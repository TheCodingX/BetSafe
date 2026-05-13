/* BetSafe — Factor: Clima (OpenWeatherMap)
 * ============================================================================
 * Obtiene pronóstico para el venue del partido. Impacta:
 *   - Over/Under goles: lluvia/viento bajan goles ~10-15%
 *   - Corners totales: viento sube corners ~5-10%
 *   - Cartas: mal clima tiende a aumentar fouls/cards
 *   - Goalkeepers: lluvia aumenta errores defensivos
 *
 * Endpoint: api.openweathermap.org/data/2.5/forecast?lat&lon&appid=$KEY
 * Free tier: 60 calls/min, 1M/mes. Cacheamos 30min por venue.
 * ============================================================================
 */
'use strict';

const { httpJson, log } = require('../lib');
const { LRUCache } = require('lru-cache');

const KEY = process.env.OPENWEATHER_API_KEY || '';
const cache = new LRUCache({ max: 500, ttl: 30 * 60 * 1000 });

/* Coordenadas conocidas de venues principales en Argentina + venues WC26.
 * Si el venue no está acá, retornamos null y el factor queda "unknown". */
const VENUES = {
  // Argentina — estadios LPF
  'la bombonera':          { lat: -34.6354, lon: -58.3645, city: 'Buenos Aires' },
  'el monumental':         { lat: -34.5454, lon: -58.4498, city: 'Buenos Aires' },
  'cilindro de avellaneda':{ lat: -34.6675, lon: -58.3686, city: 'Avellaneda' },
  'libertadores de america':{ lat: -34.6692, lon: -58.3680, city: 'Avellaneda' },
  'jose amalfitani':       { lat: -34.6353, lon: -58.5208, city: 'Buenos Aires' },
  'pedro bidegain':        { lat: -34.6705, lon: -58.4459, city: 'Buenos Aires' },
  'tomas adolfo duco':     { lat: -34.6336, lon: -58.4128, city: 'Buenos Aires' },
  'jorge luis hirschi':    { lat: -34.9116, lon: -57.9526, city: 'La Plata' },
  'juan carmelo zerillo':  { lat: -34.9090, lon: -57.9442, city: 'La Plata' },
  // WC26 sedes
  'estadio azteca':        { lat: 19.3030, lon: -99.1505, city: 'Ciudad de México' },
  'metlife stadium':       { lat: 40.8128, lon: -74.0742, city: 'East Rutherford' },
  'sofi stadium':          { lat: 33.9534, lon: -118.3387, city: 'Inglewood' },
  'at&t stadium':          { lat: 32.7473, lon: -97.0945, city: 'Arlington' },
  'arrowhead stadium':     { lat: 39.0489, lon: -94.4839, city: 'Kansas City' },
  'lumen field':           { lat: 47.5952, lon: -122.3316, city: 'Seattle' },
  'mercedes-benz stadium': { lat: 33.7553, lon: -84.4006, city: 'Atlanta' },
  'hard rock stadium':     { lat: 25.9580, lon: -80.2389, city: 'Miami' },
  'nrg stadium':           { lat: 29.6847, lon: -95.4107, city: 'Houston' },
  'gillette stadium':      { lat: 42.0909, lon: -71.2643, city: 'Foxborough' },
  'lincoln financial':     { lat: 39.9008, lon: -75.1675, city: 'Philadelphia' },
  "levi's stadium":        { lat: 37.4030, lon: -121.9692, city: 'Santa Clara' },
  'bmo field':             { lat: 43.6328, lon: -79.4187, city: 'Toronto' },
  'bc place':              { lat: 49.2768, lon: -123.1118, city: 'Vancouver' },
  'estadio akron':         { lat: 20.6814, lon: -103.4628, city: 'Guadalajara' },
  'estadio bbva':          { lat: 25.6692, lon: -100.2447, city: 'Monterrey' }
};

/** Ciudad → venue como fallback cuando no tenemos el venue exacto */
const CITIES = {
  'buenos aires': { lat: -34.6037, lon: -58.3816 },
  'la plata':     { lat: -34.9214, lon: -57.9544 },
  'rosario':      { lat: -32.9468, lon: -60.6393 },
  'cordoba':      { lat: -31.4201, lon: -64.1888 },
  'mendoza':      { lat: -32.8895, lon: -68.8458 },
  'tucuman':      { lat: -26.8083, lon: -65.2176 },
  'londres':      { lat: 51.5074, lon: -0.1278 },
  'madrid':       { lat: 40.4168, lon: -3.7038 },
  'barcelona':    { lat: 41.3851, lon: 2.1734 },
  'paris':        { lat: 48.8566, lon: 2.3522 },
  'roma':         { lat: 41.9028, lon: 12.4964 }
};

