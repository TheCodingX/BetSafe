/* BetSafe — Parser JSON de Kambi Group Limited (offering-api.kambicdn.com)
 * ============================================================================
 * Kambi es la plataforma de muchos bookies (BetWarrior, Unibet, Kindred, etc).
 * Sus endpoints públicos exponen el catálogo entero sin auth.
 *
 * Endpoints relevantes (operator key se pasa en el path, e.g. "tecacargrl"):
 *   /offering/v2018/{op}/listView/all.json
 *       → 200+ eventos con MAIN market (Resultado Final / 1X2)
 *   /offering/v2018/{op}/listView/{sport}/{country}/{league}/all/all/matches.json
 *       → eventos de UNA liga, con 2-3 betOffers por evento
 *   /offering/v2018/{op}/betoffer/event/{id1,id2,...}.json
 *       → TODOS los betOffers de uno o varios events (batch comma)
 *   /offering/v2018/{op}/betoffer/group/{groupId}.json
 *       → TODOS los betOffers de un grupo (liga entera)
 *
 * Formato:
 *   {
 *     events: [
 *       {
 *         event:    { id, name, homeName, awayName, start, group, groupId, path, sport, state },
 *         betOffers: [
 *           {
 *             id,
 *             criterion: { id, label, occurrenceType },     // identifica el mercado
 *             betOfferType: { id, name },                    // describe el tipo
 *             outcomes: [
 *               { id, label, type, odds, line, participant } // odds en milliunits (1960 = 1.96)
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Markets identificados por criterion.id:
 *   1001159858 Resultado Final (1X2)     OT_ONE / OT_CROSS / OT_TWO
 *   1001159926 Total de goles            OT_OVER / OT_UNDER  (line en milli)
 *   1001642858 Ambos Equipos Marcarán    OT_YES / OT_NO
 *   1001159922 Doble Oportunidad         OT_ONE_OR_CROSS / OT_ONE_OR_TWO / OT_CROSS_OR_TWO
 *   1001159666 Apuesta sin empate (DNB)  OT_ONE / OT_TWO
 *   1001159891 Hándicap Asiático         OT_ONE / OT_TWO con line
 *
 * Sport names (event.sport):
 *   FOOTBALL, TENNIS, BASKETBALL, BASEBALL, ICE_HOCKEY, AMERICAN_FOOTBALL,
 *   RUGBY_UNION, VOLLEYBALL, HANDBALL, ESPORTS, MMA, BOXING, ...
 * ============================================================================
 */
'use strict';

/* ── Normalización deporte (Kambi → BetSafe) ────────────────────────────────── */
const SPORT_MAP = {
  FOOTBALL: 'soccer',
  SOCCER: 'soccer',
  TENNIS: 'tennis',
  TABLE_TENNIS: 'tabletennis',
  BASKETBALL: 'basketball',
  BASEBALL: 'baseball',
  ICE_HOCKEY: 'hockey',
  HOCKEY: 'hockey',
  AMERICAN_FOOTBALL: 'amfootball',
  RUGBY_UNION: 'rugby',
  RUGBY_LEAGUE: 'rugby',
  VOLLEYBALL: 'volleyball',
  HANDBALL: 'handball',
  ESPORTS: 'esports',
  MMA: 'mma',
  BOXING: 'mma',
  CRICKET: 'cricket',
  DARTS: 'darts',
  SNOOKER: 'snooker',
  GOLF: 'golf',
  BADMINTON: 'badminton'
};

function normalizeSport(s) {
  if (!s) return 'other';
  return SPORT_MAP[String(s).toUpperCase()] || 'other';
}

/* ── Mapping de ligas ───────────────────────────────────────────────────────── */
const LEAGUE_MAP = [
  // STRICT: solo Liga Profesional ARGENTINA
  { re: /liga\s*profesional\s*(?:de\s*f[úu]tbol|argentina)|copa\s*argentina|primera\s*nacional|argentina.*primera\s*divisi|\bafa\b/i, key: 'lpf' },
  { re: /premier league/i,                          key: 'epl' },
  { re: /\bla ?liga\b|primera divisi[oó]n espa/i,   key: 'laliga' },
  { re: /serie a/i,                                 key: 'seriea' },
  { re: /bundesliga/i,                              key: 'bundesliga' },
  { re: /ligue 1/i,                                 key: 'ligue1' },
  { re: /champions league/i,                        key: 'ucl' },
  { re: /europa league/i,                           key: 'uel' },
  { re: /libertadores/i,                            key: 'libertadores' },
  { re: /sudamericana/i,                            key: 'sudamericana' },
  { re: /mls/i,                                     key: 'mls' },
  { re: /\bnba\b/i,                                 key: 'nba' },
  { re: /\bnfl\b/i,                                 key: 'nfl' },
  { re: /\bmlb\b/i,                                 key: 'mlb' },
  { re: /\bnhl\b/i,                                 key: 'nhl' },
  { re: /\batp\b/i,                                 key: 'atp' },
  { re: /\bwta\b/i,                                 key: 'wta' },
  { re: /\bufc\b|mma/i,                             key: 'ufc' }
];

