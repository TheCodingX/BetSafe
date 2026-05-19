/* BetSafe — Parser JSON de API Betano (Kaizen Gaming — betano.bet.ar)
 * ============================================================================
 * Betano usa la plataforma Kaizen Gaming. Expone DOS familias de endpoints
 * que devuelven el catálogo de cuotas, con formatos distintos:
 *
 * FORMATO A — "Kaizen flat dict" (events/markets/selections indexados por ID):
 *   /danae-webapi/api/live/overview/latest?...     (LIVE — 89+ eventos)
 *   /api/home/top-events-v2/                       (TOP prematch — 28+ eventos)
 *   {
 *     sports:     { byId: { FOOT: {...}, BASK: {...}, ... } },
 *     leagues:    { [leagueId]: { name, sportId, eventIdList } },
 *     events:     { [eventId]: { participants, startTime, marketIdList, ... } },
 *     markets:    { [marketId]: { selectionIdList, type, typeId, handicap } },
 *     selections: { [selectionId]: { price, name, columnIndex, ... } }
 *   }
 *
 * FORMATO B — "Nested array" (markets/selections inline en cada event):
 *   /api/home/top-events                           (HOME — 9 sports nested)
 *   { data: { topEvents: [
 *       { id: 'FOOT', name: 'Fútbol', events: [
 *         { id, name, startTime, leagueName, markets: [
 *           { type, typeId, handicap, selections: [{ price, name, ... }] }
 *         ] }
 *       ] }
 *     ] } }
 *
 * Markets identificados por `type`:
 *   MRES → 1X2                      (col 0=home, 1=draw, 2=away)
 *   MR12 → 1X2 SuperCuotas          (igual mapeo que MRES)
 *   DBLC → Doble oportunidad        (col 0=1X, 1=12, 2=X2)
 *   HCTG → Totals Más/Menos         (handicap = línea; col 0=over, 1=under)
 *   BTSC → Both Teams To Score      (col 0=Sí, 1=No)
 *   HCAP/FAHC/FHOT → Handicap       (handicap = línea)
 *   H2HT → Ganador (basket/tennis/esports — sin empate)
 *   FTPO → Total puntos (basket/amfootball)
 * ============================================================================
 */
'use strict';

/* ── Normalización de deporte ──────────────────────────────────────────────── */
const SPORT_MAP = {
  FOOT: 'soccer',
  FUTS: 'soccer',
  BASK: 'basketball',
  TENN: 'tennis',
  BASE: 'baseball',
  HOCK: 'hockey',
  ICEH: 'hockey',
  AMFB: 'amfootball',
  AMFO: 'amfootball',
  AMER: 'amfootball',
  RUGB: 'rugby',
  RUGL: 'rugby',
  VOLL: 'volleyball',
  VOLB: 'volleyball',
  HAND: 'handball',
  ESPS: 'esports',
  TABL: 'tabletennis',
  BADM: 'badminton',
  MMAX: 'mma',
  BOXG: 'mma',
  CRIC: 'cricket',
  DART: 'darts',
  SNOO: 'snooker',
  GOLF: 'golf',
  VRTS: 'other'
};

function normalizeSportId(sportId) {
  if (!sportId) return 'other';
  return SPORT_MAP[String(sportId).toUpperCase()] || 'other';
}

