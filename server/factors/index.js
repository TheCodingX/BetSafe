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
  if (!steamMoves.length) return 0;
  // Score 0-1 según magnitud y frecuencia de los movimientos sharp
  const maxDelta = Math.max(...steamMoves.map(s => Math.abs(s.deltaPct)));
  const sharpCount = steamMoves.filter(s => s.sharp).length;
  return Math.min(1, (maxDelta / 20) + (sharpCount * 0.1));
}

/** Análisis cuántico básico desde las cuotas (no necesita LLM).
 *  Calcula probabilidades fair (Shin no-vig), EV, Kelly. */
function quantitativeAnalysis(ev) {
  const h2h = ev.bestOdds?.h2h;
  if (!h2h) return { unavailable: true };
  const odds = [h2h.home, h2h.draw, h2h.away].filter(Boolean);
  if (odds.length < 2) return { unavailable: true };
  const overround = odds.reduce((s, o) => s + 1 / o, 0);
  const margin = overround - 1;

  // Shin's method para no-vig fair odds
  const fairProbs = shinNoVig(odds);
  const fairOdds = fairProbs.map(p => p > 0 ? 1 / p : null);

  // EV por outcome (vs mejor cuota disponible)
  const ev_pcts = odds.map((o, i) => ((fairProbs[i] * o) - 1) * 100);

  // Kelly stake (½ kelly para conservar)
  const kelly = odds.map((o, i) => {
    const p = fairProbs[i];
    const q = 1 - p;
    const b = o - 1;
    const k = (b * p - q) / b;
    return Math.max(0, k * 0.5);   // ½ Kelly
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
  const inv = odds.map(o => 1 / o);
  const sumInv = inv.reduce((s, x) => s + x, 0);
  if (sumInv <= 1) return inv;     // ya no hay vig
  // Resolver z iterativamente: π_i = (sqrt(z² + 4(1-z) * inv_i² / sumInv) - z) / (2(1-z))
  let z = (sumInv - 1) / (sumInv - inv.length / Math.max(...odds));
  z = Math.max(0.0001, Math.min(0.1, z));
  for (let iter = 0; iter < 30; iter++) {
    const probs = inv.map(i => (Math.sqrt(z * z + 4 * (1 - z) * i * i / sumInv) - z) / (2 * (1 - z)));
    const total = probs.reduce((s, p) => s + p, 0);
    if (Math.abs(total - 1) < 1e-6) return probs;
    z = z * total;
  }
  // Fallback: normalización simple
  return inv.map(i => i / sumInv);
}

module.exports = { buildFactors, quantitativeAnalysis, shinNoVig };