/* Equipo local \u2192 coords del estadio. Cuando el scraper no pasa venue/city expl\u00edcito
 * (caso casi universal), derivamos del nombre del local. Cubre top equipos AR + UE. */
const TEAM_HOME_COORDS = {
  // AR \u2014 LPF
  'boca':            { lat: -34.6354, lon: -58.3645, city: 'Buenos Aires' },
  'river':           { lat: -34.5454, lon: -58.4498, city: 'Buenos Aires' },
  'racing':          { lat: -34.6675, lon: -58.3686, city: 'Avellaneda' },
  'independiente':   { lat: -34.6692, lon: -58.3680, city: 'Avellaneda' },
  'san lorenzo':     { lat: -34.6705, lon: -58.4459, city: 'Buenos Aires' },
  'velez':           { lat: -34.6353, lon: -58.5208, city: 'Buenos Aires' },
  'huracan':         { lat: -34.6336, lon: -58.4128, city: 'Buenos Aires' },
  'rosario central': { lat: -32.9468, lon: -60.6393, city: 'Rosario' },
  'newells':         { lat: -32.9468, lon: -60.6393, city: 'Rosario' },
  'estudiantes':     { lat: -34.9116, lon: -57.9526, city: 'La Plata' },
  'gimnasia':        { lat: -34.9090, lon: -57.9442, city: 'La Plata' },
  'banfield':        { lat: -34.7406, lon: -58.3936, city: 'Buenos Aires' },
  'lanus':           { lat: -34.7203, lon: -58.3884, city: 'Buenos Aires' },
  'tigre':           { lat: -34.4380, lon: -58.5828, city: 'Buenos Aires' },
  'platense':        { lat: -34.5570, lon: -58.4660, city: 'Buenos Aires' },
  'argentinos':      { lat: -34.6075, lon: -58.4709, city: 'Buenos Aires' },
  'belgrano':        { lat: -31.4201, lon: -64.1888, city: 'Cordoba' },
  'talleres':        { lat: -31.4201, lon: -64.1888, city: 'Cordoba' },
  'instituto':       { lat: -31.4201, lon: -64.1888, city: 'Cordoba' },
  'godoy cruz':      { lat: -32.8895, lon: -68.8458, city: 'Mendoza' },
  // UE \u2014 Premier League
  'manchester city':   { lat: 53.4831, lon: -2.2004, city: 'Manchester' },
  'manchester united': { lat: 53.4631, lon: -2.2913, city: 'Manchester' },
  'liverpool':         { lat: 53.4308, lon: -2.9608, city: 'Liverpool' },
  'arsenal':           { lat: 51.5549, lon: -0.1084, city: 'London' },
  'chelsea':           { lat: 51.4817, lon: -0.1909, city: 'London' },
  'tottenham':         { lat: 51.6043, lon: -0.0664, city: 'London' },
  'west ham':          { lat: 51.5386, lon: -0.0166, city: 'London' },
  'crystal palace':    { lat: 51.3983, lon: -0.0855, city: 'London' },
  'fulham':            { lat: 51.4750, lon: -0.2218, city: 'London' },
  'brentford':         { lat: 51.4906, lon: -0.2889, city: 'London' },
  'brighton':          { lat: 50.8617, lon: -0.0832, city: 'Brighton' },
  'newcastle':         { lat: 54.9756, lon: -1.6217, city: 'Newcastle' },
  'leeds':             { lat: 53.7777, lon: -1.5717, city: 'Leeds' },
  'everton':           { lat: 53.4388, lon: -2.9663, city: 'Liverpool' },
  'aston villa':       { lat: 52.5092, lon: -1.8847, city: 'Birmingham' },
  // UE \u2014 La Liga
  'real madrid':       { lat: 40.4531, lon: -3.6883, city: 'Madrid' },
  'atletico':          { lat: 40.4361, lon: -3.5994, city: 'Madrid' },
  'barcelona':         { lat: 41.3809, lon: 2.1228, city: 'Barcelona' },
  'sevilla':           { lat: 37.3839, lon: -5.9706, city: 'Sevilla' },
  'real betis':        { lat: 37.3564, lon: -5.9819, city: 'Sevilla' },
  'valencia':          { lat: 39.4744, lon: -0.3585, city: 'Valencia' },
  'villarreal':        { lat: 39.9442, lon: -0.1031, city: 'Castellon' },
  'athletic':          { lat: 43.2641, lon: -2.9494, city: 'Bilbao' },
  'real sociedad':     { lat: 43.3017, lon: -1.9736, city: 'San Sebastian' },
  'celta':             { lat: 42.2119, lon: -8.7400, city: 'Vigo' },
  'getafe':            { lat: 40.3253, lon: -3.7142, city: 'Getafe' },
  'osasuna':           { lat: 42.7967, lon: -1.6367, city: 'Pamplona' },
  // UE \u2014 Serie A
  'juventus':          { lat: 45.1097, lon: 7.6411, city: 'Torino' },
  'inter':             { lat: 45.4781, lon: 9.1239, city: 'Milano' },
  'milan':             { lat: 45.4781, lon: 9.1239, city: 'Milano' },
  'napoli':            { lat: 40.8278, lon: 14.1925, city: 'Napoli' },
  'roma':              { lat: 41.9339, lon: 12.4547, city: 'Roma' },
  'lazio':             { lat: 41.9339, lon: 12.4547, city: 'Roma' },
  'atalanta':          { lat: 45.7089, lon: 9.6809, city: 'Bergamo' },
  'fiorentina':        { lat: 43.7806, lon: 11.2822, city: 'Firenze' },
  'torino':            { lat: 45.0419, lon: 7.6500, city: 'Torino' },
  // UE \u2014 Bundesliga
  'bayern':            { lat: 48.2188, lon: 11.6247, city: 'Munich' },
  'dortmund':          { lat: 51.4925, lon: 7.4517, city: 'Dortmund' },
  'leipzig':           { lat: 51.3458, lon: 12.3486, city: 'Leipzig' },
  'leverkusen':        { lat: 51.0383, lon: 7.0019, city: 'Leverkusen' },
  // UE \u2014 Ligue 1
  'psg':               { lat: 48.8414, lon: 2.2530, city: 'Paris' },
  'paris saint':       { lat: 48.8414, lon: 2.2530, city: 'Paris' },
  'marseille':         { lat: 43.2697, lon: 5.3958, city: 'Marseille' },
  'lyon':              { lat: 45.7653, lon: 4.9819, city: 'Lyon' },
  'monaco':            { lat: 43.7275, lon: 7.4156, city: 'Monaco' },
  // Brasil \u2014 Brasileir\u00e3o
  'flamengo':          { lat: -22.9119, lon: -43.2300, city: 'Rio de Janeiro' },
  'palmeiras':         { lat: -23.5273, lon: -46.6792, city: 'Sao Paulo' },
  'corinthians':       { lat: -23.5453, lon: -46.4742, city: 'Sao Paulo' },
  'sao paulo':         { lat: -23.5994, lon: -46.7197, city: 'Sao Paulo' },
  'fluminense':        { lat: -22.9119, lon: -43.2300, city: 'Rio de Janeiro' },
  'botafogo':          { lat: -22.8939, lon: -43.2925, city: 'Rio de Janeiro' },
  'gremio':            { lat: -29.9711, lon: -51.1953, city: 'Porto Alegre' },
  'internacional':     { lat: -30.0653, lon: -51.2358, city: 'Porto Alegre' }
};

