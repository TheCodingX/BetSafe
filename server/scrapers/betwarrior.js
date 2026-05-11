/* Scraper: BetWarrior AR
 * URL: https://betwarrior.bet.ar / https://www.betwarrior.com
 * ============================================================================
 * BetWarrior corre un SPA con sus propios endpoints internos. La estructura
 * de respuesta varía pero típicamente expone events / fixtures con
 * outcomes en formato decimal.
 * ============================================================================
 */
'use strict';

const { captureXhr, fetchHtml, loadDom, buildEvent, resolveLeague, parseDecimal, log } = require('./_base');

const PAGE_URL    = 'https://www.betwarrior.bet.ar/sports/futbol/';
const XHR_PATTERN = /\/(api|sportbook|sportsbook|public)\/(fixture|event|odds|markets|prematch|live)/i;

async function scrape() {
  try {
    const payloads = await captureXhr(PAGE_URL, XHR_PATTERN, { settleMs: 3000 });
    const out = [];
    for (const p of payloads) out.push(...genericJsonExtract(p.json));
    if (out.length) return out;
  } catch (e) { log('[betwarrior] xhr fail', e?.message); }

  try {
    const { html } = await fetchHtml(PAGE_URL, { settleMs: 1500 });
    return extractFromHtml(html);
  } catch (e) { log('[betwarrior] html fail', e?.message); return []; }
}

function genericJsonExtract(json) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== 'object') return;
    if (looksLikeEvent(n)) {
      const ev = mapGenericEvent(n);
      if (ev) out.push(ev);
    } else {
      Object.values(n).forEach(walk);
    }
  };
  walk(json);
  return out;
}

function looksLikeEvent(n) {
  return (n.home && n.away) ||
         (Array.isArray(n.participants) && n.participants.length >= 2) ||
         (Array.isArray(n.competitors) && n.competitors.length >= 2) ||
         (n.t1Name && n.t2Name);
}

function mapGenericEvent(e) {
  const home = e.home?.name || e.home || e.t1Name || (e.participants?.[0]?.name) || (e.competitors?.[0]?.name);
  const away = e.away?.name || e.away || e.t2Name || (e.participants?.[1]?.name) || (e.competitors?.[1]?.name);
  if (!home || !away) return null;
  const start = e.start || e.startTime || e.kickoff || e.scheduled || e.date || e.eventDate;
  const competition = e.competition?.name || e.tournament?.name || e.league?.name || e.competitionName || e.leagueName;
  const lg = resolveLeague(competition);
  const sportName = (e.sport?.name || e.sportName || '').toLowerCase();
  const sport = sportName.includes('basket') ? 'basketball'
              : sportName.includes('tenis') ? 'tennis'
              : 'soccer';
  // Buscar mercados
  let h2h = null;
  const flatMarkets = []
    .concat(e.markets || [])
    .concat(e.bets || [])
    .concat(e.odds || []);
  for (const m of flatMarkets) {
    const sel = m.selections || m.outcomes || m.runners || [];
    const name = (m.name || m.marketName || m.type || '').toLowerCase();
    if (!h2h && /(1x2|resultado|moneyline|h2h|ganador)/.test(name) && sel.length >= 2) {
      const h = parseDecimal(sel.find(s => /^1$|local|home/i.test(s.name||s.label))?.price ?? sel[0]?.price);
      const d = parseDecimal(sel.find(s => /^x$|empate|draw/i.test(s.name||s.label))?.price);
      const a = parseDecimal(sel.find(s => /^2$|visit|away/i.test(s.name||s.label))?.price ?? sel[sel.length-1]?.price);
      if (h || a) h2h = { home: h, draw: d, away: a };
    }
  }
  // Si no encontramos en markets, intentar campos directos típicos
  if (!h2h && (e.oddHome || e.priceHome)) {
    h2h = {
      home: parseDecimal(e.oddHome || e.priceHome),
      draw: parseDecimal(e.oddDraw || e.priceDraw),
      away: parseDecimal(e.oddAway || e.priceAway)
    };
  }
  return buildEvent({ home, away, start, league: lg.key, leagueName: lg.name, sport, h2h });
}

function extractFromHtml(html) {
  const $ = loadDom(html);
  const out = [];
  $('[class*="event"], [class*="match"], [data-event]').each((_, el) => {
    const $el = $(el);
    const teams = $el.find('[class*="team"], [class*="participant"]').slice(0, 2);
    if (teams.length < 2) return;
    const home = $(teams[0]).text().trim();
    const away = $(teams[1]).text().trim();
    if (!home || !away) return;
    const oddTxts = $el.find('[class*="odd"], [class*="price"], button').map((_, o) => $(o).text()).get();
    const odds = oddTxts.map(parseDecimal).filter(Boolean);
    let h2h = null;
    if (odds.length === 3) h2h = { home: odds[0], draw: odds[1], away: odds[2] };
    else if (odds.length === 2) h2h = { home: odds[0], away: odds[1] };
    const ev = buildEvent({ home, away, sport: 'soccer', h2h });
    if (ev) out.push(ev);
  });
  return out;
}

module.exports = scrape;
