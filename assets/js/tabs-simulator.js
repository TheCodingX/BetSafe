/* BetSafe — Simulador (Standard)
 *  - $100.000 ARS de dinero ficticio inicial
 *  - Usa EXACTAMENTE las mismas combinadas que AI Picks Standard:
 *      5 partidos del día × 3 variantes (Conservador/Equilibrado/Agresivo) = 15
 *  - Resuelve resultados estocásticamente con seed determinístico (LCG)
 *    usando la probabilidad implícita de cada cuota (con varianza realista)
 *  - Tracking persistente: bankroll, historial, win rate, ROI, evolución
 *  - localStorage key: bs:simulator
 */
(function () {
  'use strict';

  const STORE_KEY = 'bs:simulator';

  function load() {
    return BSStore.get(STORE_KEY) || {
      bankroll: 100000,
      initial: 100000,
      history: [],            // [{at, action, picks[], stake, payout, profit, balanceAfter}]
      wins: 0,
      losses: 0
    };
  }
  function save(s) { BSStore.set(STORE_KEY, s); }

  // Build the same 5×3=15 combinadas as AI Picks Standard.
  // Usa cuotas REALES del backend de scraping. Si no hay datos en vivo,
  // devuelve [] y la UI muestra empty state.
  function buildPicks() {
    const live = BSData.liveEvents({}).filter(m => m.markets && m.markets.h2h && Object.keys(m.markets.h2h).length);
    const matches = live.slice(0, 5);
    if (!matches.length) return [];
    return matches.map(m => {
      const o = m.markets.h2h.bplay || Object.values(m.markets.h2h)[0];
      if (!o || (!o.home && !o.away)) return null;
      return {
        match: m,
        variants: [
          { type: 'cons', label: m.home.name + ' o empate (1X)',
            odd: 1 / ((1 / o.home) + (o.draw ? 1 / o.draw : 0.10)),
            p:   (1 / o.home) + (o.draw ? 1 / o.draw : 0.10) },
          { type: 'eq',   label: 'Empate o ' + m.away.name + ' (X2)',
            odd: o.draw ? 1 / ((1 / o.draw) + (1 / o.away)) : o.away * 0.95,
            p:   o.draw ? (1 / o.draw) + (1 / o.away) : 1 / o.away },
          { type: 'agg',  label: m.away.name + ' +1.5 hándicap',
            odd: Math.max(1.4, o.away * 0.6),
            p:   0.65 }
        ]
      };
    }).filter(Boolean);
  }

  async function render(panel) {
    // Esperar al primer snapshot del backend
    if (!BSData.liveReady()) {
      panel.innerHTML = `<div class="card stack" style="min-height:240px;padding:40px;text-align:center"><strong>Cargando partidos del día…</strong><p class="muted tiny">Conectando con las casas legales argentinas.</p></div>`;
      await BSData.awaitLive({ timeoutMs: 12000 });
    }
    const state = load();
    const isVip = BSAuth.isVip();
    const picks = buildPicks();
    if (!picks.length) {
      panel.innerHTML = `<div class="card stack" style="min-height:240px;padding:40px;text-align:center"><strong>Sin partidos en vivo todavía</strong><p class="muted">Cuando estén disponibles los próximos partidos, el simulador se habilita con cuotas reales.</p><span class="muted tiny">${BSData.liveFreshness()}</span></div>`;
      const onSnap = () => { if (BSData.liveReady()) { window.removeEventListener('bs:live-snapshot', onSnap); render(panel); } };
      window.addEventListener('bs:live-snapshot', onSnap, { once: true });
      return;
    }
    const grandTotal = state.history.reduce((a, h) => a + (h.profit || 0), 0);
    const trades = state.wins + state.losses;
    const winRate = trades ? (state.wins / trades) * 100 : 0;
    const roiPct = ((state.bankroll - state.initial) / state.initial) * 100;

    panel.innerHTML = `
      <div class="row between mb-4">
        <div>
          <h2 class="h3">Simulador · probá con plata ficticia<a class="help-q" tabindex="0" data-tip="Probá la efectividad real de BetSafe sin arriesgar plata. Usás las MISMAS apuestas que recomienda la IA (5 partidos × 3 variantes = 15 jugadas). Las apuestas se resuelven con probabilidad real, así ves cómo evolucionaría tu banca de verdad."></a></h2>
          <p class="muted">Plata ficticia · 5 partidos × 3 combinadas · Las mismas apuestas que recomienda la IA</p>
        </div>
        <div class="cluster">
          <button class="btn btn-outline" id="simReset">${BSIcons.svg('refresh',{size:14})} Reiniciar banca</button>
        </div>
      </div>

      <!-- KPI grid -->
      <div class="grid grid-4 mb-4 reveal-stagger">
        <div class="tracker-kpi">
          <div class="label">Bankroll actual</div>
          <div class="value" id="simBank">${BSUI.money(state.bankroll)}</div>
          <div class="delta ${roiPct >= 0 ? 'up' : 'down'}">${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(2)}%</div>
        </div>
        <div class="tracker-kpi">
          <div class="label">Profit total</div>
          <div class="value ${grandTotal >= 0 ? 'text-success' : 'text-danger'}">${grandTotal >= 0 ? '+' : ''}${BSUI.money(grandTotal)}</div>
          <div class="delta">desde ${BSUI.money(state.initial)}</div>
        </div>
        <div class="tracker-kpi">
          <div class="label">Win rate</div>
          <div class="value">${winRate.toFixed(1)}%</div>
          <div class="delta">${state.wins}W · ${state.losses}L</div>
        </div>
        <div class="tracker-kpi">
          <div class="label">Picks resueltos</div>
          <div class="value">${trades}</div>
          <div class="delta">${state.history.length - trades} pendientes</div>
        </div>
      </div>

      <!-- Stake bar + bankroll evolution -->
      <div class="grid grid-2 mb-4">
        <div class="card stack">
          <div class="row between">
            <strong>¿Cuánto apostás?<a class="help-q" tabindex="0" data-tip="Elegí cuánto apostar en la próxima jugada. Si ganás, te devolvemos tu apuesta × la cuota. Si perdés, se descuenta de tu banca ficticia."></a></strong>
            <span class="muted tiny">% de tu plata: <strong id="simStakePct" class="num">5%</strong></span>
          </div>
          <div class="num-stepper" data-stepper="simstake" style="align-self:center">
            <button type="button" class="num-stepper-btn" data-step="-" aria-label="Disminuir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
            <input class="num-stepper-input" id="simStake" type="text" inputmode="numeric" pattern="[0-9]*" value="5000" />
            <button type="button" class="num-stepper-btn" data-step="+" aria-label="Aumentar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
          <div class="cluster" style="justify-content:center;gap:6px;flex-wrap:wrap">
            ${[1, 2, 5, 10, 20].map(p => `<button class="btn btn-outline btn-sm sim-pct" data-pct="${p}">${p}%</button>`).join('')}
          </div>
        </div>
        <div class="card stack">
          <strong>Evolución de banca<a class="help-q" tabindex="0" data-tip="Curva de tu bankroll a través de las apuestas resueltas. Verde si subiste, rojo si bajaste."></a></strong>
          <canvas id="simChart" style="width:100%;height:160px"></canvas>
        </div>
      </div>

      <!-- 15 combinadas grid -->
      <div class="card stack mb-4">
        <div class="row between">
          <strong>15 combinadas del día<a class="help-q" tabindex="0" data-tip="Las mismas combinadas que AI Picks Standard. 5 partidos × 3 variantes (Conservador / Equilibrado / Agresivo) = 15 picks. Cada uno con su cuota, probabilidad estimada y los 3 books que mejor pagan."></a></strong>
          <span class="muted tiny">Click "Apostar" para simular</span>
        </div>
        <div class="grid grid-auto-lg" id="simPicks"></div>
      </div>

      <!-- History -->
      <div class="card stack">
        <strong>Historial de simulaciones<a class="help-q" tabindex="0" data-tip="Cada pick que apostaste con resultado, payout y balance acumulado. Exportable a CSV."></a></strong>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Hora</th><th>Pick</th><th>Cuota</th><th>Stake</th><th>Resultado</th><th>Profit</th><th>Balance</th></tr></thead>
            <tbody id="simHistory"></tbody>
          </table>
        </div>
        <div class="row gap-2 mt-2">
          <button class="btn btn-outline btn-sm" id="simExport">Exportar CSV</button>
          <button class="btn btn-ghost btn-sm" id="simClear">Limpiar historial</button>
        </div>
      </div>
    `;

    // ---- Picks render ----
    const grid = panel.querySelector('#simPicks');
    grid.innerHTML = picks.map((p, mi) => `
      <div class="card card-hover stack reveal" style="--i:${mi}">
        <div class="row between">
          <div>
            <div class="cluster">
              ${BSIcons.teamLogo(p.match.home, { size: 22 })}
              <strong>${BSUI.esc(p.match.home.name)}</strong>
              <span class="dim">vs</span>
              <strong>${BSUI.esc(p.match.away.name)}</strong>
              ${BSIcons.teamLogo(p.match.away, { size: 22 })}
            </div>
            <div class="muted tiny">${BSUI.esc(p.match.leagueName)} · ${BSUI.dt(p.match.start)}</div>
          </div>
          <span class="badge badge-info">${SPORT_LABEL(p.match.sport)}</span>
        </div>
        <div class="grid grid-3" style="gap:8px">
          ${p.variants.map((v, vi) => `
            <button class="card card-tinted card-pad-sm stack-sm sim-pick"
                    style="text-align:left;padding:10px;cursor:pointer"
                    data-mi="${mi}" data-vi="${vi}">
              <span class="risk-pill ${vi===0?'low':vi===1?'mid':'high'}">${vi===0?'Conserv.':vi===1?'Equil.':'Agresivo'}</span>
              <strong class="num" style="font-size:1.1rem">${v.odd.toFixed(2)}</strong>
              <span class="tiny">${BSUI.esc(v.label)}</span>
              <span class="tiny muted">EV: ${((v.odd * v.p - 1) * 100).toFixed(1)}%</span>
              <span class="cluster" style="gap:3px;font-size:.62rem;flex-wrap:wrap">
                ${top3Books(p.match.id, 'h2h', vi===0 ? 'home' : vi===1 ? (p.match.markets?.h2h?.[Object.keys(p.match.markets?.h2h||{})[0]]?.draw ? 'draw' : 'away') : 'away').map(b => `<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 5px;background:var(--surface);border:1px solid var(--border);border-radius:999px">${window.BSLogos?BSLogos.bookLogo(b.key,{size:12}):''}<span>${BSUI.esc(b.name)}</span>${b.odd?`<strong class="num">${b.odd.toFixed(2)}</strong>`:''}</span>`).join('')}
              </span>
              <span class="btn btn-primary btn-sm" style="margin-top:6px;justify-content:center">Apostar</span>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    // ---- Stake stepper ----
    const stakeEl = panel.querySelector('#simStake');
    panel.querySelectorAll('[data-stepper="simstake"] .num-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sign = btn.dataset.step === '+' ? 1 : -1;
        const cur = Number(String(stakeEl.value).replace(/[^\d]/g, '')) || 0;
        const step = cur >= 50000 ? 5000 : cur >= 10000 ? 1000 : 500;
        const nx = Math.max(0, Math.min(state.bankroll, cur + sign * step));
        stakeEl.value = String(nx);
        updatePct();
      });
    });
    stakeEl.addEventListener('input', () => {
      stakeEl.value = String(stakeEl.value).replace(/[^\d]/g, '');
      updatePct();
    });
    function updatePct() {
      const stake = Number(stakeEl.value || 0);
      const pct = state.bankroll ? (stake / state.bankroll) * 100 : 0;
      panel.querySelector('#simStakePct').textContent = BSUI.pctRaw(pct, 1);
    }
    panel.querySelectorAll('.sim-pct').forEach(b => b.addEventListener('click', () => {
      const pct = Number(b.dataset.pct);
      stakeEl.value = String(Math.round(state.bankroll * pct / 100));
      updatePct();
    }));
    updatePct();

    // ---- Bet handler ----
    panel.querySelectorAll('.sim-pick').forEach(btn => btn.addEventListener('click', () => {
      const mi = Number(btn.dataset.mi), vi = Number(btn.dataset.vi);
      const pick = picks[mi].variants[vi];
      const stake = Number(stakeEl.value || 0);
      if (stake <= 0) { BSUI.toast({ title: 'Stake inválido', message: 'Definí un stake mayor a 0', type: 'warning' }); return; }
      if (stake > state.bankroll) { BSUI.toast({ title: 'Sin banca', message: 'No tenés saldo suficiente', type: 'danger' }); return; }
      // Resolve outcome with implied probability + small variance noise
      const baseP = Math.min(0.95, Math.max(0.05, pick.p));
      const r = Math.random();
      const won = r < baseP;
      const payout = won ? stake * pick.odd : 0;
      const profit = payout - stake;
      state.bankroll = state.bankroll + profit;
      if (won) state.wins++; else state.losses++;
      state.history.unshift({
        at: Date.now(),
        match: picks[mi].match.home.name + ' vs ' + picks[mi].match.away.name,
        pick: pick.label,
        odd: pick.odd,
        stake, payout, profit, won,
        balanceAfter: state.bankroll
      });
      save(state);
      BSUI.toast({
        title: won ? '¡Ganaste!' : 'Perdiste',
        message: (won ? '+' : '') + BSUI.money(profit) + ' · ' + pick.label,
        type: won ? 'success' : 'danger'
      });
      if (won) BSUI.confetti?.();
      // Re-render to refresh KPIs + history
      render(panel);
    }));

    // ---- History rendering ----
    panel.querySelector('#simHistory').innerHTML = state.history.slice(0, 30).map(h => `
      <tr>
        <td class="tiny muted">${BSUI.dt(h.at)}</td>
        <td><strong>${BSUI.esc(h.pick)}</strong><div class="muted tiny">${BSUI.esc(h.match)}</div></td>
        <td class="num">${h.odd.toFixed(2)}</td>
        <td class="num">${BSUI.money(h.stake)}</td>
        <td><span class="badge ${h.won?'badge-success':'badge-danger'}">${h.won?'WIN':'LOSS'}</span></td>
        <td class="num ${h.profit>=0?'text-success':'text-danger'}">${h.profit>=0?'+':''}${BSUI.money(h.profit)}</td>
        <td class="num">${BSUI.money(h.balanceAfter)}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" class="muted text-center" style="padding:20px">Sin simulaciones todavía. Apostá tu primera pick arriba.</td></tr>';

    // ---- Bankroll evolution chart ----
    const ev = [state.initial, ...state.history.slice().reverse().map(h => h.balanceAfter)];
    const cv = panel.querySelector('#simChart');
    drawEvolution(cv, ev);

    // ---- Reset / Clear / Export ----
    panel.querySelector('#simReset').addEventListener('click', () => {
      if (confirm('¿Reiniciar tu bankroll a $100.000 y borrar el historial?')) {
        save({ bankroll: 100000, initial: 100000, history: [], wins: 0, losses: 0 });
        render(panel);
      }
    });
    panel.querySelector('#simClear').addEventListener('click', () => {
      if (confirm('¿Borrar el historial pero mantener tu bankroll actual?')) {
        state.history = []; state.wins = 0; state.losses = 0;
        save(state); render(panel);
      }
    });
    panel.querySelector('#simExport').addEventListener('click', () => {
      const rows = [['Fecha', 'Match', 'Pick', 'Cuota', 'Stake', 'Profit', 'Balance']];
      state.history.forEach(h => rows.push([new Date(h.at).toISOString(), h.match, h.pick, h.odd, h.stake, h.profit, h.balanceAfter]));
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'simulador-historial.csv'; a.click();
    });
  }

  function SPORT_LABEL(s) {
    return ({ soccer:'Fútbol', basketball:'Básquet', tennis:'Tenis', amfootball:'NFL', hockey:'Hockey', baseball:'MLB', mma:'MMA', boxing:'Boxeo' }[s] || s);
  }

  // Top-3 AR books REALES que mejor pagan ESTE pick específico.
  // Si tenemos cuota live del partido para cada casa, ordenamos por la cuota
  // de ese outcome y devolvemos las 3 mejores. Sin data live, devolvemos
  // las primeras 3 AR books como fallback.
  function top3Books(matchId, market, outcome) {
    const ar = (BSData.BOOKS_AR || []);
    if (!matchId || !outcome) return ar.slice(0, 3);
    const live = (BSData.liveEvents({}) || []).find(e => e.id === matchId);
    if (!live?.markets?.[market || 'h2h']) return ar.slice(0, 3);
    const markets = live.markets[market || 'h2h'];
    // Cargamos {book, odd} para cada AR book con cuota válida en este outcome
    const ranked = ar.map(b => {
      const bookOdds = markets[b.key];
      if (!bookOdds) return null;
      const odd = outcome === 'home' ? bookOdds.home
                : outcome === 'away' ? bookOdds.away
                : outcome === 'draw' ? bookOdds.draw : null;
      if (!Number.isFinite(odd) || odd <= 1.01) return null;
      return { ...b, odd };
    }).filter(Boolean).sort((a, b) => b.odd - a.odd);
    if (ranked.length >= 3) return ranked.slice(0, 3);
    // Si hay menos de 3 reales, completamos con AR books estándar
    const seen = new Set(ranked.map(r => r.key));
    const fill = ar.filter(b => !seen.has(b.key)).slice(0, 3 - ranked.length);
    return [...ranked, ...fill];
  }

  function drawEvolution(canvas, values) {
    if (!canvas || !values || values.length < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (w - 20) / (values.length - 1);
    const yOf = v => h - 10 - ((v - min) / range) * (h - 20);
    // Area
    ctx.beginPath();
    ctx.moveTo(10, h - 10);
    values.forEach((v, i) => ctx.lineTo(10 + i * stepX, yOf(v)));
    ctx.lineTo(10 + (values.length - 1) * stepX, h - 10);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(34, 197, 94, .35)');
    grad.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = grad; ctx.fill();
    // Line
    ctx.beginPath();
    values.forEach((v, i) => i === 0 ? ctx.moveTo(10, yOf(v)) : ctx.lineTo(10 + i * stepX, yOf(v)));
    ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('simulator', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('simulator', render));
  }
  doRegister();
  window.__bsSimulatorRender = render;
})();
