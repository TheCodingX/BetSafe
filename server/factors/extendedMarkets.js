/* BetSafe — Extended markets predictor (córners, tarjetas, goleadores)
 * ============================================================================
 * APPROACH: Las 6 casas argentinas legales NO scrapeamos sus mercados de
 * córners/tarjetas/goleadores (cada uno requeriría parsers HTML específicos
 * por casa × 8 mercados × 6 casas = ~48 scrapers).
 *
 * Mientras eso se construye, ofrecemos PREDICCIONES ANALÍTICAS basadas en
 * modelos cuantitativos:
 *
 *   - Córners: Poisson con λ por equipo + historial liga (avg 10 córners/match)
 *   - Tarjetas: Poisson con λ por equipo + ajuste por rivalidad (avg 4/match)
 *   - Goleadores: top scorers de cada equipo × probabilidad de marcar
 *     basado en lineups + minutos esperados + forma reciente.
 *
 * Cada pick generado se MARCA con flag `analytical: true` para que la UI
 * muestre "Pick analítico — verificá disponibilidad en tu casa".
 * ============================================================================
 */
'use strict';

const { LRUCache } = require('lru-cache');
const cache = new LRUCache({ max: 500, ttl: 15 * 60 * 1000 });

/* ───────── CONFIG: medias y desvíos por sport/liga ───────── */
const SPORT_MEANS = {
  // soccer: corners promedio 10, cards promedio 4 (yellow + red)
  // Estos son los baselines mundiales. Liga-specific se ajusta abajo.
  soccer: {
    cornersTotal: 10.0,
    cornersHome:  5.4,    // home advantage
    cornersAway:  4.6,
    cardsTotal:   4.0,
    cardsHome:    1.9,
    cardsAway:    2.1
  },
  basketball: {
    foulsTotal: 22.0,
    foulsHome:  10.8,
    foulsAway:  11.2
  }
};

/* Liga adjustments: algunas ligas son MÁS físicas (más tarjetas) o más
 * ofensivas (más córners). Multiplicadores empíricos. */
const LEAGUE_ADJUSTMENTS = {
  // Más físicas → más cards
  'liga-profesional-de-futbol': { cards: 1.18, corners: 0.92 },
  'primera-nacional':           { cards: 1.20, corners: 0.85 },
  'libertadores':               { cards: 1.15, corners: 0.95 },
  'sudamericana':               { cards: 1.12, corners: 0.95 },
  'serie-a':                    { cards: 1.10, corners: 1.00 },  // italiana es física
  // Más ofensivas → más corners
  'premier-league':             { cards: 0.92, corners: 1.10 },
  'bundesliga':                 { cards: 0.88, corners: 1.15 },
  'eredivisie':                 { cards: 0.85, corners: 1.12 },
  // Mid balance
  'la-liga':                    { cards: 1.00, corners: 1.05 },
  'ligue-1':                    { cards: 1.05, corners: 1.00 },
  'champions-league':           { cards: 0.95, corners: 1.05 },
  'mls':                        { cards: 0.95, corners: 1.00 }
};

function leagueMultipliers(leagueName) {
  if (!leagueName) return { cards: 1.0, corners: 1.0 };
  const k = String(leagueName).toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
  // matching flexible: si contiene el slug
  for (const slug of Object.keys(LEAGUE_ADJUSTMENTS)) {
    if (k.includes(slug.replace(/-/g, ''))) return LEAGUE_ADJUSTMENTS[slug];
  }
  return { cards: 1.0, corners: 1.0 };
}

/* ───────── POISSON CDF helper ───────── */
function poissonCDF(k, lambda) {
  let sum = 0, term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) {
    sum += term;
    term *= lambda / (i + 1);
  }
  return Math.min(1, sum);
}
function probOver(line, lambda) {
  // P(X > line) — para líneas como 9.5 = P(X >= 10) = 1 - CDF(9)
  const floorLine = Math.floor(line);
  return 1 - poissonCDF(floorLine, lambda);
}
function probUnder(line, lambda) { return 1 - probOver(line, lambda); }

/* ───────── MAIN ───────── */
/**
 * Genera predicciones analíticas para córners, tarjetas y goleadores.
 *
 * @param {Object} event - el evento del orchestrator (con historical, factors, etc.)
 * @param {Object} ctx - { factors, poisson, elo } del pipeline AI
 * @returns {Object} { corners: { lambdas, picks }, cards: { lambdas, picks }, goalScorers: [] }
 */
async function predictExtendedMarkets(event, ctx = {}) {
  if (!event?.id) return null;
  const cached = cache.get(event.id);
  if (cached) return cached;

  const sport = event.sport || 'soccer';
  const means = SPORT_MEANS[sport];
  if (!means) {
    cache.set(event.id, null);
    return null;
  }

  const leagueAdj = leagueMultipliers(event.leagueName);
  const factors = ctx.factors || {};
  const poisson = ctx.poisson || {};

  const result = {
    sport,
    league: event.leagueName,
    leagueAdj,
    corners: predictCorners(event, factors, poisson, means, leagueAdj),
    cards:   predictCards(event, factors, poisson, means, leagueAdj),
    goalScorers: predictGoalScorers(event, factors, poisson),
    generatedAt: Date.now()
  };

  cache.set(event.id, result);
  return result;
}

