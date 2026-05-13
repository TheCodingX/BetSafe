/* Scraper: Betsson AR (pba.betsson.bet.ar) — Sportsbook SPA con AWS WAF
 * ============================================================================
 * Betsson AR opera bajo licencia LOTBA en `pba.betsson.bet.ar/apuestas-deportivas`.
 * Su plataforma es un SPA propietario (NO Kambi) protegido con AWS WAF.
 *
 * Estrategia:
 *   1) ScrapingBee con `render_js:true + premium_proxy` — bypass WAF y captura
 *      la HTML renderizada. Cost: ~25 créditos/req (premium + JS rendering).
 *   2) Playwright stealth como fallback si el budget de ScrapingBee se agota o
 *      el call falla. Carga la SPA + intercepta XHRs.
 *
 * Parsing: extrae odds desde el HTML renderizado (data embebida en
 * window.__SBKB_INITIAL_STATE__ o estructuras DOM con clases conocidas).
 *
 * NO hay path nativo HTTPS — AWS WAF bloquea inmediatamente sin JS.
 *
 * Cache server-side: 5min frescos, hasta 30min stale-fallback.
 * Tunable: BETSSON_CACHE_MS (default 5min), BETSSON_SBEE_MAX_CALLS_HR (rate limit).
 *
 * Costo estimado: 25 créditos × 12 calls/hr × 24h × 30d = ~216k créditos/mes
 * (87% del plan Freelance ScrapingBee). Cache agresivo es CRÍTICO para no
 * quemar quota.
 * ============================================================================
 */
'use strict';

const { httpJsonViaScrapingBee, httpViaScrapingBee, getCreditBudgetMultiplier, browserPool, log, sleep } = require('../lib');
const { CircuitBreaker } = require('../lib/retry');

const SPORTSBOOK_URL = 'https://pba.betsson.bet.ar/apuestas-deportivas';

const scrapingBeeBreaker = new CircuitBreaker({ name: 'betsson:scrapingbee', failThreshold: 3, cooldownMs: 15 * 60_000 });
const playwrightBreaker = new CircuitBreaker({ name: 'betsson:playwright',  failThreshold: 3, cooldownMs: 20 * 60_000 });

let cachedEvents = [];
let cachedAt = 0;

/* Parser: extrae events del HTML renderizado de Betsson.
 *
 * Betsson embebe el initial state del SPA en patrones JSON dentro de
 * <script>. Intentamos múltiples extractors en orden de robustez:
 *   1) window.__SBKB_INITIAL_STATE__ (si existe)
 *   2) JSON literal en scripts con shape esperado
 *   3) DOM-scrape de las cards (último recurso)
 *
 * Si no encontramos data, devolvemos [] sin throw.
 */
function parseBetssonHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const out = [];
  const seen = new Set();

  // Estrategia 1: extraer JSONs grandes de scripts inline
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  const candidates = [];
  while ((match = scriptRe.exec(html)) !== null) {
    const body = match[1];
    if (body.length < 200 || body.length > 5_000_000) continue;
    // Buscar JSONs con shape de odds (palabras clave esperadas)
    if (!/\b(odds|markets|outcomes|event|home|away|kickoff|startsAt|participants)\b/i.test(body)) continue;
    // Intentar parsear el script entero si es JSON puro
    try {
      const parsed = JSON.parse(body.trim());
      candidates.push(parsed);
      continue;
    } catch {}
    // Buscar JSON embedded asignado a variable
    const jsonAssignRe = /(?:window\.__[A-Z_]+__|const\s+\w+|var\s+\w+|let\s+\w+)\s*=\s*(\{[\s\S]+?\});?\s*(?:<\/script>|$)/m;
    const m = body.match(jsonAssignRe);
    if (m) {
      try { candidates.push(JSON.parse(m[1])); } catch {}
    }
  }

  // Estrategia 2: recorrer cada candidate buscando arrays de events
  for (const root of candidates) {
    const events = findEventArrays(root, 0);
    for (const ev of events) {
      const parsed = normalizeBetssonEvent(ev);
      if (!parsed) continue;
      const key = `${parsed.home?.name}|${parsed.away?.name}|${parsed.start}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
    }
  }

  return out;
}

/* Recorre profundamente buscando arrays cuyos items tengan shape de "event". */
function findEventArrays(node, depth, found = []) {
  if (depth > 8 || !node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    // Heurística: si el primer item tiene home+away u homeTeam+awayTeam, es array de events
    if (node.length && looksLikeEvent(node[0])) {
      for (const it of node) if (looksLikeEvent(it)) found.push(it);
      return found;
    }
    for (const it of node) findEventArrays(it, depth + 1, found);
    return found;
  }
  // Es objeto plano: recorrer values
  for (const v of Object.values(node)) findEventArrays(v, depth + 1, found);
  return found;
}

function looksLikeEvent(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const hasHomeAway =
    (o.home && o.away) ||
    (o.homeTeam && o.awayTeam) ||
    (Array.isArray(o.participants) && o.participants.length >= 2) ||
    (Array.isArray(o.competitors) && o.competitors.length >= 2);
  if (!hasHomeAway) return false;
  // Debe tener algo similar a markets/odds
  const hasOdds =
    (o.markets && (Array.isArray(o.markets) || typeof o.markets === 'object')) ||
    (o.odds && (Array.isArray(o.odds) || typeof o.odds === 'object')) ||
    o.bets || o.selections;
  return !!hasOdds;
}

function normalizeBetssonEvent(raw) {
  if (!raw) return null;
  // Extraer teams
  let homeName, awayName;
  if (raw.home?.name && raw.away?.name) { homeName = raw.home.name; awayName = raw.away.name; }
  else if (raw.homeTeam?.name && raw.awayTeam?.name) { homeName = raw.homeTeam.name; awayName = raw.awayTeam.name; }
  else if (typeof raw.home === 'string' && typeof raw.away === 'string') { homeName = raw.home; awayName = raw.away; }
  else if (Array.isArray(raw.participants) && raw.participants[0] && raw.participants[1]) {
    homeName = raw.participants[0].name || raw.participants[0].displayName;
    awayName = raw.participants[1].name || raw.participants[1].displayName;
  } else if (Array.isArray(raw.competitors) && raw.competitors[0] && raw.competitors[1]) {
    homeName = raw.competitors[0].name || raw.competitors[0].displayName;
    awayName = raw.competitors[1].name || raw.competitors[1].displayName;
  }
  if (!homeName || !awayName) return null;

  // Start
  const start = raw.start || raw.startTime || raw.kickoff || raw.startsAt || raw.scheduledStart || raw.eventDate;
  const startMs = start ? new Date(start).getTime() : null;
  if (!Number.isFinite(startMs)) return null;

  // League
  const leagueName = raw.competition?.name || raw.league?.name || raw.tournament?.name ||
                     raw.competitionName || raw.leagueName;

  // Sport
  const sportRaw = String(raw.sport?.name || raw.sportName || raw.sport || '').toLowerCase();
  const sport = sportRaw.includes('basket') ? 'basketball'
              : sportRaw.includes('tenis') || sportRaw.includes('tennis') ? 'tennis'
              : sportRaw.includes('beisbol') || sportRaw.includes('baseball') ? 'baseball'
              : sportRaw.includes('hockey') ? 'hockey'
              : sportRaw.includes('americano') || sportRaw.includes('amfootball') ? 'amfootball'
              : sportRaw.includes('mma') || sportRaw.includes('ufc') ? 'mma'
              : 'soccer';

  // Markets — intentar extraer 1X2 / over-under / BTTS / DC
  const markets = extractBetssonMarkets(raw);
  if (!markets.h2h && !markets.totals && !markets.btts && !markets.dc) return null;

  return {
    home: { name: homeName.trim() },
    away: { name: awayName.trim() },
    start: startMs,
    league: null,
    leagueName: leagueName || null,
    sport,
    markets: {
      ...(markets.h2h    ? { h2h:    { betsson: markets.h2h }    } : {}),
      ...(markets.totals ? { totals: { betsson: markets.totals } } : {}),
      ...(markets.btts   ? { btts:   { betsson: markets.btts }   } : {}),
      ...(markets.dc     ? { dc:     { betsson: markets.dc }     } : {})
    }
  };
}

function extractBetssonMarkets(raw) {
  const out = {};
  const mList = []
    .concat(raw.markets || [])
    .concat(raw.bets || [])
    .concat(raw.odds || [])
    .concat(raw.oddsMarkets || []);

  for (const m of mList) {
    if (!m) continue;
    const sel = m.selections || m.outcomes || m.runners || m.results || [];
    const name = String(m.name || m.marketName || m.type || m.shortName || '').toLowerCase();

    if (!out.h2h && /(1x2|resultado|moneyline|h2h|ganador|winner|3.?way|match\s+result)/.test(name) && sel.length >= 2) {
      const find = (re) => sel.find(s => re.test(String(s.name || s.label || s.shortName || '')));
      const h = find(/^1$|local|home/i), d = find(/^x$|empate|draw|tie/i), a = find(/^2$|visit|away/i);
      const h2h = {
        home: parsePrice(h?.price ?? h?.odd ?? h?.odds ?? sel[0]?.price),
        draw: parsePrice(d?.price ?? d?.odd ?? d?.odds),
        away: parsePrice(a?.price ?? a?.odd ?? a?.odds ?? sel[sel.length - 1]?.price)
      };
      if (Number.isFinite(h2h.home) || Number.isFinite(h2h.away)) out.h2h = h2h;
    } else if (!out.totals && /(total|over|under|m.s|menos)/.test(name)) {
      const line = m.line || m.handicap || sel[0]?.line || sel[0]?.handicap || sel[0]?.point;
      const ov = sel.find(s => /over|m.s/i.test(String(s.name || s.label || '')));
      const un = sel.find(s => /under|menos/i.test(String(s.name || s.label || '')));
      const numLine = Number(line);
      if (Number.isFinite(numLine) && (ov || un)) {
        out.totals = {
          [numLine]: {
            line: numLine,
            over: parsePrice(ov?.price ?? ov?.odd ?? ov?.odds),
            under: parsePrice(un?.price ?? un?.odd ?? un?.odds)
          }
        };
      }
    } else if (!out.btts && /(btts|ambos|both.*score)/.test(name)) {
      const y = sel.find(s => /yes|s.?$|s.\b/i.test(String(s.name || s.label || '')));
      const n = sel.find(s => /no\b/i.test(String(s.name || s.label || '')));
      const btts = {
        yes: parsePrice(y?.price ?? y?.odd ?? y?.odds),
        no:  parsePrice(n?.price ?? n?.odd ?? n?.odds)
      };
      if (Number.isFinite(btts.yes) || Number.isFinite(btts.no)) out.btts = btts;
    } else if (!out.dc && /(doble|double\s+chance|dc)/.test(name)) {
      const hd = sel.find(s => /1x|home.*draw|local.*empate/i.test(String(s.name || s.label || '')));
      const da = sel.find(s => /x2|draw.*away|empate.*visit/i.test(String(s.name || s.label || '')));
      const ha = sel.find(s => /12|home.*away|local.*visit/i.test(String(s.name || s.label || '')));
      const dc = {
        home_or_draw: parsePrice(hd?.price ?? hd?.odd ?? hd?.odds),
        draw_or_away: parsePrice(da?.price ?? da?.odd ?? da?.odds),
        home_or_away: parsePrice(ha?.price ?? ha?.odd ?? ha?.odds)
      };
      if (Number.isFinite(dc.home_or_draw) || Number.isFinite(dc.draw_or_away)) out.dc = dc;
    }
  }

  return out;
}

function parsePrice(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').replace(/[^\d.+\-]/g, ''));
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? Number(n.toFixed(3)) : null;
}

/* Path PRIMARIO: ScrapingBee con render_js. La SPA monta, hace fetch interno
 * a sus APIs, y al renderizar inyecta los events en el HTML/initialState.
 * Cost: ~25 créditos. */
async function tryScrapingBee() {
  if (!process.env.SCRAPINGBEE_KEY) return null;
  if (scrapingBeeBreaker.state === 'OPEN') {
    scrapingBeeBreaker._maybeReset();
    if (scrapingBeeBreaker.state === 'OPEN') return null;
  }

  try {
    const r = await scrapingBeeBreaker.exec(() =>
      httpViaScrapingBee(SPORTSBOOK_URL, {
        timeout: 50000,
        premium: true,
        renderJs: true,        // CRÍTICO: la SPA monta odds tras JS render
        country: 'ar',
        json: false,            // queremos el HTML, no JSON
        tag: 'betsson:home'
      })
    );
    if (!r?.text) return [];
    const events = parseBetssonHtml(r.text);
    log(`[betsson:sbee] ${events.length} eventos · ${r.costCredits} créditos · target=${r.status}`);
    return events;
  } catch (e) {
    if (e?.circuitOpen) { log('[betsson:sbee] circuit OPEN · skip'); return null; }
    log(`[betsson:sbee] err: ${e.message?.slice(0, 200)}`);
    return [];
  }
}

/* Fallback: Playwright stealth con browserPool. Solo si ScrapingBee no
 * funciona (cooldown agotado o cuota llena). */
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

      // Interceptar TODOS los JSON responses durante el load — los SDK del
      // sportsbook hacen N XHRs con shapes variados.
      page.on('response', async (res) => {
        try {
          const url = res.url();
          if (!/betsson|sportsbook|sb-xp|kambi/i.test(url)) return;
          const ct = (res.headers()['content-type'] || '').toLowerCase();
          if (!ct.includes('json')) return;
          const json = await res.json().catch(() => null);
          if (json && typeof json === 'object') captured.push({ url, json });
        } catch (_) {}
      });

      await page.goto(SPORTSBOOK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(5000);  // dar tiempo a la SPA a montar
      // Scroll suave para forzar lazy-load
      await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
      await sleep(2500);
      const html = await page.content().catch(() => '');
      captured.push({ url: 'page-html', json: null, html });

      if (!captured.some(c => c.json) && !html) throw new Error('no-content-captured');
    });
  } catch (e) {
    const stack = (e.stack || '').split('\n').slice(1, 3).join(' | ').slice(0, 200);
    log(`[betsson:playwright] err: ${e.message}${e.circuitOpen ? ' · circuit OPEN' : ''} · ${stack}`);
  } finally {
    if (ctx) try { await ctx.close(); } catch {}
  }

  const out = [];
  const seen = new Set();
  // Parse JSON responses
  for (const c of captured) {
    if (!c.json) continue;
    const events = findEventArrays(c.json, 0);
    for (const raw of events) {
      const parsed = normalizeBetssonEvent(raw);
      if (!parsed) continue;
      const key = `${parsed.home?.name}|${parsed.away?.name}|${parsed.start}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
    }
  }
  // Parse HTML como último recurso
  const htmlCaps = captured.filter(c => c.html);
  for (const c of htmlCaps) {
    const evs = parseBetssonHtml(c.html);
    for (const ev of evs) {
      const key = `${ev.home?.name}|${ev.away?.name}|${ev.start}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ev);
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

  let events = null;
  let via = null;

  const sbeeRes = await tryScrapingBee();
  if (sbeeRes && sbeeRes.length) { events = sbeeRes; via = 'sbee'; }

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

  // Stale fallback 30min — cuotas viejas son mejor que vacío
  const staleTtl = 30 * 60_000;
  if (cachedEvents.length && Date.now() - cachedAt < staleTtl) {
    log(`[betsson] all paths failed · serving cache (${cachedEvents.length})`);
    return cachedEvents;
  }

  log(`[betsson] no data · 0 events`);
  return [];
}

scrape.breakers = {
  scrapingbee: scrapingBeeBreaker,
  playwright: playwrightBreaker
};

scrape.clearCache = () => { cachedEvents = []; cachedAt = 0; };

module.exports = scrape;
