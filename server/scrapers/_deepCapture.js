/* BetSafe — Deep Capture Engine
 * ============================================================================
 * Reescritura masiva del approach de scraping. En vez de adivinar selectores
 * de cada SPA, hacemos lo siguiente:
 *
 *   1) Abrimos la página con Playwright stealth.
 *   2) Interceptamos TODOS los responses HTTP (XHR/Fetch/Document).
 *   3) Por cada response JSON, lo recorremos buscando shapes que tengan
 *      forma de "evento deportivo + cuotas" (heurística estructural).
 *   4) En paralelo: parseamos JSON-LD (Schema.org SportsEvent) del HTML.
 *   5) Capturamos WebSocket messages si el sitio los usa.
 *   6) Scroll automático para forzar lazy-loading de eventos.
 *   7) Wait inteligente: networkidle + selector + timer.
 *   8) Retries con backoff si la primera no devuelve nada.
 *
 * Esto es MUCHO más robusto que hardcodear selectores porque:
 *   - No depende de URLs específicas (cada casa tiene la suya)
 *   - No depende de class names (cambian seguido)
 *   - Solo depende de la ESTRUCTURA de los datos (más estable)
 *
 * NO resuelve Cloudflare hardcore (Bet365). Para eso necesitás proxy
 * residencial. Pero sí resuelve detection básica + scrapes shape-agnostic.
 * ============================================================================
 */
'use strict';

const cheerio = require('cheerio');
const { browserPool, log, sleep, normalizeTeam, parseDecimal, isFinite2 } = require('../lib');

// Limita exploración del JSON tree para evitar OOM si encuentra estructuras enormes
const MAX_TREE_DEPTH = 12;
const MAX_TREE_NODES = 50000;

/* Determina si un objeto JSON parece un evento deportivo. */
function looksLikeEvent(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  // Heurística A: campos de equipos
  const hasTeamPair =
    (o.home && o.away) ||
    (o.homeTeam && o.awayTeam) ||
    (o.t1Name && o.t2Name) ||
    (o.home_team && o.away_team) ||
    (Array.isArray(o.competitors) && o.competitors.length >= 2) ||
    (Array.isArray(o.participants) && o.participants.length >= 2) ||
    (Array.isArray(o.teams) && o.teams.length >= 2) ||
    (o.name && /\s+[vV][sS]?\.?\s+|\s+[-–—]\s+/.test(o.name));   // "X vs Y" pattern
  if (!hasTeamPair) return false;
  // Heurística B: tiene markets / odds / bets / outcomes
  // O bien tiene un campo de fecha + algún campo numérico que parezca odd
  const hasMarketHints =
    o.markets || o.bets || o.odds || o.outcomes || o.selections ||
    o.runners || o.h2h || o.fulltime || o.matchResult || o.matchOdds ||
    o.oddHome !== undefined || o.priceHome !== undefined ||
    o.homeOdd !== undefined ||
    Array.isArray(o.prices) || Array.isArray(o.mainMarkets);
  // Si tiene equipos + fecha + es de un mapa de eventos: aceptamos
  const hasScheduled = o.startTime || o.startsAt || o.commenceTime ||
                       o.commence_time || o.startDate || o.kickoff || o.scheduled;
  return !!(hasMarketHints || hasScheduled);
}

function looksLikeMarketSelection(o) {
  if (!o || typeof o !== 'object') return false;
  // Una selección típica tiene un precio numérico y un nombre/outcome
  const hasPrice = ['price', 'odd', 'odds', 'decimal', 'decimalOdds', 'value'].some(k =>
    typeof o[k] === 'number' || (typeof o[k] === 'string' && Number.isFinite(parseFloat(o[k])))
  );
  const hasOutcome = ['name', 'label', 'outcome', 'shortName', 'selection', 'type'].some(k => typeof o[k] === 'string');
  return hasPrice && hasOutcome;
}

