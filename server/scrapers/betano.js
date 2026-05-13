/* Scraper: Betano AR (Kaizen Gaming — betano.bet.ar)
 * ============================================================================
 * Betano expone endpoints JSON públicos con todo el catálogo (Kaizen flat dict
 * y nested-array format). Sin embargo Cloudflare aplica TLS fingerprinting que
 * bloquea undici/native-https con 403 Splash si la IP fue marcada.
 *
 * Estrategia (en orden):
 *   1) Native https con headers tipo Chrome — rápido cuando funciona (~150ms).
 *   2) Playwright + stealth — interceptamos los responses XHR/fetch hechos por
 *      la propia SPA al cargar la home. Mismo JSON, sin TLS fingerprinting.
 *
 * Parser: lib/betanoJson.js
 * Cache: 60s frescos, hasta 5min stale-fallback.
 * ============================================================================
 */
'use strict';

const { httpJsonNative, httpJsonViaScrapingBee, browserPool, log, sleep } = require('../lib');
const { parseBetanoJson } = require('../lib/betanoJson');
const { withRetry, CircuitBreaker } = require('../lib/retry');

// Breaker para el path nativo de Betano (vulnerable a Cloudflare).
// failThreshold bajo → cuando empieza a banear, paramos rápido y caemos
// a Playwright que tiene su propio breaker.
const directBreaker = new CircuitBreaker({ name: 'betano:direct', failThreshold: 3, cooldownMs: 90_000 });
// Playwright breaker independiente — más conservador (es caro abrirlo).
const playwrightBreaker = new CircuitBreaker({ name: 'betano:playwright', failThreshold: 3, cooldownMs: 120_000 });
// ScrapingBee breaker — si quota agotada o API key inválida, no insistas
// cada 30s. cooldown 10min para no quemar requests inútiles.
const scrapingBeeBreaker = new CircuitBreaker({ name: 'betano:scrapingbee', failThreshold: 2, cooldownMs: 10 * 60_000 });

const ENDPOINTS = [
  'https://www.betano.bet.ar/danae-webapi/api/live/overview/latest?includeVirtuals=true&queryLanguageId=8&queryOperatorId=19',
  'https://www.betano.bet.ar/api/home/top-events-v2/',
  'https://www.betano.bet.ar/api/home/top-events'
];

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://www.betano.bet.ar',
  'Referer': 'https://www.betano.bet.ar/',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

let cachedEvents = [];
let cachedAt = 0;

/* Fast path: native HTTPS directo a los endpoints JSON.
 * Si el breaker está OPEN (Cloudflare nos baneó), salimos sin esfuerzo
 * y dejamos que el caller caiga a Playwright. */
async function tryDirect() {
  if (directBreaker.state === 'OPEN') {
    directBreaker._maybeReset();
    if (directBreaker.state === 'OPEN') return [];
  }
  const seen = new Set();
  const out = [];
  let anyOk = false;
  for (const url of ENDPOINTS) {
    try {
      const json = await directBreaker.exec(() => withRetry(
        () => httpJsonNative(url, { headers: HEADERS, timeout: 12000 }),
        { maxAttempts: 2, baseMs: 600 }
      ));
      if (!json) continue;
      anyOk = true;
      const events = parseBetanoJson(json);
      for (const ev of events) {
        const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ev);
      }
    } catch (e) {
      if (e?.circuitOpen) { log(`[betano-json:direct] circuit OPEN · skip ${url}`); break; }
      log(`[betano-json:direct] err ${url.split('?')[0].slice(-60)}: ${e.message?.slice(0, 120)}`);
    }
  }
  return out;
}

/* Slow path: navegamos a la home con Playwright y interceptamos los JSON
 * que la propia SPA pide. Bypass natural de Cloudflare.
 * Si el breaker está OPEN no intentamos (Playwright es CPU-pesado). */