function resolveCoords(venueText) {
  if (!venueText) return null;
  const k = String(venueText).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [name, c] of Object.entries(VENUES)) if (k.includes(name)) return c;
  for (const [name, c] of Object.entries(CITIES)) if (k.includes(name)) return c;
  return null;
}

/** Resuelve coords desde nombre de equipo local (fallback cuando no hay venue). */
function resolveCoordsByTeam(teamName) {
  if (!teamName) return null;
  const k = String(teamName).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  for (const [name, c] of Object.entries(TEAM_HOME_COORDS)) {
    if (k.includes(name)) return c;
  }
  return null;
}

/** Devuelve el pronóstico más cercano al kickoff. */
async function getWeather({ venue, city, lat, lon, kickoff, homeTeam }) {
  if (!KEY) return { unavailable: true, reason: 'no-api-key' };
  // Resolver coords con prioridad: lat/lon explícito → venue → city → equipo local
  let coords = (lat && lon) ? { lat, lon } : resolveCoords(venue || city);
  if (!coords && homeTeam) coords = resolveCoordsByTeam(homeTeam);
  if (!coords) return { unavailable: true, reason: 'venue-unknown' };

  const k = `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}|${Math.floor((kickoff || Date.now()) / 3600000)}`;
  const cached = cache.get(k);
  if (cached) return cached;

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${coords.lat}&lon=${coords.lon}&appid=${KEY}&units=metric&lang=es`;
    const data = await httpJson(url, { timeout: 8000 });
    const target = kickoff || Date.now();
    const closest = (data.list || []).reduce((best, item) => {
      const ms = item.dt * 1000;
      const dist = Math.abs(ms - target);
      return (!best || dist < best.dist) ? { item, dist } : best;
    }, null);
    if (!closest) return { unavailable: true, reason: 'no-forecast' };
    const w = closest.item;
    const result = {
      lat: coords.lat, lon: coords.lon,
      ts: w.dt * 1000,
      tempC:    w.main?.temp,
      feels:    w.main?.feels_like,
      humidity: w.main?.humidity,
      windKmh:  w.wind?.speed ? Math.round(w.wind.speed * 3.6) : null,
      windDeg:  w.wind?.deg,
      gustKmh:  w.wind?.gust ? Math.round(w.wind.gust * 3.6) : null,
      cloudPct: w.clouds?.all,
      rainMm:   (w.rain?.['3h'] || 0),
      snowMm:   (w.snow?.['3h'] || 0),
      condition: w.weather?.[0]?.main,
      conditionDesc: w.weather?.[0]?.description,
      icon: w.weather?.[0]?.icon
    };
    // Impacto inferido
    result.impact = inferImpact(result);
    cache.set(k, result);
    return result;
  } catch (e) {
    log('[weather] err', e?.message);
    return { unavailable: true, reason: 'api-error', err: e?.message };
  }
}

function inferImpact(w) {
  let goalsMultiplier = 1.0;   // 1.0 = sin impacto; <1 menos goles, >1 más
  let cornersMultiplier = 1.0;
  let cardsMultiplier = 1.0;
  const notes = [];

  // Lluvia significativa → menos goles
  if (w.rainMm > 5)    { goalsMultiplier *= 0.85; cardsMultiplier *= 1.15; notes.push('Lluvia intensa: goles ↓15%, faltas ↑15%'); }
  else if (w.rainMm > 1) { goalsMultiplier *= 0.92; notes.push('Lluvia leve: goles ↓8%'); }

  // Nieve → goles fuertemente afectado
  if (w.snowMm > 0)    { goalsMultiplier *= 0.78; notes.push('Nieve: goles ↓22%'); }

  // Viento fuerte → más córners, menos goles
  if (w.windKmh > 35)  { cornersMultiplier *= 1.12; goalsMultiplier *= 0.90; notes.push(`Viento fuerte (${w.windKmh}km/h): córners ↑12%, goles ↓10%`); }
  else if (w.windKmh > 25) { cornersMultiplier *= 1.06; notes.push(`Viento moderado (${w.windKmh}km/h): córners ↑6%`); }

  // Temperaturas extremas
  if (w.tempC != null) {
    if (w.tempC < 0)     { goalsMultiplier *= 0.93; notes.push('Frío extremo: goles ↓7%'); }
    else if (w.tempC > 32) { goalsMultiplier *= 0.94; notes.push('Calor extremo: goles ↓6% (fatiga)'); }
  }

  // Humedad alta + calor = fatiga acumulada
  if (w.humidity > 80 && w.tempC > 28) {
    goalsMultiplier *= 0.92;
    notes.push('Humedad y calor: ritmo bajo en 2° tiempo');
  }

  return {
    goalsMultiplier: Number(goalsMultiplier.toFixed(3)),
    cornersMultiplier: Number(cornersMultiplier.toFixed(3)),
    cardsMultiplier: Number(cardsMultiplier.toFixed(3)),
    notes
  };
}

module.exports = { getWeather, resolveCoords, VENUES };
