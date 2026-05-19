/* BetSafe — Factor: Lesiones / bajas confirmadas
 * ============================================================================
 * Estrategia híbrida — múltiples fuentes con fallback:
 *
 *   1) API-Football (api-football-v1.p.rapidapi.com) — si hay key.
 *   2) ESPN public scraping — `site.api.espn.com/.../injuries`
 *   3) Football-data.org lineups (no es lesión pero indica ausencia)
 *
 * Para cada equipo devolvemos:
 *   { team, injuries: [{ name, position, status, expectedReturn }] }
 *
 * Status: 'out' | 'doubt' | 'fit' | 'returning'
 *
 * Cache 15 min por equipo (las listas no cambian tan rápido).
 * ============================================================================
 */
'use strict';

const { httpJson, httpGet, log } = require('../lib');
const cheerio = require('cheerio');
const { LRUCache } = require('lru-cache');

// Soportamos dos formas de autenticación contra api-sports:
//   1) APISPORTS_KEY     → conexión directa a v3.football.api-sports.io
//   2) RAPIDAPI_KEY      → conexión via marketplace RapidAPI
// La directa es preferida (menos intermediarios, mismo free tier).
const APISPORTS_KEY = process.env.APISPORTS_KEY || '';
const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const cache = new LRUCache({ max: 200, ttl: 15 * 60 * 1000 });

