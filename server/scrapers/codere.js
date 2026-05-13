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

const { httpJsonNative, httpViaScrapingBee, log } = require('../lib');
const {
  buildEventFromGetEvents,
  buildEventFromMarquee,
  buildEventsFromLive
} = require('../lib/codereJson');
const { withRetry, CircuitBreaker } = require('../lib/retry');

const breaker = new CircuitBreaker({ name: 'codere', failThreshold: 5, cooldownMs: 60_000 });

/* Codere AR ha cambiado de dominios. Probamos múltiples bases hasta encontrar
 * una viva. Si NINGUNA responde, intentamos ScrapingBee como último recurso
 * (Codere a veces filtra por IP/geo y SBee permite IP AR). */
const CODERE_BASES = [
  'https://m.caba.codere.bet.ar/NavigationService',
  'https://m.pba.codere.bet.ar/NavigationService',
  'https://m.cba.codere.bet.ar/NavigationService',
  'https://m.codere.com.ar/NavigationService',
  'https://apuestas.codere.com.ar/NavigationService'
];
let CACHED_BASE = null;   // primer base que respondió, cached para todas las llamadas siguientes

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://m.caba.codere.bet.ar',
  'Referer': 'https://m.caba.codere.bet.ar/Deportes/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

/* Lista completa de sports que Codere expone con SportHandle.
 * Confirmado: GetSports devuelve 23 sports — cubrimos todos los que tienen
 * eventos vendibles (excluimos horse_racing porque su feed no es estándar).
 */
const SPORT_HANDLES = new Set([
  'soccer', 'basketball', 'tennis', 'baseball',
  'ice_hockey', 'american_football', 'australian_football',
  'volleyball', 'rugby', 'rugby_league', 'handball',
  'esports', 'efootball', 'ebasket',
  'mma', 'artes_marciales', 'boxeo',
  'tabletennis', 'table_tennis', 'badminton',
  'darts', 'snooker', 'golf', 'cycling', 'motorsport',
  'cricket'
]);

/* Por-sport cap de ligas a consultar. Soccer es lo más grande de Argentina
 * y se merece más cobertura; los deportes menores requieren menos llamadas.
 * Total esperado: ~140-160 leagues × ~1.5KB JSON = 250KB bajados por ciclo.
 */
const LEAGUES_PER_SPORT = {
  soccer: 35,
  basketball: 18,
  tennis: 20,
  baseball: 8,
  ice_hockey: 8,
  american_football: 8,
  esports: 6,
  efootball: 6,
  mma: 5,
  artes_marciales: 5,
  volleyball: 5,
  rugby: 5,
  rugby_league: 4,
  handball: 4,
  tabletennis: 6,
  table_tennis: 6,
  ebasket: 3,
  boxeo: 3,
  darts: 4,
  snooker: 3,
  golf: 4,
  cycling: 3,
  motorsport: 5,
  badminton: 3,
  australian_football: 2,
  cricket: 3
};

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

/* Probar cada CODERE_BASE en orden hasta encontrar uno vivo.
 * Cachea el ganador en CACHED_BASE para no repetir la búsqueda en cada call. */
async function tryBases(path) {
  // Si ya tenemos un base que funcionó, intentarlo primero
  const bases = CACHED_BASE
    ? [CACHED_BASE, ...CODERE_BASES.filter(b => b !== CACHED_BASE)]
    : CODERE_BASES.slice();
  let lastErr = null;
  for (const base of bases) {
    try {
      const data = await httpJsonNative(base + path, { headers: HEADERS, timeout: 8000 });
      if (data) {
        CACHED_BASE = base;   // recordar este como base válido
        return data;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  // FINAL FALLBACK: ScrapingBee con render_js=false (es API JSON, no necesita JS).
  // Usa IP residencial AR para bypass de geo-blocking.
  if (process.env.SCRAPINGBEE_KEY) {
    for (const base of bases) {
      try {
        const r = await httpViaScrapingBee(base + path, {
          timeout: 18000,
          premium: true,
          renderJs: false,
          country: 'ar',
          json: true,
          tag: 'codere:api'
        });
        if (r?.json) {
          CACHED_BASE = base;
          return r.json;
        }
      } catch (_) {}
    }
  }
  throw lastErr || new Error('all codere bases failed');
}

async function get(path) {
  return breaker.exec(() => withRetry(
    () => tryBases(path),
    { maxAttempts: 2, baseMs: 400 }
  ));
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

  // Agrupamos por sport y aplicamos el cap per-sport (LEAGUES_PER_SPORT).
  // Dentro de cada sport: priority leagues primero, después by alfabético
  // (estable para que el round-robin no oscille entre ciclos).
  const bySport = new Map();
  for (const l of out) {
    if (!bySport.has(l.sport)) bySport.set(l.sport, []);
    bySport.get(l.sport).push(l);
  }
  const final = [];
  for (const [sport, list] of bySport) {
    const cap = LEAGUES_PER_SPORT[sport] || 3;
    const sorted = [...list].sort((a, b) => {
      const pdiff = Number(b.priority) - Number(a.priority);
      if (pdiff !== 0) return pdiff;
      return (a.leagueName || '').localeCompare(b.leagueName || '');
    });
    final.push(...sorted.slice(0, cap));
  }

  cachedLeagueNodeIds = final;
  cachedLeagueNodeIdsAt = Date.now();
  return final;
}

/* Set completo de GameTypeIds que el parser entiende. Se pide para CADA
 * liga sin importar el sport — Codere ignora los que no apliquen a ese
 * deporte (e.g. BTTS=31 no aplica a basketball, vuelve vacío). */
const ALL_GAME_TYPES = [
  1,    // 1X2 / 2-way según resultados
  97,   // 2-way h2h (basket/tennis/baseball/hockey/volley/mma)
  3,    // DNB
  2,    // Doble Oportunidad (soccer)
  18,   // Totals soccer
  317,  // Totals hockey
  393,  // Totals volleyball
  959,  // Totals baseball
  2083, // Totals basketball
  103,  // Totals amfootball
  159,  // Handicap (basket/baseball/hockey)
  259,  // Handicap rugby
  31    // BTTS (soccer)
].join(';');

async function scrape() {
  const t0 = Date.now();
  if (cachedEvents.length && Date.now() - cachedAt < 60_000) return cachedEvents;

  const leagues = await discoverLeagueNodeIds();

  const [homeInfo, liveEvents, ...leaguePayloads] = await Promise.all([
    get(`/Home/GetHomeInfo?countHomeLiveEvents=20&gameTypesHomeLiveEvents=${ALL_GAME_TYPES}`).catch(() => null),
    get('/Home/GetHomeLiveEvents').catch(() => null),
    ...leagues.map(l => get(`/Home/GetEvents?parentid=${l.nodeId}&gameTypes=${ALL_GAME_TYPES}`).catch(() => null))
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

scrape.breaker = breaker;
scrape.clearCache = () => { cachedEvents = []; cachedAt = 0; cachedLeagueNodeIds = null; cachedLeagueNodeIdsAt = 0; };

module.exports = scrape;
