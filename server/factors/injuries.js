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
    const season = new Date().getFullYear();
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

async function espnInjuries(teamName, leagueKey) {
  // ESPN tiene endpoints públicos como:
  //   site.api.espn.com/apis/site/v2/sports/soccer/{league}/teams/{teamSlug}/injuries
  const leagueSlugs = {
    epl: 'eng.1', laliga: 'esp.1', seriea: 'ita.1', bundesliga: 'ger.1',
    ligue1: 'fra.1', ucl: 'uefa.champions', uel: 'uefa.europa',
    lpf: 'arg.1', mls: 'usa.1', nba: 'basketball/nba', nfl: 'football/nfl',
    mlb: 'baseball/mlb', nhl: 'hockey/nhl'
  };
  const slug = leagueSlugs[leagueKey] || 'eng.1';
  const teamSlug = String(teamName).toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);
  try {
    // Búsqueda genérica + injuries
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${teamSlug}/injuries`;
    const data = await httpJson(url, { timeout: 6000 });
    const list = (data.items || []).map(i => ({
      name: i.athlete?.displayName,
      position: i.athlete?.position?.abbreviation || null,
      status: normalizeStatus(i.status, i.shortComment),
      reason: i.shortComment || i.longComment || null,
      expectedReturn: i.returnDate || null
    }));
    if (list.length) return { team: teamName, source: 'espn', injuries: list };
  } catch (e) { /* try team page */ }

  // Fallback: scrape de la página pública de team en ESPN (HTML)
  try {
    const html = await httpGet(`https://www.espn.com/soccer/team/squad/_/id/${teamSlug}`, { accept: 'text/html', timeout: 6000 });
    const $ = cheerio.load(html);
    const list = [];
    $('table tbody tr').each((_, tr) => {
      const $tr = $(tr);
      const statusBadge = $tr.find('[class*="injury"], [class*="status"]').text().trim();
      if (!statusBadge) return;
      const name = $tr.find('a').first().text().trim();
      if (!name) return;
      list.push({ name, position: null, status: normalizeStatus(statusBadge), reason: statusBadge });
    });
    if (list.length) return { team: teamName, source: 'espn-html', injuries: list };
  } catch (e) { /* ignore */ }
  return null;
}

function normalizeStatus(type, reason) {
  const s = String(type || reason || '').toLowerCase();
  if (/out|missing|baja|ausente|sancion|sanction/.test(s)) return 'out';
  if (/doubt|questionable|gtd|duda|incierto|probable/.test(s)) return 'doubt';
  if (/return|back|recovered|fit/.test(s)) return 'returning';
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
