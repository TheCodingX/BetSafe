/* Scraper: Bplay (Buenos Aires Lottery, LOTBA / IPLyC)
 * URL: https://www.bplay.com.ar
 * ============================================================================
 * Bplay corre un SPA con su propio backend. El sportsbook está en
 * /apuestas-deportivas y usa endpoints internos JSON.
 *
 * Estrategia:
 *   1) Capturar XHR /sportsbook/... cuando Playwright carga la página.
 *   2) Si no se capturó nada, fallback a parsing HTML (cheerio) — encontramos
 *      tarjetas .event-card con .team-name y .odds-value.
 *
 * Las URLs cambian: en ese caso, ajustar PAGE_URL y/o XHR_PATTERN.
 * ============================================================================
 */
'use strict';

const { captureXhr, fetchHtml, loadDom, buildEvent, resolveLeague, normalizeTeam, parseDecimal, log } = require('./_base');

const PAGE_URL    = 'https://www.bplay.com.ar/apuestas-deportivas';
const XHR_PATTERN = /\/(api|sportsbook|public)\/(events|odds|fixtures|markets)/i;

async function scrape() {
  // 1) XHR sniffing
  try {
    const payloads = await captureXhr(PAGE_URL, XHR_PATTERN, { settleMs: 2500 });
    const events = [];
    for (const p of payloads) {
      const evs = extractFromJson(p.json);
      events.push(...evs);
    }
    if (events.length) return events;
  } catch (e) { log('[bplay] xhr fail', e?.message); }

  // 2) HTML parsing fallback
  try {
    const { html } = await fetchHtml(PAGE_URL, { waitFor: '[class*="event"], [class*="match"]', settleMs: 1500 });
    return extractFromHtml(html);
  } catch (e) { log('[bplay] html fail', e?.message); return []; }
}

function extractFromJson(json) {
  const out = [];
  const collect = (obj) => {
    if (!obj) return;
    if (Array.isArray(obj)) return obj.forEach(collect);
    if (obj.competitors || obj.participants || obj.teams) {
      const ev = parseJsonEvent(obj);
      if (ev) out.push(ev);
    }
    if (obj.events) collect(obj.events);
    if (obj.fixtures) collect(obj.fixtures);
    if (obj.data) collect(obj.data);
    if (obj.items) collect(obj.items);
  };
  collect(json);
  return out;
}

function parseJsonEvent(o) {
  const teams = o.competitors || o.participants || o.teams || [];
  if (!Array.isArray(teams) || teams.length < 2) return null;
  const home = teams[0]?.name || teams[0]?.title;
  const away = teams[1]?.name || teams[1]?.title;
  if (!home || !away) return null;
  const start = o.startTime || o.start || o.kickoff || o.scheduled || o.date;
  const sport = (o.sport || o.sportName || '').toLowerCase().includes('basket') ? 'basketball'
              : (o.sport || o.sportName || '').toLowerCase().includes('tennis') ? 'tennis'
              : 'soccer';
  const competition = o.competition?.name || o.tournament?.name || o.league?.name || o.competitionName;
  const lg = resolveLeague(competition);

  const markets = o.markets || o.bets || [];
  let h2h = null, totals = null, btts = null;
  for (const m of markets) {
    const name = (m.name || m.type || '').toLowerCase();
    const sel = m.selections || m.outcomes || m.runners || [];
    if (!sel.length) continue;
    if (/(^|\s)(1x2|match result|resultado|moneyline|h2h)/.test(name) && !h2h) {
      const find = (key) => sel.find(s => new RegExp(key,'i').test(s.name || s.label || ''));
      const h = parseDecimal(find('^1$|home|local|' + escapeReg(home))?.odd ?? find('^1$|home')?.price);
      const d = parseDecimal(find('^x$|draw|empate')?.odd ?? find('^x$|draw')?.price);
      const a = parseDecimal(find('^2$|away|visit|' + escapeReg(away))?.odd ?? find('^2$|away')?.price);
      if (h || a) h2h = { home: h, draw: d, away: a };
    } else if (/total|over.+under/i.test(name) && !totals) {
      const line = m.line || m.handicap || sel[0]?.line || sel[0]?.handicap;
      const over = sel.find(s => /over|más/i.test(s.name || s.label || ''));
      const under = sel.find(s => /under|menos/i.test(s.name || s.label || ''));
      if (line && (over || under)) totals = { [line]: { line: Number(line), over: parseDecimal(over?.odd ?? over?.price), under: parseDecimal(under?.odd ?? under?.price) } };
    } else if (/both teams|ambos|btts|gg/i.test(name) && !btts) {
      const y = sel.find(s => /yes|si|sí/i.test(s.name || s.label || ''));
      const n = sel.find(s => /^no/i.test(s.name || s.label || ''));
      btts = { yes: parseDecimal(y?.odd ?? y?.price), no: parseDecimal(n?.odd ?? n?.price) };
    }
  }
  return buildEvent({ home, away, start, league: lg.key, leagueName: lg.name, sport, h2h, totals, btts });
}

function escapeReg(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function extractFromHtml(html) {
  const $ = loadDom(html);
  const out = [];
  // tarjetas de evento — múltiples convenciones posibles
  const cards = $('[class*="event-card"], [class*="EventCard"], [data-event-id], [class*="match-row"]');
  cards.each((_, el) => {
    const $el = $(el);
    const teamEls = $el.find('[class*="team-name"], [class*="competitor"], [data-team]');
    if (teamEls.length < 2) return;
    const home = $(teamEls[0]).text().trim();
    const away = $(teamEls[1]).text().trim();
    const oddEls = $el.find('[class*="odd-value"], [class*="OddValue"], [data-odd], button [class*="value"]');
    const odds = oddEls.map((_, o) => parseDecimal($(o).text())).get().filter(Boolean);
    if (!home || !away) return;
    let h2h = null;
    if (odds.length === 3) h2h = { home: odds[0], draw: odds[1], away: odds[2] };
    else if (odds.length === 2) h2h = { home: odds[0], away: odds[1] };
    const league = $el.closest('[class*="competition"], [class*="tournament"]').find('[class*="title"]').first().text().trim()
                || $el.parents().find('[class*="competition-title"]').first().text().trim();
    const lg = resolveLeague(league);
    const ev = buildEvent({ home, away, league: lg.key, leagueName: lg.name, sport: 'soccer', h2h });
    if (ev) out.push(ev);
  });
  return out;
}

module.exports = scrape;
