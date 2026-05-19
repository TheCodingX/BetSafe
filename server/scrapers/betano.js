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

const { httpJson, httpJsonNative, httpJsonViaScrapingBee, getCreditBudgetMultiplier, browserPool, log, sleep } = require('../lib');
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
// Cloudflare Worker proxy breaker — si configurado y funciona, es el path PRIMARIO.
// failThreshold mayor (4) porque es más confiable que SBee. cooldown corto (3min).
const cfProxyBreaker = new CircuitBreaker({ name: 'betano:cfproxy', failThreshold: 4, cooldownMs: 3 * 60_000 });

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

/* PRIMARY path: Cloudflare Worker proxy.
 * El Worker corre en la red de CF → su outbound IP es CF → Betano (también
 * detrás de CF) NO devuelve splash 403. Es la solución gratis sustentable
 * cuando ScrapingBee tiene quota agotada o key inválida.
 *
 * Se activa solo si CF_PROXY_URL está en env vars. Sin esto, retorna null.
 *
 * Cost: $0 con Workers Free 100k req/día.
 * Deploy del worker: ver /cf-worker/README.md.
 */
async function tryCloudflareProxy() {
  const proxyUrl = process.env.CF_PROXY_URL;
  if (!proxyUrl) return null;
  if (cfProxyBreaker.state === 'OPEN') {
    cfProxyBreaker._maybeReset();
    if (cfProxyBreaker.state === 'OPEN') return null;
  }

  const proxyHeaders = process.env.CF_PROXY_KEY
    ? { 'x-proxy-key': process.env.CF_PROXY_KEY }
    : {};

  const seen = new Set();
  const out = [];
  let anyOk = false;
  let lastErr = null;

  // Los 3 endpoints en serie (el Worker tiene cache CF de 30s, las llamadas
  // repetidas son baratas). En paralelo arriesgaría rate-limit del Worker.
  for (const url of ENDPOINTS) {
    try {
      const json = await cfProxyBreaker.exec(() => withRetry(
        () => httpJson(`${proxyUrl}/?url=${encodeURIComponent(url)}`, {
          headers: proxyHeaders,
          timeout: 18000
        }),
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
      lastErr = e;
      if (e?.circuitOpen) { log(`[betano-json:cfproxy] circuit OPEN · skip rest`); break; }
      log(`[betano-json:cfproxy] err ${url.split('?')[0].slice(-40)}: ${e.message?.slice(0, 100)}`);
    }
  }
  if (out.length) log(`[betano-json:cfproxy] ${out.length} eventos via CF Worker proxy`);
  return anyOk ? out : null;
}

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

/* Slow path: Playwright headless con stealth.
 *
 * ESTRATEGIA DOBLE+MULTI-PAGE (passive + active):
 *  1) PASIVO: listen page.on('response') para capturar CUALQUIER JSON que la
 *     SPA pida. Filtramos por shape de eventos en parser.
 *  2) ACTIVO: una vez que el challenge JS de Cloudflare clearea el browser
 *     (cookie cf_clearance set), usamos page.evaluate para llamar a los
 *     endpoints DESDE DENTRO del browser. Cookies + TLS fingerprint coinciden.
 *  3) MULTI-PAGE: navegamos a home → /futbol/ → /live/ → mobile (m.betano.*)
 *     dentro de la MISMA sesión browser. Cada navegación dispara nuevos XHR
 *     y le da más tiempo a CF challenge para clearear.
 *
 * En IPs cloud (Render) CF puede bloquear permanentemente. El stale-fallback
 * de 4h en scrape() asegura que la UI no quede vacía mientras CF nos banea. */
async function tryPlaywright() {
  if (playwrightBreaker.state === 'OPEN') {
    playwrightBreaker._maybeReset();
    if (playwrightBreaker.state === 'OPEN') return [];
  }
  const captured = [];
  const debug = { activeOk: 0, activeTotal: 0, cfCleared: false, pagesNavigated: 0, status: {} };
  let ctx = null;
  try {
    await playwrightBreaker.exec(async () => {
      // blockResources=false: necesitamos que CF ejecute su challenge JS
      // (requiere images/fonts/scripts cargando). Aceptamos el costo CPU
      // porque cache es 8min y este path solo corre cuando direct+sbee fallan.
      const handle = await browserPool.newPage({ blockResources: false });
      ctx = handle.ctx;
      const page = handle.page;

      // PASIVO: capturar TODO JSON de dominios betano/kaizen. El parser
      // determinará cuál tiene events. URLs específicas se quedan obsoletas
      // cada vez que Kaizen actualiza su API.
      page.on('response', async (res) => {
        try {
          const url = res.url();
          if (!/\.(betano|kaizengaming)\./.test(url)) return;
          if (res.status() !== 200) return;
          const ct = res.headers()['content-type'] || '';
          if (!ct.includes('json')) return;
          const json = await res.json().catch(() => null);
          if (!json || typeof json !== 'object') return;
          // Solo procesamos JSONs que se parezcan a payloads de eventos:
          // - Formato A (flat dict): events + markets + selections
          // - Formato B (nested): topEvents array
          const a = json.events && json.markets && json.selections;
          const a2 = json.data?.events && json.data?.markets && json.data?.selections;
          const b = Array.isArray(json.data?.topEvents) || Array.isArray(json.topEvents);
          if (a || a2 || b) captured.push({ url, json });
        } catch (e) {
          // No silenciar: si captura/parse falla recurrentemente, queremos saber
          if (Math.random() < 0.05) log(`[betano-json] capture err: ${e.message?.slice(0, 80)}`);
        }
      });

      // Helper: chequear si CF clearance cookie está set (señal robusta de bypass)
      const hasCfClearance = async () => {
        try {
          const cookies = await ctx.cookies('https://www.betano.bet.ar/');
          return cookies.some(c => c.name === 'cf_clearance' || c.name === '__cf_bm');
        } catch { return false; }
      };

      // FASE 1: home — dispara CF challenge + carga SPA shell
      try {
        await page.goto('https://www.betano.bet.ar/', { waitUntil: 'commit', timeout: 30000 });
        debug.pagesNavigated++;
      } catch (_) {}

      // Esperar hasta 25s a que CF challenge clear: el body sale del splash
      // screen o aparece la cookie cf_clearance. CF en Render puede tardar 5-15s.
      await page.waitForFunction(() => {
        const text = document.body?.innerText || '';
        const hasSplash = /splash\s*screen|just a moment|verificando|checking your browser|attention required/i.test(text);
        const hasContent = text.length > 200 || document.querySelector('main, [class*=event], [class*=match], [class*=odds]');
        return !hasSplash && hasContent;
      }, { timeout: 25000 }).catch(() => {});
      debug.cfCleared = await hasCfClearance();
      await sleep(2000); // grace period para que SPA hidrate

      // ACTIVO: NAVEGAR (no fetch) a cada JSON endpoint. Verificado 2026-05-18:
      // CF clearance cookie funciona para page navigations pero NO para fetch()
      // API calls (CF aplica policy diferenciada). Al navegar a la URL del JSON,
      // CF lo trata como page-load y nos deja pasar.
      const endpoints = [
        'https://www.betano.bet.ar/api/home/top-events-v2/',
        'https://www.betano.bet.ar/api/home/top-events',
        'https://www.betano.bet.ar/danae-webapi/api/live/overview/latest?includeVirtuals=true&queryLanguageId=8&queryOperatorId=19'
      ];

      for (const url of endpoints) {
        try {
          const res = await page.goto(url, { waitUntil: 'commit', timeout: 18000 });
          const status = res?.status() || 0;
          debug.activeTotal++;
          const shortKey = url.split('/').slice(-1)[0].split('?')[0] || url;
          debug.status[shortKey] = status;
          if (status !== 200) continue;
          // Body es JSON puro renderizado como text/json. document.body.innerText lo contiene.
          const jsonText = await page.evaluate(() => {
            // Algunos browsers wrappean JSON en <pre>, otros lo dejan en body
            const pre = document.querySelector('pre');
            return (pre?.textContent || document.body?.innerText || '').trim();
          }).catch(() => '');
          if (!jsonText) continue;
          let json;
          try { json = JSON.parse(jsonText); }
          catch { continue; }
          if (json && typeof json === 'object') {
            captured.push({ url, json });
            debug.activeOk++;
          }
        } catch (e) {
          debug.status[`err:${url.split('/').slice(-1)[0].slice(0,30)}`] = String(e.message).slice(0, 30);
        }
      }
      debug.pagesNavigated += endpoints.length;

      // FASE 2: si nada todavía, intentar mobile site (m.betano.*) que tiene
      // distinto CF rules que el desktop site
      if (!captured.length) {
        try {
          await page.goto('https://m.betano.bet.ar/', { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
          await sleep(2500);
          for (const url of endpoints) {
            const mobUrl = url.replace('://www.', '://m.');
            try {
              const res = await page.goto(mobUrl, { waitUntil: 'commit', timeout: 15000 });
              if (res?.status() !== 200) continue;
              const t = await page.evaluate(() => document.body?.innerText?.trim() || '').catch(() => '');
              if (!t) continue;
              const j = JSON.parse(t);
              if (j && typeof j === 'object') captured.push({ url: mobUrl, json: j });
            } catch (_) {}
          }
        } catch (_) {}
      }

      if (!captured.length) {
        const st = Object.entries(debug.status).map(([k, v]) => `${k}=${v}`).join(',');
        throw new Error(`no-json-captured · active=${debug.activeOk}/${debug.activeTotal} · cf=${debug.cfCleared?'Y':'N'} · pages=${debug.pagesNavigated} · ${st}`);
      }
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
    try {
      const events = parseBetanoJson(json);
      for (const ev of events) {
        const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ev);
      }
    } catch (e) {
      if (Math.random() < 0.05) log(`[betano-json] parse err: ${e.message?.slice(0, 80)}`);
    }
  }
  return out;
}

/* ScrapingBee path: para deploys cloud (Render, Fly, etc.) donde Cloudflare
 * blackholea la IP. Activado solo si SCRAPINGBEE_KEY está en env.
 *
 * Pega a LOS 3 ENDPOINTS de betano (live + top-v2 + top-events) en paralelo
 * para cobertura completa. Los responses se mergean por (home|away|start).
 *
 * Costo: ~10 créditos × 3 endpoints = 30 créditos por ciclo. Con cache de
 * 8min y plan Freelance 250k:
 *   30 créditos × 60/8 calls/hr × 24h × 30d = 162k/mes (60% del plan).
 *
 * Tunable via env vars:
 *   - BETANO_SBEE_ENDPOINTS=live,top   (subset de los 3 para ahorrar)
 *   - BETANO_CACHE_MS=480000           (8min default)
 */
const ENDPOINT_TAGS = ['live', 'top-v2', 'top'];

async function tryScrapingBee() {
  if (!process.env.SCRAPINGBEE_KEY) return null;  // null = "no configurada, skip"
  if (scrapingBeeBreaker.state === 'OPEN') {
    scrapingBeeBreaker._maybeReset();
    if (scrapingBeeBreaker.state === 'OPEN') return null;
  }

  // Determinar qué endpoints pegar (tunable via env). Default = los 3.
  const wantedSet = (process.env.BETANO_SBEE_ENDPOINTS || 'live,top-v2,top')
    .split(',').map(s => s.trim()).filter(Boolean);
  const tasks = ENDPOINTS.map((url, i) => ({ url, tag: ENDPOINT_TAGS[i] }))
    .filter(t => wantedSet.includes(t.tag));

  if (!tasks.length) return [];

  // Ejecutamos en paralelo — los 3 endpoints son independientes.
  const results = await Promise.all(tasks.map(async ({ url, tag }) => {
    try {
      return await scrapingBeeBreaker.exec(() =>
        httpJsonViaScrapingBee(url, { timeout: 35000, premium: true, renderJs: false, country: 'ar', tag: `betano:${tag}` })
      );
    } catch (e) {
      if (e?.circuitOpen) return null;
      log(`[betano-json:sbee:${tag}] err: ${e.message?.slice(0, 150)}`);
      return null;
    }
  }));

  // Merge dedup por (home|away|start)
  const seen = new Set();
  const out = [];
  let totalCredits = 0;
  let oks = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r?.json) continue;
    oks++;
    totalCredits += r.costCredits || 0;
    const events = parseBetanoJson(r.json);
    for (const ev of events) {
      const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ev);
    }
  }

  if (oks > 0) {
    log(`[betano-json:sbee] ${out.length} eventos · ${oks}/${tasks.length} endpoints OK · ${totalCredits} créditos`);
    return out;
  }
  return [];
}

async function scrape() {
  const t0 = Date.now();
  // Si tenemos ScrapingBee: cache 8min × budget multiplier (2x/4x si quota bajo).
  // Si no: cache 1min original (sin proxy de pago, podemos darle más vueltas).
  const baseCacheTtl = process.env.SCRAPINGBEE_KEY
    ? Number(process.env.BETANO_CACHE_MS) || 8 * 60_000
    : 60_000;
  const cacheTtl = process.env.SCRAPINGBEE_KEY
    ? baseCacheTtl * getCreditBudgetMultiplier()
    : baseCacheTtl;
  if (cachedEvents.length && Date.now() - cachedAt < cacheTtl) return cachedEvents;

  // ORDEN DE PRIORIDAD (path PRIMARIO al fondo de la cascada):
  //   1) CF Worker proxy (gratis, real-time, funciona aunque CF bloquee Render IP)
  //   2) ScrapingBee (pago, mejor si quota+key OK)
  //   3) Direct HTTPS (suele 403 desde cloud IPs por CF)
  //   4) Playwright (CPU-pesado, último recurso)
  let events = null;
  let via = null;

  // CF Worker — si está configurado (CF_PROXY_URL set), es el primer intento
  const cfResult = await tryCloudflareProxy();
  if (cfResult && cfResult.length) {
    events = cfResult;
    via = 'cfproxy';
  }

  if (!events?.length) {
    const sbeeResult = await tryScrapingBee();
    if (sbeeResult && sbeeResult.length) {
      events = sbeeResult;
      via = 'sbee';
    }
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

  // Stale-fallback agresivo: cuotas de hace 4h son MUY preferibles a 0 cuotas
  // (especialmente cuando Cloudflare bloquea todas las paths). En el peor caso
  // ya elevamos a 4h porque sin SBee este scraper depende solo de Playwright,
  // que CF puede bloquear sostenidamente. La UI muestra el age de las cuotas.
  const staleTtl = 4 * 60 * 60_000;  // 4h max stale
  if (cachedEvents.length && Date.now() - cachedAt < staleTtl) {
    const ageMin = Math.round((Date.now() - cachedAt) / 60_000);
    log(`[betano-json] all paths failed · serving stale cache (${cachedEvents.length} ev · ${ageMin}min old)`);
    return cachedEvents;
  }

  log(`[betano-json] no data · 0 events · ${Date.now() - t0}ms`);
  return [];
}

// Exponemos los breakers para que /api/breakers refleje el estado real.
// `direct` cubre native HTTPS (vulnerable a Cloudflare TLS fingerprint);
// `playwright` cubre el fallback con browser real;
// `scrapingbee` cubre el proxy-as-a-service (cuando SCRAPINGBEE_KEY está set).
scrape.breakers = {
  cfproxy: cfProxyBreaker,
  direct: directBreaker,
  playwright: playwrightBreaker,
  scrapingbee: scrapingBeeBreaker
};

// Permite a /api/sources/refresh forzar bypass del cache (e.g. antes de un partido).
scrape.clearCache = () => { cachedEvents = []; cachedAt = 0; };

module.exports = scrape;
