/* BetSafe — Factors aggregator
 * ============================================================================
 * Combina TODOS los factores en un único objeto enriquecido por partido:
 *
 *   {
 *     event: { id, home, away, league, start },
 *     market: { h2h, totals, btts, ... } - cuotas de nuestro scraping,
 *     weather: { tempC, windKmh, rainMm, impact },
 *     injuries: { home, away, severityScore },
 *     historical: { h2h, form },
 *     sharp: { steamMoves[], publicPct, rlm },
 *     quantitative: { poisson, elo, fairOdds, ev },
 *     correlation: [{ leg, withLeg, factor }]
 *   }
 *
 * Estos factores alimentan el AI Pipeline para generar picks hyper-detallados.
 * Y se exponen al frontend para que el usuario aplique filtros reales.
 * ============================================================================
 */
'use strict';

const { LRUCache } = require('lru-cache');
const { log } = require('../lib');
const { getWeather } = require('./weather');
const { getInjuries } = require('./injuries');
const { getHistorical } = require('./historical');

const cache = new LRUCache({ max: 300, ttl: 10 * 60 * 1000 });   // 10min cache

/** Construye el bundle completo de factores para un evento. */
async function buildFactors(event, { steamMoves = [], surebets = [] } = {}) {
  if (!event?.id) return null;
  const cached = cache.get(event.id);
  if (cached) return cached;

  // Ejecutar todas las fuentes en paralelo
  const [weather, injuries, historical] = await Promise.allSettled([
    getWeather({
      venue: event.venue || event.stadium,
      city: event.city,
      kickoff: event.start
    }),
    getInjuries({
      homeName: event.home?.name,
      awayName: event.away?.name,
      leagueKey: event.league
    }),
    getHistorical({
      homeName: event.home?.name,
      awayName: event.away?.name,
      leagueKey: event.league
    })
  ]);

  // Sharp money signal: steam moves de ESTE evento + público
  const evSteam = steamMoves.filter(s => s.eventId === event.id);
  const sharpScore = computeSharpScore(evSteam);

  // Análisis cuantitativo desde las cuotas (sin LLM)
  const quant = quantitativeAnalysis(event);

  const result = {
    event: {
      id: event.id,
      home: event.home,
      away: event.away,
      league: event.league,
      leagueName: event.leagueName,
      sport: event.sport,
      start: event.start
    },
    market: {
      h2h:     event.bestOdds?.h2h,
      totals:  event.bestOdds?.totals,
      btts:    event.bestOdds?.btts,
      books:   Object.keys(event.markets?.h2h || {}).length,
      overround: event.overround
    },
    weather:    weather.status === 'fulfilled' ? weather.value : { unavailable: true },
    injuries:   injuries.status === 'fulfilled' ? injuries.value : { unavailable: true },
    historical: historical.status === 'fulfilled' ? historical.value : { unavailable: true },
    sharp: {
      steamMoves: evSteam,
      score: sharpScore,
      hasArbActive: surebets.some(sb => sb.eventId === event.id)
    },
    quantitative: quant,
    ts: Date.now()
  };
  cache.set(event.id, result);
  return result;
}

function computeSharpScore(steamMoves) {
  if (!steamMoves?.length) return 0;
  const deltas = steamMoves
    .map(s => Math.abs(Number(s?.deltaPct)))
    .filter(v => Number.isFinite(v));
  if (!deltas.length) return 0;
  const maxDelta = Math.max(...deltas);
  const sharpCount = steamMoves.filter(s => s?.sharp).length;
  const score = (maxDelta / 20) + (sharpCount * 0.1);
  return Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
}

/** Análisis cuántico básico desde las cuotas (no necesita LLM).
 *  Calcula probabilidades fair (Shin no-vig), EV, Kelly. */
function quantitativeAnalysis(ev) {
  const h2h = ev?.bestOdds?.h2h;
  if (!h2h) return { unavailable: true };
  // Solo cuotas válidas (Number.isFinite + > 1.01)
  const odds = [h2h.home, h2h.draw, h2h.away].filter(o => Number.isFinite(o) && o > 1.01);
  if (odds.length < 2) return { unavailable: true };
  const overround = odds.reduce((s, o) => s + 1 / o, 0);
  const margin = overround - 1;

  // Shin's method para no-vig fair odds
  const fairProbs = shinNoVig(odds);
  // Guard contra NaN/Infinity de shinNoVig
  if (!fairProbs || fairProbs.some(p => !Number.isFinite(p))) return { unavailable: true };
  const fairOdds = fairProbs.map(p => p > 0 ? 1 / p : null);

  // EV por outcome
  const ev_pcts = odds.map((o, i) => ((fairProbs[i] * o) - 1) * 100);

  // Kelly stake (½ kelly). Guard contra b <= 0 (cuota <= 1).
  const kelly = odds.map((o, i) => {
    const p = fairProbs[i];
    const b = o - 1;
    if (b <= 0 || !Number.isFinite(p)) return 0;
    const q = 1 - p;
    const k = (b * p - q) / b;
    return Math.max(0, Math.min(0.5, k * 0.5));   // ½ Kelly, cap a 50% defensa
  });

  return {
    margin: Number((margin * 100).toFixed(3)),
    impliedProbs: odds.map(o => Number((1 / o).toFixed(4))),
    fairProbs: fairProbs.map(p => Number(p.toFixed(4))),
    fairOdds: fairOdds.map(o => o ? Number(o.toFixed(2)) : null),
    ev: ev_pcts.map(v => Number(v.toFixed(2))),
    kellyHalf: kelly.map(k => Number((k * 100).toFixed(2)))
  };
}

/** Shin's no-vig probabilities — más preciso que el método multiplicativo
 *  porque modela la asymmetric information del bookmaker. */
function shinNoVig(odds) {
  if (!Array.isArray(odds) || !odds.length) return [];
  const inv = odds.map(o => 1 / o);
  const sumInv = inv.reduce((s, x) => s + x, 0);
  if (!Number.isFinite(sumInv) || sumInv <= 0) return inv.map(() => 0);
  if (sumInv <= 1) return inv;     // ya no hay vig (cuotas son surebet o fair)
  // z inicial: heurística estable
  const maxOdd = Math.max(...odds);
  const denom = sumInv - inv.length / maxOdd;
  let z = denom !== 0 ? (sumInv - 1) / denom : 0.05;
  if (!Number.isFinite(z)) z = 0.05;
  z = Math.max(0.0001, Math.min(0.1, z));

  let lastDelta = Infinity;
  for (let iter = 0; iter < 30; iter++) {
    const probs = inv.map(i => (Math.sqrt(z * z + 4 * (1 - z) * i * i / sumInv) - z) / (2 * (1 - z)));
    const total = probs.reduce((s, p) => s + p, 0);
    if (!Number.isFinite(total) || total <= 0) break;
    const delta = Math.abs(total - 1);
    if (delta < 1e-6) return probs;
    // Si NO está convergiendo (delta no decrece), fallback a normalización simple
    if (delta >= lastDelta * 0.9) break;
    lastDelta = delta;
    z = z * total;
    if (!Number.isFinite(z) || z >= 1) break;
  }
  // Fallback: normalización simple proporcional
  return inv.map(i => i / sumInv);
}

module.exports = { buildFactors, quantitativeAnalysis, shinNoVig };