/* ── Mapping de ligas ───────────────────────────────────────────────────────── */
const LEAGUE_MAP = [
  // STRICT: solo Liga Profesional ARGENTINA (no Saudí, no Mexicana, etc).
  { re: /liga\s*profesional\s*(?:de\s*f[úu]tbol|argentina)|copa\s*argentina|argentina.*primera|\bafa\b/i, key: 'lpf' },
  { re: /premier league/i,                          key: 'epl' },
  { re: /la ?liga|primera divisi[oó]n espa/i,       key: 'laliga' },
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

function parsePrice(n) {
  if (n == null) return null;
  const v = typeof n === 'number' ? n : parseFloat(String(n).replace(',', '.'));
  return Number.isFinite(v) && v > 1.01 && v < 1000 ? v : null;
}

function preferredTotalsLine(sport) {
  if (sport === 'basketball') return 215.5;
  if (sport === 'baseball')   return 8.5;
  if (sport === 'amfootball') return 45.5;
  return 2.5;
}

/* ── Procesa un array de selections con su market type → mercado interno ────── */
function selsToMarket(sels, type, handicap, home, away, sport) {
  if (!sels.length) return null;
  const byCol = (idx) => sels.find(s => s.columnIndex === idx) ?? sels[idx];
  const byName = (re) => sels.find(s => s.name && re.test(s.name));

  switch (type) {
    /* 1X2 */
    case 'MRES':
    case 'MR12': {
      const ph = parsePrice(byCol(0)?.price);
      const pd = sels.length >= 3 ? parsePrice(byCol(1)?.price) : null;
      const pa = parsePrice(byCol(sels.length >= 3 ? 2 : 1)?.price);
      if (ph && pa) return { kind: 'h2h', value: { home: ph, draw: pd, away: pa } };
      return null;
    }
    /* Ganador sin empate (basket/tennis/esports) */
    case 'H2HT': {
      const ph = parsePrice(byCol(0)?.price);
      const pa = parsePrice(byCol(1)?.price);
      if (ph && pa) return { kind: 'h2h', value: { home: ph, draw: null, away: pa } };
      return null;
    }
    /* Doble oportunidad */
    case 'DBLC': {
      const p1x = parsePrice(byCol(0)?.price);
      const p12 = parsePrice(byCol(1)?.price);
      const px2 = parsePrice(byCol(2)?.price);
      if (!p1x && !p12 && !px2) return null;
      return { kind: 'dc', value: { home_or_draw: p1x, home_or_away: p12, draw_or_away: px2 } };
    }
    /* Totals Más/Menos */
    case 'HCTG':
    case 'FTPO': {
      if (!Number.isFinite(handicap)) return null;
      const over = parsePrice(byCol(0)?.price) ?? parsePrice(byName(/^m[áa]s/i)?.price);
      const under = parsePrice(byCol(1)?.price) ?? parsePrice(byName(/^menos/i)?.price);
      if (!over || !under) return null;
      return { kind: 'totals_candidate', value: { line: handicap, over, under } };
    }
    /* BTTS */
    case 'BTSC': {
      const yes = parsePrice(byCol(0)?.price) ?? parsePrice(byName(/^s[íi]$/i)?.price);
      const no = parsePrice(byCol(1)?.price) ?? parsePrice(byName(/^no$/i)?.price);
      if (!yes || !no) return null;
      return { kind: 'btts', value: { yes, no } };
    }
    /* Asian/Match Handicap */
    case 'HCAP':
    case 'FAHC':
    case 'FHOT': {
      if (!Number.isFinite(handicap)) return null;
      const ho = parsePrice(byCol(0)?.price);
      const ao = parsePrice(byCol(1)?.price);
      if (!ho || !ao) return null;
      return { kind: 'ah', value: { line: handicap, home_minus: ho, away_plus: ao } };
    }
    /* CÓRNERS — Total córners Más/Menos
     * Kaizen Gaming usa típicamente: CRNR, CORN, FCRN (full corners)
     * También puede aparecer como market name "Córners" + tipo total */
    case 'CRNR':
    case 'CORN':
    case 'FCRN':
    case 'TCRN': {
      if (!Number.isFinite(handicap)) return null;
      const over = parsePrice(byCol(0)?.price) ?? parsePrice(byName(/^m[áa]s|over/i)?.price);
      const under = parsePrice(byCol(1)?.price) ?? parsePrice(byName(/^menos|under/i)?.price);
      if (!over || !under) return null;
      return { kind: 'corners_candidate', value: { line: handicap, over, under } };
    }
    /* TARJETAS — Total tarjetas Más/Menos
     * Kaizen: CARD, TBOOK, BOOK (booking points) */
    case 'CARD':
    case 'CARDS':
    case 'BOOK':
    case 'TBOOK':
    case 'FBOOK': {
      if (!Number.isFinite(handicap)) return null;
      const over = parsePrice(byCol(0)?.price) ?? parsePrice(byName(/^m[áa]s|over/i)?.price);
      const under = parsePrice(byCol(1)?.price) ?? parsePrice(byName(/^menos|under/i)?.price);
      if (!over || !under) return null;
      return { kind: 'cards_candidate', value: { line: handicap, over, under } };
    }
    /* HÁNDICAP EUROPEO (3-way) — ganador con hándicap entero, permite empate
     * Kaizen: HHC3, EHCP, EHCAP */
    case 'HHC3':
    case 'EHCP':
    case 'EHCAP': {
      if (!Number.isFinite(handicap)) return null;
      const ho = parsePrice(byCol(0)?.price);
      const dr = parsePrice(byCol(1)?.price);
      const ao = parsePrice(byCol(2)?.price);
      if (!ho || !ao) return null;
      return { kind: 'eh', value: { line: handicap, home: ho, draw: dr, away: ao } };
    }
    /* GOLEADOR — Anota cualquier momento
     * Kaizen: GLAT, GSAT, ANYG, ATGS */
    case 'GLAT':
    case 'GSAT':
    case 'ANYG':
    case 'ATGS': {
      const players = sels
        .map(s => ({ name: s.name, price: parsePrice(s.price) }))
        .filter(p => p.name && p.price);
      if (!players.length) return null;
      return { kind: 'goalscorer_candidate', value: { players } };
    }
    /* DNB — Empate no apuesta (2-way)
     * Kaizen: DNB, DRWNB, NDRW */
    case 'DNB':
    case 'DRWNB':
    case 'NDRW': {
      const ho = parsePrice(byCol(0)?.price);
      const ao = parsePrice(byCol(1)?.price);
      if (!ho || !ao) return null;
      return { kind: 'dnb', value: { home: ho, away: ao } };
    }
    /* HT result — 1X2 del primer tiempo
     * Kaizen: H1X2, HTRT, HRES, HTRES */
    case 'H1X2':
    case 'HTRT':
    case 'HRES':
    case 'HTRES': {
      const ph = parsePrice(byCol(0)?.price);
      const pd = sels.length >= 3 ? parsePrice(byCol(1)?.price) : null;
      const pa = parsePrice(byCol(sels.length >= 3 ? 2 : 1)?.price);
      if (!ph || !pa) return null;
      return { kind: 'ht_result', value: { home: ph, draw: pd, away: pa } };
    }
    /* Totals HT — Más/Menos goles primer tiempo
     * Kaizen: HOU, HOUM, HTOU, HOUG */
    case 'HOU':
    case 'HOUM':
    case 'HTOU':
    case 'HOUG': {
      if (!Number.isFinite(handicap)) return null;
      const over = parsePrice(byCol(0)?.price) ?? parsePrice(byName(/^m[áa]s|over/i)?.price);
      const under = parsePrice(byCol(1)?.price) ?? parsePrice(byName(/^menos|under/i)?.price);
      if (!over || !under) return null;
      return { kind: 'totals_ht_candidate', value: { line: handicap, over, under } };
    }
    /* Marcador exacto — collection de outcomes "1-0", "2-1", etc.
     * Kaizen: EXAS, EXSC, CSCO, ECSC */
    case 'EXAS':
    case 'EXSC':
    case 'CSCO':
    case 'ECSC': {
      const scores = {};
      for (const s of sels) {
        const name = String(s.name || '').trim();
        const odd = parsePrice(s.price);
        // Normalizar formato "1-0", "1:0", "1 - 0" → "1-0"
        const m = name.match(/^(\d{1,2})\s*[-:]\s*(\d{1,2})$/);
        if (m && odd) scores[`${m[1]}-${m[2]}`] = odd;
      }
      if (!Object.keys(scores).length) return null;
      return { kind: 'exact_score', value: scores };
    }
    default:
      return null;
  }
}

/* ── Format A: Kaizen flat dict (events/markets/selections indexados) ───────── */
function buildEventFlat(eventId, dict) {
  const ev = dict.events?.[eventId];
  if (!ev) return null;
  const participants = ev.participants || [];
  if (participants.length < 2) return null;

  const home = participants.find(p => p.isHome === true) ?? participants[0];
  const away = participants.find(p => p.isHome === false) ?? participants[participants.length - 1 === 0 ? 0 : 1];
  if (!home?.name || !away?.name || home.name === away.name) return null;

  const sport = normalizeSportId(ev.sportId);
  const league = dict.leagues?.[ev.leagueId];
  const lg = resolveLeague(league?.name || null);

  const markets = {};
  let bestTotal = null, bestTotalHt = null, bestCorners = null, bestCards = null;
  const marketIds = Array.isArray(ev.marketIdList) ? ev.marketIdList : [];

  for (const mid of marketIds) {
    const m = dict.markets?.[mid];
    if (!m) continue;
    const sels = (m.selectionIdList || []).map(id => dict.selections?.[id]).filter(Boolean);
    const res = selsToMarket(sels, m.type, m.handicap, home, away, sport);
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
      // Para HT preferimos línea 1.5 (2 goles 1T es alto)
      const pref = 1.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestTotalHt ? Math.abs(bestTotalHt.line - pref) : Infinity;
      if (newDiff < curDiff) bestTotalHt = res.value;
    }
    else if (res.kind === 'corners_candidate') {
      // Línea preferida: 9.5 córners totales
      const pref = 9.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestCorners ? Math.abs(bestCorners.line - pref) : Infinity;
      if (newDiff < curDiff) bestCorners = res.value;
    }
    else if (res.kind === 'cards_candidate') {
      // Línea preferida: 4.5 tarjetas totales
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

  const wrapped = {};
  for (const [k, v] of Object.entries(markets)) if (v) wrapped[k] = { betano: v };

  return {
    home: { name: home.name },
    away: { name: away.name },
    start: Number.isFinite(ev.startTime) ? ev.startTime : null,
    league: lg.key,
    leagueName: league?.name || null,
    sport,
    markets: wrapped
  };
}

/* ── Format B: Nested (markets inline en cada event) ─────────────────────────── */
function buildEventNested(ev) {
  if (!ev || !ev.name) return null;
  // Participants pueden venir en `participants`, o derivados de `shortName` / `name` con " - "
  let homeName, awayName;
  if (Array.isArray(ev.participants) && ev.participants.length >= 2) {
    const h = ev.participants.find(p => p.isHome === true) ?? ev.participants[0];
    const a = ev.participants.find(p => p.isHome === false) ?? ev.participants[1];
    homeName = h?.name;
    awayName = a?.name;
  } else {
    const parts = String(ev.name).split(/\s+-\s+/);
    if (parts.length === 2) { homeName = parts[0]; awayName = parts[1]; }
  }
  if (!homeName || !awayName || homeName === awayName) return null;

  const sport = normalizeSportId(ev.sportId);
  const lg = resolveLeague(ev.leagueDescription || ev.leagueName || null);

  const markets = {};
  let bestTotal = null, bestTotalHt = null, bestCorners = null, bestCards = null;
  const evMarkets = Array.isArray(ev.markets) ? ev.markets : [];

  for (const m of evMarkets) {
    const sels = Array.isArray(m.selections) ? m.selections : [];
    const res = selsToMarket(sels, m.type, m.handicap, { name: homeName }, { name: awayName }, sport);
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
      // Para HT preferimos línea 1.5 (2 goles 1T es alto)
      const pref = 1.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestTotalHt ? Math.abs(bestTotalHt.line - pref) : Infinity;
      if (newDiff < curDiff) bestTotalHt = res.value;
    }
    else if (res.kind === 'corners_candidate') {
      // Línea preferida: 9.5 córners totales
      const pref = 9.5;
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestCorners ? Math.abs(bestCorners.line - pref) : Infinity;
      if (newDiff < curDiff) bestCorners = res.value;
    }
    else if (res.kind === 'cards_candidate') {
      // Línea preferida: 4.5 tarjetas totales
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

  const wrapped = {};
  for (const [k, v] of Object.entries(markets)) if (v) wrapped[k] = { betano: v };

  return {
    home: { name: homeName },
    away: { name: awayName },
    start: Number.isFinite(ev.startTime) ? ev.startTime : null,
    league: lg.key,
    leagueName: ev.leagueDescription || ev.leagueName || null,
    sport,
    markets: wrapped
  };
}

/* ── parseBetanoJson: auto-detecta formato A o B y devuelve array de events ─── */
function parseBetanoJson(payload) {
  if (!payload || typeof payload !== 'object') return [];

  // Candidatos para formato A (flat dict con events/markets/selections)
  const flatCandidates = [
    payload,
    payload.data,
    payload.data?.topEventsV2,
    payload.data?.topEventsV3,
    payload.data?.overview,
    payload.state,
    payload.sportsbook,
    payload.initialState?.sportsbook,
    payload.initialState,
    payload.result,
    payload.body
  ];
  let flatDict = null;
  for (const c of flatCandidates) {
    if (c && typeof c === 'object' && c.events && c.markets && c.selections) { flatDict = c; break; }
  }

  if (flatDict) {
    const out = [];
    for (const eid of Object.keys(flatDict.events)) {
      const ev = buildEventFlat(eid, flatDict);
      if (ev) out.push(ev);
    }
    return out;
  }

  // Candidatos para formato B (nested)
  const out = [];
  const nestedSports = payload.data?.topEvents || payload.topEvents;
  if (Array.isArray(nestedSports)) {
    for (const sportGroup of nestedSports) {
      const events = Array.isArray(sportGroup.events) ? sportGroup.events : [];
      for (const ev of events) {
        // Propagar sportId del group al event si no lo trae
        if (!ev.sportId && sportGroup.id) ev.sportId = sportGroup.id;
        const built = buildEventNested(ev);
        if (built) out.push(built);
      }
    }
  }
  return out;
}

module.exports = { parseBetanoJson, normalizeSportId, buildEventFlat, buildEventNested };
