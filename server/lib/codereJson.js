/* BetSafe — Parser JSON de Codere AR (m.caba.codere.bet.ar)
 * ============================================================================
 * Codere expone su API en /NavigationService/. La estructura de respuesta es
 * un .NET serializado (PascalCase, fechas /Date(epoch)/).
 *
 * Endpoints relevantes:
 *   /Home/GetHomeInfo?countHomeLiveEvents=20&gameTypesHomeLiveEvents=1;18 → marquee + live + highlights
 *   /Home/GetHomeLiveEvents                                                → live events agrupados por sport
 *   /Home/GetSports                                                        → catálogo de sports + NodeIds
 *   /Home/GetCountries?parentid={sportNodeId}                              → países + ligas para un sport
 *   /Home/GetEvents?parentid={leagueNodeId}&gameTypes=1;18;2;31           → events con markets de una liga
 *   /Category/GetCategoriesByLeague?parentid={leagueNodeId}                → categorías (markets) disponibles
 *
 * GameTypeId → market interno:
 *    1  = 1X2 (h2h) — Results[].Name = "Argentinos Juniors"/"X"/"Huracán", SortOrder 0/1/2
 *   18  = Más/Menos Total Goles (totals) — GameSpecialOddsValue = línea ("2.5"), SortOrder 0=Over, 1=Under
 *    2  = Doble Oportunidad (DC) — Results[].Name = "1X"/"X2"/"12"
 *   31  = Marcan Ambos Equipos (BTTS) — Results[].Name = "Sí"/"No"
 *    3  = Apuesta Sin Empate (DNB) — Results[].Name = home/away (sin draw)
 * ============================================================================
 */
'use strict';

/* ── Normalización de deporte (SportHandle → BetSafe) ──────────────────────── */
const SPORT_MAP = {
  soccer: 'soccer',
  futsal: 'soccer',
  basketball: 'basketball',
  baloncesto: 'basketball',
  tennis: 'tennis',
  baseball: 'baseball',
  beisbol: 'baseball',
  ice_hockey: 'hockey',
  hockey_hielo: 'hockey',
  american_football: 'amfootball',
  futbol_americano: 'amfootball',
  rugby: 'rugby',
  rugby_union: 'rugby',
  volleyball: 'volleyball',
  voleibol: 'volleyball',
  handball: 'handball',
  balonmano: 'handball',
  esports: 'esports',
  e_futbol: 'esports',
  'e-fútbol': 'esports',
  tabletennis: 'tabletennis',
  tenis_de_mesa: 'tabletennis',
  badminton: 'badminton',
  mma: 'mma',
  artes_marciales: 'mma',
  ufc: 'mma',
  boxing: 'mma',
  boxeo: 'mma',
  cricket: 'cricket',
  darts: 'darts',
  dardos: 'darts',
  snooker: 'snooker',
  golf: 'golf'
};

function normalizeSport(handle) {
  if (!handle) return 'other';
  const key = String(handle).toLowerCase().replace(/\s+/g, '_');
  return SPORT_MAP[key] || 'other';
}

const LEAGUE_MAP = [
  { re: /liga profesional|primera divisi[oó]n.*argentina|copa argentina|primera nacional/i, key: 'lpf' },
  { re: /premier league/i,                key: 'epl' },
  { re: /primera divisi[oó]n.*espa|\bla ?liga\b/i, key: 'laliga' },
  { re: /serie a/i,                       key: 'seriea' },
  { re: /bundesliga/i,                    key: 'bundesliga' },
  { re: /ligue 1/i,                       key: 'ligue1' },
  { re: /champions league/i,              key: 'ucl' },
  { re: /europa league/i,                 key: 'uel' },
  { re: /copa libertadores|libertadores/i, key: 'libertadores' },
  { re: /sudamericana/i,                  key: 'sudamericana' },
  { re: /mls/i,                           key: 'mls' },
  { re: /\bnba\b/i,                       key: 'nba' },
  { re: /\bnfl\b/i,                       key: 'nfl' },
  { re: /\bmlb\b/i,                       key: 'mlb' },
  { re: /\bnhl\b/i,                       key: 'nhl' },
  { re: /\batp\b/i,                       key: 'atp' },
  { re: /\bwta\b/i,                       key: 'wta' },
  { re: /\bufc\b|mma/i,                   key: 'ufc' }
];

function resolveLeague(name) {
  if (!name) return { key: null, name: null };
  for (const { re, key } of LEAGUE_MAP) if (re.test(name)) return { key, name };
  return { key: null, name };
}

