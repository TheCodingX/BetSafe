/* BetSafe — Factor: Histórico H2H + forma reciente
 * ============================================================================
 * Fuentes:
 *   - football-data.org (free 10 req/min) → H2H, standings, scorers, matches
 *   - api-football (RapidAPI, opcional) → datos más ricos
 *
 * Devolvemos:
 *   - h2h: últimos 10 enfrentamientos (W/D/L del local)
 *   - form: últimos 5 partidos de cada equipo
 *   - homeAdvantage: % de victorias jugando de local del local
 *   - awayPerformance: % puntos consiguiendo de visitante del visitante
 *   - avgGoals: GF/GC promedios
 *   - cleansheets: % partidos sin gol concedido
 *   - btts: % partidos con BTTS
 * ============================================================================
 */
'use strict';

const { httpJson, log } = require('../lib');
const { LRUCache } = require('lru-cache');

const FD_KEY = process.env.BS_FOOTBALL_DATA_API_KEY || '';
const cache = new LRUCache({ max: 500, ttl: 60 * 60 * 1000 });   // 1h cache

const FD_COMPS = {
  epl: 'PL', laliga: 'PD', seriea: 'SA', bundesliga: 'BL1',
  ligue1: 'FL1', ucl: 'CL', uel: 'EC',
  lpf: 'ASL', mls: 'MLS',
  libertadores: 'CLI', sudamericana: 'CLI',
  worldcup: 'WC', wc26: 'WC'
};

async function getHistorical({ homeName, awayName, leagueKey }) {
  const key = `${homeName}|${awayName}|${leagueKey}`.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  if (!FD_KEY) {
    const r = { unavailable: true, reason: 'no-fd-key' };
    cache.set(key, r);
    return r;
  }

  try {
    const compCode = FD_COMPS[leagueKey] || 'PL';
    // Buscamos los IDs de equipos en la competencia
    const teams = await httpJson(`https://api.football-data.org/v4/competitions/${compCode}/teams`, {
      headers: { 'X-Auth-Token': FD_KEY }, timeout: 8000
    });
    const home = teams.teams?.find(t => fuzzyMatch(t.name, homeName));
    const away = teams.teams?.find(t => fuzzyMatch(t.name, awayName));
    if (!home || !away) {
      const r = { unavailable: true, reason: 'team-not-found' };
      cache.set(key, r);
      return r;
    }

    // H2H histórico
    const h2h = await httpJson(`https://api.football-data.org/v4/teams/${home.id}/matches?status=FINISHED&limit=200`, {
      headers: { 'X-Auth-Token': FD_KEY }, timeout: 10000
    }).catch(() => ({ matches: [] }));
    const h2hMatches = (h2h.matches || []).filter(m =>
      (m.homeTeam?.id === home.id && m.awayTeam?.id === away.id) ||
      (m.homeTeam?.id === away.id && m.awayTeam?.id === home.id)
    ).slice(0, 10);

    const formHome = (h2h.matches || []).slice(0, 5);
    const awayMatches = await httpJson(`https://api.football-data.org/v4/teams/${away.id}/matches?status=FINISHED&limit=10`, {
      headers: { 'X-Auth-Token': FD_KEY }, timeout: 10000
    }).catch(() => ({ matches: [] }));
    const formAway = (awayMatches.matches || []).slice(0, 5);

    const result = {
      h2h: summarizeH2h(h2hMatches, home.id),
      form: {
        home: summarizeForm(formHome, home.id),
        away: summarizeForm(formAway, away.id)
      },
      teams: { home: home.name, away: away.name }
    };
    cache.set(key, result);
    return result;
  } catch (e) {
    log('[historical] err', e?.message);
    const r = { unavailable: true, reason: 'api-error', err: e?.message };
    cache.set(key, r);
    return r;
  }
}

function summarizeH2h(matches, homeId) {
  if (!matches.length) return { matches: 0 };
  let homeW = 0, homeD = 0, homeL = 0, totalGoals = 0, bttsCount = 0;
  matches.forEach(m => {
    const score = m.score?.fullTime;
    if (!score) return;
    const homeIsLocal = m.homeTeam?.id === homeId;
    const homeGoals = homeIsLocal ? score.home : score.away;
    const awayGoals = homeIsLocal ? score.away : score.home;
    totalGoals += (score.home || 0) + (score.away || 0);
    if ((score.home || 0) > 0 && (score.away || 0) > 0) bttsCount++;
    if (homeGoals > awayGoals) homeW++;
    else if (homeGoals === awayGoals) homeD++;
    else homeL++;
  });
  const n = matches.length;
  return {
    matches: n,
    homeWinRate:   Number((homeW / n).toFixed(3)),
    drawRate:      Number((homeD / n).toFixed(3)),
    awayWinRate:   Number((homeL / n).toFixed(3)),
    avgGoals:      Number((totalGoals / n).toFixed(2)),
    bttsRate:      Number((bttsCount / n).toFixed(3)),
    recent: matches.slice(0, 5).map(m => ({
      date: m.utcDate,
      score: `${m.score?.fullTime?.home ?? '-'}-${m.score?.fullTime?.away ?? '-'}`,
      competition: m.competition?.name
    }))
  };
}

function summarizeForm(matches, teamId) {
  if (!matches.length) return { matches: 0 };
  let w = 0, d = 0, l = 0, gf = 0, ga = 0, cleanSheets = 0, scoredCount = 0;
  matches.forEach(m => {
    const score = m.score?.fullTime;
    if (!score) return;
    const isLocal = m.homeTeam?.id === teamId;
    const myGoals = isLocal ? (score.home || 0) : (score.away || 0);
    const theirGoals = isLocal ? (score.away || 0) : (score.home || 0);
    gf += myGoals; ga += theirGoals;
    if (myGoals > theirGoals) w++;
    else if (myGoals === theirGoals) d++;
    else l++;
    if (theirGoals === 0) cleanSheets++;
    if (myGoals > 0) scoredCount++;
  });
  const n = matches.length;
  return {
    matches: n,
    wdl: `${w}-${d}-${l}`,
    pointsPerGame: Number(((w * 3 + d) / n).toFixed(2)),
    goalsFor: Number((gf / n).toFixed(2)),
    goalsAgainst: Number((ga / n).toFixed(2)),
    cleanSheetRate: Number((cleanSheets / n).toFixed(3)),
    scoreRate: Number((scoredCount / n).toFixed(3)),
    recent: matches.slice(0, 5).map(m => ({
      date: m.utcDate,
      score: `${m.score?.fullTime?.home ?? '-'}-${m.score?.fullTime?.away ?? '-'}`,
      competition: m.competition?.name
    }))
  };
}

function fuzzyMatch(a, b) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const A = norm(a), B = norm(b);
  if (A.includes(B) || B.includes(A)) return true;
  // Levenshtein simplificado (char overlap)
  let common = 0;
  for (const c of new Set(A)) if (B.includes(c)) common++;
  return common / Math.max(A.length, B.length, 1) > 0.7;
}

module.exports = { getHistorical };
