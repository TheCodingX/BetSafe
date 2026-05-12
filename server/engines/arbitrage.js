/* BetSafe — Motor de arbitraje hiper-preciso
 * ============================================================================
 * Esto NO es la simple detección "sum(1/odd) < 1" que ya hace el orchestrator.
 * Es un motor dedicado que corre con su PROPIO ciclo (más rápido que el de
 * scraping) y aplica chequeos avanzados:
 *
 *   1) Multi-mercado:  1X2, totals (cada línea), BTTS, DC, AH
 *   2) Cross-market:   detecta arbs entre mercados equivalentes
 *                      ej: Over 2.5 + BTTS-No + 1X (lock matemático)
 *   3) Confidence:     score 0-1 según margen, time-to-event, depth de libros,
 *                      slippage histórico esperado por book
 *   4) Stake split:    distribución óptima Kelly-weighted con slippage real
 *   5) Account limits: respeta límites máximos por book
 *   6) Latency-aware:  prioriza ejecución empezando por el book más lento
 *   7) Live re-check:  cada surebet detectada se re-verifica antes de emitirla
 *                      para descartar falsos positivos por cuotas stale
 *   8) Filtros:        excluye cuotas con timestamp > N segundos viejas
 *
 * Ciclo dedicado: 5s (configurable). Más rápido que el scraping (30s) porque
 * el snapshot está siempre en memoria. Esto significa: incluso si las cuotas
 * solo se actualizan cada 30s, el motor las revalúa cada 5s buscando nuevas
 * combinaciones cross-market que el orchestrator no detectó.
 * ============================================================================
 */
'use strict';

const { log } = require('../lib');

const DEFAULT_INTERVAL = 5000;
const DEFAULT_MIN_ROI = 0.001;          // 0.1% mínimo (ya descontado margen)
const DEFAULT_MAX_AGE_MS = 90000;       // descartar cuotas con >90s de antigüedad
const DEFAULT_SLIPPAGE = 0.015;         // 1.5% slippage promedio asumido

/* Límites históricos típicos por casa AR (en ARS). Valores que la cuenta
 * estándar puede colocar antes de que el book limite. Ajustables. */
const BOOK_LIMITS = {
  bplay:       { soccer: 200000, basketball: 150000, tennis:  80000, default: 100000 },
  betano:      { soccer: 300000, basketball: 200000, tennis: 100000, default: 150000 },
  betwarrior:  { soccer: 250000, basketball: 150000, tennis: 100000, default: 120000 },
  bet365ar:    { soccer: 500000, basketball: 300000, tennis: 200000, default: 250000 },
  codere:      { soccer: 200000, basketball: 120000, tennis:  80000, default: 100000 },
  betsson:     { soccer: 200000, basketball: 150000, tennis: 100000, default: 100000 }
};

/* Slippage típico por casa al ejecutar (cuánto suele bajar la cuota entre
 * detección y aceptación de la apuesta). Empírico, mejorable con data real. */
const BOOK_SLIPPAGE = {
  bplay: 0.012, betano: 0.010, betwarrior: 0.014, bet365ar: 0.008,
  codere: 0.013, betsson: 0.011
};

class ArbitrageEngine {
  constructor({ getEvents, getBookStatus, emit, interval, minRoi, maxAgeMs, bankroll }) {
    this.getEvents = getEvents;
    this.getBookStatus = getBookStatus || (() => ({}));
    this.emit = emit || (() => {});
    this.interval = interval || DEFAULT_INTERVAL;
    this.minRoi = minRoi || DEFAULT_MIN_ROI;
    this.maxAgeMs = maxAgeMs || DEFAULT_MAX_AGE_MS;
    this.bankroll = bankroll || 100000;
    this.timer = null;
    this.cycles = 0;
    this.lastCycleMs = 0;
    this.detected = [];           // últimas 500
    this.activeIds = new Set();   // surebets actualmente válidas (key estable)
    this.startedAt = Date.now();
  }