/** Recorre un JSON tree buscando todos los nodos que parezcan eventos. */
function findEventNodes(root) {
  const out = [];
  let nodesVisited = 0;
  const walk = (node, depth) => {
    if (depth > MAX_TREE_DEPTH || nodesVisited > MAX_TREE_NODES) return;
    nodesVisited++;
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (looksLikeEvent(node)) {
      out.push(node);
      // No descendemos en eventos para no anidar
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Mapea un nodo "evento" a nuestro shape interno. */
function mapEventNode(node, bookKey) {
  const [home, away] = teamNames(node);
  if (!home || !away) return null;

  const start = node.start || node.startTime || node.kickoff ||
                node.scheduled || node.date || node.eventDate ||
                node.commenceTime || node.commence_time || node.startsAt;

  const competition = node.competition?.name || node.tournament?.name ||
                      node.league?.name || node.category?.name ||
                      node.competitionName || node.leagueName || node.tournamentName ||
                      node.competition?.title || node.tournament?.title;

  const sportName = String(
    node.sport?.name || node.sportName || node.sport ||
    node.discipline?.name || ''
  ).toLowerCase();
  const sport = sportName.includes('basket') ? 'basketball'
              : sportName.includes('tenis') || sportName.includes('tennis') ? 'tennis'
              : sportName.includes('americano') || sportName.includes('football amer') || sportName.includes('amfootball') ? 'amfootball'
              : sportName.includes('beisbol') || sportName.includes('baseball') ? 'baseball'
              : sportName.includes('hockey') ? 'hockey'
              : sportName.includes('mma') || sportName.includes('ufc') || sportName.includes('boxeo') ? 'mma'
              : 'soccer';

  const markets = extractMarkets(node);
  if (!markets || (!markets.h2h && !markets.totals && !markets.btts)) return null;

  // Wrap markets bajo bookKey si especificado
  const wrappedMarkets = {};
  if (bookKey) {
    if (markets.h2h)    wrappedMarkets.h2h = { [bookKey]: markets.h2h };
    if (markets.totals) wrappedMarkets.totals = { [bookKey]: markets.totals };
    if (markets.btts)   wrappedMarkets.btts = { [bookKey]: markets.btts };
    if (markets.dc)     wrappedMarkets.dc = { [bookKey]: markets.dc };
  } else {
    Object.assign(wrappedMarkets, markets);
  }

  return {
    home: { name: String(home).trim() },
    away: { name: String(away).trim() },
    start: start ? new Date(start).getTime() : null,
    league: null,
    leagueName: competition || null,
    sport,
    markets: wrappedMarkets
  };
}

function teamNames(e) {
  if (e.home?.name && e.away?.name) return [e.home.name, e.away.name];
  if (typeof e.home === 'string' && typeof e.away === 'string') return [e.home, e.away];
  if (e.t1Name && e.t2Name) return [e.t1Name, e.t2Name];
  if (e.homeTeam?.name && e.awayTeam?.name) return [e.homeTeam.name, e.awayTeam.name];
  const list = e.competitors || e.participants || e.teams || [];
  if (list[0] && list[1]) {
    const nA = list[0].name || list[0].title || list[0].displayName || list[0];
    const nB = list[1].name || list[1].title || list[1].displayName || list[1];
    return [typeof nA === 'string' ? nA : null, typeof nB === 'string' ? nB : null];
  }
  return [null, null];
}

function extractMarkets(node) {
  const out = {};
  const markets = []
    .concat(node.markets || [])
    .concat(node.bets || [])
    .concat(node.odds || [])
    .concat(node.oddsMarkets || []);

  for (const m of markets) {
    if (!m) continue;
    const sel = m.selections || m.outcomes || m.runners || [];
    const name = String(m.name || m.marketName || m.type || m.shortName || m.key || '').toLowerCase();

    // 1X2 / moneyline / match winner / h2h
    if (!out.h2h && /(1x2|resultado del partido|resultado final|match result|moneyline|h2h|ganador|winner|fulltime result|to win|match winner)/.test(name) && sel.length >= 2) {
      const findByName = (re) => sel.find(s => re.test(String(s.name || s.label || s.shortName || '')));
      const oHome  = findByName(/^1$|local|home/i);
      const oDraw  = findByName(/^x$|empate|draw|tie/i);
      const oAway  = findByName(/^2$|visit|away/i);
      const h2h = {
        home: parseDecimal(oHome?.price ?? oHome?.odd ?? oHome?.odds ?? oHome?.decimal ?? sel[0]?.price),
        draw: parseDecimal(oDraw?.price ?? oDraw?.odd ?? oDraw?.odds),
        away: parseDecimal(oAway?.price ?? oAway?.odd ?? oAway?.odds ?? oAway?.decimal ?? sel[sel.length-1]?.price)
      };
      if (isFinite2(h2h.home) || isFinite2(h2h.away)) out.h2h = h2h;
    }
    // Totals / Over-Under
    else if (!out.totals && /(total|más|menos|over|under)/.test(name)) {
      const line = m.line || m.handicap || sel[0]?.line || sel[0]?.handicap || sel[0]?.point;
      const ov = sel.find(s => /over|más/i.test(String(s.name || s.label || '')));
      const un = sel.find(s => /under|menos/i.test(String(s.name || s.label || '')));
      const numLine = Number(line);
      if (Number.isFinite(numLine) && (ov || un)) {
        out.totals = { [numLine]: {
          line: numLine,
          over: parseDecimal(ov?.price ?? ov?.odd ?? ov?.odds),
          under: parseDecimal(un?.price ?? un?.odd ?? un?.odds)
        }};
      }
    }
    // BTTS
    else if (!out.btts && /(ambos|both teams|btts|gg|marcan|both score)/.test(name)) {
      out.btts = {
        yes: parseDecimal((sel.find(s => /sí|si|yes/i.test(String(s.name||s.label||''))))?.price),
        no:  parseDecimal((sel.find(s => /^no/i.test(String(s.name||s.label||''))))?.price)
      };
    }
    // Doble oportunidad
    else if (!out.dc && /(doble oport|double chance)/.test(name)) {
      const find = (re) => sel.find(s => re.test(String(s.name || s.label || '')));
      out.dc = {
        home_or_draw: parseDecimal(find(/1x|1\/x|local.*empate|home.*draw/i)?.price),
        draw_or_away: parseDecimal(find(/x2|x\/2|empate.*visit|draw.*away/i)?.price),
        home_or_away: parseDecimal(find(/12|1\/2|local.*visit|home.*away/i)?.price)
      };
    }
  }

  // Campos directos sin envoltorio markets[]: oddHome, priceHome, etc.
  if (!out.h2h && (node.oddHome || node.priceHome || node.homeOdd)) {
    out.h2h = {
      home: parseDecimal(node.oddHome ?? node.priceHome ?? node.homeOdd ?? node.h2h?.home),
      draw: parseDecimal(node.oddDraw ?? node.priceDraw ?? node.drawOdd ?? node.h2h?.draw),
      away: parseDecimal(node.oddAway ?? node.priceAway ?? node.awayOdd ?? node.h2h?.away)
    };
  }

  return out;
}

/* JSON-LD scraping: muchos sitios incrustan markup Schema.org SportsEvent. */
function extractFromJsonLd(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).contents().text();
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      items.forEach(item => {
        if (!item) return;
        const t = item['@type'];
        if (t === 'SportsEvent' || t === 'Event' || (Array.isArray(t) && t.includes('SportsEvent'))) {
          const home = item.homeTeam?.name || item.competitor?.[0]?.name;
          const away = item.awayTeam?.name || item.competitor?.[1]?.name;
          const start = item.startDate;
          if (home && away) {
            out.push({
              home: { name: home },
              away: { name: away },
              start: start ? new Date(start).getTime() : null,
              leagueName: item.superEvent?.name || item.sport || null,
              sport: 'soccer',
              markets: {}  // JSON-LD raramente trae odds, solo fixture
            });
          }
        }
      });
    } catch {}
  });
  return out;
}