/* ── Parse /Date(epoch)/ a ms epoch ─────────────────────────────────────────── */
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/\/Date\((-?\d+)\)\//);
  if (m) return Number(m[1]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/* ── Validar/parsear odds decimales ─────────────────────────────────────────── */
function parseOdd(n) {
  const v = typeof n === 'number' ? n : parseFloat(n);
  return Number.isFinite(v) && v > 1.01 && v < 1000 ? v : null;
}

function parseLine(s) {
  if (s == null || s === '') return null;
  // Codere envía la línea como "<Spov>2.5" en algunos endpoints
  const cleaned = typeof s === 'string' ? s.replace(/^<[^>]+>/, '').replace(',', '.') : s;
  const v = typeof cleaned === 'number' ? cleaned : parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

function preferredTotalsLine(sport) {
  if (sport === 'basketball') return 215.5;
  if (sport === 'baseball')   return 8.5;
  if (sport === 'amfootball') return 45.5;
  return 2.5;
}

/* ── Extrae primer LocalizedValue (preferentemente lang=es) ─────────────────── */
function localizedName(loc) {
  if (!loc) return null;
  const vals = loc.LocalizedValues;
  if (!Array.isArray(vals) || !vals.length) return null;
  const es = vals.find(v => v.LanguageCode === 'es' && v.Value);
  return (es?.Value) || vals[0]?.Value || null;
}

/* ── Identifica home/away desde Participants[] ──────────────────────────────── */
function extractTeams(participants) {
  if (!Array.isArray(participants) || participants.length < 2) return null;
  let home = participants.find(p => p.IsHome === true);
  let away = participants.find(p => p.IsHome === false);
  if (!home || !away) {
    // Fallback: ParticipantOrder en AdditionalValues
    const ordered = [...participants].sort((a, b) => {
      const oa = +(a.AdditionalValues?.LocalizedValues?.find(v => v.Key === 'ParticipantOrder')?.Value ?? 0);
      const ob = +(b.AdditionalValues?.LocalizedValues?.find(v => v.Key === 'ParticipantOrder')?.Value ?? 0);
      return oa - ob;
    });
    home = ordered[0]; away = ordered[1];
  }
  const hn = localizedName(home?.LocalizedNames);
  const an = localizedName(away?.LocalizedNames);
  if (!hn || !an || hn === an) return null;
  return { home: hn, away: an };
}

/* ── Procesa un Game (mercado) → mercado interno ────────────────────────────── */
function processGame(g, teams, sport) {
  const results = Array.isArray(g.Results) ? g.Results : [];
  if (!results.length) return null;
  const gtid = results[0].GameTypeId;
  const line = parseLine(g.SpecialOddsValue ?? results[0].GameSpecialOddsValue);

  const byOrder = (i) => results.find(r => r.SortOrder === i) ?? results[i];
  const odd = (i) => parseOdd(byOrder(i)?.Odd);

  /* 1X2 — SortOrder 0=home, 1=draw, 2=away (Codere convention) */
  if (gtid === 1) {
    const h = odd(0), d = odd(1), a = odd(2);
    if (!h || !a) return null;
    return { kind: 'h2h', value: { home: h, draw: d, away: a } };
  }

  /* DNB (1-2, sin empate) */
  if (gtid === 3) {
    const h = odd(0), a = odd(1);
    if (!h || !a) return null;
    return { kind: 'h2h', value: { home: h, draw: null, away: a } };
  }

  /* Doble Oportunidad.
   * Codere envía outcomes en este orden (SortOrder):
   *   0 → 1X (home/draw)   ej. "Osasuna / X"
   *   1 → 12 (home/away)   ej. "Osasuna / Atlético"
   *   2 → X2 (draw/away)   ej. "X / Atlético"
   * Como los `Name` traen team names, parsea por SortOrder.
   */
  if (gtid === 2) {
    const p1x = odd(0);
    const p12 = odd(1);
    const px2 = odd(2);
    if (!p1x && !px2 && !p12) return null;
    return { kind: 'dc', value: { home_or_draw: p1x, home_or_away: p12, draw_or_away: px2 } };
  }

  /* Totals (Más/Menos) — SortOrder 0=Over, 1=Under */
  if (gtid === 18 && line != null) {
    const ov = odd(0), un = odd(1);
    if (!ov || !un) return null;
    return { kind: 'totals_candidate', value: { line, over: ov, under: un } };
  }

  /* BTTS — Results[].Name = "Sí"/"No" o SortOrder 0=Yes, 1=No */
  if (gtid === 31) {
    const rSi = results.find(r => /^s[íi]$/i.test(r.Name)) ?? byOrder(0);
    const rNo = results.find(r => /^no$/i.test(r.Name)) ?? byOrder(1);
    const py = parseOdd(rSi?.Odd);
    const pn = parseOdd(rNo?.Odd);
    if (!py || !pn) return null;
    return { kind: 'btts', value: { yes: py, no: pn } };
  }

  return null;
}

/* ── Build event a partir del bloque /Home/GetEvents → array de events ───────── */
function buildEventFromGetEvents(ev) {
  if (!ev) return null;
  const teams = extractTeams(ev.Participants);
  if (!teams) return null;

  const sport = normalizeSport(ev.SportHandle || ev.SportName);
  const start = parseDate(ev.StartDate || ev.StartsAt);
  if (!start) return null;

  const leagueName = ev.LeagueName || null;
  const lg = resolveLeague(leagueName);

  const markets = {};
  let bestTotal = null;
  for (const g of (ev.Games || [])) {
    const res = processGame(g, teams, sport);
    if (!res) continue;
    if (res.kind === 'h2h' && !markets.h2h) markets.h2h = res.value;
    else if (res.kind === 'dc' && !markets.dc) markets.dc = res.value;
    else if (res.kind === 'btts' && !markets.btts) markets.btts = res.value;
    else if (res.kind === 'ah' && !markets.ah) markets.ah = res.value;
    else if (res.kind === 'totals_candidate') {
      const pref = preferredTotalsLine(sport);
      const newDiff = Math.abs(res.value.line - pref);
      const curDiff = bestTotal ? Math.abs(bestTotal.line - pref) : Infinity;
      if (newDiff < curDiff) bestTotal = res.value;
    }
  }
  if (bestTotal) markets.totals = { [bestTotal.line]: bestTotal };

  if (!markets.h2h && !markets.totals && !markets.btts && !markets.dc && !markets.ah) return null;
  const wrapped = {};
  for (const [k, v] of Object.entries(markets)) if (v) wrapped[k] = { codere: v };

  return {
    home: { name: teams.home },
    away: { name: teams.away },
    start,
    league: lg.key,
    leagueName,
    sport,
    markets: wrapped
  };
}

/* ── Build event a partir del bloque marquee (/Home/GetHomeInfo) ────────────── */
function buildEventFromMarquee(ev) {
  if (!ev) return null;
  const home = ev.ParticipantHome;
  const away = ev.ParticipantAway;
  if (!home || !away || home === away) return null;
  const sport = normalizeSport(ev.SportHandle);
  const start = parseDate(ev.StartDate);
  if (!start) return null;
  const lg = resolveLeague(ev.LeagueName);

  // El marquee tiene un único Game: Game.Results[]
  const results = ev.Game?.Results || [];
  const odd = (i) => {
    const r = results.find(rr => rr.SortOrder === i) ?? results[i];
    return parseOdd(r?.Odd);
  };
  // Asumimos h2h por defecto (SortOrder 0/1/2 → home/draw/away)
  const h = odd(0), d = odd(1), a = odd(2);
  if (!h || !a) return null;

  return {
    home: { name: home },
    away: { name: away },
    start,
    league: lg.key,
    leagueName: ev.LeagueName,
    sport,
    markets: {
      h2h: { codere: { home: h, draw: d, away: a } }
    }
  };
}

/* ── Build events a partir de /Home/GetHomeLiveEvents ───────────────────────── */
function buildEventsFromLive(payload) {
  if (!payload?.LiveSport || !Array.isArray(payload.LiveSport)) return [];
  const out = [];
  for (const sp of payload.LiveSport) {
    const sport = normalizeSport(sp.SportHandle || sp.Name);
    for (const e of (sp.Events || [])) {
      const teams = extractTeams(e.Participants);
      if (!teams) continue;
      const start = parseDate(e.StartDate);
      if (!start) continue;
      const leagueName = e.LeagueName || sp.Name;
      const lg = resolveLeague(leagueName);

      const markets = {};
      let bestTotal = null;
      // El DefaultGame es el principal market (h2h)
      const games = [e.DefaultGame, ...(e.Games || [])].filter(Boolean);
      for (const g of games) {
        const res = processGame(g, teams, sport);
        if (!res) continue;
        if (res.kind === 'h2h' && !markets.h2h) markets.h2h = res.value;
        else if (res.kind === 'dc' && !markets.dc) markets.dc = res.value;
        else if (res.kind === 'btts' && !markets.btts) markets.btts = res.value;
        else if (res.kind === 'totals_candidate') {
          const pref = preferredTotalsLine(sport);
          const newDiff = Math.abs(res.value.line - pref);
          const curDiff = bestTotal ? Math.abs(bestTotal.line - pref) : Infinity;
          if (newDiff < curDiff) bestTotal = res.value;
        }
      }
      if (bestTotal) markets.totals = { [bestTotal.line]: bestTotal };
      if (!markets.h2h && !markets.totals && !markets.btts && !markets.dc) continue;

      const wrapped = {};
      for (const [k, v] of Object.entries(markets)) if (v) wrapped[k] = { codere: v };
      out.push({
        home: { name: teams.home },
        away: { name: teams.away },
        start,
        league: lg.key,
        leagueName,
        sport,
        markets: wrapped
      });
    }
  }
  return out;
}

module.exports = {
  buildEventFromGetEvents,
  buildEventFromMarquee,
  buildEventsFromLive,
  normalizeSport,
  resolveLeague
};
