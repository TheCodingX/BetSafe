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

function resolveCoords(venueText) {
  if (!venueText) return null;
  const k = String(venueText).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [name, c] of Object.entries(VENUES)) if (k.includes(name)) return c;
  for (const [name, c] of Object.entries(CITIES)) if (k.includes(name)) return c;
  return null;
}

/** Devuelve el pronóstico más cercano al kickoff. */
async function getWeather({ venue, city, lat, lon, kickoff }) {
  if (!KEY) return { unavailable: true, reason: 'no-api-key' };
  const coords = (lat && lon) ? { lat, lon } : resolveCoords(venue || city);
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
