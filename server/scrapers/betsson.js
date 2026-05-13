/* Scraper: Betsson AR (pba.betsson.bet.ar) — Kambi Sportsbook XP + AWS WAF
 * ============================================================================
 * DESCUBRIMIENTO 2026-05-13: Betsson AR usa Kambi Group Sportsbook XP debajo
 * (mismo provider que BetWarrior). Esto se confirmó leyendo el HTML del
 * sportsbook: los JS bundles vienen de `/dist/prod/xp/widgets/sportsbook/`
 * que es la firma estándar de Kambi SBKB.
 *
 * Cambios vs versión anterior:
 *   1) URL FIX: `/apuestas-deportivas` devuelve 404 (anti-bot). El path
 *      correcto es `/apuestas-deportivas/futbol` (200 OK sin cookies).
 *   2) Multi-URL: tirar también `/en-directo`, `/basquet`, `/tenis` para
 *      capturar más mercados.
 *   3) Intento ALTERNATIVO Kambi directo: probamos varios operator keys
 *      (`betssonarba`, `betssonpba`, etc) — si alguno responde, evitamos
 *      ScrapingBee (GRATIS). Solo si todos fallan, caemos a SBee render_js.
 *
 * Estrategia:
 *   1) Kambi direct API → si operator key funciona, GRATIS y rápido
 *   2) ScrapingBee render_js sobre pba.betsson.bet.ar/apuestas-deportivas/futbol
 *      → ~25 créditos, Kambi SPA monta odds en HTML rendered
 *   3) Playwright stealth fallback si el budget de SBee se agota
 *
 * Cache: 5min frescos × budget multiplier, hasta 30min stale-fallback.
 * ============================================================================
 */
'use strict';

const { httpJsonNative, httpViaScrapingBee, getCreditBudgetMultiplier, browserPool, log, sleep } = require('../lib');
const { CircuitBreaker } = require('../lib/retry');
const { parseKambiListView } = require('../lib/kambiJson');

// Solo 1 URL — la SPA carga toda la app desde acá
const SPORTSBOOK_URLS = [
  'https://pba.betsson.bet.ar/apuestas-deportivas/futbol'
];

// REDUCIDO: solo los 3 operator keys más probables. Antes 9 → era timeout
// (cada uno toma 12s × 9 = 108s peor caso).
const KAMBI_OPERATOR_CANDIDATES = [
  'betssonarba', 'betssonpba', 'betssoncba'
];
let validKambiOperator = null;

const KAMBI_BASES = [
  'https://us.offering-api.kambicdn.com'   // solo 1 base, la US edge
];

