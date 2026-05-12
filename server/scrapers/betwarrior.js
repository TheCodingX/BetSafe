/* Scraper: BetWarrior AR (LOTBA — backend Kambi Group)
 * ============================================================================
 * BetWarrior corre sobre Kambi Group (offering-api.kambicdn.com) con el
 * operator code "tecacargrl". Sus endpoints JSON son PÚBLICOS y sin auth.
 *
 * Estrategia:
 *   1) /group.json                                                → descubre ligas dinámicamente
 *   2) /listView/all.json                                         → catálogo amplio (main market)
 *   3) /listView/football/{country}/{league}/all/all/matches.json → ligas top con más markets
 *   4) Merge: las ligas tienen prioridad sobre /all.json para markets adicionales
 *
 * Parser: lib/kambiJson.js
 * Cache server-side: 60s frescos, hasta 5min stale-fallback.
 * ============================================================================
 */
'use strict';

const { httpJsonNative, log } = require('../lib');
const { parseKambiListView } = require('../lib/kambiJson');

const OP = 'tecacargrl';
const BASE = `https://us.offering-api.kambicdn.com/offering/v2018/${OP}`;
const COMMON_QS = 'channel_id=7&client_id=200&lang=es_AR&market=AR&useCombined=true&useCombinedLive=true';

const URL_ALL = `${BASE}/listView/all.json?${COMMON_QS}`;
const URL_GROUPS = `${BASE}/group.json?lang=es_AR&market=AR`;

const HEADERS = {
  'Accept': 'application/json',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://apuestas.betwarrior.bet.ar',
  'Referer': 'https://apuestas.betwarrior.bet.ar/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

const BOOK = 'betwarrior';

// Whitelist de ligas top que nos interesan (con prioridad para Argentina + Sudamérica).
// Si BetWarrior agrega/quita ligas el código sigue funcionando — sólo hay que
// agregar/quitar entradas aquí.
const PRIORITY_LEAGUES = new Set([
  'liga_profesional_argentina', 'copa_argentina', 'primera_b_metropolitana', 'primera_b_nacional',
  'la_liga', 'premier_league', 'serie_a', 'bundesliga', 'ligue_1', 'brasileirao_serie_a',
  'champions_league', 'europa_league', 'conference_league',
  'copa_libertadores', 'copa_sudamericana',
  'liga_profesional_bolivia', 'primera_chile', 'liga_betplay_dimayor',
  'liga_pro', 'mls', 'liga_mx', 'primera_paraguay', 'eredivisie',
  'liga_1', 'super_lig', 'liga_futve'
]);

let cachedEvents = [];
let cachedAt = 0;
let cachedLeagueUrls = null;
let cachedLeagueUrlsAt = 0;

/* Descubre ligas top dinámicamente desde /group.json. Cachea 30min. */
async function discoverLeagueUrls() {
  if (cachedLeagueUrls && Date.now() - cachedLeagueUrlsAt < 30 * 60_000) return cachedLeagueUrls;
  const urls = [];
  try {
    const groups = await httpJsonNative(URL_GROUPS, { headers: HEADERS, timeout: 10000 });
    const football = groups?.group?.groups?.find(g => g.termKey === 'football');
    if (football) {
      for (const country of football.groups || []) {
        const subLeagues = country.groups || [];
        if (subLeagues.length === 0) {
          // Top-level "country" sin sub-leagues (ej: champions_league)
          if (PRIORITY_LEAGUES.has(country.termKey)) {
            urls.push(`${BASE}/listView/football/${country.termKey}/all/all/matches.json?${COMMON_QS}`);
          }
        } else {
          for (const league of subLeagues) {
            if (PRIORITY_LEAGUES.has(league.termKey)) {
              urls.push(`${BASE}/listView/football/${country.termKey}/${league.termKey}/all/all/matches.json?${COMMON_QS}`);
            }
          }
        }
      }
    }
  } catch (e) {
    log(`[betwarrior-kambi] discovery err: ${e.message?.slice(0, 80)}`);
  }
  cachedLeagueUrls = urls;
  cachedLeagueUrlsAt = Date.now();
  return urls;
}

async function fetchAll(urls) {
  const out = [];
  await Promise.all(urls.map(async url => {
    try {
      const j = await httpJsonNative(url, { headers: HEADERS, timeout: 12000 });
      if (j) out.push({ url, json: j });
    } catch (_) {}
  }));
  return out;
}

/* Merge: prefiere markets de league-specific sobre los de /all.json. */
function mergeEvents(primary, secondary) {
  const key = (ev) => `${ev.home.name}|${ev.away.name}|${ev.start}`.toLowerCase();
  const map = new Map();
  for (const ev of primary) map.set(key(ev), ev);
  for (const ev of secondary) {
    const k = key(ev);
    const existing = map.get(k);
    if (!existing) { map.set(k, ev); continue; }
    const merged = { ...existing, markets: { ...existing.markets } };
    for (const [mk, v] of Object.entries(ev.markets)) merged.markets[mk] = v;   // league wins
    map.set(k, merged);
  }
  return [...map.values()];
}

async function scrape() {
  const t0 = Date.now();
  if (cachedEvents.length && Date.now() - cachedAt < 60_000) return cachedEvents;

  const leagueUrls = await discoverLeagueUrls();

  // 1) /listView/all.json (catálogo amplio, main market)
  const [allPayload, ...leaguePayloads] = await Promise.all([
    httpJsonNative(URL_ALL, { headers: HEADERS, timeout: 12000 }).catch(() => null),
    ...leagueUrls.map(u => httpJsonNative(u, { headers: HEADERS, timeout: 12000 }).catch(() => null))
  ]);

  const allEvents = allPayload ? parseKambiListView(allPayload, BOOK) : [];
  const leagueEvents = leaguePayloads.filter(Boolean).flatMap(p => parseKambiListView(p, BOOK));

  const merged = mergeEvents(allEvents, leagueEvents);

  if (merged.length) {
    cachedEvents = merged;
    cachedAt = Date.now();
    log(`[betwarrior-kambi] ${merged.length} eventos (${allEvents.length} all + ${leagueEvents.length} league across ${leagueUrls.length} ligas) · ${Date.now() - t0}ms`);
    return merged;
  }

  if (cachedEvents.length && Date.now() - cachedAt < 5 * 60_000) {
    log(`[betwarrior-kambi] no data · serving cache (${cachedEvents.length})`);
    return cachedEvents;
  }

  log(`[betwarrior-kambi] no data · 0 events`);
  return [];
}

module.exports = scrape;
