/* Scraper: Codere AR (LOTBA — m.caba.codere.bet.ar)
 * ============================================================================
 * Codere AR usa una API .NET en /NavigationService/ que es PÚBLICA y sin
 * Cloudflare bloqueando native HTTPS.
 *
 * Flujo:
 *   1) GET /Home/GetSports → catálogo de deportes con NodeIds
 *   2) Para cada deporte de interés:
 *        GET /Home/GetCountries?parentid={sportNodeId} → países con leagues
 *   3) Para las top N leagues (priorizadas):
 *        GET /Home/GetEvents?parentid={leagueNodeId}&gameTypes=1;18;2;31
 *      Devuelve events con Participants + Games + Results
 *   4) Bonus: /Home/GetHomeInfo (marquee + highlights) y /Home/GetHomeLiveEvents
 *
 * Cache server-side: 60s frescos, hasta 5min stale-fallback.
 * Discovery (sports/leagues) cacheado 30min.
 * ============================================================================
 */
'use strict';

const { httpJsonNative, log } = require('../lib');
const {
  buildEventFromGetEvents,
  buildEventFromMarquee,
  buildEventsFromLive
} = require('../lib/codereJson');

const BASE = 'https://m.caba.codere.bet.ar/NavigationService';

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://m.caba.codere.bet.ar',
  'Referer': 'https://m.caba.codere.bet.ar/Deportes/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

const SPORT_HANDLES = new Set([
  'soccer', 'basketball', 'tennis', 'baseball',
  'ice_hockey', 'american_football', 'volleyball',
  'rugby', 'handball', 'esports', 'mma', 'boxing', 'tabletennis'
]);

const LEAGUE_PRIORITY = [
  /liga profesional|primera nacional|copa argentina/i,
  /primera divisi[oó]n|\bla ?liga\b/i,
  /premier league|fa cup/i,
  /serie a/i,
  /bundesliga/i,
  /ligue 1/i,
  /brasileirao|brasileir.o/i,
  /champions league/i,
  /europa league/i,
  /libertadores|sudamericana/i,
  /mls/i,
  /\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b/i,
  /\batp\b|\bwta\b|grand slam|tenis/i,
  /\bufc\b|mma/i,
  /mundial|copa mundial/i
];

function isPriorityLeague(name) {
  if (!name) return false;
  return LEAGUE_PRIORITY.some(re => re.test(name));
}

const BOOK = 'codere';
let cachedEvents = [];
let cachedAt = 0;
let cachedLeagueNodeIds = null;
let cachedLeagueNodeIdsAt = 0;

async function get(path) {
  return httpJsonNative(BASE + path, { headers: HEADERS, timeout: 12000 });
}

/* Discover league NodeIds across sports (cached 30min). */
async function discoverLeagueNodeIds() {
  if (cachedLeagueNodeIds && Date.now() - cachedLeagueNodeIdsAt < 30 * 60_000) return cachedLeagueNodeIds;

  const out = [];
  try {
    const sports = await get('/Home/GetSports');
    const wanted = (sports || []).filter(s => SPORT_HANDLES.has(s.SportHandle));

    const sportResults = await Promise.all(
      wanted.map(async sp => {
        try {
          const countries = await get(`/Home/GetCountries?parentid=${sp.NodeId}`);
          return { sport: sp.SportHandle, countries: countries || [] };
        } catch (_) { return { sport: sp.SportHandle, countries: [] }; }
      })
    );

    for (const { sport, countries } of sportResults) {
      for (const c of countries) {
        for (const l of (c.Leagues || [])) {
          out.push({ sport, country: c.Name, leagueName: l.Name, nodeId: l.NodeId, priority: isPriorityLeague(l.Name) });
        }
      }
    }
  } catch (e) {
    log(`[codere] discovery err: ${e.message?.slice(0, 80)}`);
  }

  // Estrategia: top 30 soccer + top 5 de cada otro deporte. Mantiene buena
  // cobertura en futbol (lo más jugado) y agrega variedad cross-sport.
  const soccer = out.filter(l => l.sport === 'soccer').sort((a, b) => Number(b.priority) - Number(a.priority)).slice(0, 30);
  const others = out.filter(l => l.sport !== 'soccer');
  const bySport = new Map();
  for (const l of others) {
    if (!bySport.has(l.sport)) bySport.set(l.sport, []);
    bySport.get(l.sport).push(l);
  }
  const otherTop = [];
  for (const [, list] of bySport) {
    otherTop.push(...list.sort((a, b) => Number(b.priority) - Number(a.priority)).slice(0, 5));
  }
  const final = [...soccer, ...otherTop];

  cachedLeagueNodeIds = final;
  cachedLeagueNodeIdsAt = Date.now();
  return final;
}

async function scrape() {
  const t0 = Date.now();
  if (cachedEvents.length && Date.now() - cachedAt < 60_000) return cachedEvents;

  const leagues = await discoverLeagueNodeIds();

  const [homeInfo, liveEvents, ...leaguePayloads] = await Promise.all([
    get('/Home/GetHomeInfo?countHomeLiveEvents=20&gameTypesHomeLiveEvents=1;18;2;31').catch(() => null),
    get('/Home/GetHomeLiveEvents').catch(() => null),
    ...leagues.map(l => get(`/Home/GetEvents?parentid=${l.nodeId}&gameTypes=1;18;2;31`).catch(() => null))
  ]);

  const merged = new Map();
  const addEvent = (ev) => {
    if (!ev) return;
    const key = `${ev.home.name}|${ev.away.name}|${ev.start}`.toLowerCase();
    const existing = merged.get(key);
    if (!existing) { merged.set(key, ev); return; }
    for (const [mk, v] of Object.entries(ev.markets)) {
      if (!existing.markets[mk]) existing.markets[mk] = v;
    }
  };

  if (homeInfo?.marquee) {
    for (const m of homeInfo.marquee) {
      const ev = buildEventFromMarquee(m);
      if (ev) addEvent(ev);
    }
  }
  if (Array.isArray(homeInfo?.highlightsEvents)) {
    for (const h of homeInfo.highlightsEvents) {
      const ev = buildEventFromGetEvents(h);
      if (ev) addEvent(ev);
    }
  }

  if (liveEvents) {
    for (const ev of buildEventsFromLive(liveEvents)) addEvent(ev);
  }

  for (const payload of leaguePayloads) {
    if (!Array.isArray(payload)) continue;
    for (const e of payload) {
      const ev = buildEventFromGetEvents(e);
      if (ev) addEvent(ev);
    }
  }

  const events = [...merged.values()];
  if (events.length) {
    cachedEvents = events;
    cachedAt = Date.now();
    log(`[codere] ${events.length} eventos · ${leagues.length} ligas · ${Date.now() - t0}ms`);
    return events;
  }

  if (cachedEvents.length && Date.now() - cachedAt < 5 * 60_000) {
    log(`[codere] no data · serving cache (${cachedEvents.length})`);
    return cachedEvents;
  }

  log(`[codere] no data · 0 events`);
  return [];
}

module.exports = scrape;
