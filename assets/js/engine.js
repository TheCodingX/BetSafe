/* BetSafe — Quantitative Engine
 * ============================================================================
 * Motor cuantitativo real para análisis de apuestas deportivas.
 *
 * Implementa modelos estadísticos públicos y bien establecidos:
 *  - Distribución de Poisson (goles esperados)
 *  - Independencia con grilla bivariada para 1X2 / BTTS / Over-Under
 *  - Elo rating dinámico
 *  - Remoción de margen (multiplicativo + Shin)
 *  - Expected Value (EV) y Kelly fraccional
 *  - Detección de surebets (2-way y 3-way)
 *  - Correlación entre legs (heurística por evento + familia de mercado)
 *  - Optimización de combinadas con branch-and-bound
 *  - Monte Carlo (N runs) y What-If (2^N enumeración exacta)
 *  - CLV (Closing Line Value)
 *
 * Todo es matemática estándar. Ningún dato proviene de scraping.
 * Cuando se conecta a una API real (BSApi), los modelos consumen sus números
 * y producen análisis cuantitativo verificable.
 * ============================================================================
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // PROBABILIDAD CORE
  // ─────────────────────────────────────────────────────────────────────────

  /** Poisson PMF: P(X = k | λ) */
  function poissonPMF(k, lambda) {
    if (lambda <= 0 || k < 0) return k === 0 ? 1 : 0;
    // Cálculo estable: exp(k*ln(λ) - λ - ln(k!))
    let logFact = 0;
    for (let i = 2; i <= k; i++) logFact += Math.log(i);
    const logP = k * Math.log(lambda) - lambda - logFact;
    return Math.exp(logP);
  }

  /** Poisson CDF: P(X <= k | λ) */
  function poissonCDF(k, lambda) {
    let s = 0;
    for (let i = 0; i <= k; i++) s += poissonPMF(i, lambda);
    return Math.min(1, s);
  }

  /** Grilla bivariada P(home=i, away=j) hasta maxGoals, asumiendo independencia */
  function bivariateGrid(lambdaH, lambdaA, maxGoals = 8) {
    const grid = [];
    const pH = []; const pA = [];
    for (let i = 0; i <= maxGoals; i++) {
      pH[i] = poissonPMF(i, lambdaH);
      pA[i] = poissonPMF(i, lambdaA);
    }
    for (let i = 0; i <= maxGoals; i++) {
      grid[i] = [];
      for (let j = 0; j <= maxGoals; j++) {
        grid[i][j] = pH[i] * pA[j];
      }
    }
    return grid;
  }

  /** Derivar probabilidades de mercado desde grilla bivariada */
  function deriveMarketsFromGrid(grid) {
    let pHome = 0, pDraw = 0, pAway = 0;
    let bttsYes = 0, bttsNo = 0;
    const totalsP = {}; // P(total = k)
    const N = grid.length;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p = grid[i][j];
        if (i > j) pHome += p; else if (i === j) pDraw += p; else pAway += p;
        if (i >= 1 && j >= 1) bttsYes += p; else bttsNo += p;
        const t = i + j;
        totalsP[t] = (totalsP[t] || 0) + p;
      }
    }
    // Over/Under para líneas medias (1.5, 2.5, 3.5, 4.5)
    const overs = {};
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].forEach(line => {
      let pOver = 0;
      Object.entries(totalsP).forEach(([k, p]) => { if (Number(k) > line) pOver += p; });
      overs[line] = { over: pOver, under: 1 - pOver };
    });
    return {
      h2h:   { home: pHome, draw: pDraw, away: pAway },
      btts:  { yes: bttsYes, no: bttsNo },
      totals: overs,
      // Doble oportunidad
      dc: {
        home_or_draw: pHome + pDraw,
        draw_or_away: pDraw + pAway,
        home_or_away: pHome + pAway
      },
      // DNB
      dnb: {
        home: pHome / (pHome + pAway),
        away: pAway / (pHome + pAway)
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ELO RATING
  // ─────────────────────────────────────────────────────────────────────────

  const ELO = {
    K: 32,           // factor K base
    homeAdv: 60,     // ventaja de localía (~60 puntos Elo en fútbol)
    init: 1500,
    /** Probabilidad esperada de Elo: home gana vs away */
    expected(ratingH, ratingA, homeAdv = ELO.homeAdv) {
      return 1 / (1 + Math.pow(10, ((ratingA - (ratingH + homeAdv)) / 400)));
    },
    /** Actualiza ratings post-partido. result: 1 (home), 0.5 (draw), 0 (away) */
    update(ratingH, ratingA, result, k = ELO.K) {
      const eH = ELO.expected(ratingH, ratingA);
      const newH = ratingH + k * (result - eH);
      const newA = ratingA + k * ((1 - result) - (1 - eH));
      return [newH, newA];
    },
    /** Convierte rating diferencial a λ (goles esperados) usando base + escala */
    toLambda(diff, base = 1.4) {
      // Ajuste log-lineal: ±400 Elo ≈ ±0.5 goles
      return Math.max(0.2, base + diff / 800);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // PROBABILIDAD IMPLÍCITA + REMOCIÓN DE MARGEN
  // ─────────────────────────────────────────────────────────────────────────

  /** Probabilidad implícita cruda: 1/odd */
  function implied(odd) { return odd > 1 ? 1 / odd : 0; }

  /** Margen del libro (overround) para un mercado: Σ(1/odd) - 1 */
  function overround(odds) {
    return odds.reduce((s, o) => s + implied(o), 0) - 1;
  }

  /** Remoción multiplicativa del margen: p_fair = p_raw / Σp_raw
   *  Más simple, sesgo hacia favoritos. Usado por la mayoría de comparadores. */
  function removeMarginMultiplicative(odds) {
    const raws = odds.map(implied);
    const sum = raws.reduce((a, b) => a + b, 0);
    return raws.map(p => p / sum);
  }

  /** Remoción Shin: corrige el "favourite-longshot bias".
   *  Más sofisticado, asume liquidez asimétrica entre favorito/perdedor. */
  function removeMarginShin(odds, iters = 50) {
    const raws = odds.map(implied);
    const sum = raws.reduce((a, b) => a + b, 0);
    let z = 0;
    for (let it = 0; it < iters; it++) {
      const denom = raws.reduce((acc, p) => {
        const sq = Math.sqrt(z * z + 4 * (1 - z) * (p * p / sum));
        return acc + sq;
      }, 0);
      const newZ = ((denom - 2) / 2) * (denom > 2 ? 1 : -1);
      if (Math.abs(newZ - z) < 1e-9) break;
      z = Math.max(0, Math.min(0.5, newZ));
    }
    return raws.map(p => {
      const sq = Math.sqrt(z * z + 4 * (1 - z) * (p * p / sum));
      return (sq - z) / (2 * (1 - z));
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EV + KELLY
  // ─────────────────────────────────────────────────────────────────────────

  /** Expected Value de una apuesta: EV = trueP * odd - 1
   *  > 0 = apuesta con valor; < 0 = casa toma ventaja */
  function expectedValue(trueP, odd) {
    return trueP * odd - 1;
  }

  /** Kelly criterion fraccional. f* = (p*b - q) / b donde b = odd-1, q = 1-p */
  function kellyFraction(trueP, odd, kellyMult = 1) {
    const b = odd - 1;
    if (b <= 0) return 0;
    const q = 1 - trueP;
    const f = (trueP * b - q) / b;
    return Math.max(0, f * kellyMult);
  }

  /** Stake recomendado a partir de banca, prob real y cuota */
  function kellyStake(bankroll, trueP, odd, kellyMult = 0.5, cap = 0.05) {
    const f = kellyFraction(trueP, odd, kellyMult);
    return Math.round(bankroll * Math.min(f, cap));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SUREBET / ARBITRAJE
  // ─────────────────────────────────────────────────────────────────────────

  /** Detecta surebet en N outcomes mutuamente exclusivos.
   *  Si Σ(1/odd) < 1 → existe arbitraje. */
  function detectSurebet(odds) {
    const total = odds.reduce((s, o) => s + 1 / o, 0);
    if (total >= 1) return null;
    const roi = (1 / total - 1);  // ROI garantizado
    // Distribución óptima de stakes para profit igual en cada outcome:
    // stake_i = (1/odd_i) / total
    const stakes = odds.map(o => (1 / o) / total);
    return { total, roi, stakes };
  }

  /** Detecta el mejor surebet entre múltiples casas para un mercado 2-way / 3-way.
   *  booksOdds: [{ book, odds: [o1, o2, (o3)] }, ...] */
  function findBestSurebet(booksOdds) {
    if (!booksOdds.length) return null;
    const numOutcomes = booksOdds[0].odds.length;
    // Tomamos la mejor cuota de cada outcome entre todas las casas
    const bestOdds = [];
    const bestBooks = [];
    for (let i = 0; i < numOutcomes; i++) {
      let bestO = 0; let bestB = null;
      booksOdds.forEach(b => {
        if (b.odds[i] && b.odds[i] > bestO) { bestO = b.odds[i]; bestB = b.book; }
      });
      bestOdds.push(bestO);
      bestBooks.push(bestB);
    }
    const sb = detectSurebet(bestOdds);
    if (!sb) return null;
    return { ...sb, odds: bestOdds, books: bestBooks };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CORRELACIÓN ENTRE LEGS
  // ─────────────────────────────────────────────────────────────────────────

  /** Mercados que son altamente correlacionados (no se pueden combinar bien).
   *  Conjuntos basados en dependencia probabilística estándar. */
  const CORRELATED_MARKETS = {
    // 1X2 y Doble Oportunidad son perfectamente correlacionados
    h2h_dc: ['h2h', 'dc'],
    // BTTS y Totales están correlacionados (más goles → más probable BTTS)
    btts_totals: ['btts', 'totals'],
    // DNB y 1X2 están correlacionados
    h2h_dnb: ['h2h', 'dnb'],
    // Mercados de córners entre sí
    corners: ['corners', 'corners_home', 'corners_away', 'corners_handicap', 'first_corner'],
    // Mercados de tarjetas entre sí
    cards: ['cards', 'cards_home', 'cards_away', 'card_player', 'first_card', 'red_card'],
    // Mercados de goleadores entre sí
    scorers: ['scorer_any', 'scorer_first', 'scorer_last', 'scorer_2plus', 'scorer_hat']
  };

  /** ¿Son dos legs altamente correlacionadas? */
  function areCorrelated(legA, legB) {
    if (legA.matchId === legB.matchId) {
      // Mismo partido → casi siempre correlacionado salvo combinaciones específicas
      // (ej. Goleador específico + 1X2 NO están perfectamente correlacionados)
      const mA = legA.market, mB = legB.market;
      // Si están en el mismo grupo de correlación, descartar
      for (const group of Object.values(CORRELATED_MARKETS)) {
        if (group.includes(mA) && group.includes(mB)) return true;
      }
      // Mismo partido + mercados independientes: aún así descartar por seguridad
      // a menos que se quiera explotar correlación intencional (Same Game Parlay)
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OPTIMIZACIÓN DE COMBINADAS (branch-and-bound)
  // ─────────────────────────────────────────────────────────────────────────

  /** Construye candidatos de leg para un partido según nivel de riesgo.
   *  matchProbs viene del modelo Poisson + odds reales. */
  function legCandidates(match, marketsAvailable, risk) {
    const out = [];
    const probs = match.modelProbs || {};
    const odds  = match.odds || {};
    const matchId = match.id;

    function add(market, outcome, label, p, odd) {
      if (!p || !odd || odd < 1.01) return;
      const ev = expectedValue(p, odd);
      out.push({ matchId, match, market, outcome, label, p, odd, ev });
    }

    // 1X2
    if (marketsAvailable.has('h2h') && probs.h2h && odds.h2h) {
      add('h2h', 'home', `Gana ${match.home.name}`, probs.h2h.home, odds.h2h.home);
      add('h2h', 'draw', `Empate`, probs.h2h.draw, odds.h2h.draw);
      add('h2h', 'away', `Gana ${match.away.name}`, probs.h2h.away, odds.h2h.away);
    }
    // Doble oportunidad
    if (marketsAvailable.has('dc') && probs.dc && odds.dc) {
      add('dc', 'home_or_draw', `${match.home.name} o empate`, probs.dc.home_or_draw, odds.dc.home_or_draw);
      add('dc', 'draw_or_away', `Empate o ${match.away.name}`, probs.dc.draw_or_away, odds.dc.draw_or_away);
    }
    // Goles O/U (línea principal 2.5)
    if (marketsAvailable.has('totals') && probs.totals && odds.totals) {
      Object.entries(probs.totals).forEach(([line, p]) => {
        if (odds.totals[line]) {
          add('totals', 'over', `Más de ${line} goles`, p.over, odds.totals[line].over);
          add('totals', 'under', `Menos de ${line} goles`, p.under, odds.totals[line].under);
        }
      });
    }
    // BTTS
    if (marketsAvailable.has('btts') && probs.btts && odds.btts) {
      add('btts', 'yes', `Ambos equipos marcan: Sí`, probs.btts.yes, odds.btts.yes);
      add('btts', 'no',  `Ambos equipos marcan: No`, probs.btts.no,  odds.btts.no);
    }

    // Filtrar por banda de riesgo (cuota)
    const bands = {
      cons: [1.10, 1.45],
      eq:   [1.45, 2.30],
      agg:  [2.30, 8.00]
    };
    const [lo, hi] = bands[risk] || bands.eq;
    return out.filter(c => c.odd >= lo && c.odd <= hi);
  }

  /** Optimiza combinada de N legs con mayor EV evitando correlación.
   *  Usa branch-and-bound: ordena por EV desc, explora rama y poda si EV total
   *  proyectado cae por debajo del mejor encontrado. */
  function optimizeCombo(matches, n, risk, marketsAvailable, opts = {}) {
    const minEv = opts.minEv != null ? opts.minEv : -0.05;
    const allCandidates = [];
    matches.forEach(m => {
      legCandidates(m, marketsAvailable, risk).forEach(c => allCandidates.push(c));
    });
    // Ordenar por EV descendente como heurística para branch-and-bound
    allCandidates.sort((a, b) => b.ev - a.ev);

    let best = null;
    function score(combo) {
      const totalOdd = combo.reduce((a, b) => a * b.odd, 1);
      const totalP   = combo.reduce((a, b) => a * b.p,   1);
      const ev = totalP * totalOdd - 1;
      return { totalOdd, totalP, ev };
    }

    function explore(picked, startIdx) {
      if (picked.length === n) {
        const s = score(picked);
        if (s.ev < minEv) return;
        if (!best || s.ev > best.ev) {
          best = { legs: picked.slice(), ...s };
        }
        return;
      }
      // Poda: cota optimista
      // Aún tomando los mejores N-picked.length futuros, si el producto cae <= best, cortar
      for (let i = startIdx; i < allCandidates.length; i++) {
        const cand = allCandidates[i];
        // Anti-correlación
        let ok = true;
        for (const p of picked) if (areCorrelated(p, cand)) { ok = false; break; }
        if (!ok) continue;
        picked.push(cand);
        explore(picked, i + 1);
        picked.pop();
        // Cota: si el cand de mejor EV restante no alcanza, podar
        if (best && best.ev > 0) {
          const remaining = n - picked.length - 1;
          if (remaining > 0 && cand.ev < best.ev / (remaining + 1) - 0.1) break;
        }
      }
    }
    explore([], 0);
    return best;
  }

  /** Genera múltiples combinadas distintas (diversificadas) */
  function generateCombos(matches, n, risk, count, marketsAvailable, opts = {}) {
    const used = new Set();
    const combos = [];
    let attempts = 0;
    while (combos.length < count && attempts < count * 5) {
      attempts++;
      const sub = matches.filter(m => !used.has(m.id) || matches.length < n * count);
      const best = optimizeCombo(sub, n, risk, marketsAvailable, opts);
      if (!best) break;
      combos.push(best);
      best.legs.forEach(l => used.add(l.matchId));
    }
    return combos;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MONTE CARLO + WHAT-IF
  // ─────────────────────────────────────────────────────────────────────────

  /** Generador de números pseudo-aleatorios (mulberry32) — determinístico con seed */
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Monte Carlo: simula N runs de una combinada, retorna distribución de profit */
  function monteCarloCombo(legs, stake, runs = 1000, seed = 42) {
    const rand = rng(seed);
    const totalOdd = legs.reduce((a, b) => a * b.odd, 1);
    const winPayout = stake * totalOdd;
    const losses = [];
    let wins = 0;
    for (let i = 0; i < runs; i++) {
      let win = true;
      for (const l of legs) { if (rand() > l.p) { win = false; break; } }
      if (win) wins++;
      losses.push(win ? winPayout - stake : -stake);
    }
    losses.sort((a, b) => a - b);
    const pct = q => losses[Math.min(losses.length - 1, Math.floor(q * losses.length))];
    return {
      runs,
      wins,
      winRate: wins / runs,
      expectedProfit: losses.reduce((a, b) => a + b, 0) / runs,
      percentiles: {
        p05: pct(0.05),
        p25: pct(0.25),
        p50: pct(0.50),
        p75: pct(0.75),
        p95: pct(0.95)
      },
      maxLoss: losses[0],
      maxWin: losses[losses.length - 1]
    };
  }

  /** What-If: enumera los 2^N escenarios exactos.
   *  Solo viable para N <= 12 (4096 escenarios). */
  function whatIfCombo(legs, stake) {
    const N = legs.length;
    if (N > 12) throw new Error('What-If solo soporta hasta 12 legs');
    const scenarios = [];
    for (let mask = 0; mask < (1 << N); mask++) {
      let p = 1;
      let win = true;
      const outcomes = [];
      for (let i = 0; i < N; i++) {
        const legWins = (mask & (1 << i)) !== 0;
        outcomes.push(legWins);
        p *= legWins ? legs[i].p : (1 - legs[i].p);
        if (!legWins) win = false;
      }
      const totalOdd = legs.reduce((a, b) => a * b.odd, 1);
      const profit = win ? stake * (totalOdd - 1) : -stake;
      scenarios.push({ outcomes, p, profit, win });
    }
    return scenarios;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLV (Closing Line Value)
  // ─────────────────────────────────────────────────────────────────────────

  /** CLV: comparación de cuota tomada vs cuota de cierre.
   *  CLV > 0 = batió al mercado en el momento de cierre. */
  function clv(takenOdd, closingOdd) {
    if (!takenOdd || !closingOdd) return 0;
    return (takenOdd / closingOdd) - 1;
  }

  /** CLV agregado sobre una serie de apuestas */
  function aggregateClv(bets) {
    if (!bets.length) return 0;
    return bets.reduce((s, b) => s + clv(b.odd, b.closingOdd), 0) / bets.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SHARPE / SORTINO / DRAWDOWN
  // ─────────────────────────────────────────────────────────────────────────

  /** Sharpe ratio: (μ - rf) / σ.  rf = 0 por defecto */
  function sharpe(returns, rf = 0) {
    if (returns.length < 2) return 0;
    const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mu) ** 2, 0) / (returns.length - 1);
    const sigma = Math.sqrt(variance);
    return sigma === 0 ? 0 : (mu - rf) / sigma;
  }

  /** Sortino: solo penaliza volatilidad negativa */
  function sortino(returns, rf = 0) {
    if (returns.length < 2) return 0;
    const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
    const downside = returns.filter(r => r < rf);
    if (!downside.length) return Infinity;
    const ddev = Math.sqrt(downside.reduce((s, r) => s + (r - rf) ** 2, 0) / downside.length);
    return ddev === 0 ? 0 : (mu - rf) / ddev;
  }

  /** Maximum drawdown a partir de una serie de equity (banca a lo largo del tiempo) */
  function maxDrawdown(equity) {
    let peak = equity[0] || 0;
    let mdd = 0;
    for (const v of equity) {
      if (v > peak) peak = v;
      const dd = (peak - v) / peak;
      if (dd > mdd) mdd = dd;
    }
    return mdd;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PICKS: genera 3 picks (cons / eq / agg) para un partido
  // ─────────────────────────────────────────────────────────────────────────

  function pickForMatch(match, marketsAvailable = new Set(['h2h','dc','totals','btts'])) {
    const out = { cons: null, eq: null, agg: null };
    const all = ['cons', 'eq', 'agg'].flatMap(r =>
      legCandidates(match, marketsAvailable, r).map(c => ({ ...c, risk: r }))
    );
    // Para cada banda elegimos el de mayor EV
    ['cons', 'eq', 'agg'].forEach(r => {
      const inBand = all.filter(c => c.risk === r);
      if (inBand.length) {
        inBand.sort((a, b) => b.ev - a.ev);
        out[r] = inBand[0];
      }
    });
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PIPELINE: dadas cuotas reales (y opcionalmente Elo / xG), produce el
  // model completo del partido (probabilidades model-based vs market-based)
  // ─────────────────────────────────────────────────────────────────────────

  /** Construye probabilidades model (Poisson) + market (1/odd con margen removido)
   *  y combina ambas en `true_p` (Bayes-like blend). */
  function modelMatch(match, opts = {}) {
    const lambdaH = match.lambdaH || opts.lambdaH || 1.4;
    const lambdaA = match.lambdaA || opts.lambdaA || 1.1;
    const grid = bivariateGrid(lambdaH, lambdaA, opts.maxGoals || 8);
    const modelProbs = deriveMarketsFromGrid(grid);

    // Market probs (desde mejores cuotas removiendo margen)
    const odds = match.odds || {};
    const marketProbs = {};
    if (odds.h2h) {
      const [pH, pD, pA] = removeMarginShin([odds.h2h.home, odds.h2h.draw, odds.h2h.away].filter(Boolean));
      marketProbs.h2h = { home: pH, draw: pD, away: pA };
    }
    if (odds.btts) {
      const [pY, pN] = removeMarginShin([odds.btts.yes, odds.btts.no].filter(Boolean));
      marketProbs.btts = { yes: pY, no: pN };
    }
    if (odds.totals) {
      marketProbs.totals = {};
      Object.entries(odds.totals).forEach(([line, o]) => {
        if (o.over && o.under) {
          const [pO, pU] = removeMarginShin([o.over, o.under]);
          marketProbs.totals[line] = { over: pO, under: pU };
        }
      });
    }

    // Blend Bayesiano simple: 60% modelo, 40% mercado (priors)
    // Cuando hay menos datos del modelo, conviene confiar más en el mercado.
    const blendModel = opts.blendModel != null ? opts.blendModel : 0.6;
    const blendMarket = 1 - blendModel;
    function blend(mod, mkt) {
      if (!mod) return mkt;
      if (!mkt) return mod;
      const out = {};
      Object.keys(mod).forEach(k => {
        out[k] = typeof mod[k] === 'object'
          ? blend(mod[k], mkt[k])
          : (mod[k] * blendModel + (mkt[k] || mod[k]) * blendMarket);
      });
      return out;
    }
    const finalProbs = blend(modelProbs, marketProbs);

    // Derivar dc desde h2h si no está
    if (finalProbs.h2h && !finalProbs.dc) {
      finalProbs.dc = {
        home_or_draw: finalProbs.h2h.home + finalProbs.h2h.draw,
        draw_or_away: finalProbs.h2h.draw + finalProbs.h2h.away,
        home_or_away: finalProbs.h2h.home + finalProbs.h2h.away
      };
    }
    // Derivar dnb desde h2h
    if (finalProbs.h2h && !finalProbs.dnb) {
      const denom = finalProbs.h2h.home + finalProbs.h2h.away;
      if (denom > 0) {
        finalProbs.dnb = {
          home: finalProbs.h2h.home / denom,
          away: finalProbs.h2h.away / denom
        };
      }
    }

    return {
      ...match,
      modelProbs: finalProbs,
      rawModelProbs: modelProbs,
      marketProbs,
      lambdaH, lambdaA
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────────────────────

  global.BSEngine = {
    // Core probability
    poissonPMF, poissonCDF, bivariateGrid, deriveMarketsFromGrid,
    // Elo
    ELO,
    // Margin removal
    implied, overround, removeMarginMultiplicative, removeMarginShin,
    // EV / Kelly
    expectedValue, kellyFraction, kellyStake,
    // Surebet
    detectSurebet, findBestSurebet,
    // Correlation + combos
    areCorrelated, legCandidates, optimizeCombo, generateCombos,
    // Monte Carlo / What-If
    rng, monteCarloCombo, whatIfCombo,
    // CLV
    clv, aggregateClv,
    // Risk metrics
    sharpe, sortino, maxDrawdown,
    // Picks
    pickForMatch,
    // Pipeline
    modelMatch,
    // Constants
    CORRELATED_MARKETS
  };
})(typeof window !== 'undefined' ? window : globalThis);