const KAMBI_HEADERS = {
  'Accept': 'application/json',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://pba.betsson.bet.ar',
  'Referer': 'https://pba.betsson.bet.ar/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

const scrapingBeeBreaker = new CircuitBreaker({ name: 'betsson:scrapingbee', failThreshold: 3, cooldownMs: 15 * 60_000 });
const playwrightBreaker = new CircuitBreaker({ name: 'betsson:playwright',  failThreshold: 3, cooldownMs: 20 * 60_000 });
const kambiBreaker      = new CircuitBreaker({ name: 'betsson:kambi',       failThreshold: 5, cooldownMs: 10 * 60_000 });

let cachedEvents = [];
let cachedAt = 0;

const BOOK = 'betsson';

/* ── Path 1: Kambi direct (GRATIS si encontramos el operator key) ─────────── */
async function tryKambiDirect() {
  if (kambiBreaker.state === 'OPEN') {
    kambiBreaker._maybeReset();
    if (kambiBreaker.state === 'OPEN') return null;
  }

  // Si ya descubrimos el operator key, usalo directo
  if (validKambiOperator) {
    const events = await fetchKambiOperator(validKambiOperator);
    if (events && events.length) return events;
    // Si dejó de funcionar, invalidar para re-descubrir
    validKambiOperator = null;
  }

  // Descubrimiento: probar operadores uno por uno
  for (const op of KAMBI_OPERATOR_CANDIDATES) {
    try {
      const events = await fetchKambiOperator(op);
      if (events && events.length > 0) {
        validKambiOperator = op;
        log(`[betsson:kambi] operator key descubierto: '${op}' · ${events.length} eventos`);
        return events;
      }
    } catch (e) {
      // Continuar al siguiente operator
    }
    // Pequeña pausa entre intentos para no rate-limit
    await sleep(300);
  }
  log(`[betsson:kambi] ningún operator key responde — caer a SBee`);
  return null;
}

async function fetchKambiOperator(op) {
  for (const base of KAMBI_BASES) {
    const url = `${base}/offering/v2018/${op}/listView/all.json?channel_id=7&client_id=200&lang=es_AR&market=AR&useCombined=true`;
    try {
      // Timeout corto (5s) por intento — si no responde rápido, probablemente
      // el operator key es incorrecto. NO bloquear breaker por timeouts cortos.
      const res = await httpJsonNative(url, { headers: KAMBI_HEADERS, timeout: 5000 });
      if (res && Array.isArray(res.events) && res.events.length > 0) {
        const parsed = parseKambiListView(res, BOOK);
        return parsed;
      }
    } catch (_) {}
  }
  return null;
}

/* ── Path 2: ScrapingBee render_js sobre URL correcta ─────────────────────── */
async function tryScrapingBee() {
  if (!process.env.SCRAPINGBEE_KEY) return null;
  if (scrapingBeeBreaker.state === 'OPEN') {
    scrapingBeeBreaker._maybeReset();
    if (scrapingBeeBreaker.state === 'OPEN') return null;
  }

  const all = [];
  const seen = new Set();

  for (const url of SPORTSBOOK_URLS) {
    try {
      const r = await scrapingBeeBreaker.exec(() =>
        httpViaScrapingBee(url, {
          timeout: 25000,
          premium: true,
          renderJs: true,
          country: 'ar',
          json: false,
          wait: 3000,          // 3s para Kambi SPA — suficiente sin matar timeout
          tag: `betsson:${url.split('/').pop()}`
        })
      );
      if (!r?.text) continue;
      const events = parseBetssonRendered(r.text);
      for (const ev of events) {
        const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
        if (!seen.has(key)) { seen.add(key); all.push(ev); }
      }
      log(`[betsson:sbee] ${url.split('/').pop()} → ${events.length} eventos · ${r.costCredits} créditos · ${r.text.length} bytes`);
    } catch (e) {
      if (e?.circuitOpen) { log('[betsson:sbee] circuit OPEN · skip'); break; }
      log(`[betsson:sbee] err ${url.split('/').pop()}: ${e.message?.slice(0, 150)}`);
    }
  }
  return all;
}

/* ── Parser del HTML rendered (post-JS) ────────────────────────────────────── */
function parseBetssonRendered(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();

  // Estrategia 1: JSON embebido en scripts
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  const candidates = [];
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const body = m[1];
    if (body.length < 200 || body.length > 10_000_000) continue;
    // Buscar shapes de events (Kambi usa "betOffers", "outcomes", "homeName", "awayName")
    if (!/(betOffers|homeName|awayName|criterion|outcomes|kickoff|startTime)/i.test(body)) continue;
    try { candidates.push(JSON.parse(body.trim())); continue; } catch {}
    // JSON asignado a variable
    const m2 = body.match(/(?:window\.__[A-Z_]+__|const\s+\w+|let\s+\w+|var\s+\w+)\s*=\s*(\{[\s\S]+?\});?\s*(?:<\/script>|$)/m);
    if (m2) { try { candidates.push(JSON.parse(m2[1])); } catch {} }
  }

  // Estrategia 2: si encontramos JSON con shape Kambi, usar parser estándar
  for (const root of candidates) {
    // Caso A: el JSON es { events: [...] } directo (formato Kambi)
    if (root && Array.isArray(root.events)) {
      try {
        const parsed = parseKambiListView(root, BOOK);
        for (const ev of parsed) {
          const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push(ev); }
        }
        continue;
      } catch {}
    }
    // Caso B: buscar arrays con shape de event en cualquier rama
    const events = findEventArrays(root, 0);
    for (const raw of events) {
      const parsed = normalizeBetssonEvent(raw);
      if (!parsed) continue;
      const key = `${parsed.home?.name}|${parsed.away?.name}|${parsed.start}`.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(parsed); }
    }
  }

  return out;
}

