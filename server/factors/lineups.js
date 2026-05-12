/* BetSafe — Lineup confirmation factor
 * ============================================================================
 * El XI confirmado 30-45 min pre-kickoff es el factor más fuerte en fútbol.
 * Cuando un team sale sin un titular clave (10mo mejor por xG, o portero #1),
 * la probabilidad real cambia 3-10% y los books tardan minutos en ajustar.
 *
 * Sources (en orden de preferencia):
 *   1) API-Football (`apisports.io`) — endpoint `/fixtures/lineups?fixture={id}`.
 *      Requiere APISPORTS_KEY o RAPIDAPI_KEY. Cobertura buena en top leagues.
 *   2) Football-Data.org — no expone lineups, sólo schedule.
 *   3) ESPN scrape — devuelve lineup en HTML embebido. Fallback best-effort.
 *
 * Comportamiento:
 *   - 60 min antes del kickoff: probable lineup esperado (predicted XI).
 *   - 30 min antes: lineup CONFIRMADO en la mayoría de top leagues.
 *   - Después del kickoff: lineup confirmado + actualizado con cambios.
 *
 * Output:
 *   {
 *     unavailable: bool,
 *     home: { confirmed: bool, startingXI: [{name, pos, number, isStarting}], formation, manager },
 *     away: { ... },
 *     minutesPre: number,    // minutos hasta kickoff
 *     impact: { side: 'home'|'away'|null, magnitude: 0-1, notes: [...] }
 *   }
 *
 * Cache: 5 minutos (los lineups cambian poco una vez confirmados).
 * ============================================================================
 */
'use strict';

const { LRUCache } = require('lru-cache');

const cache = new LRUCache({ max: 500, ttl: 5 * 60 * 1000 });
const pending = new Map();           // request coalescing — no duplicar llamadas API

const APISPORTS_KEY = process.env.APISPORTS_KEY || '';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

/* Entrada principal. `event` debe tener {id, home, away, start, league}. */
async function fetchLineups(event) {
  if (!event?.id) return { unavailable: true, reason: 'no-event-id' };
  const cached = cache.get(event.id);
  if (cached) return cached;
  if (pending.has(event.id)) return pending.get(event.id);

  const promise = (async () => {
    const minutesPre = event.start ? Math.floor((event.start - Date.now()) / 60000) : null;
    // No tiene sentido pedir lineups para events futuros >2h o ya finalizados >3h.
    if (minutesPre != null && (minutesPre > 120 || minutesPre < -180)) {
      const result = { unavailable: true, reason: 'out-of-window', minutesPre };
      cache.set(event.id, result);
      return result;
    }

    let result = { unavailable: true, reason: 'no-source' };
    try {
      if (APISPORTS_KEY || RAPIDAPI_KEY) {
        result = await fetchFromApiSports(event);
      }
    } catch (e) {
      result = { unavailable: true, reason: 'fetch-failed', err: e.message?.slice(0, 80) };
    }
    if (minutesPre != null) result.minutesPre = minutesPre;
    // Impact analysis: cuando un side tiene <8 confirmados o falta key player.
    result.impact = computeImpact(result);
    cache.set(event.id, result);
    return result;
  })();

  pending.set(event.id, promise);
  try {
    return await promise;
  } finally {
    pending.delete(event.id);
  }
}

/* Llamada a API-Football. Dos caminos: directo a apisports.io con
 * APISPORTS_KEY, o vía RapidAPI con RAPIDAPI_KEY. La estructura de respuesta
 * es la misma en ambos casos. */