function resolveLeague(name) {
  if (!name) return { key: null, name: null };
  for (const { re, key } of LEAGUE_MAP) if (re.test(name)) return { key, name };
  return { key: null, name };
}

/* ── Parseo de odds: Kambi usa milliunits (1960 = 1.96, 10000 = 10.0) ───────── */
function parseOdds(milli) {
  if (milli == null) return null;
  const n = Number(milli);
  if (!Number.isFinite(n)) return null;
  const v = n / 1000;
  return v > 1.01 && v < 1000 ? v : null;
}

/* ── Parseo de línea (Kambi también la pone en milliunits: 4500 = 4.5) ──────── */
function parseLine(milli) {
  if (milli == null) return null;
  const n = Number(milli);
  if (!Number.isFinite(n)) return null;
  return n / 1000;
}

function preferredTotalsLine(sport) {
  if (sport === 'basketball') return 215.5;
  if (sport === 'baseball')   return 8.5;
  if (sport === 'amfootball') return 45.5;
  return 2.5;
}

/* ── Procesa un betOffer único → un mercado interno (h2h/totals/btts/dc/ah) ──── */
function processBetOffer(bo, sport) {
  const cid = bo?.criterion?.id;
  const outcomes = bo?.outcomes || [];
  if (!cid || !outcomes.length) return null;

  /* 1X2 (Resultado Final) — también captura "Descanso" si quieres */
  if (cid === 1001159858) {
    const home = outcomes.find(o => o.type === 'OT_ONE');
    const draw = outcomes.find(o => o.type === 'OT_CROSS');
    const away = outcomes.find(o => o.type === 'OT_TWO');
    const ph = parseOdds(home?.odds);
    const pa = parseOdds(away?.odds);
    if (!ph || !pa) return null;
    return { kind: 'h2h', value: { home: ph, draw: parseOdds(draw?.odds), away: pa } };
  }

  /* Apuesta sin empate (DNB) — separado de h2h para tener su market propio */
  if (cid === 1001159666) {
    const home = outcomes.find(o => o.type === 'OT_ONE');
    const away = outcomes.find(o => o.type === 'OT_TWO');
    const ph = parseOdds(home?.odds);
    const pa = parseOdds(away?.odds);
    if (!ph || !pa) return null;
    return { kind: 'dnb', value: { home: ph, away: pa } };
  }

  /* Total de goles / Total de puntos (criterion 1001159926 fútbol; en otros sports varía) */
  if (cid === 1001159926) {
    const over = outcomes.find(o => o.type === 'OT_OVER');
    const under = outcomes.find(o => o.type === 'OT_UNDER');
    const ov = parseOdds(over?.odds);
    const un = parseOdds(under?.odds);
    const line = parseLine(over?.line ?? under?.line);
    if (!ov || !un || line == null) return null;
    return { kind: 'totals_candidate', value: { line, over: ov, under: un } };
  }

  /* Ambos Equipos Marcarán (BTTS) */
  if (cid === 1001642858) {
    const yes = outcomes.find(o => o.type === 'OT_YES');
    const no = outcomes.find(o => o.type === 'OT_NO');
    const py = parseOdds(yes?.odds);
    const pn = parseOdds(no?.odds);
    if (!py || !pn) return null;
    return { kind: 'btts', value: { yes: py, no: pn } };
  }

  /* Doble Oportunidad */
  if (cid === 1001159922) {
    const oc = outcomes.find(o => o.type === 'OT_ONE_OR_CROSS');
    const ot = outcomes.find(o => o.type === 'OT_ONE_OR_TWO');
    const ct = outcomes.find(o => o.type === 'OT_CROSS_OR_TWO');
    const p1 = parseOdds(oc?.odds);
    const p12 = parseOdds(ot?.odds);
    const p2 = parseOdds(ct?.odds);
    if (!p1 && !p12 && !p2) return null;
    return { kind: 'dc', value: { home_or_draw: p1, home_or_away: p12, draw_or_away: p2 } };
  }

  /* Hándicap Asiático (criteria 1001159891, 1001247308) — OT_ONE / OT_TWO con line */
  if (cid === 1001159891 || cid === 1001247308 || cid === 1001159968) {
    const ho = outcomes.find(o => o.type === 'OT_ONE');
    const ao = outcomes.find(o => o.type === 'OT_TWO');
    const oh = parseOdds(ho?.odds);
    const oa = parseOdds(ao?.odds);
    const line = parseLine(ho?.line ?? ao?.line);
    if (!oh || !oa || line == null) return null;
    return { kind: 'ah', value: { line, home_minus: oh, away_plus: oa } };
  }

  /* ── MARKETS EXTENDIDOS (2026-05-17) ─────────────────────────────────────
   * Kambi criterionIds adicionales para fútbol. Las IDs son consistentes
   * cross-operator (Betsson AR, BetWarrior, 888sport, etc. todos usan el
   * mismo schema). Si la casa no ofrece ese mercado para el partido, el
   * betOffer simplemente no aparece en betOffers — sin crash.
   */

  /* Resultado al Descanso (HT 1X2)
   * REAL criterionIds verificados 2026-05-18 contra tecacargrl (BetWarrior):
   * - 1000316018 = "Half Time"
   * Plus IDs históricos por compatibilidad: 1001159921, 1001687428 */
  if (cid === 1000316018 || cid === 1001159921 || cid === 1001687428) {
    const home = outcomes.find(o => o.type === 'OT_ONE');
    const draw = outcomes.find(o => o.type === 'OT_CROSS');
    const away = outcomes.find(o => o.type === 'OT_TWO');
    const ph = parseOdds(home?.odds);
    const pa = parseOdds(away?.odds);
    if (!ph || !pa) return null;
    return { kind: 'ht_result', value: { home: ph, draw: parseOdds(draw?.odds), away: pa } };
  }

  /* Total de Goles al Descanso (HT Over/Under)
   * REAL cid verificado: 1001159532 = "Total Goals - 1st Half"
   * Plus históricos: 1001159927, 1001687429 */
  if (cid === 1001159532 || cid === 1001159927 || cid === 1001687429) {
    const over = outcomes.find(o => o.type === 'OT_OVER');
    const under = outcomes.find(o => o.type === 'OT_UNDER');
    const ov = parseOdds(over?.odds);
    const un = parseOdds(under?.odds);
    const line = parseLine(over?.line ?? under?.line);
    if (!ov || !un || line == null) return null;
    return { kind: 'totals_ht_candidate', value: { line, over: ov, under: un } };
  }

  /* Total de Córners (Over/Under)
   * REAL cid verificado: 1001159897 = "Total Corners"
   * Plus históricos: 1001159939, 1001207924, 1001687431 */
  if (cid === 1001159897 || cid === 1001159939 || cid === 1001207924 || cid === 1001687431) {
    const over = outcomes.find(o => o.type === 'OT_OVER');
    const under = outcomes.find(o => o.type === 'OT_UNDER');
    const ov = parseOdds(over?.odds);
    const un = parseOdds(under?.odds);
    const line = parseLine(over?.line ?? under?.line);
    if (!ov || !un || line == null) return null;
    return { kind: 'corners_candidate', value: { line, over: ov, under: un } };
  }

  /* Total de Tarjetas (Booking points Over/Under) — cid 1001159948 / 1001687432
   * Nota: BetWarrior actual no expone tarjetas — solo eventos top-tier. */
  if (cid === 1001159948 || cid === 1001687432 || cid === 1001247313) {
    const over = outcomes.find(o => o.type === 'OT_OVER');
    const under = outcomes.find(o => o.type === 'OT_UNDER');
    const ov = parseOdds(over?.odds);
    const un = parseOdds(under?.odds);
    const line = parseLine(over?.line ?? under?.line);
    if (!ov || !un || line == null) return null;
    return { kind: 'cards_candidate', value: { line, over: ov, under: un } };
  }

  /* Marcador Exacto (Correct Score)
   * REAL cid verificado: 1001159780 = "Correct Score"
   * Plus históricos: 1001159900, 1001687425, 1001687426
   * Cada outcome es un score "1-0", "2-1" etc. (en label/englishLabel) */
  if (cid === 1001159780 || cid === 1001159900 || cid === 1001687425 || cid === 1001687426) {
    const scores = {};
    for (const o of outcomes) {
      const label = String(o.englishLabel || o.label || '').trim();
      const odd = parseOdds(o.odds);
      const m = label.match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
      if (m && odd) scores[`${m[1]}-${m[2]}`] = odd;
    }
    if (!Object.keys(scores).length) return null;
    return { kind: 'exact_score', value: scores };
  }

  /* FALLBACK por NOMBRE del criterion: si el cid no matchea pero el label
   * dice claramente "Córners totales" / "Tarjetas" / "Marcador exacto" /
   * "Primer tiempo 1X2", aplicamos los handlers correspondientes. Esto
   * agarra cases donde Kambi cambió de cid sin avisar. */
  const cName = String(bo?.criterion?.label || '').toLowerCase();
  if (/c[óo]rners?/.test(cName) && /m[áa]s|menos|over|under|total/i.test(cName)) {
    const over = outcomes.find(o => o.type === 'OT_OVER');
    const under = outcomes.find(o => o.type === 'OT_UNDER');
    const ov = parseOdds(over?.odds);
    const un = parseOdds(under?.odds);
    const line = parseLine(over?.line ?? under?.line);
    if (ov && un && line != null) return { kind: 'corners_candidate', value: { line, over: ov, under: un } };
  }
  if (/tarjetas?|amonestaci/.test(cName) && /m[áa]s|menos|over|under|total/i.test(cName)) {
    const over = outcomes.find(o => o.type === 'OT_OVER');
    const under = outcomes.find(o => o.type === 'OT_UNDER');
    const ov = parseOdds(over?.odds);
    const un = parseOdds(under?.odds);
    const line = parseLine(over?.line ?? under?.line);
    if (ov && un && line != null) return { kind: 'cards_candidate', value: { line, over: ov, under: un } };
  }

  return null;
}