/* deepCapture: la función principal.
 * Carga la página, captura TODOS los responses JSON, los analiza, y devuelve
 * todos los eventos detectados (formato shape-agnóstico). */
async function deepCapture({
  url,
  bookKey,
  waitForSelector = null,
  waitNetworkIdle = true,
  scrollPasses = 2,
  scrollDelayMs = 800,
  settleMs = 2000,
  navTimeoutMs = 30000,
  blockResources = true,
  preNavigate = null,           // fn opcional para configurar headers/cookies antes de navegar
  postNavigate = null,          // fn opcional para ejecutar después del navigate
  extraInterceptors = null      // fn opcional que recibe (page, addJson) para hooks custom
} = {}) {
  const { page, ctx } = await browserPool.newPage({ blockResources });
  const jsonResponses = [];
  const wsMessages = [];
  let htmlBody = '';

  // Captura de TODOS los responses
  page.on('response', async (res) => {
    try {
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      // Solo nos interesan JSON responses
      if (!/json|application\/javascript/.test(ct)) return;
      // No leer responses gigantes (>5MB) — probablemente assets bundled
      const size = Number(res.headers()['content-length'] || 0);
      if (size > 5_000_000) return;
      const body = await res.text().catch(() => '');
      if (!body || body.length > 5_000_000) return;
      let json;
      // El response puede ser JSON puro o JSONP wrap
      try {
        json = JSON.parse(body);
      } catch {
        // Intentar JSONP: callback({...})
        const m = body.match(/^[a-zA-Z_$][\w$]*\((.*)\)\s*;?\s*$/);
        if (m) {
          try { json = JSON.parse(m[1]); } catch { return; }
        } else return;
      }
      if (json && (typeof json === 'object')) {
        jsonResponses.push({ url: res.url(), json });
      }
    } catch {}
  });

  // Captura de WebSocket frames (algunas casas pushan cuotas por WS)
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      try {
        if (!payload || typeof payload !== 'string') return;
        if (payload.length > 100_000) return;
        const json = JSON.parse(payload);
        if (json && typeof json === 'object') wsMessages.push({ url: ws.url(), json });
      } catch {}
    });
  });

  try {
    if (typeof preNavigate === 'function') await preNavigate(page, ctx);

    await page.goto(url, {
      waitUntil: waitNetworkIdle ? 'networkidle' : 'domcontentloaded',
      timeout: navTimeoutMs
    }).catch(e => log(`[deepCapture] nav warn ${url}: ${e.message?.slice(0, 80)}`));

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 12000 }).catch(() => {});
    }
    await sleep(settleMs);

    // Forzar lazy-load: scroll progresivo
    for (let i = 0; i < scrollPasses; i++) {
      try {
        await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.8)));
        await sleep(scrollDelayMs);
      } catch {}
    }
    // Volver al top y esperar un poco más
    try { await page.evaluate(() => window.scrollTo(0, 0)); } catch {}
    await sleep(800);

    if (typeof extraInterceptors === 'function') {
      await extraInterceptors(page, (j, src) => jsonResponses.push({ url: src || 'custom', json: j }));
    }

    if (typeof postNavigate === 'function') await postNavigate(page, ctx, { jsonResponses, wsMessages });

    htmlBody = await page.content().catch(() => '');
  } finally {
    try { await ctx.close(); } catch {}
  }

  // Análisis: por cada response JSON, buscar nodos-evento
  const events = [];
  const seen = new Set();
  const addIfNew = (ev) => {
    if (!ev) return;
    const k = `${ev.home?.name || ''}|${ev.away?.name || ''}|${ev.start || ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push(ev);
  };

  const allPayloads = jsonResponses.concat(wsMessages);
  for (const p of allPayloads) {
    const nodes = findEventNodes(p.json);
    for (const node of nodes) {
      const ev = mapEventNode(node, bookKey);
      addIfNew(ev);
    }
  }

  // Suplementar con JSON-LD si la cosecha XHR fue pobre
  if (events.length < 3 && htmlBody) {
    const jsonLdEvents = extractFromJsonLd(htmlBody);
    jsonLdEvents.forEach(addIfNew);
  }

  return {
    events,
    stats: {
      jsonResponses: jsonResponses.length,
      wsMessages: wsMessages.length,
      detected: events.length
    },
    // Para debugging: lista de URLs XHR capturadas + sample de su body
    captures: jsonResponses.map(p => ({
      url: p.url,
      bodyKeys: Object.keys(p.json).slice(0, 10),
      bodyPreview: JSON.stringify(p.json).slice(0, 300)
    })).slice(0, 20),
    htmlBody  // disponible si el caller quiere parsing custom adicional
  };
}

/** Wrapper con retry + backoff. Útil cuando el site tarda en estabilizar. */
async function deepCaptureWithRetry(opts, { retries = 1, backoffMs = 4000 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      last = await deepCapture(opts);
      if (last.events.length > 0) return last;
    } catch (e) {
      log(`[deepCapture] retry ${i+1} fail: ${e.message?.slice(0, 80)}`);
    }
    if (i < retries) await sleep(backoffMs * (i + 1));
  }
  return last || { events: [], stats: {}, htmlBody: '' };
}

module.exports = { deepCapture, deepCaptureWithRetry, findEventNodes, mapEventNode };