async function tryPlaywright() {
  if (playwrightBreaker.state === 'OPEN') {
    playwrightBreaker._maybeReset();
    if (playwrightBreaker.state === 'OPEN') return [];
  }
  const captured = [];
  let ctx = null;
  try {
    await playwrightBreaker.exec(async () => {
      const handle = await browserPool.newPage({ blockResources: true });
      ctx = handle.ctx;
      const page = handle.page;
      page.on('response', async (res) => {
        const url = res.url();
        const isBetanoApi =
          /\/danae-webapi\/api\/live\/overview\/latest/.test(url) ||
          /\/api\/home\/top-events(-v2)?/.test(url);
        if (!isBetanoApi) return;
        try {
          if (res.status() !== 200) return;
          const ct = res.headers()['content-type'] || '';
          if (!ct.includes('json')) return;
          const json = await res.json().catch(() => null);
          if (json) captured.push({ url, json });
        } catch (_) {}
      });
      await page.goto('https://www.betano.bet.ar/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(3500);
      // Visitar sección live para forzar la llamada al endpoint live-overview
      await page.goto('https://www.betano.bet.ar/live/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(3000);
      // Si no capturamos nada, lo contamos como fallo
      if (!captured.length) throw new Error('no-json-captured');
    });
  } catch (e) {
    const stackLine = (e.stack || '').split('\n').slice(1, 3).join(' | ').replace(/\s+/g, ' ').slice(0, 200);
    log(`[betano-json] playwright err: ${e.message}${e.circuitOpen ? ' · circuit OPEN' : ''} · ${stackLine}`);
  } finally {
    if (ctx) try { await ctx.close(); } catch {}
  }

  const seen = new Set();
  const out = [];
  for (const { json } of captured) {
    const events = parseBetanoJson(json);
    for (const ev of events) {
      const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ev);
    }
  }
  return out;
}

/* ScrapingBee path: para deploys cloud (Render, Fly, etc.) donde Cloudflare
 * blackholea la IP. Activado solo si SCRAPINGBEE_KEY está en env.
 *
 * Costo: ~10 créditos/req con premium_proxy. Para conservar quota free,
 * pegamos SOLO al endpoint de live overview (el más valioso para arbitrage).
 * Cache propio: 5 minutos.
 */
async function tryScrapingBee() {
  if (!process.env.SCRAPINGBEE_KEY) return null;  // null = "no configurada, skip"
  if (scrapingBeeBreaker.state === 'OPEN') {
    scrapingBeeBreaker._maybeReset();
    if (scrapingBeeBreaker.state === 'OPEN') return null;
  }
  // Solo el endpoint live para minimizar gasto de créditos.
  // top-events-v2/top-events son redundantes con live-overview.
  const url = ENDPOINTS[0];
  try {
    const { json, costCredits, status } = await scrapingBeeBreaker.exec(() =>
      httpJsonViaScrapingBee(url, { timeout: 35000, premium: true, renderJs: false, country: 'ar' })
    );
    if (!json) return [];
    const events = parseBetanoJson(json);
    log(`[betano-json:sbee] ${events.length} eventos · ${costCredits} créditos · target=${status}`);
    return events;
  } catch (e) {
    if (e?.circuitOpen) {
      log(`[betano-json:sbee] circuit OPEN · skip`);
      return null;
    }
    log(`[betano-json:sbee] err: ${e.message?.slice(0, 200)}`);
    return [];
  }
}

async function scrape() {
  const t0 = Date.now();
  // Si tenemos ScrapingBee: cache 5min (conservar créditos).
  // Si no: cache 1min original (sin proxy de pago, podemos darle más vueltas).
  const cacheTtl = process.env.SCRAPINGBEE_KEY ? 5 * 60_000 : 60_000;
  if (cachedEvents.length && Date.now() - cachedAt < cacheTtl) return cachedEvents;

  // Cuando hay ScrapingBee, es el path PRIMARIO (es el único que funciona
  // bajo Cloudflare desde IPs cloud). Si falla o no está, caemos a direct + PW.
  let events = null;
  let via = null;

  const sbeeResult = await tryScrapingBee();
  if (sbeeResult && sbeeResult.length) {
    events = sbeeResult;
    via = 'sbee';
  }

  if (!events?.length) {
    events = await tryDirect();
    via = 'direct';
  }
  if (!events?.length) {
    events = await tryPlaywright();
    via = 'playwright';
  }

  if (events?.length) {
    cachedEvents = events;
    cachedAt = Date.now();
    log(`[betano-json:${via}] ${events.length} eventos · ${Date.now() - t0}ms`);
    return events;
  }

  if (cachedEvents.length && Date.now() - cachedAt < 15 * 60_000) {
    log(`[betano-json] all paths failed · serving cache (${cachedEvents.length})`);
    return cachedEvents;
  }

  log(`[betano-json] no data · 0 events`);
  return [];
}

// Exponemos los breakers para que /api/breakers refleje el estado real.
// `direct` cubre native HTTPS (vulnerable a Cloudflare TLS fingerprint);
// `playwright` cubre el fallback con browser real;
// `scrapingbee` cubre el proxy-as-a-service (cuando SCRAPINGBEE_KEY está set).
scrape.breakers = {
  direct: directBreaker,
  playwright: playwrightBreaker,
  scrapingbee: scrapingBeeBreaker
};

module.exports = scrape;