/* ── Build event interno a partir del bloque {event, betOffers} ────────────── */
function buildEvent(item, bookKey) {
  const ev = item?.event;
  if (!ev) return null;
  if (ev.state && ev.state !== 'NOT_STARTED' && ev.state !== 'STARTED' && ev.state !== 'OPEN' && ev.state !== 'LIVE') return null;
  const home = ev.homeName;
  const away = ev.awayName;
  if (!home || !away || home === away) return null;
  const sport = normalizeSport(ev.sport);
  const lg = resolveLeague(ev.group);
  const start = ev.start ? Date.parse(ev.start) : null;
  if (start == null || !Number.isFinite(start)) return null;

  const markets = {};
  let bestTotal = null, bestTotalHt = null, bestCorners = null, bestCards = null;
  for (const bo of (item.betOffers || [])) {
    const res = processBetOffer(bo, sport);
    if (!res) continue;
    if (res.kind === 'h2h' && !markets.h2h) markets.h2h = res.value;
    else if (res.kind === 'dc' && !markets.dc) markets.dc = res.value;
    else if (res.kind === 'btts' && !markets.btts) markets.btts = res.value;
    else if (res.kind === 'ah' && !markets.ah) markets.ah = res.value;
    else if (res.kind === 'dnb' && !markets.dnb) markets.dnb = res.value;
    else if (res.kind === 'ht_result' && !markets['ht-result']) markets['ht-result'] = res.value;
    else if (res.kind === 'exact_score' && !markets['exact-score']) markets['exact-score'] = res.value;
    else if (res.kind === 'totals_candidate') {
      const pref = preferredTotalsLine(sport);
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestTotal ? Math.abs(bestTotal.line - pref) : Infinity;
      if (newDiff < curDiff) bestTotal = res.value;
    }
    else if (res.kind === 'totals_ht_candidate') {
      const pref = 1.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestTotalHt ? Math.abs(bestTotalHt.line - pref) : Infinity;
      if (newDiff < curDiff) bestTotalHt = res.value;
    }
    else if (res.kind === 'corners_candidate') {
      const pref = 9.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestCorners ? Math.abs(bestCorners.line - pref) : Infinity;
      if (newDiff < curDiff) bestCorners = res.value;
    }
    else if (res.kind === 'cards_candidate') {
      const pref = 4.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestCards ? Math.abs(bestCards.line - pref) : Infinity;
      if (newDiff < curDiff) bestCards = res.value;
    }
  }
  if (bestTotal) markets.totals = { [bestTotal.line]: bestTotal };
  if (bestTotalHt) markets['totals-ht'] = { [bestTotalHt.line]: bestTotalHt };
  if (bestCorners) markets['corners-total'] = { [bestCorners.line]: bestCorners };
  if (bestCards) markets['cards-total'] = { [bestCards.line]: bestCards };

  if (!markets.h2h && !markets.totals && !markets.btts && !markets.dc && !markets.ah
      && !markets.dnb && !markets['ht-result'] && !markets['totals-ht']
      && !markets['exact-score'] && !markets['corners-total'] && !markets['cards-total']) return null;

  // Wrap markets bajo bookKey (e.g. 'betwarrior')
  const wrapped = {};
  for (const [k, v] of Object.entries(markets)) if (v) wrapped[k] = { [bookKey]: v };

  return {
    home: { name: home },
    away: { name: away },
    start,
    league: lg.key,
    leagueName: ev.group || null,
    sport,
    markets: wrapped
  };
}

