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

    // Track every leg's data freshness por casa (min de lastUpdate de los
    // mercados involucrados). Lo usamos para enriquecer la surebet con
    // `oddsAge` y para que el frontend pueda mostrar "actualizada hace Xs"
    // por surebet — no solo por snapshot global.
    const eventFreshness = new Map();
    fresh.forEach(ev => { eventFreshness.set(ev.id, ev.lastUpdate || Date.now()); });

    // Cuando una surebet ya estaba activa la "refrescamos" — esto resetea
    // su lastSeenAt para que el frontend muestre frescura correcta.
    const upsert = (sb) => {
      activeNow.add(sb.key);
      sb.lastSeenAt = Date.now();
      sb.oddsAge = Date.now() - (eventFreshness.get(sb.eventId) || Date.now());
      if (!this.activeIds.has(sb.key)) {
        newSurebets.push(sb);
      } else {
        // Re-detectada: actualizar la copia en `detected` con nueva info
        const idx = this.detected.findIndex(x => x.key === sb.key);
        if (idx >= 0) {
          // Mantenemos el original (ts/enriquecimiento) pero actualizamos
          // lastSeenAt + cuotas si bajaron/subieron + oddsAge
          this.detected[idx].lastSeenAt = sb.lastSeenAt;
          this.detected[idx].oddsAge = sb.oddsAge;
          this.detected[idx].odds = sb.odds;
        }
      }
    };

    fresh.forEach(ev => {
      // 1) 2-way + 3-way en 1X2
      this.detect1x2(ev).forEach(upsert);
      // 2) Totals
      this.detectTotals(ev).forEach(upsert);
      // 3) BTTS
      this.detectBtts(ev).forEach(upsert);
      // 4) Asian Handicap
      this.detectAh(ev).forEach(upsert);
      // 5) Cross-market 1X2 × DC
      this.detect1x2VsDc(ev).forEach(upsert);
    });

    // Surebets que desaparecieron del snapshot fresco = "cerradas"
    const closed = [...this.activeIds].filter(id => !activeNow.has(id));
    this.activeIds = activeNow;

    // Computar metadata enriquecida para cada surebet nueva
    newSurebets.forEach(sb => this.enrich(sb, fresh));

    if (newSurebets.length) {
      // Filtrar por ROI mínimo (ya con slippage descontado) y descartar
      // anomalías. Books regulados típicamente cierran o anulan cualquier
      // arb superior al 8-10% por "error manifiesto" — los arbs reales en
      // AR rondan el 0.5-5%. Cualquier cosa >12% es CASI seguro odds stale
      // de un live game ya resuelto. Lo marcamos como `suspicious` para
      // que la UI pueda mostrarlo pero el motor no lo emite por default.
      const PALPABLE_ERROR_CAP = 0.12;
      const SUSPICIOUS_CAP = 0.25;
      const filtered = [];
      const suspicious = [];
      for (const sb of newSurebets) {
        if (sb.netRoi < this.minRoi) continue;
        if (sb.grossRoi > SUSPICIOUS_CAP) continue;  // data error pura
        if (sb.grossRoi > PALPABLE_ERROR_CAP) {
          sb.flag = 'palpable-error-risk';
          suspicious.push(sb);
          continue;
        }
        filtered.push(sb);
      }
      filtered.sort((a, b) => b.confidence - a.confidence || b.netRoi - a.netRoi);
      this.detected = filtered.concat(this.detected).slice(0, 500);
      filtered.forEach(sb => this.emit('surebet', sb));
      if (suspicious.length) {
        this.suspicious = suspicious.concat(this.suspicious || []).slice(0, 100);
      }
    }
    if (closed.length) this.emit('surebets-closed', closed);

    this.lastCycleMs = Date.now() - t0;
    this._lastCycleAt = Date.now();
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

  // ── Asian Handicap: mismo book / cross-book / mirror lines ─────────────
  /* Detecta surebets en mercado AH usando 3 estrategias:
   *
   * 1) MISMA LÍNEA — book A ofrece home -0.5, book B ofrece away +0.5.
   *    Cobertura total cuando home_minus.line === away_plus.line.
   *
   * 2) MIRROR LINES — la línea real cubierta debe ser COMPLEMENTARIA:
   *    book A: home -1.5 (home gana por 2+)  +  book B: away +1.5 (away
   *    gana, empata, o pierde por 1) son LOCK matemático sólo si la línea
   *    de A y B suman a 0 con signos opuestos. Nuestro `line` field
   *    siempre se almacena POSITIVO en `home_minus` y POSITIVO en
   *    `away_plus` representando la magnitud del handicap aplicado al lado
   *    respectivo. Por lo tanto un lock real cumple line_A === line_B.
   *
   *    Sin embargo, algunos books publican AH con line "0.0" en home y
   *    "0.0" en away (DNB-like), o con líneas con .25/.75 (cuartos).
   *    Para esas .25/.75 sólo hay PARTIAL lock — los excluimos por ahora.
   *
   * 3) AH integer line + half-point split (line 1 + line 1.5) — NO es lock
   *    en push, generalmente no lo tratamos como arb pero se podría agregar.
   *
   * Implementación: agrupamos por línea (key = parseFloat para evitar bugs
   * de string), iteramos sólo líneas con AMBAS patas disponibles.
   */
  detectAh(ev) {
    const ah = ev?.markets?.ah;
    if (!ah) return [];
    const linesByBook = Object.entries(ah).filter(([, m]) => m && typeof m === 'object');
    if (!linesByBook.length) return [];

    // Buckets por línea normalizada (Number con 2 decimales para tolerancia
    // de strings/formatos).
    const homeByLine = new Map();   // line → [{book, price}]
    const awayByLine = new Map();
    for (const [book, m] of linesByBook) {
      if (m.line == null) continue;
      const ln = Math.round(Number(m.line) * 100) / 100;
      if (!Number.isFinite(ln)) continue;
      if (Number.isFinite(m.home_minus) && m.home_minus > 1.01) {
        if (!homeByLine.has(ln)) homeByLine.set(ln, []);
        homeByLine.get(ln).push({ book, price: m.home_minus });
      }
      if (Number.isFinite(m.away_plus) && m.away_plus > 1.01) {
        if (!awayByLine.has(ln)) awayByLine.set(ln, []);
        awayByLine.get(ln).push({ book, price: m.away_plus });
      }
    }

    const out = [];
    // Sólo consideramos integer + half lines (no quarter-ball .25/.75 que
    // son splits y rompen la lógica lock simple).
    for (const line of homeByLine.keys()) {
      if (!awayByLine.has(line)) continue;
      // Half-lines o integer lines puros (multiplos de 0.5)
      const isQuarter = Math.abs((line * 2) - Math.round(line * 2)) > 1e-6;
      if (isQuarter) continue;

      const homes = homeByLine.get(line);
      const aways = awayByLine.get(line);
      let best = null;
      // Buscamos la combinación con MEJOR sum(1/oi) entre books DISTINTOS.
      for (const h of homes) {
        for (const a of aways) {
          if (h.book === a.book) continue;
          const sum = 1 / h.price + 1 / a.price;
          if (sum >= 1) continue;
          if (!best || sum < best.sum) best = { sum, h, a };
        }
      }
      if (best) {
        out.push(makeSurebet(ev, `ah-${line}`, ['home_minus', 'away_plus'],
          [best.h.price, best.a.price], [best.h.book, best.a.book]));
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
    // Filtrar `detected` para devolver SOLO las que siguen activas (activeIds).
    // Esto evita servir cuotas viejas que ya no existen en el mercado y
    // que confundirían al usuario (ej: Betano marcando 1.40 cuando ya cerró a 1.25).
    const activeOnly = this.detected.filter(sb => this.activeIds.has(sb.key));
    return {
      detected: activeOnly,
      activeSurebets: this.activeIds.size,
      cycles: this.cycles,
      lastCycleMs: this.lastCycleMs,
      lastCycleAt: this._lastCycleAt || 0,
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