/* ───────── CÓRNERS ─────────
 * Modelo: λ_total = base_total × ajuste_liga × ajuste_partido
 *   ajuste_partido considera diferencia de poder de fuego (xG implícito).
 *   Equipos más ofensivos → más córners.
 */
function predictCorners(event, factors, poisson, means, leagueAdj) {
  // Base por liga
  let lambdaTotal = means.cornersTotal * leagueAdj.corners;

  // Ajuste por xG total esperado (más goles → más ataques → más córners)
  // Soccer: cada gol extra implica ~2 córners más en promedio.
  if (Number.isFinite(poisson.lambdaH) && Number.isFinite(poisson.lambdaA)) {
    const xgTotal = poisson.lambdaH + poisson.lambdaA;
    const xgFactor = xgTotal / 2.5;  // 2.5 = avg soccer
    lambdaTotal *= 0.75 + 0.25 * xgFactor;  // ajuste suave (max ±25%)
  }

  // Ajuste por clima (lluvia/viento reduce córners)
  const wImp = factors.weather?.impact?.goalsMultiplier;
  if (Number.isFinite(wImp) && wImp < 1) lambdaTotal *= 0.92 + (wImp - 0.9) * 0.8;

  // Distribución home/away (home ventaja = ~54% de los córners)
  const homeShare = Number.isFinite(poisson.lambdaH) && Number.isFinite(poisson.lambdaA)
    ? poisson.lambdaH / (poisson.lambdaH + poisson.lambdaA)
    : 0.54;
  const lambdaH = lambdaTotal * homeShare;
  const lambdaA = lambdaTotal * (1 - homeShare);

  // Picks: principales líneas que tienen valor estructural
  const picks = [];
  for (const line of [8.5, 9.5, 10.5, 11.5]) {
    const pOver = probOver(line, lambdaTotal);
    const pUnder = 1 - pOver;
    // Solo emitimos pick si la dirección está clara (>58% una de las dos)
    if (pOver >= 0.58) {
      picks.push({
        market: 'corners',
        outcome: 'over',
        line,
        label: `Más de ${line} córners`,
        analyticalProb: Number(pOver.toFixed(3)),
        // No tenemos cuota real — estimamos fair odd
        // Asumimos cuota de mercado ~95% de fair (típico margen casa) → EV +5% al user
        fairOdd: Number((1 / (pOver * 0.95)).toFixed(2)),
        analytical: true,
        rationale: `Análisis interno: ${lambdaTotal.toFixed(1)} córners esperados según xG (${(poisson.lambdaH + poisson.lambdaA).toFixed(2)} goles) y promedio de la liga (${means.cornersTotal * leagueAdj.corners} córners base). Probabilidad ${(pOver * 100).toFixed(0)}% de superar los ${line} córners.`
      });
    } else if (pUnder >= 0.58) {
      picks.push({
        market: 'corners',
        outcome: 'under',
        line,
        label: `Menos de ${line} córners`,
        analyticalProb: Number(pUnder.toFixed(3)),
        fairOdd: Number((1 / (pUnder * 0.95)).toFixed(2)),
        analytical: true,
        rationale: `Análisis interno: ${lambdaTotal.toFixed(1)} córners esperados — partido cerrado/defensivo. Probabilidad ${(pUnder * 100).toFixed(0)}% de quedar por debajo de los ${line} córners.`
      });
    }
  }

  return {
    lambdaTotal: Number(lambdaTotal.toFixed(2)),
    lambdaHome: Number(lambdaH.toFixed(2)),
    lambdaAway: Number(lambdaA.toFixed(2)),
    picks: picks.slice(0, 2)   // máximo 2 picks de córners por evento
  };
}

/* ───────── TARJETAS ─────────
 * Modelo: λ depende de rivalidad + estilo de equipos + agresividad histórica.
 */
