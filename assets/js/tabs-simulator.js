/* BetSafe — Simulador (refactor 2026-05)
 * ────────────────────────────────────────────────────────────────────────────
 * Simulación PROFESIONAL de apuestas con dinero ficticio.
 *
 * Flujo:
 *   1) Usuario configura banca + nivel de riesgo
 *   2) IA recomienda combinadas REALES del motor (/api/curated-combos)
 *      basadas en partidos del día con cuotas vivas
 *   3) Usuario elige una y "simula" la apuesta → queda en estado PENDIENTE
 *   4) Cuando el partido termina (start + 2.5h), el sistema resuelve la
 *      apuesta usando probabilidad implícita de la cuota (con varianza
 *      realista). Auto-update de banca + métricas.
 *
 * Estados de cada apuesta:
 *   - 'pending'   : el partido aún no empezó / no terminó
 *   - 'won'       : ganó (todas las legs)
 *   - 'lost'      : perdió (al menos 1 leg falló)
 *
 * Persistencia: localStorage `bs:simulator:v2`
 * ────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const STORE_KEY = 'bs:simulator:v2';
  const RESOLUTION_DELAY_MS = 2.5 * 60 * 60 * 1000;  // 2.5h después del start

  function load() {
    const d = BSStore.get(STORE_KEY);
    if (d && typeof d === 'object') return d;
    return {
      bankroll: 100000,
      initial: 100000,
      risk: 'eq',          // cons / eq / agg
      bets: [],            // [{id, ts, combo, stake, status, resolvedAt, payout, profit, balanceAfter, legs[]}]
      wins: 0,
      losses: 0
    };
  }
  function save(s) { BSStore.set(STORE_KEY, s); }

  /* RESOLVER APUESTAS PENDIENTES
   * Cada apuesta pendiente cuyo último start + 2.5h pasó se resuelve.
   * Para cada leg: roll vs probabilidad implícita (con +5% varianza).
   * Si TODAS las legs ganan, combo gana. Si falla 1+, pierde. */
  function resolvePendingBets(state) {
    const now = Date.now();
    let changed = false;
    for (const bet of state.bets) {
      if (bet.status !== 'pending') continue;
      const lastStart = Math.max(...(bet.legs || []).map(l => l.start || 0).filter(Boolean), 0);
      if (!lastStart || now < lastStart + RESOLUTION_DELAY_MS) continue;

      // Resolver cada leg con probabilidad implícita
      // baseProb = confidence si existe, sino 1/odd
      let allWon = true;
      const resolvedLegs = (bet.legs || []).map(l => {
        const baseProb = Number.isFinite(l.confidence) ? l.confidence : (1 / Math.max(1.01, l.odd || 2));
        // Varianza: ±5% sobre la prob base (mercado real no es perfectamente eficiente)
        const noise = (Math.random() - 0.5) * 0.10;
        const adjustedProb = Math.max(0.05, Math.min(0.97, baseProb + noise));
        const won = Math.random() < adjustedProb;
        if (!won) allWon = false;
        return { ...l, _won: won };
      });
      bet.legs = resolvedLegs;
      bet.status = allWon ? 'won' : 'lost';
      bet.resolvedAt = now;
      if (allWon) {
        bet.payout = Math.round(bet.stake * (bet.combo?.totalOdd || 1));
        bet.profit = bet.payout - bet.stake;
        state.bankroll += bet.profit;
        state.wins++;
      } else {
        bet.payout = 0;
        bet.profit = -bet.stake;
        state.bankroll += bet.profit;
        state.losses++;
      }
      bet.balanceAfter = state.bankroll;
      changed = true;
    }
    return changed;
  }

  /* Cargar combinadas recomendadas REALES del motor (/api/curated-combos) */
  async function fetchRecommendedCombos(risk) {
    try {
      // /api/curated-combos devuelve combinadas reales con análisis IA.
      // Si /api/generator está habilitado, usamos el endpoint que más datos da.
      const url = `/api/generator`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: 'soccer',
          risk: risk || 'eq',
          legs: 3,
          count: 5,
          useAiBuilder: false
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return Array.isArray(data?.combos) ? data.combos : [];
    } catch (e) {
      console.warn('[simulator] error cargando combos:', e?.message);
      return [];
    }
  }

  async function render(panel) {
    if (!BSData.liveReady()) {
      panel.innerHTML = renderLoadingState();
      await BSData.awaitLive({ timeoutMs: 12000 });
    }

    const state = load();
    // Resolver apuestas pendientes al entrar
    if (resolvePendingBets(state)) save(state);

    // Render layout principal
    panel.innerHTML = renderLayout(state);

    // Cargar combos recomendados en background
    const combosHost = panel.querySelector('#simCombos');
    combosHost.innerHTML = renderCombosLoading();
    const combos = await fetchRecommendedCombos(state.risk);
    combosHost.innerHTML = combos.length
      ? combos.map((c, i) => renderComboCard(c, i, state)).join('')
      : renderCombosEmpty();

    // Bindings
    bindControls(panel, state);
    bindComboActions(panel, state, combos);
    bindMyBetsActions(panel, state);
    drawEvolution(panel.querySelector('#simChart'), state);
  }

  /* ═══════ TEMPLATES ═══════ */

  function renderLoadingState() {
    return `<div class="card stack" style="min-height:240px;padding:40px;text-align:center">
      <strong>Cargando partidos del día…</strong>
      <p class="muted tiny">Conectando con las casas legales argentinas.</p>
    </div>`;
  }

  function renderLayout(state) {
    const grandTotal = state.bankroll - state.initial;
    const trades = state.wins + state.losses;
    const winRate = trades ? (state.wins / trades) * 100 : 0;
    const roiPct = ((state.bankroll - state.initial) / state.initial) * 100;
    const pending = state.bets.filter(b => b.status === 'pending').length;

    return `
      <!-- HERO ─────────────────────────────────────────────────────── -->
      <header class="sim-hero reveal" style="background:linear-gradient(135deg, rgba(30,75,200,.06), rgba(255,193,7,.04));border:1px solid var(--border);border-radius:16px;padding:24px 26px;margin-bottom:20px">
        <div class="row between" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
          <div>
            <span class="badge" style="background:var(--brand-500);color:white;margin-bottom:6px;display:inline-block">SIMULADOR</span>
            <h2 class="h3" style="margin:0;font-size:1.4rem">Probá tus estrategias con dinero ficticio</h2>
            <p class="muted tiny" style="margin-top:6px;line-height:1.5;max-width:580px">
              La IA analiza los partidos del día y te recomienda combinadas reales.
              Vos elegís cuál "simular" — el sistema resuelve las apuestas cuando terminan
              los partidos y trackeá tu evolución sin arriesgar plata real.
            </p>
          </div>
          <button class="btn btn-outline btn-sm" id="simReset">
            ${BSIcons.svg('refresh', { size: 14 })} Reiniciar banca
          </button>
        </div>
      </header>

      <!-- KPI GRID ─────────────────────────────────────────────────── -->
      <div class="grid grid-4 reveal-stagger" style="gap:14px;margin-bottom:20px">
        ${kpiCard('Banca actual', BSUI.money(state.bankroll), `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}%`, roiPct >= 0 ? 'up' : 'down')}
        ${kpiCard('Profit total', `${grandTotal >= 0 ? '+' : ''}${BSUI.money(grandTotal)}`, `desde ${BSUI.money(state.initial)}`, grandTotal >= 0 ? 'up' : 'down')}
        ${kpiCard('Win rate', `${winRate.toFixed(1)}%`, `${state.wins}W · ${state.losses}L`, '')}
        ${kpiCard('Apuestas activas', `${pending}`, trades === 0 && pending === 0 ? 'Empezá ahora' : `${trades} resueltas`, '')}
      </div>

      <!-- BANCA + CHART ────────────────────────────────────────────── -->
      <div class="sim-banca-grid" style="display:grid;grid-template-columns: 320px 1fr;gap:18px;margin-bottom:22px">
        <div class="card stack" style="padding:18px">
          <strong style="font-size:.95rem">Configuración</strong>
          <div>
            <label class="muted tiny" style="display:block;margin-bottom:4px">Banca ficticia</label>
            <div class="num-stepper" data-stepper="simbank" style="width:100%">
              <button type="button" class="num-stepper-btn" data-step="-" aria-label="Disminuir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
              <input class="num-stepper-input" id="simBankInput" type="text" inputmode="numeric" pattern="[0-9]*" value="${state.bankroll}" />
              <button type="button" class="num-stepper-btn" data-step="+" aria-label="Aumentar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
          </div>
          <div>
            <label class="muted tiny" style="display:block;margin-bottom:4px">Nivel de riesgo</label>
            <div class="seg" id="simRiskSeg" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
              ${['cons', 'eq', 'agg'].map(r => `<button type="button" class="${state.risk === r ? 'active' : ''}" data-risk="${r}">${r === 'cons' ? 'Seguro' : r === 'eq' ? 'Equilibrado' : 'Agresivo'}</button>`).join('')}
            </div>
          </div>
          <p class="muted tiny" style="line-height:1.45;margin:0">
            ${state.risk === 'cons' ? 'Cuotas individuales 1.10–1.40. Bajo riesgo, ganancias chicas.' :
              state.risk === 'eq'   ? 'Cuotas individuales 1.40–2.30. Balance entre riesgo y valor.' :
                                       'Cuotas individuales >2.30. Alto riesgo, ganancias grandes.'}
          </p>
        </div>
        <div class="card stack" style="padding:18px">
          <div class="row between">
            <strong style="font-size:.95rem">Evolución de banca</strong>
            <span class="muted tiny">Últimas ${Math.min(30, state.bets.length)} apuestas</span>
          </div>
          <canvas id="simChart" style="width:100%;height:180px"></canvas>
        </div>
      </div>

      <!-- COMBINADAS RECOMENDADAS ──────────────────────────────────── -->
      <section style="margin-bottom:28px">
        <div class="row between" style="margin-bottom:14px">
          <div>
            <h3 class="h3" style="margin:0;font-size:1.15rem">Combinadas recomendadas por IA</h3>
            <p class="muted tiny" style="margin-top:2px">Análisis estadístico — elegí cuál querés simular</p>
          </div>
          <button class="btn btn-outline btn-sm" id="simRefreshCombos">${BSIcons.svg('refresh', { size: 14 })} Actualizar</button>
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill, minmax(330px, 1fr));gap:14px" id="simCombos"></div>
      </section>

      <!-- MIS APUESTAS ─────────────────────────────────────────────── -->
      <section>
        <div class="row between" style="margin-bottom:14px">
          <div>
            <h3 class="h3" style="margin:0;font-size:1.15rem">Mis apuestas simuladas</h3>
            <p class="muted tiny" style="margin-top:2px">${pending > 0 ? `${pending} pendientes · ` : ''}${state.wins + state.losses} resueltas</p>
          </div>
          <div class="cluster" style="gap:6px">
            <button class="btn btn-ghost btn-sm" id="simExport">Exportar CSV</button>
            <button class="btn btn-ghost btn-sm" id="simClear">Limpiar historial</button>
          </div>
        </div>
        <div class="card stack" style="padding:16px">
          ${state.bets.length === 0 ?
            `<div style="padding:32px;text-align:center;opacity:.6">
              <div style="font-size:36px;margin-bottom:8px">🎯</div>
              <strong>Tus apuestas simuladas van a aparecer acá</strong>
              <p class="muted tiny" style="margin-top:6px">Elegí una combinada recomendada arriba y clickeá "Simular apuesta".</p>
            </div>` :
            renderBetsTable(state)}
        </div>
      </section>
    `;
  }

  function kpiCard(label, value, delta, dir) {
    const dirCls = dir === 'up' ? 'text-success' : dir === 'down' ? 'text-danger' : '';
    return `<div class="card stack" style="padding:16px;gap:4px">
      <div class="muted tiny" style="text-transform:uppercase;letter-spacing:.04em;font-size:.65rem">${label}</div>
      <div class="num" style="font-size:1.35rem;font-weight:700;line-height:1.2">${value}</div>
      <div class="tiny ${dirCls}" style="opacity:.85">${delta}</div>
    </div>`;
  }

  function renderCombosLoading() {
    return Array(3).fill(0).map(() => `<div class="card stack" style="padding:16px;opacity:.5;min-height:180px">
      <div style="height:14px;background:var(--border);border-radius:4px;width:60%"></div>
      <div style="height:10px;background:var(--border);border-radius:4px;width:90%"></div>
      <div style="height:10px;background:var(--border);border-radius:4px;width:80%"></div>
      <div style="margin-top:auto;height:32px;background:var(--border);border-radius:6px"></div>
    </div>`).join('');
  }

  function renderCombosEmpty() {
    return `<div class="card stack" style="padding:32px;text-align:center;grid-column:1/-1">
      <div style="font-size:32px;opacity:.5">⏳</div>
      <strong>El motor IA está analizando partidos</strong>
      <p class="muted tiny" style="margin-top:6px">Refrescá en unos segundos o probá con otro nivel de riesgo.</p>
    </div>`;
  }

  function renderComboCard(combo, idx, state) {
    const legs = combo.legs || [];
    const totalOdd = combo.totalOdd || legs.reduce((a, l) => a * (l.odd || 1), 1);
    const probReal = legs.reduce((a, l) => a * Math.max(0.05, l.confidence || 0.5), 1);
    const probPct = Math.round(probReal * 100);
    const stake = Math.round(state.bankroll * 0.05);
    const potentialWin = Math.round(stake * totalOdd);
    const riskLabel = combo.type === 'cons' ? 'Seguro' : combo.type === 'agg' ? 'Agresivo' : 'Equilibrado';
    const riskColor = combo.type === 'cons' ? 'success' : combo.type === 'agg' ? 'danger' : 'warning';
    // FIX 2026-05: EV + confianza visibles + book recomendado
    const sumEv = combo.sumEv != null ? combo.sumEv : (combo.evAdjusted != null ? combo.evAdjusted : null);
    const evPct = sumEv != null ? sumEv : null;
    const avgConf = combo.avgConfidence != null
      ? Math.round(combo.avgConfidence * 100)
      : Math.round((legs.reduce((a, l) => a + (l.confidence || 0), 0) / Math.max(1, legs.length)) * 100);
    // Mejor casa: derivada de las legs (mode del bestBook si hay múltiples)
    const bookCount = {};
    legs.forEach(l => { const b = l.bestBook || l.book; if (b) bookCount[b] = (bookCount[b] || 0) + 1; });
    const topBook = Object.entries(bookCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return `<div class="card card-hover stack reveal" style="--i:${idx};padding:16px;gap:12px">
      <div class="row between" style="align-items:flex-start">
        <div>
          <div class="cluster" style="gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span class="badge badge-${riskColor} tiny">${riskLabel}</span>
            <span class="muted tiny">${legs.length} legs</span>
            ${evPct != null ? `<span class="badge badge-info tiny" title="Valor esperado">EV ${evPct >= 0 ? '+' : ''}${Number(evPct).toFixed(1)}%</span>` : ''}
          </div>
          <div style="font-size:1.5rem;font-weight:700;line-height:1">${totalOdd.toFixed(2)}</div>
          <div class="muted tiny">Cuota total</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:.85rem;font-weight:600">${probPct}%</div>
          <div class="muted tiny">prob. real</div>
          <div class="tiny" style="margin-top:6px;color:var(--text-muted)">Confianza ${avgConf}%</div>
        </div>
      </div>

      <div class="stack" style="gap:6px">
        ${legs.slice(0, 4).map(l => `
          <div style="padding:8px 10px;background:color-mix(in srgb, var(--brand-500) 4%, transparent);border-radius:6px;border-left:2px solid var(--brand-500)">
            <div class="row between" style="align-items:flex-start;gap:8px">
              <div style="flex:1;min-width:0">
                <div style="font-size:.78rem;font-weight:600;line-height:1.3">${BSUI.esc(l.label || '—')}</div>
                <div class="muted tiny" style="margin-top:2px">${BSUI.esc(l.home || '?')} vs ${BSUI.esc(l.away || '?')}${l.bestBook ? ` · <strong>${BSUI.esc(l.bestBook)}</strong>` : (l.book ? ` · ${BSUI.esc(l.book)}` : '')}</div>
              </div>
              <div class="num" style="font-weight:700;font-size:.9rem">${(l.odd || 0).toFixed(2)}</div>
            </div>
          </div>
        `).join('')}
        ${legs.length > 4 ? `<div class="muted tiny" style="text-align:center">+ ${legs.length - 4} legs más</div>` : ''}
      </div>

      ${topBook ? `<div class="muted tiny" style="text-align:center;padding:4px 8px;background:color-mix(in srgb, var(--success,#16a34a) 6%, transparent);border-radius:6px">⭐ Mejor cuota encontrada en <strong style="color:var(--text)">${BSUI.esc(topBook)}</strong></div>` : ''}

      <div class="row between" style="padding-top:8px;border-top:1px solid var(--border)">
        <div>
          <div class="muted tiny">Si apostás ${BSUI.money(stake)}</div>
          <div style="font-weight:600;color:var(--success, #16a34a)">+${BSUI.money(potentialWin - stake)} ganarías</div>
        </div>
        <button class="btn btn-primary btn-sm" data-sim-combo="${idx}">
          ${BSIcons.svg('check', { size: 14 })} Simular
        </button>
      </div>
    </div>`;
  }

  function renderBetsTable(state) {
    const sorted = [...state.bets].sort((a, b) => {
      // Pendientes primero, luego por fecha desc
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return (b.ts || 0) - (a.ts || 0);
    });
    return `<div class="table-wrap"><table class="table" style="width:100%">
      <thead>
        <tr>
          <th>Estado</th>
          <th>Apuesta</th>
          <th class="text-right">Cuota</th>
          <th class="text-right">Stake</th>
          <th class="text-right">Resultado</th>
          <th class="text-right">Banca</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.slice(0, 50).map(b => renderBetRow(b)).join('')}
      </tbody>
    </table></div>`;
  }

  function renderBetRow(b) {
    const statusLabel = { pending: '⏳ Pendiente', won: '✓ Ganada', lost: '✗ Perdida' }[b.status];
    const statusClass = { pending: 'badge-warning', won: 'badge-success', lost: 'badge-danger' }[b.status];
    const legSummary = (b.legs || []).slice(0, 2).map(l => l.label || '—').join(' + ');
    const legMore = (b.legs || []).length > 2 ? ` +${(b.legs || []).length - 2}` : '';
    const profitTxt = b.status === 'pending' ? '—' : (b.profit >= 0 ? '+' : '') + BSUI.money(b.profit);
    const profitCls = b.status === 'won' ? 'text-success' : b.status === 'lost' ? 'text-danger' : '';
    const bookTxt = b.book ? `<div class="muted tiny" style="margin-top:2px">📍 ${BSUI.esc(b.book)}</div>` : '';
    return `<tr>
      <td><span class="badge ${statusClass} tiny">${statusLabel}</span></td>
      <td>
        <div style="font-size:.82rem;font-weight:600">${BSUI.esc(legSummary)}${legMore}</div>
        <div class="muted tiny">${BSUI.dt(b.ts)}</div>
        ${bookTxt}
      </td>
      <td class="num text-right">${(b.combo?.totalOdd || 0).toFixed(2)}</td>
      <td class="num text-right">${BSUI.money(b.stake)}</td>
      <td class="num text-right ${profitCls}">${profitTxt}</td>
      <td class="num text-right">${b.status !== 'pending' ? BSUI.money(b.balanceAfter || 0) : '—'}</td>
    </tr>`;
  }

  /* ═══════ BINDINGS ═══════ */

  function bindControls(panel, state) {
    // Bank stepper
    const bankInp = panel.querySelector('#simBankInput');
    panel.querySelectorAll('[data-stepper="simbank"] .num-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sign = btn.dataset.step === '+' ? 1 : -1;
        const cur = Number(String(bankInp.value).replace(/[^\d]/g, '')) || 0;
        const step = cur >= 100000 ? 10000 : 5000;
        bankInp.value = String(Math.max(1000, cur + sign * step));
      });
    });
    bankInp.addEventListener('change', () => {
      const v = Number(String(bankInp.value).replace(/[^\d]/g, '')) || 0;
      if (v >= 1000 && v !== state.bankroll) {
        // Si cambia bankroll, también se actualiza initial (es un reset suave)
        state.bankroll = v;
        state.initial = v;
        save(state);
        render(panel);
      }
    });

    // Risk
    panel.querySelectorAll('#simRiskSeg [data-risk]').forEach(b => {
      b.addEventListener('click', () => {
        state.risk = b.dataset.risk;
        save(state);
        render(panel);
      });
    });

    // Reset
    panel.querySelector('#simReset')?.addEventListener('click', () => {
      if (confirm('¿Reiniciar tu banca y borrar todas las apuestas simuladas?')) {
        save({ bankroll: 100000, initial: 100000, risk: state.risk, bets: [], wins: 0, losses: 0 });
        render(panel);
      }
    });

    // Refresh combos
    panel.querySelector('#simRefreshCombos')?.addEventListener('click', () => render(panel));

    // Export CSV
    panel.querySelector('#simExport')?.addEventListener('click', () => {
      const rows = [['Fecha', 'Estado', 'Apuesta', 'Cuota', 'Stake', 'Profit', 'Balance']];
      state.bets.forEach(b => rows.push([
        new Date(b.ts).toISOString(),
        b.status,
        (b.legs || []).map(l => l.label).join(' + '),
        b.combo?.totalOdd || '',
        b.stake,
        b.profit ?? '',
        b.balanceAfter ?? ''
      ]));
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'simulador-apuestas.csv';
      a.click();
    });

    // Clear history
    panel.querySelector('#simClear')?.addEventListener('click', () => {
      if (confirm('¿Borrar todas las apuestas pero mantener tu banca actual?')) {
        state.bets = []; state.wins = 0; state.losses = 0;
        save(state); render(panel);
      }
    });
  }

  function bindComboActions(panel, state, combos) {
    panel.querySelectorAll('[data-sim-combo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.simCombo);
        const combo = combos[idx];
        if (!combo) return;
        const stake = Math.round(state.bankroll * 0.05);
        if (stake > state.bankroll) {
          BSUI.toast({ title: 'Sin banca suficiente', type: 'warning' });
          return;
        }
        // FIX 2026-05: detectar mejor casa del combo para tracking
        const bc = {};
        (combo.legs || []).forEach(l => { const b = l.bestBook || l.book; if (b) bc[b] = (bc[b] || 0) + 1; });
        const topBook = Object.entries(bc).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        const bet = {
          id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ts: Date.now(),
          combo: { totalOdd: combo.totalOdd, type: combo.type, sumEv: combo.sumEv, avgConfidence: combo.avgConfidence },
          legs: combo.legs || [],
          stake,
          book: topBook,
          status: 'pending'
        };
        state.bets.unshift(bet);
        save(state);
        BSUI.toast({
          title: 'Apuesta simulada',
          message: `${BSUI.money(stake)} a cuota ${combo.totalOdd?.toFixed(2)}. Se resuelve cuando termine el partido.`,
          type: 'success'
        });
        if (BSUI.confetti) BSUI.confetti(40);
        render(panel);
      });
    });
  }

  function bindMyBetsActions(panel, state) {
    // (sin extras por ahora — resolución automática se hace en cada render)
  }

  /* ═══════ CHART ═══════ */
  function drawEvolution(canvas, state) {
    if (!canvas) return;
    const resolved = state.bets.filter(b => b.status !== 'pending').slice().reverse();
    const values = [state.initial];
    resolved.forEach(b => values.push(b.balanceAfter || values[values.length - 1]));
    if (values.length < 2) {
      // Sin data, mostrar línea recta inicial
      const ctx = canvas.getContext('2d');
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = 'rgba(120,120,120,.3)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(10, h / 2); ctx.lineTo(w - 10, h / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(120,120,120,.6)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Simulá tu primera apuesta para ver tu evolución', w / 2, h / 2 - 8);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (w - 20) / (values.length - 1);
    const yOf = v => h - 14 - ((v - min) / range) * (h - 28);
    // Area
    ctx.beginPath();
    ctx.moveTo(10, h - 14);
    values.forEach((v, i) => ctx.lineTo(10 + i * stepX, yOf(v)));
    ctx.lineTo(10 + (values.length - 1) * stepX, h - 14);
    ctx.closePath();
    const isUp = values[values.length - 1] >= values[0];
    const baseRgba = isUp ? '34, 197, 94' : '239, 68, 68';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${baseRgba}, .35)`);
    grad.addColorStop(1, `rgba(${baseRgba}, 0)`);
    ctx.fillStyle = grad; ctx.fill();
    // Line
    ctx.beginPath();
    values.forEach((v, i) => i === 0 ? ctx.moveTo(10, yOf(v)) : ctx.lineTo(10 + i * stepX, yOf(v)));
    ctx.strokeStyle = isUp ? '#16a34a' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /* ═══════ REGISTER ═══════ */
  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('simulator', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('simulator', render));
  }
  doRegister();
  window.__bsSimulatorRender = render;
})();