/** Obtiene lesiones para un partido. Recibe nombres canónicos de equipos. */
async function getInjuries({ homeName, awayName, league, leagueKey }) {
  const key = `${homeName}|${awayName}|${leagueKey || league || ''}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let home = await getInjuriesForTeam(homeName, leagueKey).catch(() => null);
  let away = await getInjuriesForTeam(awayName, leagueKey).catch(() => null);

  const result = {
    home: home || { team: homeName, source: 'unavailable', injuries: [] },
    away: away || { team: awayName, source: 'unavailable', injuries: [] },
    severityScore: scoreSeverity(home, away)
  };
  cache.set(key, result);
  return result;
}

async function getInjuriesForTeam(teamName, leagueKey) {
  // 1) Intento API-Football si hay alguna key (directa o via RapidAPI)
  if (APISPORTS_KEY || RAPIDAPI_KEY) {
    try {
      const r = await apiFootballInjuries(teamName);
      if (r) return r;
    } catch (e) { /* sigue */ }
  }
  // 2) ESPN scrape como fallback (USA + Europa)
  try {
    const r = await espnInjuries(teamName, leagueKey);
    if (r) return r;
  } catch (e) { /* sigue */ }
  return null;
}

/** Devuelve base URL + headers según qué key tenemos disponible.
 *  - APISPORTS_KEY → directa a v3.football.api-sports.io (recomendado)
 *  - RAPIDAPI_KEY  → via marketplace RapidAPI */
function apiFootballConfig() {
  if (APISPORTS_KEY) {
    return {
      base: 'https://v3.football.api-sports.io',
      headers: { 'x-apisports-key': APISPORTS_KEY }
    };
  }
  return {
    base: 'https://api-football-v1.p.rapidapi.com/v3',
    headers: {
      'X-RapidAPI-Key': RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
    }
  };
}

async function apiFootballInjuries(teamName) {
  // Endpoint: /injuries?team={id}&season={year}
  // Necesita buscar el team ID primero.
  const cfg = apiFootballConfig();
  try {
    const search = await httpJson(`${cfg.base}/teams?search=${encodeURIComponent(teamName)}`, {
      headers: cfg.headers
    });
    const teamId = search.response?.[0]?.team?.id;
    if (!teamId) return null;
    // Season en api-football: año de inicio de la temporada europea.
    // En agosto-diciembre = año actual. En enero-julio = año anterior
    // (la temporada europea 24/25 empieza en agosto 2024 y termina mayo 2025).
    const now = new Date();
    const season = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const data = await httpJson(`${cfg.base}/injuries?team=${teamId}&season=${season}`, {
      headers: cfg.headers
    });
    const list = (data.response || [])
      .filter(i => i.fixture?.date && new Date(i.fixture.date) >= new Date(Date.now() - 30*24*3600*1000))
      .map(i => ({
        name: i.player?.name,
        position: i.player?.position || null,
        status: normalizeStatus(i.player?.type, i.player?.reason),
        reason: i.player?.reason || null,
        expectedReturn: null
      }));
    return { team: teamName, source: 'api-football', injuries: list };
  } catch (e) { return null; }
}

// ESPN espera sport+league en estructura: sports/<sport>/<league>/...
const ESPN_LEAGUE_PATHS = {
  epl: 'soccer/eng.1', laliga: 'soccer/esp.1', seriea: 'soccer/ita.1',
  bundesliga: 'soccer/ger.1', ligue1: 'soccer/fra.1',
  ucl: 'soccer/uefa.champions', uel: 'soccer/uefa.europa',
  lpf: 'soccer/arg.1', mls: 'soccer/usa.1',
  libertadores: 'soccer/conmebol.libertadores',
  sudamericana: 'soccer/conmebol.sudamericana',
  nba: 'basketball/nba', wnba: 'basketball/wnba', euroleague: 'basketball/euroleague',
  nfl: 'football/nfl', mlb: 'baseball/mlb', nhl: 'hockey/nhl'
};

async function espnInjuries(teamName, leagueKey) {
  const leaguePath = ESPN_LEAGUE_PATHS[leagueKey];
  if (!leaguePath) return null;   // no soportamos sin sport-league explícito

  // Buscar el team ID via /teams (paginado, devuelve todos)
  let teamId = null;
  try {
    const teamsData = await httpJson(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams`, { timeout: 8000 });
    const allTeams = teamsData.sports?.[0]?.leagues?.[0]?.teams || [];
    const norm = s => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
    const target = norm(teamName);
    // Match por nombre completo, luego displayName, luego shortDisplayName, luego abbreviation
    const match = allTeams.find(t => {
      const tt = t.team || t;
      return [tt.displayName, tt.name, tt.shortDisplayName, tt.location, tt.abbreviation]
        .filter(Boolean).some(n => {
          const nn = norm(n);
          return nn === target || nn.includes(target) || target.includes(nn);
        });
    });
    teamId = (match?.team || match)?.id;
  } catch (e) {
    // si /teams falla, no podemos seguir
    return null;
  }
  if (!teamId) return null;

  // Endpoint correcto de injuries por team ID
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams/${teamId}/injuries`;
    const data = await httpJson(url, { timeout: 8000 });
    const items = data.items || data.injuries || [];
    const list = items.map(i => ({
      name: i.athlete?.displayName || i.athlete?.fullName,
      position: i.athlete?.position?.abbreviation || null,
      status: normalizeStatus(i.status, i.shortComment),
      reason: i.shortComment || i.longComment || null,
      expectedReturn: i.returnDate || null
    })).filter(i => i.name);
    if (list.length) return { team: teamName, source: 'espn', injuries: list };
  } catch (e) { /* ignore */ }
  return null;
}

function normalizeStatus(type, reason) {
  const s = String(type || reason || '').toLowerCase();
  // Anclar palabras con boundaries para evitar matches como "scout" → "out"
  if (/\bout\b|\bmissing\b|\bbaja\b|\bausente\b|sancion|sanction/.test(s)) return 'out';
  if (/doubt|questionable|gtd|duda|incierto|probable/.test(s)) return 'doubt';
  if (/\breturn\b|\bback\b|recovered|\bfit\b/.test(s)) return 'returning';
  return 'doubt';
}

/** Score 0-1 de severidad combinada (cuánto impacta a las cuotas).
 *  0 = ambos equipos fit, 1 = ambos equipos diezmados. */
function scoreSeverity(home, away) {
  function teamScore(t) {
    if (!t?.injuries) return 0;
    return t.injuries.reduce((s, i) => {
      const weight = i.status === 'out' ? 0.10 : i.status === 'doubt' ? 0.04 : 0.01;
      // Posiciones críticas pesan más
      const posMul = /GK|portero/i.test(i.position || i.reason || '') ? 2.0
                   : /DF|CB|def/i.test(i.position || '') ? 1.4
                   : /MF|mid/i.test(i.position || '') ? 1.2
                   : /FW|delant|ST|striker/i.test(i.position || '') ? 1.6
                   : 1.0;
      return s + weight * posMul;
    }, 0);
  }
  const h = teamScore(home);
  const a = teamScore(away);
  return {
    home: Math.min(1, h),
    away: Math.min(1, a),
    diffPctImpactOnHome: Number(((a - h) * 100).toFixed(2))  // negativo = home favorecido
  };
}

module.exports = { getInjuries };
