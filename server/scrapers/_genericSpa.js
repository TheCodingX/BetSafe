/* BetSafe — Scraper genérico para SPAs de casas de apuestas
 * ============================================================================
 * Las 12 casas argentinas legales usan SPAs con XHR a APIs JSON internos.
 * Para no repetir 200 líneas por scraper, este helper:
 *   - Abre la página objetivo en Playwright.
 *   - Intercepta TODOS los XHR/Fetch que matchean un patrón.
 *   - Aplica un "extractor" a cada payload y agrega los eventos resultantes.
 *   - Si nada matchea, parsea HTML con cheerio y los selectores que le pases.
 *
 * Uso:
 *   module.exports = require('./_genericSpa')({
 *     pageUrl: 'https://example.com/sport/football',
 *     xhrPattern: /\/api\/events/,
 *     extractor: 'generic',                    // o función custom
 *     htmlSelectors: { card: '.event', team:'.team', odd:'.odd' }
 *   });
 * ============================================================================
 */
'use strict';

const { captureXhr, fetchHtml, loadDom, buildEvent, resolveLeague, parseDecimal, log } = require('./_base');

function genericExtract(json) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== 'object') return;
    if (looksLikeEvent(n)) {
      const ev = mapEvent(n);
      if (ev) out.push(ev);
    } else Object.values(n).forEach(walk);
  };
  walk(json);
  return out;
}

function looksLikeEvent(n) {
  if (n.home && n.away) return true;
  if (n.t1Name && n.t2Name) return true;
  if (Array.isArray(n.competitors) && n.competitors.length >= 2 && (n.markets || n.bets)) return true;
  if (Array.isArray(n.participants) && n.participants.length >= 2 && (n.markets || n.outcomes)) return true;
  if (Array.isArray(n.teams) && n.teams.length >= 2 && (n.markets || n.odds)) return true;
  return false;
}

function teamNames(e) {
  if (e.home?.name && e.away?.name) return [e.home.name, e.away.name];
  if (e.home && e.away && typeof e.home === 'string') return [e.home, e.away];
  if (e.t1Name && e.t2Name) return [e.t1Name, e.t2Name];
  const list = e.competitors || e.participants || e.teams || [];
  if (list[0] && list[1]) return [list[0].name || list[0].title || list[0], list[1].name || list[1].title || list[1]];
  return [null, null];
}

function mapEvent(e) {
  const [home, away] = teamNames(e);
  if (!home || !away) return null;
  const start = e.start || e.startTime || e.kickoff || e.scheduled || e.date || e.eventDate;
  const competition = e.competition?.name || e.tournament?.name || e.league?.name || e.category?.name
                   || e.competitionName || e.leagueName || e.tournamentName;
  const lg = resolveLeague(competition);
  const sportName = (e.sport?.name || e.sportName || e.sport || '').toLowerCase();
  const sport = sportName.includes('basket') ? 'basketball'
              : sportName.includes('tenis') || sportName.includes('tennis') ? 'tennis'
              : sportName.includes('americano') || sportName.includes('football amer') ? 'amfootball'
              : sportName.includes('beisbol') || sportName.includes('baseball') ? 'baseball'
              : sportName.includes('hockey') ? 'hockey'
              : sportName.includes('mma') || sportName.includes('ufc') ? 'mma'
              : 'soccer';
  const markets = [].concat(e.markets || []).concat(e.bets || []).concat(e.odds || []);
  let h2h = null, totals = null, btts = null, dc = null;
  for (const m of markets) {
    const sel = m.selections || m.outcomes || m.runners || [];
    const name = (m.name || m.marketName || m.type || m.shortName || '').toLowerCase();
    if (!h2h && /(1x2|resultado del partido|resultado final|match result|moneyline|h2h|ganador|winner|fulltime result)/.test(name) && sel.length >= 2) {
      const h = parseDecimal(sel.find(s => /^1$|local|home/i.test(s.name||s.label||s.shortName))?.price ?? sel[0]?.price);
      const d = parseDecimal(sel.find(s => /^x$|empate|draw|tie/i.test(s.name||s.label||s.shortName))?.price);
      const a = parseDecimal(sel.find(s => /^2$|visit|away/i.test(s.name||s.label||s.shortName))?.price ?? sel[sel.length-1]?.price);
      if (h || a) h2h = { home: h, draw: d, away: a };
    } else if (!totals && /(total|más|menos|over|under)/.test(name)) {
      const line = m.line || m.handicap || sel[0]?.line || sel[0]?.handicap;
      const ov = sel.find(s => /over|más/i.test(s.name||s.label||s.shortName));
      const un = sel.find(s => /under|menos/i.test(s.name||s.label||s.shortName));
      if (line && (ov || un)) totals = { [line]: { line: Number(line), over: parseDecimal(ov?.price), under: parseDecimal(un?.price) } };
    } else if (!btts && /(ambos|both teams|btts|gg|marcan)/.test(name)) {
      btts = {
        yes: parseDecimal(sel.find(s => /sí|si|yes/i.test(s.name||s.label||s.shortName))?.price),
        no:  parseDecimal(sel.find(s => /^no/i.test(s.name||s.label||s.shortName))?.price)
      };
    } else if (!dc && /(doble oport|double chance)/.test(name)) {
      const sel1 = sel.find(s => /1x|1\/x|local.*empate|home.*draw/i.test(s.name||s.label));
      const sel2 = sel.find(s => /x2|x\/2|empate.*visit|draw.*away/i.test(s.name||s.label));
      const sel12 = sel.find(s => /12|1\/2|local.*visit|home.*away/i.test(s.name||s.label));
      dc = {
        home_or_draw: parseDecimal(sel1?.price),
        draw_or_away: parseDecimal(sel2?.price),
        home_or_away: parseDecimal(sel12?.price)
      };
    }
  }
  // Campos directos a veces
  if (!h2h && (e.oddHome || e.priceHome)) {
    h2h = {
      home: parseDecimal(e.oddHome || e.priceHome),
      draw: parseDecimal(e.oddDraw || e.priceDraw),
      away: parseDecimal(e.oddAway || e.priceAway)
    };
  }
  return buildEvent({ home, away, start, league: lg.key, leagueName: lg.name, sport, h2h, totals, btts, dc });
}