/* ── parseKambiListView: payload de listView/* → array de events internos ───── */
function parseKambiListView(payload, bookKey) {
  if (!payload || !Array.isArray(payload.events)) return [];
  const out = [];
  for (const item of payload.events) {
    const ev = buildEvent(item, bookKey);
    if (ev) out.push(ev);
  }
  return out;
}

/* ── parseKambiBetoffers: payload de /betoffer/event/{ids}.json ──────────────
 * Devuelve array de { eventId, markets:{h2h,totals,btts,dc,ah} } para que el
 * scraper haga merge con los eventos del listView (que ya tiene home/away/start).
 */
function parseKambiBetoffers(payload, sportHint = 'soccer') {
  if (!payload || !Array.isArray(payload.betOffers)) return new Map();
  const byEvent = new Map();
  for (const bo of payload.betOffers) {
    const eid = bo.eventId;
    if (!eid) continue;
    const res = processBetOffer(bo, sportHint);
    if (!res) continue;
    if (!byEvent.has(eid)) byEvent.set(eid, { markets: {}, bestTotal: null, bestTotalHt: null, bestCorners: null, bestCards: null });
    const ctx = byEvent.get(eid);
    if (res.kind === 'h2h' && !ctx.markets.h2h) ctx.markets.h2h = res.value;
    else if (res.kind === 'dc' && !ctx.markets.dc) ctx.markets.dc = res.value;
    else if (res.kind === 'btts' && !ctx.markets.btts) ctx.markets.btts = res.value;
    else if (res.kind === 'ah' && !ctx.markets.ah) ctx.markets.ah = res.value;
    else if (res.kind === 'dnb' && !ctx.markets.dnb) ctx.markets.dnb = res.value;
    else if (res.kind === 'ht_result' && !ctx.markets['ht-result']) ctx.markets['ht-result'] = res.value;
    else if (res.kind === 'exact_score' && !ctx.markets['exact-score']) ctx.markets['exact-score'] = res.value;
    else if (res.kind === 'totals_candidate') {
      const pref = preferredTotalsLine(sportHint);
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = ctx.bestTotal ? Math.abs(ctx.bestTotal.line - pref) : Infinity;
      if (newDiff < curDiff) ctx.bestTotal = res.value;
    }
    else if (res.kind === 'totals_ht_candidate') {
      const pref = 1.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = ctx.bestTotalHt ? Math.abs(ctx.bestTotalHt.line - pref) : Infinity;
      if (newDiff < curDiff) ctx.bestTotalHt = res.value;
    }
    else if (res.kind === 'corners_candidate') {
      const pref = 9.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = ctx.bestCorners ? Math.abs(ctx.bestCorners.line - pref) : Infinity;
      if (newDiff < curDiff) ctx.bestCorners = res.value;
    }
    else if (res.kind === 'cards_candidate') {
      const pref = 4.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = ctx.bestCards ? Math.abs(ctx.bestCards.line - pref) : Infinity;
      if (newDiff < curDiff) ctx.bestCards = res.value;
    }
  }
  // Aplicar candidates a markets
  for (const [, ctx] of byEvent) {
    if (ctx.bestTotal) ctx.markets.totals = { [ctx.bestTotal.line]: ctx.bestTotal };
    if (ctx.bestTotalHt) ctx.markets['totals-ht'] = { [ctx.bestTotalHt.line]: ctx.bestTotalHt };
    if (ctx.bestCorners) ctx.markets['corners-total'] = { [ctx.bestCorners.line]: ctx.bestCorners };
    if (ctx.bestCards) ctx.markets['cards-total'] = { [ctx.bestCards.line]: ctx.bestCards };
  }
  return byEvent;
}

module.exports = { parseKambiListView, parseKambiBetoffers, processBetOffer, buildEvent, normalizeSport };
