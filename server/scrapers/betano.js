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

const { httpJsonNative, browserPool, log, sleep } = require('../lib');
const { parseBetanoJson } = require('../lib/betanoJson');
const { withRetry, CircuitBreaker } = require('../lib/retry');

// Breaker para el path nativo de Betano (vulnerable a Cloudflare).
// failThreshold bajo → cuando empieza a banear, paramos rápido y caemos
// a Playwright que tiene su propio breaker.
const directBreaker = new CircuitBreaker({ name: 'betano:direct', failThreshold: 3, cooldownMs: 90_000 });
// Playwright breaker independiente — más conservador (es caro abrirlo).
const playwrightBreaker = new CircuitBreaker({ name: 'betano:playwright', failThreshold: 3, cooldownMs: 120_000 });

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

async function scrape() {
  const t0 = Date.now();
  if (cachedEvents.length && Date.now() - cachedAt < 60_000) return cachedEvents;

  // Fast path
  let events = await tryDirect();
  let via = 'direct';
  if (!events.length) {
    events = await tryPlaywright();
    via = 'playwright';
  }

  if (events.length) {
    cachedEvents = events;
    cachedAt = Date.now();
    log(`[betano-json:${via}] ${events.length} eventos · ${Date.now() - t0}ms`);
    return events;
  }

  if (cachedEvents.length && Date.now() - cachedAt < 5 * 60_000) {
    log(`[betano-json] both paths failed · serving cache (${cachedEvents.length})`);
    return cachedEvents;
  }

  log(`[betano-json] no data · 0 events`);
  return [];
}

// Exponemos AMBOS breakers para que /api/breakers refleje el estado real.
// `direct` cubre native HTTPS (vulnerable a Cloudflare TLS fingerprint);
// `playwright` cubre el fallback con browser real.
scrape.breakers = { direct: directBreaker, playwright: playwrightBreaker };

module.exports = scrape;