function predictCards(event, factors, poisson, means, leagueAdj) {
  let lambdaTotal = means.cardsTotal * leagueAdj.cards;

  // Ajuste por importancia del partido (clásicos, playoffs → más cards)
  const ln = String(event.leagueName || '').toLowerCase();
  if (/playoff|final|semifinal|clasico|cl[áa]sico/i.test(ln)) lambdaTotal *= 1.20;
  if (/copa|cup/i.test(ln) && !/del rey|america/i.test(ln)) lambdaTotal *= 1.08;

  // Ajuste por lesiones críticas (suelen llevar a fouls duros / yellow tactical)
  const sevH = factors.injuries?.severityScore?.home || 0;
  const sevA = factors.injuries?.severityScore?.away || 0;
  if (sevH > 0.4 || sevA > 0.4) lambdaTotal *= 1.05;

  const homeShare = 0.48;  // visitante recibe más tarjetas (referee bias)
  const lambdaH = lambdaTotal * homeShare;
  const lambdaA = lambdaTotal * (1 - homeShare);

  const picks = [];
  for (const line of [3.5, 4.5, 5.5]) {
    const pOver = probOver(line, lambdaTotal);
    const pUnder = 1 - pOver;
    if (pOver >= 0.60) {
      picks.push({
        market: 'cards',
        outcome: 'over',
        line,
        label: `Más de ${line} tarjetas`,
        analyticalProb: Number(pOver.toFixed(3)),
        // Asumimos cuota de mercado ~95% de fair (típico margen casa) → EV +5% al user
        fairOdd: Number((1 / (pOver * 0.95)).toFixed(2)),
        analytical: true,
        rationale: `Análisis interno: ${lambdaTotal.toFixed(1)} tarjetas esperadas (promedio liga ${means.cardsTotal} × ajuste contexto). ${ln.includes('playoff') ? 'Partido de playoff aumenta intensidad. ' : ''}Probabilidad ${(pOver * 100).toFixed(0)}% de superar las ${line} tarjetas.`
      });
    } else if (pUnder >= 0.62) {
      picks.push({
        market: 'cards',
        outcome: 'under',
        line,
        label: `Menos de ${line} tarjetas`,
        analyticalProb: Number(pUnder.toFixed(3)),
        fairOdd: Number((1 / (pUnder * 0.95)).toFixed(2)),
        analytical: true,
        rationale: `Análisis interno: ${lambdaTotal.toFixed(1)} tarjetas esperadas — partido más cordial. Probabilidad ${(pUnder * 100).toFixed(0)}% de quedar por debajo.`
      });
    }
  }

  return {
    lambdaTotal: Number(lambdaTotal.toFixed(2)),
    lambdaHome: Number(lambdaH.toFixed(2)),
    lambdaAway: Number(lambdaA.toFixed(2)),
    picks: picks.slice(0, 1)   // máximo 1 pick de tarjetas
  };
}

/* ───────── GOLEADORES ─────────
 * Modelo: top scorers de la temporada × λ ajustado por matchup.
 * Sin SofaScore detallado, usamos un proxy: equipos con xG alto generan más
 * picks de goleador. NO inventamos nombres — solo emitimos si tenemos
 * roster + goleadores conocidos.
 */
function predictGoalScorers(event, factors, poisson) {
  // Sin lineups + sin historical scorers, no podemos predecir nombres.
  // Por ahora devolvemos array vacío con flag "pending data".
  // Cuando se integre lineups completos con goleadores del año, llenamos.
  const lineups = factors.lineups;
  if (!lineups || lineups.unavailable) return [];
  if (!lineups.home?.expectedStarters || !lineups.away?.expectedStarters) return [];

  const picks = [];
  // Calcular goles esperados por equipo
  const goalsH = poisson.lambdaH || 1.3;
  const goalsA = poisson.lambdaA || 1.0;

  // Asumimos que los 3 delanteros principales se llevan ~70% de los goles
  // (40% el primero, 20% el segundo, 10% el tercero)
  const homeForwards = (lineups.home.expectedStarters || []).filter(p => /forward|striker|delantero|fw|st/i.test(p.position || '')).slice(0, 3);
  const awayForwards = (lineups.away.expectedStarters || []).filter(p => /forward|striker|delantero|fw|st/i.test(p.position || '')).slice(0, 3);

  function scorerPicks(forwards, lambda, teamName) {
    const dist = [0.40, 0.20, 0.10];   // goles esperados por jugador
    return forwards.map((p, i) => {
      const playerLambda = lambda * (dist[i] || 0);
      // P(jugador marque al menos 1) = 1 - e^-λ
      const probAnytime = 1 - Math.exp(-playerLambda);
      if (probAnytime < 0.30) return null;
      return {
        market: 'goalscorer-anytime',
        outcome: 'yes',
        player: p.name,
        team: teamName,
        label: `${p.name} marca`,
        analyticalProb: Number(probAnytime.toFixed(3)),
        fairOdd: Number((1 / (probAnytime * 0.95)).toFixed(2)),
        analytical: true,
        rationale: `Análisis interno: ${p.name} es titular esperado en ${teamName}. Con ${lambda.toFixed(2)} goles proyectados para el equipo y siendo delantero N°${i+1} en la rotación, probabilidad ${(probAnytime * 100).toFixed(0)}% de marcar en cualquier momento.`
      };
    }).filter(Boolean);
  }

  picks.push(...scorerPicks(homeForwards, goalsH, event.home?.name));
  picks.push(...scorerPicks(awayForwards, goalsA, event.away?.name));

  // Sort by probability descending y tomar top 4
  picks.sort((a, b) => b.analyticalProb - a.analyticalProb);
  return picks.slice(0, 4);
}

module.exports = { predictExtendedMarkets };
