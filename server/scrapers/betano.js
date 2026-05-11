/* Scraper: Betano AR (Kaizen Gaming)
 * URL: https://www.betano.com.ar
 * ============================================================================
 * Betano usa Kaizen Gaming common platform. Tienen un endpoint público
 * /api/sb/v1/events bajo el origin del país. Los selectores HTML como
 * data-qa="event-row" son estables.
 *
 * El response shape de Kaizen incluye: { events: [{ id, competitors, markets,
 *   league:{name,categoryName}, startTime, sport:{name} }] }
 * ============================================================================
 */
'use strict';

const { captureXhr, fetchHtml, loadDom, buildEvent, resolveLeague, parseDecimal, log } = require('./_base');

const PAGE_URL    = 'https://www.betano.com.ar/sport/futbol/partidos-de-hoy/';
const XHR_PATTERN = /\/(api|public)\/(sb|sports?|events?|odds|markets)/i;

async function scrape() {
  try {
    const payloads = await captureXhr(PAGE_URL, XHR_PATTERN, { settleMs: 3000 });
    const out = [];
    for (const p of payloads) out.push(...kaizenJsonToEvents(p.json));
    if (out.length) return out;
  } catch (e) { log('[betano] xhr fail', e?.message); }

  try {
    const { html } = await fetchHtml(PAGE_URL, { waitFor: '[data-qa="event-row"], [class*="event"]', settleMs: 1500 });
    return extractFromHtml(html);
  } catch (e) { log('[betano] html fail', e?.message); return []; }
}

function kaizenJsonToEvents(json) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === 'object') {
      if (n.competitors || (n.markets && n.competitors !== undefined)) {
        const ev = mapEvent(n);
        if (ev) out.push(ev);
      } else {
        Object.values(n).forEach(walk);
      }
    }
  };
  walk(json);
  return out;
}

function mapEvent(e) {
  const comps = e.competitors || e.teams || [];
  if (!Array.isArray(comps) || comps.length < 2) return null;
  const home = comps[0]?.name;
  const away = comps[1]?.name;
  const start = e.startTime || e.scheduled || e.date;
  const sportName = (e.sport?.name || e.sportName || '').toLowerCase();
  const sport = sportName.includes('basket') ? 'basketball'
              : sportName.includes('tenis') ? 'tennis'
              : sportName.includes('americano') ? 'amfootball'
              : sportName.includes('beisbol') ? 'baseball'
              : 'soccer';
  const leagueName = e.league?.name || e.tournament?.name || e.category?.name;
  const lg = resolveLeague(leagueName);
  const markets = e.markets || e.bets || [];
  let h2h = null, totals = null, btts = null;
  for (const m of markets) {
    const name = (m.name || m.shortName || '').toLowerCase();
    const sel = m.selections || m.outcomes || [];
    if (!sel.length) continue;
    if (!h2h && /(^| )(1x2|resultado|match result|moneyline|ganador)/.test(name)) {
      const h = parseDecimal(sel.find(s => /^1$|local|home/i.test(s.name))?.price);
      const d = parseDecimal(sel.find(s => /^x$|empate|draw/i.test(s.name))?.price);
      const a = parseDecimal(sel.find(s => /^2$|visit|away/i.test(s.name))?.price);
      if (h || a) h2h = { home: h, draw: d, away: a };
    } else if (!totals && /(total|más|menos|over|under)/.test(name)) {
      const line = m.line || sel[0]?.line || sel[0]?.handicap;
      const ov = sel.find(s => /over|más/i.test(s.name));
      const un = sel.find(s => /under|menos/i.test(s.name));
      if (line && (ov || un)) totals = { [line]: { line: Number(line), over: parseDecimal(ov?.price), under: parseDecimal(un?.price) } };
    } else if (!btts && /(ambos|both teams|btts|marcan)/.test(name)) {
      btts = {
        yes: parseDecimal(sel.find(s => /sí|si|yes/i.test(s.name))?.price),
        no:  parseDecimal(sel.find(s => /^no/i.test(s.name))?.price)
      };
    }
  }
  return buildEvent({ home, away, start, league: lg.key, leagueName: lg.name, sport, h2h, totals, btts });
}

function extractFromHtml(html) {
  const $ = loadDom(html);
  const out = [];
  $('[data-qa="event-row"], [class*="event-row"]').each((_, el) => {
    const $el = $(el);
    const teams = $el.find('[data-qa="competitor"], [class*="competitor"], [class*="team-name"]');
    if (teams.length < 2) return;
    const home = $(teams[0]).text().trim();
    const away = $(teams[1]).text().trim();
    const oddEls = $el.find('[data-qa="price"], [class*="price"], [class*="OddValue"]');
    const odds = oddEls.map((_, o) => parseDecimal($(o).text())).get().filter(Boolean);
    let h2h = null;
    if (odds.length >= 3) h2h = { home: odds[0], draw: odds[1], away: odds[2] };
    else if (odds.length === 2) h2h = { home: odds[0], away: odds[1] };
    const league = $el.closest('[class*="league"], [class*="competition"]').find('[class*="title"]').first().text().trim();
    const lg = resolveLeague(league);
    const ev = buildEvent({ home, away, league: lg.key, leagueName: lg.name, sport: 'soccer', h2h });
    if (ev) out.push(ev);
  });
  return out;
}

module.exports = scrape;
