/* BetSafe — Quantitative core: Kelly, EV, Poisson, Monte Carlo, Elo, Markov, Sharpe */
(function (global) {
  'use strict';

  // ---- Odds conversion ----
  function decToImplied(d) { return d > 0 ? 1 / d : 0; }
  function decToAmerican(d) { return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1)); }
  function decToFractional(d) {
    if (d <= 1) return '0/1';
    const dec = d - 1;
    const denom = 100;
    let n = Math.round(dec * denom), m = denom;
    const g = gcd(n, m); return `${n / g}/${m / g}`;
  }
  function americanToDec(a) { return a >= 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1; }
  function fractionalToDec(s) { const [n, d] = String(s).split('/').map(Number); return n / d + 1; }
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  // No-vig fair odds (basic 2-way / 3-way)
  function noVigFair(odds) {
    const ip = odds.map(decToImplied);
    const sum = ip.reduce((a, b) => a + b, 0);
    return ip.map(x => 1 / (x / sum));
  }
  function overround(odds) {
    return odds.map(decToImplied).reduce((a, b) => a + b, 0) - 1;
  }

  // ---- Kelly ----
  // f* = (b*p - q) / b where b = decimal-1, p = win prob, q = 1-p
  function kelly(p, dec, fraction = 1) {
    const b = dec - 1;
    const f = (b * p - (1 - p)) / b;
    return Math.max(0, f * fraction);
  }
  // Half / Quarter Kelly helpers
  const halfKelly = (p, d) => kelly(p, d, 0.5);
  const quarterKelly = (p, d) => kelly(p, d, 0.25);

  // EV
  function ev(p, dec, stake = 1) { return stake * (p * (dec - 1) - (1 - p)); }
  function evMulti(probs, decs, stake = 1) {
    const p = probs.reduce((a, b) => a * b, 1);
    const d = decs.reduce((a, b) => a * b, 1);
    return ev(p, d, stake);
  }

  // ---- Arbitrage 2-way / 3-way ----
  function surebet(odds) {
    const inv = odds.map(o => 1 / o).reduce((a, b) => a + b, 0);
    return { isSure: inv < 1, margin: 1 - inv, roi: (1 - inv) * 100 };
  }
  function surebetStakes(odds, total = 1000) {
    const sum = odds.map(o => 1 / o).reduce((a, b) => a + b, 0);
    const stakes = odds.map(o => total * (1 / o) / sum);
    return { stakes, payout: stakes[0] * odds[0], profit: stakes[0] * odds[0] - total };
  }

  // Middling: 2 cuotas con líneas distintas
  function middling(odd1, odd2, stake1, stake2) {
    const winBoth = stake1 * odd1 + stake2 * odd2 - (stake1 + stake2);
    const winOne1 = stake1 * odd1 - stake1 - stake2;
    const winOne2 = stake2 * odd2 - stake1 - stake2;
    const loseBoth = -(stake1 + stake2);
    return { winBoth, winOne1, winOne2, loseBoth };
  }

  // ---- Poisson xG ----
  function poisson(k, lambda) { let p = Math.exp(-lambda); for (let i = 1; i <= k; i++) p *= lambda / i; return p; }
  function scoreMatrix(lambdaH, lambdaA, max = 5) {
    const m = []; let pHome = 0, pDraw = 0, pAway = 0, btts = 0, over25 = 0;
    for (let h = 0; h <= max; h++) { m[h] = []; for (let a = 0; a <= max; a++) {
      const p = poisson(h, lambdaH) * poisson(a, lambdaA);
      m[h][a] = p;
      if (h > a) pHome += p; else if (h < a) pAway += p; else pDraw += p;
      if (h > 0 && a > 0) btts += p;
      if (h + a > 2.5) over25 += p;
    } }
    return { matrix: m, pHome, pDraw, pAway, btts, over25 };
  }

  // ---- Elo ----
  function eloUpdate(rA, rB, scoreA, k = 32) {
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const newA = rA + k * (scoreA - eA);
    const newB = rB + k * ((1 - scoreA) - (1 - eA));
    return { rA: newA, rB: newB, eA };
  }

  // ---- Monte Carlo (deterministic LCG) ----
  function lcg(seed) { let s = seed >>> 0; return () => { s = (1103515245 * s + 12345) >>> 0; return (s & 0x7fffffff) / 0x7fffffff; }; }

  function monteCarlo({ legs, stake = 1000, runs = 1000, seed = 12345 }) {
    const rng = lcg(seed);
    const results = [];
    for (let i = 0; i < runs; i++) {
      let win = true;
      for (const leg of legs) { if (rng() > leg.p) { win = false; break; } }
      const dec = legs.reduce((a, b) => a * b.odd, 1);
      results.push(win ? stake * (dec - 1) : -stake);
    }
    results.sort((a, b) => a - b);
    const pct = q => results[Math.floor(q * (results.length - 1))];
    return {
      mean: results.reduce((a, b) => a + b, 0) / results.length,
      median: pct(0.5),
      p5: pct(0.05), p25: pct(0.25), p75: pct(0.75), p95: pct(0.95),
      hits: results.filter(r => r > 0).length,
      runs
    };
  }

  // ---- What-If enumeration of 2^N combinada outcomes ----
  function whatIf(legs, stake = 1000) {
    const N = legs.length;
    const out = [];
    for (let mask = 0; mask < (1 << N); mask++) {
      let prob = 1, dec = 1, allWin = true;
      for (let i = 0; i < N; i++) {
        const bit = (mask >> i) & 1;
        if (bit) { prob *= legs[i].p; dec *= legs[i].odd; }
        else { prob *= (1 - legs[i].p); allWin = false; }
      }
      out.push({ mask, prob, payout: allWin ? stake * dec : 0, profit: (allWin ? stake * dec : 0) - stake });
    }
    return out;
  }

  // ---- Markov streak projection ----
  function markovStreak(p, n = 10) {
    // p = prob of win. Returns expected longest streak in n trials.
    return Math.log(n) / Math.log(1 / (1 - p));
  }

  // ---- Sharpe / Sortino ----
  function sharpe(returns, rf = 0) {
    const mean = avg(returns) - rf;
    const sd = std(returns);
    return sd === 0 ? 0 : mean / sd;
  }
  function sortino(returns, rf = 0) {
    const mean = avg(returns) - rf;
    const downside = returns.filter(r => r < 0);
    const dd = std(downside);
    return dd === 0 ? 0 : mean / dd;
  }
  function maxDrawdown(equity) {
    let peak = equity[0] || 0, mdd = 0;
    for (const e of equity) { peak = Math.max(peak, e); mdd = Math.min(mdd, e - peak); }
    return mdd;
  }
  function avg(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
  function std(a) { const m = avg(a); return Math.sqrt(avg(a.map(x => (x - m) ** 2))); }

  // ---- Hedge / Lay / Free Bet ----
  function hedge(stakeA, oddA, oddB) {
    // To equalize profit on both sides
    const stakeB = (stakeA * oddA) / oddB;
    const profitA = stakeA * (oddA - 1) - stakeB;
    const profitB = stakeB * (oddB - 1) - stakeA;
    return { stakeB, profitA, profitB };
  }
  function lay(backStake, backOdd, layOdd, commission = 0.05) {
    const layStake = (backStake * backOdd) / (layOdd - commission);
    const liability = layStake * (layOdd - 1);
    return { layStake, liability };
  }
  function freeBetSnr(stake, odd) {
    // Stake-not-returned: profit = stake * (odd - 1)
    return stake * (odd - 1);
  }

  // ---- Dutching ----
  function dutch(odds, total = 1000) {
    const sum = odds.map(o => 1 / o).reduce((a, b) => a + b, 0);
    const stakes = odds.map(o => total * (1 / o) / sum);
    const profit = stakes[0] * odds[0] - total;
    return { stakes, profit };
  }

  // ---- CLV ----
  function clv(closingProb, takenOdd) {
    const takenP = 1 / takenOdd;
    return ((closingProb - takenP) / takenP) * 100; // %
  }

  // ---- Risk Score ----
  function riskScore(odd, prob, stakeRatio) {
    const overR = (1 / prob) - odd;
    const sizing = Math.min(1, stakeRatio * 10);
    return Math.max(0, Math.min(100, Math.round(50 + overR * 30 + sizing * 20)));
  }

  // ---- Pythagorean win ---- (exponent depends on sport)
  function pythagorean(scored, allowed, exp = 2) {
    return Math.pow(scored, exp) / (Math.pow(scored, exp) + Math.pow(allowed, exp));
  }

  // ---- Drawdown estimator (95% CI) ----
  function drawdownEstimate(p, edge, n) {
    // Approx via geometric Brownian motion
    const sigma = Math.sqrt(p * (1 - p));
    return -1.96 * sigma * Math.sqrt(n) + edge * n;
  }

  global.BSMath = {
    decToImplied, decToAmerican, decToFractional, americanToDec, fractionalToDec,
    noVigFair, overround,
    kelly, halfKelly, quarterKelly, ev, evMulti,
    surebet, surebetStakes, middling,
    poisson, scoreMatrix,
    eloUpdate, monteCarlo, whatIf, markovStreak,
    sharpe, sortino, maxDrawdown,
    hedge, lay, freeBetSnr, dutch,
    clv, riskScore, pythagorean, drawdownEstimate,
    lcg
  };
})(window);