function findEventArrays(node, depth, found = []) {
  if (depth > 8 || !node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    if (node.length && looksLikeEvent(node[0])) {
      for (const it of node) if (looksLikeEvent(it)) found.push(it);
      return found;
    }
    for (const it of node) findEventArrays(it, depth + 1, found);
    return found;
  }
  for (const v of Object.values(node)) findEventArrays(v, depth + 1, found);
  return found;
}

function looksLikeEvent(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const hasHomeAway =
    (o.homeName && o.awayName) ||
    (o.home && o.away) ||
    (o.homeTeam && o.awayTeam) ||
    (Array.isArray(o.participants) && o.participants.length >= 2) ||
    (Array.isArray(o.competitors) && o.competitors.length >= 2);
  if (!hasHomeAway) return false;
  return !!(o.markets || o.odds || o.betOffers || o.bets || o.selections || o.outcomes);
}

function normalizeBetssonEvent(raw) {
  if (!raw) return null;
  // Extraer teams (Kambi usa homeName/awayName)
  let homeName = raw.homeName || raw.home?.name || raw.homeTeam?.name;
  let awayName = raw.awayName || raw.away?.name || raw.awayTeam?.name;
  if (!homeName && typeof raw.home === 'string') homeName = raw.home;
  if (!awayName && typeof raw.away === 'string') awayName = raw.away;
  if (!homeName && Array.isArray(raw.participants) && raw.participants[0]) {
    homeName = raw.participants[0].name || raw.participants[0].displayName;
    awayName = raw.participants[1]?.name || raw.participants[1]?.displayName;
  }
  if (!homeName && Array.isArray(raw.competitors) && raw.competitors[0]) {
    homeName = raw.competitors[0].name || raw.competitors[0].displayName;
    awayName = raw.competitors[1]?.name || raw.competitors[1]?.displayName;
  }
  if (!homeName || !awayName) return null;

  const start = raw.start || raw.startTime || raw.kickoff || raw.startsAt || raw.scheduledStart;
  const startMs = start ? new Date(start).getTime() : null;
  if (!Number.isFinite(startMs)) return null;

  const leagueName = raw.group || raw.path?.[raw.path.length - 1]?.name || raw.competition?.name || raw.league?.name || raw.leagueName;

  const sportRaw = String(raw.sport || raw.sport?.name || raw.sportName || '').toLowerCase();
  const sport = sportRaw.includes('basket') ? 'basketball'
              : sportRaw.includes('tennis') ? 'tennis'
              : sportRaw.includes('hockey') ? 'hockey'
              : sportRaw.includes('baseball') ? 'baseball'
              : sportRaw.includes('american') || sportRaw.includes('amfootball') ? 'amfootball'
              : sportRaw.includes('mma') || sportRaw.includes('boxing') ? 'mma'
              : 'soccer';

  const markets = extractBetssonMarkets(raw);
  if (!markets.h2h && !markets.totals && !markets.btts && !markets.dc) return null;

  return {
    home: { name: String(homeName).trim() },
    away: { name: String(awayName).trim() },
    start: startMs,
    league: null,
    leagueName: leagueName || null,
    sport,
    markets: {
      ...(markets.h2h    ? { h2h:    { [BOOK]: markets.h2h }    } : {}),
      ...(markets.totals ? { totals: { [BOOK]: markets.totals } } : {}),
      ...(markets.btts   ? { btts:   { [BOOK]: markets.btts }   } : {}),
      ...(markets.dc     ? { dc:     { [BOOK]: markets.dc }     } : {})
    }
  };
}