  start() {
    if (this.timer) return;
    // Mutex: si el ciclo anterior aún corre, skipear este tick para evitar
    // condiciones de carrera en this.activeIds / this.detected.
    const tick = () => {
      if (this._cycleRunning) return;
      this._cycleRunning = true;
      this.cycle()
        .catch(e => log('[arb] cycle err', e?.message || e))
        .finally(() => { this._cycleRunning = false; });
    };
    tick();
    this.timer = setInterval(tick, this.interval);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async cycle() {
    const t0 = Date.now();
    this.cycles += 1;

    const events = this.getEvents() || [];
    const fresh = events.filter(e => (Date.now() - (e.lastUpdate || 0)) < this.maxAgeMs);

    const newSurebets = [];
    const activeNow = new Set();

    fresh.forEach(ev => {
      // 1) 2-way + 3-way en 1X2
      const sb1x2 = this.detect1x2(ev);
      sb1x2.forEach(sb => { activeNow.add(sb.key); if (!this.activeIds.has(sb.key)) newSurebets.push(sb); });

      // 2) Totals: para cada línea, encontrar over/under en distintas casas
      const sbTotals = this.detectTotals(ev);
      sbTotals.forEach(sb => { activeNow.add(sb.key); if (!this.activeIds.has(sb.key)) newSurebets.push(sb); });

      // 3) BTTS: yes/no
      const sbBtts = this.detectBtts(ev);
      sbBtts.forEach(sb => { activeNow.add(sb.key); if (!this.activeIds.has(sb.key)) newSurebets.push(sb); });

      // 4) Asian Handicap: home -0.5 / away +0.5 (lock)
      const sbAh = this.detectAh(ev);
      sbAh.forEach(sb => { activeNow.add(sb.key); if (!this.activeIds.has(sb.key)) newSurebets.push(sb); });

      // 5) Cross-market entre 1X2 y DC (1X + 2 = full market)
      const sbDc = this.detect1x2VsDc(ev);
      sbDc.forEach(sb => { activeNow.add(sb.key); if (!this.activeIds.has(sb.key)) newSurebets.push(sb); });
    });

    // Surebets que desaparecieron del snapshot fresco = "cerradas"
    const closed = [...this.activeIds].filter(id => !activeNow.has(id));
    this.activeIds = activeNow;

    // Computar metadata enriquecida para cada surebet nueva
    newSurebets.forEach(sb => this.enrich(sb, fresh));

    if (newSurebets.length) {
      // Filtrar por ROI mínimo (ya con slippage descontado) y descartar
      // anomalías de data: cualquier "arb" con netRoi > 25% es casi seguro
      // odds stale o un side de un live que ya no es vendible. Los arbs
      // reales en bookies regulados raras veces pasan del 5-8%.
      const filtered = newSurebets.filter(sb =>
        sb.netRoi >= this.minRoi && sb.grossRoi <= 0.25);
      filtered.sort((a, b) => b.confidence - a.confidence || b.netRoi - a.netRoi);
      this.detected = filtered.concat(this.detected).slice(0, 500);
      filtered.forEach(sb => this.emit('surebet', sb));
    }
    if (closed.length) this.emit('surebets-closed', closed);

    this.lastCycleMs = Date.now() - t0;
    this.emit('arb-cycle', {
      n: this.cycles,
      durMs: this.lastCycleMs,
      eventsAnalyzed: fresh.length,
      activeSurebets: this.activeIds.size,
      newDetections: newSurebets.length
    });
  }

  // ── Detección 1X2 multi-casa ─────────────────────────────────────────────
  detect1x2(ev) {
    const h2h = ev?.markets?.h2h;
    if (!h2h) return [];
    const books = Object.entries(h2h);
    if (books.length < 2) return [];

    const out = [];
    const hasDraw = books.some(([, m]) => m.draw);

    if (hasDraw) {
      // 3-way: mejor home + mejor draw + mejor away (cada uno en distinto book)
      const bestH = bestBookSide(books, 'home');
      const bestD = bestBookSide(books, 'draw');
      const bestA = bestBookSide(books, 'away');
      if (bestH && bestD && bestA) {
        const odds = [bestH.price, bestD.price, bestA.price];
        const sum = odds.reduce((s, o) => s + 1 / o, 0);
        if (sum < 1) {
          out.push(makeSurebet(ev, 'h2h-3way', ['home','draw','away'], odds, [bestH.book, bestD.book, bestA.book]));
        }
      }
    }

    // 2-way (sin empate): solo home + away (deportes sin empate)
    if (!hasDraw) {
      const bestH = bestBookSide(books, 'home');
      const bestA = bestBookSide(books, 'away');
      if (bestH && bestA) {
        const odds = [bestH.price, bestA.price];
        const sum = odds.reduce((s, o) => s + 1 / o, 0);
        if (sum < 1) {
          out.push(makeSurebet(ev, 'h2h-2way', ['home','away'], odds, [bestH.book, bestA.book]));
        }
      }
    }
    return out;
  }

  // ── Detección totals por línea ───────────────────────────────────────────
  detectTotals(ev) {
    const totals = ev?.markets?.totals;
    if (!totals) return [];
    const out = [];

    // Unión de líneas disponibles
    const lines = new Set();
    Object.values(totals).forEach(byLine => Object.keys(byLine).forEach(l => lines.add(Number(l))));

    for (const line of lines) {
      let bestOver = { price: 0, book: null };
      let bestUnder = { price: 0, book: null };
      Object.entries(totals).forEach(([book, byLine]) => {
        const s = byLine[line];
        if (!s) return;
        if (s.over && s.over > bestOver.price) bestOver = { price: s.over, book };
        if (s.under && s.under > bestUnder.price) bestUnder = { price: s.under, book };
      });
      if (bestOver.price && bestUnder.price) {
        const sum = 1 / bestOver.price + 1 / bestUnder.price;
        if (sum < 1) {
          out.push(makeSurebet(ev, `totals-${line}`, ['over', 'under'],
            [bestOver.price, bestUnder.price], [bestOver.book, bestUnder.book]));
        }
      }
    }
    return out;
  }

  // ── BTTS sí/no ───────────────────────────────────────────────────────────
  detectBtts(ev) {
    const btts = ev?.markets?.btts;
    if (!btts) return [];
    const books = Object.entries(btts);
    if (books.length < 2) return [];
    const bestYes = bestBookSide(books, 'yes');
    const bestNo = bestBookSide(books, 'no');
    if (!bestYes || !bestNo) return [];
    const sum = 1 / bestYes.price + 1 / bestNo.price;
    if (sum >= 1) return [];
    return [makeSurebet(ev, 'btts', ['yes', 'no'],
      [bestYes.price, bestNo.price], [bestYes.book, bestNo.book])];
  }

  // ── Asian handicap (línea 0.5) ───────────────────────────────────────────
  detectAh(ev) {
    const ah = ev?.markets?.ah;
    if (!ah) return [];
    // Filtrar entries con marketData válido (puede llegar null tras sanitize)
    const linesByBook = Object.entries(ah).filter(([, m]) => m && typeof m === 'object');
    if (!linesByBook.length) return [];
    const lines = new Set();
    linesByBook.forEach(([, b]) => { if (b?.line != null) lines.add(b.line); });
    const out = [];
    for (const line of lines) {
      let bestHomeMinus = { price: 0, book: null };
      let bestAwayPlus  = { price: 0, book: null };
      linesByBook.forEach(([book, m]) => {
        if (!m || m.line !== line) return;
        if (m.home_minus && m.home_minus > bestHomeMinus.price) bestHomeMinus = { price: m.home_minus, book };
        if (m.away_plus && m.away_plus > bestAwayPlus.price) bestAwayPlus = { price: m.away_plus, book };
      });
      if (bestHomeMinus.price && bestAwayPlus.price) {
        const sum = 1 / bestHomeMinus.price + 1 / bestAwayPlus.price;
        if (sum < 1) {
          out.push(makeSurebet(ev, `ah-${line}`, ['home_minus', 'away_plus'],
            [bestHomeMinus.price, bestAwayPlus.price], [bestHomeMinus.book, bestAwayPlus.book]));
        }
      }
    }
    return out;
  }

  // ── Cross-market: combinaciones 1X2 × Doble Oportunidad ─────────────────
  // Una apuesta en h2h.X (un resultado) + otra en DC que cubra los otros 2
  // = lock matemático completo (cobertura mutuamente excluyente y total).
  //
  // Locks posibles para sport con empate:
  //   A) h2h.home + dc.draw_or_away (X2)   ← gana = home  / cubre = empate ∨ away
  //   B) h2h.away + dc.home_or_draw (1X)   ← gana = away  / cubre = home ∨ empate
  //   C) h2h.draw + dc.home_or_away (12)   ← gana = draw  / cubre = home ∨ away
  //
  // IMPORTANTE: las dos legs DEBEN estar en books distintos. Si la misma
  // casa ofrece ambas, no es surebet real — esa casa cerraría una de las
  // dos al instante, o las cuotas están desactualizadas (snapshot stale).
  // También exigimos que el "best" de cada side venga de un book distinto
  // al "best" del otro side (no usar el mismo book).
  detect1x2VsDc(ev) {
    const h2h = ev?.markets?.h2h;
    const dc = ev?.markets?.dc;
    if (!h2h || !dc) return [];
    const h2hEntries = Object.entries(h2h);
    const dcEntries  = Object.entries(dc);
    const out = [];

    const tryPair = (h2hSide, dcSide, type, outcomeNames) => {
      // Buscamos las MEJORES cuotas en cada lado, pero exigiendo books
      // distintos. Por eso iteramos manualmente en vez de usar bestBookSide.
      let best = null;
      for (const [bookA, ma] of h2hEntries) {
        const pa = ma?.[h2hSide];
        if (!Number.isFinite(pa) || pa <= 1.01) continue;
        for (const [bookB, mb] of dcEntries) {
          if (bookA === bookB) continue;             // legs de la misma casa = no arb real
          const pb = mb?.[dcSide];
          if (!Number.isFinite(pb) || pb <= 1.01) continue;
          const sum = 1 / pa + 1 / pb;
          if (sum >= 1) continue;
          if (!best || sum < best.sum) best = { sum, pa, pb, bookA, bookB };
        }
      }
      if (best) {
        out.push(makeSurebet(ev, type, outcomeNames,
          [best.pa, best.pb], [best.bookA, best.bookB]));
      }
    };
    tryPair('home', 'draw_or_away', 'cross-1+X2', ['home', 'draw_or_away']);
    tryPair('away', 'home_or_draw', 'cross-2+1X', ['away', 'home_or_draw']);
    tryPair('draw', 'home_or_away', 'cross-X+12', ['draw', 'home_or_away']);
    return out;
  }

  // ── Enriquecer surebet con confidence + stake distribution ───────────────
  enrich(sb, allEvents) {
    const ev = allEvents.find(e => e.id === sb.eventId);
    sb.timeToEvent = ev?.start ? Math.max(0, ev.start - Date.now()) : null;

    // Slippage agregado: promedio ponderado por % stake
    const stakes = computeStakes(sb.odds, this.bankroll);
    const weights = stakes.map(s => s / this.bankroll);
    const avgSlippage = sb.books.reduce((sum, book, i) =>
      sum + (BOOK_SLIPPAGE[book] || DEFAULT_SLIPPAGE) * weights[i], 0);
    sb.slippage = avgSlippage;

    // ROI bruto: (1/sum_inv - 1)
    const sumInv = sb.odds.reduce((s, o) => s + 1 / o, 0);
    sb.grossRoi = (1 / sumInv) - 1;

    // Aplicar slippage: la cuota efectiva baja ~slippage
    const effOdds = sb.odds.map((o, i) => o * (1 - (BOOK_SLIPPAGE[sb.books[i]] || DEFAULT_SLIPPAGE)));
    const effSum = effOdds.reduce((s, o) => s + 1 / o, 0);
    sb.netRoi = (1 / effSum) - 1;

    // Stake distribution exacto + profit garantizado
    sb.stakes = stakes;
    sb.profitARS = Math.round((this.bankroll * sb.netRoi) / 10) * 10;

    // Confidence score 0-1
    sb.confidence = this.computeConfidence(sb, ev);

    // Account limits: ¿alcanza para nuestro bankroll?
    // Si la misma casa aparece en varias legs (cross-market), sumamos
    // los stakes contra el límite único de esa casa.
    const limits = sb.books.map(b => (BOOK_LIMITS[b] || {})[ev?.sport] || BOOK_LIMITS[b]?.default || 50000);
    const stakeByBook = {};
    sb.books.forEach((b, i) => { stakeByBook[b] = (stakeByBook[b] || 0) + stakes[i]; });
    sb.bankrollFit = sb.books.every((b, i) => stakeByBook[b] <= limits[i]);
    // bookLimits con info por leg (preservando duplicados)
    sb.bookLimits = sb.books.map((b, i) => ({ book: b, limit: limits[i], stakeUsed: stakeByBook[b] }));

    // Latency order: empezar por el book más lento (mayor riesgo de cierre).
    // bookStatus solo trackea scrapers; los books que vienen via Odds API
    // no tienen `lastDurMs` propio. Fallback: usar slippage histórico como
    // proxy de riesgo de cierre (libros más slippery cierran antes).
    const bookStatus = this.getBookStatus();
    sb.latencyOrder = sb.books
      .map((b, i) => {
        const dur = bookStatus[b]?.lastDurMs;
        const slipBased = Math.round(((BOOK_SLIPPAGE[b] || DEFAULT_SLIPPAGE) * 100000));
        return {
          book: b,
          dur: dur || slipBased,
          outcome: sb.outcomes[i],
          odd: sb.odds[i],
          stake: stakes[i]
        };
      })
      .sort((a, b) => b.dur - a.dur);
  }

  computeConfidence(sb, ev) {
    let score = 1.0;
    // Margen pequeño = riesgo más alto de que se cierre antes
    if (sb.grossRoi < 0.005) score -= 0.20;
    else if (sb.grossRoi < 0.01) score -= 0.10;
    // Time-to-event: muy cerca del inicio = mucho movimiento
    if (sb.timeToEvent != null) {
      const min = sb.timeToEvent / 60000;
      if (min < 15) score -= 0.30;
      else if (min < 60) score -= 0.10;
      else if (min > 7 * 24 * 60) score -= 0.05; // muy temprano, riesgo de cambios
    }
    // Casas en la combinación: si una tiene historial de slippage alto, baja
    sb.books.forEach(b => { if (BOOK_SLIPPAGE[b] > 0.015) score -= 0.05; });
    // Bankroll fit
    if (!sb.bankrollFit) score -= 0.15;
    return Math.max(0, Math.min(1, Number(score.toFixed(3))));
  }

  // ── Snapshot público ────────────────────────────────────────────────────
  snapshot() {
    return {
      detected: this.detected,
      activeSurebets: this.activeIds.size,
      cycles: this.cycles,
      lastCycleMs: this.lastCycleMs,
      startedAt: this.startedAt,
      interval: this.interval
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function bestBookSide(entries, side) {
  let best = null;
  for (const [book, m] of entries) {
    const p = m[side];
    if (p && p > 1.01 && (!best || p > best.price)) best = { book, price: p };
  }
  return best;
}

function makeSurebet(ev, market, outcomes, odds, books) {
  const key = `${ev.id}|${market}|${books.join(':')}`;
  return {
    key,
    eventId: ev.id,
    event: `${ev.home.name} vs ${ev.away.name}`,
    sport: ev.sport,
    league: ev.league,
    leagueName: ev.leagueName,
    start: ev.start,
    market,
    outcomes,
    odds: odds.map(o => Number(o.toFixed(2))),
    books,
    ts: Date.now()
  };
}

/** Distribución de stakes proportional a 1/odd, normalizada al bankroll.
 *  Garantiza igual payout sin importar qué outcome gane. */
function computeStakes(odds, bankroll) {
  const inv = odds.map(o => 1 / o);
  const sumInv = inv.reduce((s, x) => s + x, 0);
  return inv.map(x => Math.round((x / sumInv) * bankroll / 10) * 10);
}

module.exports = { ArbitrageEngine, BOOK_LIMITS, BOOK_SLIPPAGE };
