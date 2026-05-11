/* BetSafe — Scraper base utilities
 * ============================================================================
 * Cada scraper individual (bplay.js, betano.js, ...) usa este módulo para:
 *   1) Intentar fetch con undici (rápido y barato).
 *   2) Si la casa requiere JS rendering, escalar a Playwright (caro pero
 *      compatible con cualquier SPA).
 *   3) Parsear el resultado con cheerio o evaluar el window.__INITIAL_STATE.
 *
 * Convención: cada scraper exporta una función async (opts) → events[].
 *   donde events[] son objetos { home, away, start, league, leagueName, sport,
 *                                 markets: { h2h:{home,draw,away}, totals:{}, btts:{} } }
 *
 * NOTE: Las URLs de cada casa pueden cambiar — están centralizadas en cada
 * scraper para que actualizarlas sea un edit puntual.
 * ============================================================================
 */
'use strict';

const cheerio = require('cheerio');
const { browserPool, httpGet, log, sleep, normalizeTeam, parseDecimal } = require('../lib');

/* fetchHtml — intenta cargar HTML con undici primero.
 * Si la página devuelve HTML "vacío" (típico SPA), escala a Playwright. */
async function fetchHtml(url, opts = {}) {
  try {
    const html = await httpGet(url, {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      headers: { ...(opts.headers || {}) }
    });
    if (html && html.length > 5000 && !/<noscript>.*JavaScript/i.test(html.slice(0, 2000))) {
      return { html, via: 'http' };
    }
  } catch (e) { /* sigue a Playwright */ }

  // Escalar a browser
  const { page, ctx } = await browserPool.newPage({ blockResources: true });
  try {
    await page.goto(url, { waitUntil: opts.waitUntil || 'domcontentloaded', timeout: 18000 });
    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor, { timeout: 12000 }).catch(() => {});
    } else {
      await sleep(opts.settleMs || 800);
    }
    const html = await page.content();
    return { html, via: 'browser' };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** evalOnPage — abre la página, evalúa una función JS adentro del DOM y la
 *  retorna. Útil cuando la casa expone window.__data__ o un endpoint XHR. */
async function evalOnPage(url, evaluator, opts = {}) {
  const { page, ctx } = await browserPool.newPage({ blockResources: true });
  try {
    await page.goto(url, { waitUntil: opts.waitUntil || 'domcontentloaded', timeout: 20000 });
    if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 14000 }).catch(() => {});
    await sleep(opts.settleMs || 600);
    return await page.evaluate(evaluator);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Intercepta requests XHR/Fetch que matcheen un patrón y devuelve sus bodies.
 *  Útil cuando la casa pega contra un endpoint propio JSON. */
async function captureXhr(url, urlPattern, opts = {}) {
  const { page, ctx } = await browserPool.newPage({ blockResources: true });
  const payloads = [];
  try {
    page.on('response', async (res) => {
      try {
        if (urlPattern.test(res.url())) {
          const ct = res.headers()['content-type'] || '';
          if (/json/i.test(ct)) {
            const json = await res.json().catch(() => null);
            if (json) payloads.push({ url: res.url(), json });
          }
        }
      } catch {}
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 22000 }).catch(() => {});
    await sleep(opts.settleMs || 1500);
    return payloads;
  } finally {
    await ctx.close().catch(() => {});
  }
}

function loadDom(html) { return cheerio.load(html); }

/* Heurísticas comunes para detectar formato de cuotas y outcomes en HTML
 * cuando el scraper específico no pudo parsear via JSON. */
function pickH2hFromText(textBlocks) {
  // textBlocks: array de strings que están cerca uno del otro en el DOM
  // intentamos encontrar 2 o 3 números entre 1.01 y 50 que parezcan cuotas.
  const odds = textBlocks
    .map(t => parseDecimal(t))
    .filter(v => v && v > 1.01 && v < 100);
  if (odds.length === 3) return { home: odds[0], draw: odds[1], away: odds[2] };
  if (odds.length === 2) return { home: odds[0], away: odds[1] };
  return null;
}

function buildEvent({ home, away, start, league, leagueName, sport = 'soccer', h2h, totals, btts, dc, ah }) {
  if (!home || !away) return null;
  const ev = {
    home: { name: String(home).trim() },
    away: { name: String(away).trim() },
    start: start ? new Date(start).getTime() : null,
    league: league || null,
    leagueName: leagueName || null,
    sport,
    markets: {}
  };
  if (h2h && (h2h.home || h2h.away)) ev.markets.h2h = h2h;
  if (totals) ev.markets.totals = totals;
  if (btts) ev.markets.btts = btts;
  if (dc) ev.markets.dc = dc;
  if (ah) ev.markets.ah = ah;
  if (Object.keys(ev.markets).length === 0) return null;
  return ev;
}

/* Mapea nombres de competición que vienen del scraper a las keys internas
 * que usa el frontend (LEAGUES de data.js). Coincidencia laxa. */
const LEAGUE_KEY_MAP = [
  { match: /liga profesional|primera division|copa de la liga|copa argentina/i, key: 'lpf', name: 'Liga Profesional Argentina' },
  { match: /premier league/i,                key: 'epl',         name: 'Premier League' },
  { match: /laliga|la liga|primera espa/i,   key: 'laliga',      name: 'La Liga' },
  { match: /serie a/i,                       key: 'seriea',      name: 'Serie A' },
  { match: /bundesliga/i,                    key: 'bundesliga',  name: 'Bundesliga' },
  { match: /ligue 1|ligue1/i,                key: 'ligue1',      name: 'Ligue 1' },
  { match: /champions/i,                     key: 'ucl',         name: 'UEFA Champions League' },
  { match: /europa league/i,                 key: 'uel',         name: 'UEFA Europa League' },
  { match: /libertadores/i,                  key: 'libertadores',name: 'Copa Libertadores' },
  { match: /sudamericana/i,                  key: 'sudamericana',name: 'Copa Sudamericana' },
  { match: /\bnba\b/i,                       key: 'nba',         name: 'NBA' },
  { match: /\bnfl\b/i,                       key: 'nfl',         name: 'NFL' },
  { match: /\bmlb\b/i,                       key: 'mlb',         name: 'MLB' },
  { match: /\bnhl\b/i,                       key: 'nhl',         name: 'NHL' },
  { match: /\bmls\b/i,                       key: 'mls',         name: 'MLS' },
  { match: /ufc|mma/i,                       key: 'ufc',         name: 'UFC / MMA' },
  { match: /atp|wta|grand slam|roland|wimbled|us open|austral/i, key: 'tennis_majors', name: 'Tennis' }
];
function resolveLeague(rawText) {
  if (!rawText) return { key: null, name: null };
  for (const r of LEAGUE_KEY_MAP) {
    if (r.match.test(rawText)) return { key: r.key, name: r.name };
  }
  return { key: null, name: String(rawText).slice(0, 60) };
}

module.exports = {
  fetchHtml, evalOnPage, captureXhr, loadDom,
  buildEvent, pickH2hFromText, resolveLeague,
  parseDecimal, normalizeTeam, log, sleep
};