function extractBetssonMarkets(raw) {
  const out = {};
  const mList = []
    .concat(raw.betOffers || [])
    .concat(raw.markets || [])
    .concat(raw.bets || [])
    .concat(raw.odds || []);

  for (const m of mList) {
    if (!m) continue;
    // Kambi: outcomes; otros: selections/runners
    const sel = m.outcomes || m.selections || m.runners || m.results || [];
    const name = String(m.name || m.marketName || m.criterion?.label || m.type || m.shortName || '').toLowerCase();
    const cid = m.criterion?.id;

    // 1X2 / Resultado / h2h
    if (!out.h2h && (cid === 1001159858 || /(1x2|resultado|moneyline|h2h|ganador|winner|3.?way|match\s+result)/.test(name)) && sel.length >= 2) {
      const findOut = (re) => sel.find(s => re.test(String(s.label || s.name || s.type || '')));
      const h = findOut(/^1\b|home|local|OT_ONE/i);
      const d = findOut(/^x\b|empate|draw|tie|OT_CROSS/i);
      const a = findOut(/^2\b|away|visit|OT_TWO/i);
      const h2h = {
        home: parsePrice(h?.odds ?? h?.price ?? h?.odd ?? sel[0]?.odds),
        draw: parsePrice(d?.odds ?? d?.price ?? d?.odd),
        away: parsePrice(a?.odds ?? a?.price ?? a?.odd ?? sel[sel.length - 1]?.odds)
      };
      if (Number.isFinite(h2h.home) || Number.isFinite(h2h.away)) out.h2h = h2h;
    } else if (!out.totals && (cid === 1001159926 || /(total|over|under|m.s|menos)/.test(name))) {
      const line = m.line || m.handicap || sel[0]?.line || sel[0]?.handicap || sel[0]?.point;
      const ov = sel.find(s => /over|m.s|OT_OVER/i.test(String(s.label || s.name || s.type || '')));
      const un = sel.find(s => /under|menos|OT_UNDER/i.test(String(s.label || s.name || s.type || '')));
      const numLine = Number(line);
      if (Number.isFinite(numLine) && (ov || un)) {
        // Si line viene en milliunits (Kambi: 25 = 2.5), normalizar
        const finalLine = numLine > 100 ? numLine / 1000 : numLine;
        out.totals = {
          [finalLine]: {
            line: finalLine,
            over: parsePrice(ov?.odds ?? ov?.price ?? ov?.odd),
            under: parsePrice(un?.odds ?? un?.price ?? un?.odd)
          }
        };
      }
    } else if (!out.btts && (cid === 1001642858 || /(btts|ambos|both.*score|ambos.*marcar)/.test(name))) {
      const y = sel.find(s => /yes|s.?$|OT_YES/i.test(String(s.label || s.name || s.type || '')));
      const n = sel.find(s => /^no\b|OT_NO/i.test(String(s.label || s.name || s.type || '')));
      const btts = {
        yes: parsePrice(y?.odds ?? y?.price ?? y?.odd),
        no:  parsePrice(n?.odds ?? n?.price ?? n?.odd)
      };
      if (Number.isFinite(btts.yes) || Number.isFinite(btts.no)) out.btts = btts;
    } else if (!out.dc && (cid === 1001159922 || /(doble|double\s+chance|dc)/.test(name))) {
      const hd = sel.find(s => /1x|home.*draw|local.*empate|OT_ONE_OR_CROSS/i.test(String(s.label || s.name || s.type || '')));
      const da = sel.find(s => /x2|draw.*away|empate.*visit|OT_CROSS_OR_TWO/i.test(String(s.label || s.name || s.type || '')));
      const ha = sel.find(s => /12|home.*away|local.*visit|OT_ONE_OR_TWO/i.test(String(s.label || s.name || s.type || '')));
      const dc = {
        home_or_draw: parsePrice(hd?.odds ?? hd?.price ?? hd?.odd),
        draw_or_away: parsePrice(da?.odds ?? da?.price ?? da?.odd),
        home_or_away: parsePrice(ha?.odds ?? ha?.price ?? ha?.odd)
      };
      if (Number.isFinite(dc.home_or_draw) || Number.isFinite(dc.draw_or_away)) out.dc = dc;
    }
  }
  return out;
}

function parsePrice(v) {
  if (v == null) return null;
  let n;
  if (typeof v === 'number') {
    // Kambi devuelve odds en milliunits: 1960 = 1.96
    n = v > 100 ? v / 1000 : v;
  } else {
    n = parseFloat(String(v).replace(',', '.').replace(/[^\d.+\-]/g, ''));
  }
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? Number(n.toFixed(3)) : null;
}