function extractFromHtml(html, sel) {
  const $ = loadDom(html);
  const out = [];
  $(sel.card).each((_, el) => {
    const $el = $(el);
    const teams = $el.find(sel.team).slice(0, 2);
    if (teams.length < 2) return;
    const home = $(teams[0]).text().trim();
    const away = $(teams[1]).text().trim();
    if (!home || !away) return;
    const oddTxts = $el.find(sel.odd).map((_, o) => $(o).text()).get();
    const odds = oddTxts.map(parseDecimal).filter(Boolean);
    let h2h = null;
    if (odds.length >= 3) h2h = { home: odds[0], draw: odds[1], away: odds[2] };
    else if (odds.length === 2) h2h = { home: odds[0], away: odds[1] };
    const leagueText = sel.league ? ($el.closest(sel.league).find(sel.leagueTitle || '*').first().text().trim() || '') : '';
    const lg = resolveLeague(leagueText);
    const ev = buildEvent({ home, away, sport: 'soccer', league: lg.key, leagueName: lg.name, h2h });
    if (ev) out.push(ev);
  });
  return out;
}

// Patrón XHR amplio que matchea las APIs internas más comunes de SPAs de
// sportsbook (Kaizen, Sportradar, Sirplay, Pragmatic, custom, etc.)
const BROAD_XHR_PATTERN = /\/(api|graphql|sb|sports?book|sport|public|content|odds-api|live|prematch|markets|events?|fixtures?|odds|leagues?|competitions?|tournaments?|matches?|cdn|feed|data|gateway)/i;

module.exports = function genericSpa(cfg) {
  return async function scrape() {
    // 1) Intentar captura XHR con el patrón específico
    let xhrPayloads = [];
    try {
      xhrPayloads = await captureXhr(cfg.pageUrl, cfg.xhrPattern, { settleMs: cfg.settleMs || 2500 });
      const out = [];
      for (const p of xhrPayloads) {
        const evs = (cfg.extractor === 'generic' || !cfg.extractor) ? genericExtract(p.json)
                  : cfg.extractor(p.json);
        out.push(...evs);
      }
      if (out.length) return out;
    } catch (e) { log(`[${cfg.name}] xhr fail`, e?.message?.slice(0, 80)); }

    // 2) Si el patrón específico falló, intentar uno MÁS AMPLIO
    if (cfg.xhrPattern !== BROAD_XHR_PATTERN) {
      try {
        const broadPayloads = await captureXhr(cfg.pageUrl, BROAD_XHR_PATTERN, { settleMs: cfg.settleMs || 3000 });
        const out = [];
        for (const p of broadPayloads) {
          const evs = genericExtract(p.json);
          out.push(...evs);
        }
        if (out.length) {
          log(`[${cfg.name}] capturado vía pattern amplio · ${broadPayloads.length} XHR · ${out.length} ev`);
          return out;
        }
        // Logueamos qué URLs vimos para que el admin pueda ajustar el pattern
        if (broadPayloads.length) {
          const sample = broadPayloads.slice(0, 5).map(p => p.url).join(', ');
          log(`[${cfg.name}] vio ${broadPayloads.length} XHR pero no parseó: ${sample.slice(0, 200)}`);
        } else {
          log(`[${cfg.name}] sin XHR matched`);
        }
      } catch (e) { log(`[${cfg.name}] broad xhr fail`, e?.message?.slice(0, 80)); }
    }

    // 3) HTML fallback (último recurso)
    if (cfg.htmlSelectors) {
      try {
        const { html } = await fetchHtml(cfg.pageUrl, { waitFor: cfg.htmlSelectors.waitFor || cfg.htmlSelectors.card, settleMs: 1500 });
        const out = extractFromHtml(html, cfg.htmlSelectors);
        if (out.length) log(`[${cfg.name}] capturado vía HTML · ${out.length} ev`);
        return out;
      } catch (e) { log(`[${cfg.name}] html fail`, e?.message?.slice(0, 80)); }
    }
    return [];
  };
};

module.exports.genericExtract = genericExtract;
module.exports.extractFromHtml = extractFromHtml;