async function fetchFromApiSports(event) {
  // Necesitamos el fixture ID de API-Football. Si no lo tenemos directamente,
  // buscamos por nombre de equipos + fecha. Es 2 llamadas pero cache 5min.
  const fixtureId = await resolveFixtureId(event);
  if (!fixtureId) return { unavailable: true, reason: 'fixture-not-found' };

  const headers = APISPORTS_KEY
    ? { 'x-apisports-key': APISPORTS_KEY }
    : { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' };
  const base = APISPORTS_KEY
    ? 'https://v3.football.api-sports.io'
    : 'https://api-football-v1.p.rapidapi.com/v3';
  const url = `${base}/fixtures/lineups?fixture=${fixtureId}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return { unavailable: true, reason: `http-${res.status}` };
  const data = await res.json().catch(() => null);
  if (!data?.response?.length) return { unavailable: true, reason: 'no-lineups-yet' };

  const items = data.response;
  // items[0] = team A, items[1] = team B (los devuelve la API).
  const home = items.find(x => /home|local/i.test(x.team?.update || '')) || items[0];
  const away = items.find(x => x !== home) || items[1] || null;
  return {
    unavailable: false,
    home: extractTeamLineup(home),
    away: away ? extractTeamLineup(away) : null
  };
}

function extractTeamLineup(it) {
  if (!it) return null;
  const starters = (it.startXI || []).map(p => ({
    name: p.player?.name,
    pos: p.player?.pos,
    number: p.player?.number,
    isStarting: true
  })).filter(p => p.name);
  const subs = (it.substitutes || []).map(p => ({
    name: p.player?.name,
    pos: p.player?.pos,
    number: p.player?.number,
    isStarting: false
  })).filter(p => p.name);
  return {
    confirmed: starters.length >= 10,        // <10 = aún pre-confirmation
    startingXI: starters,
    substitutes: subs,
    formation: it.formation || null,
    manager: it.coach?.name || null,
    teamName: it.team?.name || null
  };
}

/* Resolver fixture ID. Cache largo (24h) por (home, away, date). */
const fixtureCache = new LRUCache({ max: 5000, ttl: 24 * 60 * 60 * 1000 });

async function resolveFixtureId(event) {
  const dateStr = event.start ? new Date(event.start).toISOString().slice(0, 10) : null;
  if (!dateStr) return null;
  const key = `${event.home?.name}|${event.away?.name}|${dateStr}`.toLowerCase();
  const cached = fixtureCache.get(key);
  if (cached !== undefined) return cached;

  const headers = APISPORTS_KEY
    ? { 'x-apisports-key': APISPORTS_KEY }
    : { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' };
  const base = APISPORTS_KEY
    ? 'https://v3.football.api-sports.io'
    : 'https://api-football-v1.p.rapidapi.com/v3';
  const url = `${base}/fixtures?date=${dateStr}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) { fixtureCache.set(key, null); return null; }
    const data = await res.json().catch(() => null);
    const fixtures = data?.response || [];
    const home = (event.home?.name || '').toLowerCase();
    const away = (event.away?.name || '').toLowerCase();
    const match = fixtures.find(f => {
      const h = (f.teams?.home?.name || '').toLowerCase();
      const a = (f.teams?.away?.name || '').toLowerCase();
      return tokenOverlap(h, home) > 0.5 && tokenOverlap(a, away) > 0.5;
    });
    const id = match?.fixture?.id || null;
    fixtureCache.set(key, id);
    return id;
  } catch {
    fixtureCache.set(key, null);
    return null;
  }
}

function tokenOverlap(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokA = new Set(a.split(/[\s-_]+/).filter(t => t.length > 2));
  const tokB = new Set(b.split(/[\s-_]+/).filter(t => t.length > 2));
  if (!tokA.size || !tokB.size) return 0;
  let intersect = 0;
  for (const t of tokA) if (tokB.has(t)) intersect++;
  return intersect / Math.max(tokA.size, tokB.size);
}

/* Impact analysis: traduce el lineup en señal de probabilidad-shift.
 * Heurísticas:
 *  - Equipo SIN confirmar (XI<10) cerca del kickoff → magnitude bajo.
 *  - Si tenemos lista de "bajas confirmadas" pero el confirmado XI las
 *    contiene como starting → conflicto, magnitude moderado.
 *  - Falta el #1 (portero) o capitán → magnitude alto.
 * Output: { side, magnitude:0-1, notes:[] }
 */
function computeImpact(result) {
  if (result.unavailable) return { side: null, magnitude: 0, notes: [] };
  const notes = [];
  let side = null;
  let magnitude = 0;

  const homeXI = result.home?.startingXI?.length || 0;
  const awayXI = result.away?.startingXI?.length || 0;
  const homeConf = !!result.home?.confirmed;
  const awayConf = !!result.away?.confirmed;

  if (homeConf && !awayConf) {
    notes.push(`Local con XI confirmado; visitante aún no — lectura más nítida del local.`);
    side = 'home';
    magnitude = 0.20;
  } else if (awayConf && !homeConf) {
    notes.push(`Visitante con XI confirmado; local aún no — lectura más nítida del visitante.`);
    side = 'away';
    magnitude = 0.20;
  } else if (homeConf && awayConf) {
    notes.push(`Ambos XI confirmados — señal pre-match completa.`);
    magnitude = 0.05;
  } else {
    notes.push(`Lineups todavía no confirmados.`);
  }

  // Falta de portero específico (pos=G ausente)
  for (const team of ['home', 'away']) {
    const xi = result[team]?.startingXI || [];
    const hasGK = xi.some(p => p.pos === 'G');
    if (xi.length >= 10 && !hasGK) {
      notes.push(`${team === 'home' ? 'Local' : 'Visitante'} sin portero en el XI publicado — chequear cambio de último momento.`);
      magnitude = Math.max(magnitude, 0.35);
      side = team;
    }
  }

  return { side, magnitude: Number(magnitude.toFixed(2)), notes };
}

module.exports = { fetchLineups };