/* ── Path 3: Playwright fallback ──────────────────────────────────────────── */
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
        try {
          const url = res.url();
          if (!/(kambi|betsson|sb-xp|sportsbook|offering)/i.test(url)) return;
          const ct = (res.headers()['content-type'] || '').toLowerCase();
          if (!ct.includes('json')) return;
          const json = await res.json().catch(() => null);
          if (json && typeof json === 'object') captured.push({ url, json });
        } catch (_) {}
      });

      // Cargar primero el home para cookies, luego sportsbook
      await page.goto('https://pba.betsson.bet.ar/', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(2000);
      await page.goto('https://pba.betsson.bet.ar/apuestas-deportivas/futbol', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
      await sleep(6000);  // Kambi SPA monta los eventos
      await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
      await sleep(2000);
      const html = await page.content().catch(() => '');
      captured.push({ url: 'page-html', html, json: null });

      if (!captured.some(c => c.json) && !html) throw new Error('no-content-captured');
    });
  } catch (e) {
    log(`[betsson:playwright] err: ${e.message}${e.circuitOpen ? ' · circuit OPEN' : ''}`);
  } finally {
    if (ctx) try { await ctx.close(); } catch {}
  }

  const out = [];
  const seen = new Set();
  for (const c of captured) {
    if (c.json) {
      // Si es shape Kambi, usar parser
      if (Array.isArray(c.json.events)) {
        try {
          const evs = parseKambiListView(c.json, BOOK);
          for (const ev of evs) {
            const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
            if (!seen.has(key)) { seen.add(key); out.push(ev); }
          }
        } catch {}
      } else {
        const events = findEventArrays(c.json, 0);
        for (const raw of events) {
          const parsed = normalizeBetssonEvent(raw);
          if (!parsed) continue;
          const key = `${parsed.home?.name}|${parsed.away?.name}|${parsed.start}`.toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push(parsed); }
        }
      }
    }
    if (c.html) {
      const evs = parseBetssonRendered(c.html);
      for (const ev of evs) {
        const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
        if (!seen.has(key)) { seen.add(key); out.push(ev); }
      }
    }
  }
  log(`[betsson:playwright] ${out.length} eventos extraídos`);
  return out;
}

async function scrape() {
  const t0 = Date.now();
  const baseCacheMs = Number(process.env.BETSSON_CACHE_MS) || 5 * 60_000;
  const cacheTtl = process.env.SCRAPINGBEE_KEY
    ? baseCacheMs * getCreditBudgetMultiplier()
    : baseCacheMs;
  if (cachedEvents.length && Date.now() - cachedAt < cacheTtl) return cachedEvents;

  // GUARD: Betsson scraper quemaba ~3200 créditos SBee con 0 eventos.
  // Hasta encontrar el Kambi operator key correcto o el HTML parser
  // funcional, mantenemos OFF por default. Set ENABLE_BETSSON_SCRAPER=true
  // para reactivar (asumir el costo + investigar el endpoint correcto).
  if (process.env.ENABLE_BETSSON_SCRAPER !== 'true') {
    log('[betsson] DESACTIVADO por default (ENABLE_BETSSON_SCRAPER=true para activar)');
    return [];
  }

  let events = null;
  let via = null;

  // PATH 1: Kambi direct (gratis)
  const kambiRes = await tryKambiDirect();
  if (kambiRes && kambiRes.length) { events = kambiRes; via = 'kambi'; }

  // PATH 2: ScrapingBee render_js
  if (!events?.length) {
    const sbeeRes = await tryScrapingBee();
    if (sbeeRes && sbeeRes.length) { events = sbeeRes; via = 'sbee'; }
  }

  // PATH 3: Playwright
  if (!events?.length) {
    events = await tryPlaywright();
    via = 'playwright';
  }

  if (events?.length) {
    cachedEvents = events;
    cachedAt = Date.now();
    log(`[betsson:${via}] ${events.length} eventos · ${Date.now() - t0}ms`);
    return events;
  }

  // Stale fallback
  const staleTtl = 30 * 60_000;
  if (cachedEvents.length && Date.now() - cachedAt < staleTtl) {
    log(`[betsson] all paths failed · serving cache (${cachedEvents.length})`);
    return cachedEvents;
  }

  log(`[betsson] no data · 0 events`);
  return [];
}

scrape.breakers = {
  kambi: kambiBreaker,
  scrapingbee: scrapingBeeBreaker,
  playwright: playwrightBreaker
};

scrape.clearCache = () => { cachedEvents = []; cachedAt = 0; validKambiOperator = null; };

module.exports = scrape;
