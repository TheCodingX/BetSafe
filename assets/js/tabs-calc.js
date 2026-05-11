/* BetSafe — Calc Hub (9 básicas: Kelly, Hedge, Dutch, Arb, Parlay, Free Bet, CLV, Drawdown, Middle) */
(function () {
  'use strict';

  const CALCS = [
    { id: 'kelly',    label: 'Kelly Criterion',         tip: 'Te dice cuánto apostar. Cuando creés tener ventaja real, Kelly calcula el % exacto de tu banca para apostar — ni tan poco que no te rinda, ni tanto que te quemes. Recomendado: ¼ Kelly para empezar.' },
    { id: 'hedge',    label: 'Hedge',                   tip: 'Cerrar una apuesta antes de tiempo para asegurar parte de la ganancia (o limitar la pérdida) apostando al lado contrario. Útil para combinadas con un solo leg pendiente.' },
    { id: 'dutch',    label: 'Dutching',                tip: 'Apostás a varios resultados a la vez para que ganes el mismo monto sin importar cuál salga. Sirve cuando tenés 2-3 candidatos y querés cubrirte.' },
    { id: 'arb',      label: 'Arbitraje 2-way',         tip: 'Cuando dos casas pagan distinto el mismo partido, apostás a los dos lados y ganás sí o sí. La calculadora te da los stakes exactos para que el profit sea igual en cualquier resultado.' },
    { id: 'parlay',   label: 'Combinada',               tip: 'Multiplicás cuotas de varios partidos. Calcula la cuota total, el payout y el profit. Atención: la varianza sube rápido — con 5 legs un solo error te liquida.' },
    { id: 'freebet',  label: 'Free Bet (SNR)',          tip: 'Cuando ganás con una freebet la casa te paga sólo el profit, no el stake (Stake Not Returned). Esta calc te dice cuánto vale realmente tu freebet en plata para que decidas la mejor cuota a usar.' },
    { id: 'clv',      label: 'CLV (Closing Line Value)', tip: 'Compará la cuota a la que apostaste contra la cuota de cierre del mercado. Si tu cuota era mejor, ganaste valor — y eso es la mejor señal de que estás apostando bien, gane o pierda el partido.' },
    { id: 'drawdown', label: 'Drawdown estimator',      tip: 'Calcula la peor caída esperada de tu banca según tu win-rate y stake. Antes de creerte invencible: si tu plan no aguanta este drawdown, tu plan es malo.' },
    { id: 'middle',   label: 'Middling',                tip: 'Cuando dos casas tienen líneas distintas (ej: -2.5 vs +3.5), apostás los dos lados. Si el resultado cae justo en el medio, ganás las dos. Si no, sólo una — pero diseñado para perder muy poco.' }
  ];

  function render(panel) {
    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Calc Hub · 9 calculadoras esenciales<a class="help-q" tabindex="0" data-tip="Las 9 calculadoras más usadas: Kelly (stake óptimo), Hedge (cerrar posición), Dutching (apostar a múltiples outcomes), Arbitraje, Parlay, Free Bet (SNR), CLV, Drawdown, Middle. Cada una con su tooltip explicando para qué sirve. Versión Pro con 24 cálculos en CalcPro VIP."></a></h2>
          <p class="muted">Kelly, Hedge, Dutch, Arb, Parlay, Free Bet, CLV, Drawdown, Middle.</p>
        </div>
        <a href="#calcpro" class="btn btn-gold btn-sm" onclick="if(!BSAuth.isVip()){event.preventDefault();BSDash.go('calcpro')}">CalcPro VIP →</a>
      </div>
      <div class="seg" id="calcSeg" role="tablist">${CALCS.map((c, i) => `<button class="${i===0?'active':''}" data-c="${c.id}" role="tab"><span>${c.label}</span><span class="bs-help" tabindex="0" data-tip="${c.tip}" aria-label="¿Qué hace esta calculadora?">?</span></button>`).join('')}</div>
      <div id="calcOut" class="mt-3"></div>
    `;
    panel.querySelector('#calcSeg').addEventListener('click', e => {
      // El click sobre el "?" no debe cambiar de calc; sólo el resto del botón
      if (e.target.closest('.bs-help')) { e.stopPropagation(); return; }
      const b = e.target.closest('button'); if (!b) return;
      panel.querySelectorAll('#calcSeg button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); show(b.dataset.c);
    });
    show('kelly');

    function show(id) {
      const out = panel.querySelector('#calcOut');
      out.innerHTML = template(id);
      bind(out, id);
    }
  }

  function template(id) {
    if (id === 'kelly') return `
      <div class="grid grid-2 gap-4">
        <div class="card stack">
          <h3 class="h4">Kelly Criterion</h3>
          <p class="muted tiny">Stake óptimo según tu edge.</p>
          <label class="field"><span class="field-label">Probabilidad estimada</span><input class="input" id="k_p" type="number" step="0.01" min="0" max="1" value="0.55"></label>
          <label class="field"><span class="field-label">Cuota decimal</span><input class="input" id="k_o" type="number" step="0.01" min="1.01" value="2.10"></label>
          <label class="field"><span class="field-label">Banca</span><input class="input" id="k_b" type="number" min="0" step="1000" value="100000"></label>
          <div class="row gap-2"><label class="radio"><input type="radio" name="kf" value="1" checked><span class="dot-r"></span>Full</label><label class="radio"><input type="radio" name="kf" value="0.5"><span class="dot-r"></span>Half</label><label class="radio"><input type="radio" name="kf" value="0.25"><span class="dot-r"></span>Quarter</label></div>
        </div>
        <div class="card card-tinted stack" id="kOut"></div>
      </div>`;
    if (id === 'hedge') return `
      <div class="grid grid-2 gap-4">
        <div class="card stack">
          <h3 class="h4">Hedge calculator</h3>
          <label class="field"><span class="field-label">Stake A</span><input class="input" id="h_s" type="number" value="1000"></label>
          <label class="field"><span class="field-label">Cuota A</span><input class="input" id="h_a" type="number" step="0.01" value="2.5"></label>
          <label class="field"><span class="field-label">Cuota B (otro lado)</span><input class="input" id="h_b" type="number" step="0.01" value="1.6"></label>
        </div>
        <div class="card card-tinted stack" id="hOut"></div>
      </div>`;
    if (id === 'dutch') return `
      <div class="card stack">
        <h3 class="h4">Dutching · igualar payout entre múltiples outcomes</h3>
        <label class="field"><span class="field-label">Cuotas (separadas por coma)</span><input class="input" id="d_o" value="2.4, 3.1, 4.5"></label>
        <label class="field"><span class="field-label">Stake total</span><input class="input" id="d_t" type="number" value="1000"></label>
        <div id="dOut"></div>
      </div>`;
    if (id === 'arb') return `
      <div class="card stack">
        <h3 class="h4">Arbitraje 2-way</h3>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Cuota A</span><input class="input" id="a_a" type="number" step="0.01" value="2.10"></label>
          <label class="field"><span class="field-label">Cuota B</span><input class="input" id="a_b" type="number" step="0.01" value="2.05"></label>
          <label class="field"><span class="field-label">Stake total</span><input class="input" id="a_t" type="number" value="1000"></label>
        </div>
        <div id="aOut"></div>
      </div>`;
    if (id === 'parlay') return `
      <div class="card stack">
        <h3 class="h4">Combinada</h3>
        <label class="field"><span class="field-label">Cuotas (coma)</span><input class="input" id="p_o" value="1.85, 2.10, 1.55"></label>
        <label class="field"><span class="field-label">Stake</span><input class="input" id="p_s" type="number" value="500"></label>
        <div id="pOut"></div>
      </div>`;
    if (id === 'freebet') return `
      <div class="card stack">
        <h3 class="h4">Free Bet (Stake-not-returned)</h3>
        <p class="muted tiny">Profit potencial = stake × (cuota − 1)</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Free Bet $</span><input class="input" id="fb_s" type="number" value="2000"></label>
          <label class="field"><span class="field-label">Cuota</span><input class="input" id="fb_o" type="number" step="0.01" value="3.20"></label>
        </div>
        <div id="fbOut"></div>
      </div>`;
    if (id === 'clv') return `
      <div class="card stack">
        <h3 class="h4">CLV — Closing Line Value</h3>
        <p class="muted tiny">CLV (%) = (probabilidad de cierre − probabilidad implícita tomada) / tomada × 100</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Cuota tomada</span><input class="input" id="clv_t" type="number" step="0.01" value="2.10"></label>
          <label class="field"><span class="field-label">Cuota cierre</span><input class="input" id="clv_c" type="number" step="0.01" value="1.95"></label>
        </div>
        <div id="clvOut"></div>
      </div>`;
    if (id === 'drawdown') return `
      <div class="card stack">
        <h3 class="h4">Drawdown estimator (95% CI)</h3>
        <div class="grid grid-3 gap-3">
          <label class="field"><span class="field-label">Win rate (p)</span><input class="input" id="dd_p" type="number" step="0.01" value="0.55"></label>
          <label class="field"><span class="field-label">Edge por pick</span><input class="input" id="dd_e" type="number" step="0.001" value="0.04"></label>
          <label class="field"><span class="field-label">N picks</span><input class="input" id="dd_n" type="number" value="100"></label>
        </div>
        <div id="ddOut"></div>
      </div>`;
    if (id === 'middle') return `
      <div class="card stack">
        <h3 class="h4">Middling</h3>
        <p class="muted tiny">Apostá Over y Under en líneas distintas, calculá los 3 escenarios.</p>
        <div class="grid grid-3 gap-3">
          <label class="field"><span class="field-label">Cuota O</span><input class="input" id="m_o1" type="number" step="0.01" value="1.95"></label>
          <label class="field"><span class="field-label">Cuota U</span><input class="input" id="m_o2" type="number" step="0.01" value="1.95"></label>
          <label class="field"><span class="field-label">Stake O</span><input class="input" id="m_s1" type="number" value="500"></label>
          <label class="field"><span class="field-label">Stake U</span><input class="input" id="m_s2" type="number" value="500"></label>
        </div>
        <div id="mOut"></div>
      </div>`;
  }

  function bind(root, id) {
    const live = (cb) => { root.querySelectorAll('input').forEach(i => i.addEventListener('input', cb)); cb(); };

    if (id === 'kelly') live(() => {
      const p = +root.querySelector('#k_p').value;
      const o = +root.querySelector('#k_o').value;
      const b = +root.querySelector('#k_b').value;
      const f = +root.querySelector('input[name="kf"]:checked').value;
      const k = BSMath.kelly(p, o, f);
      const stake = b * k;
      const ev = BSMath.ev(p, o, stake);
      root.querySelector('#kOut').innerHTML = `
        <strong>Stake recomendado</strong>
        <div class="kpi-value">${BSUI.money(stake)}</div>
        <div class="muted tiny">${BSUI.pct(k)} de la banca · EV ${BSUI.money(ev)}</div>
        <div class="row gap-2 mt-3"><span class="risk-pill ${k<0.02?'low':k<0.05?'mid':'high'}">${k<0.02?'Bajo':k<0.05?'Medio':'Alto'}</span></div>
        <p class="muted tiny mt-2">Si Kelly ≤ 0, no apostá: no hay edge.</p>`;
    });

    if (id === 'hedge') live(() => {
      const s = +root.querySelector('#h_s').value;
      const a = +root.querySelector('#h_a').value;
      const b = +root.querySelector('#h_b').value;
      const r = BSMath.hedge(s, a, b);
      root.querySelector('#hOut').innerHTML = `
        <strong>Stake B sugerido</strong>
        <div class="kpi-value">${BSUI.money(r.stakeB)}</div>
        <div class="muted tiny">Profit equivalente A: ${BSUI.money(r.profitA)} · B: ${BSUI.money(r.profitB)}</div>`;
    });

    if (id === 'dutch') live(() => {
      const odds = root.querySelector('#d_o').value.split(',').map(s=>+s).filter(x=>x>1);
      const total = +root.querySelector('#d_t').value;
      const r = BSMath.dutch(odds, total);
      root.querySelector('#dOut').innerHTML = `
        <div class="grid grid-3 mt-3">
          ${odds.map((o, i) => `<div class="card card-tinted card-pad-sm"><div class="muted tiny">Cuota ${o.toFixed(2)}</div><strong class="num">${BSUI.money(r.stakes[i])}</strong></div>`).join('')}
        </div>
        <div class="row between mt-3"><span>Profit (cualquier outcome gana)</span><strong class="text-success">${BSUI.money(r.profit)}</strong></div>`;
    });

    if (id === 'arb') live(() => {
      const a = +root.querySelector('#a_a').value;
      const b = +root.querySelector('#a_b').value;
      const total = +root.querySelector('#a_t').value;
      const sb = BSMath.surebet([a, b]);
      const st = BSMath.surebetStakes([a, b], total);
      root.querySelector('#aOut').innerHTML = `
        <div class="row between mt-3"><span>¿Es surebet?</span><strong class="${sb.isSure?'text-success':'text-danger'}">${sb.isSure?'Sí ✓':'No'}</strong></div>
        <div class="row between"><span>ROI</span><strong class="num">${sb.roi.toFixed(2)}%</strong></div>
        <div class="grid grid-2 mt-2">
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Stake A (${a.toFixed(2)})</div><strong class="num">${BSUI.money(st.stakes[0])}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Stake B (${b.toFixed(2)})</div><strong class="num">${BSUI.money(st.stakes[1])}</strong></div>
        </div>
        <div class="row between mt-2"><span>Profit garantizado</span><strong class="text-success">${BSUI.money(st.profit)}</strong></div>`;
    });

    if (id === 'parlay') live(() => {
      const odds = root.querySelector('#p_o').value.split(',').map(s=>+s).filter(x=>x>1);
      const stake = +root.querySelector('#p_s').value;
      const total = odds.reduce((a, b) => a * b, 1);
      const payout = stake * total;
      const profit = payout - stake;
      const implied = total > 0 ? 1 / total : 0;
      root.querySelector('#pOut').innerHTML = `
        <div class="grid grid-3 mt-3">
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Cuota total</div><strong class="num">${total.toFixed(2)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Payout</div><strong class="num">${BSUI.money(payout)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Probabilidad implícita</div><strong class="num">${BSUI.pct(implied)}</strong></div>
        </div>`;
    });

    if (id === 'freebet') live(() => {
      const s = +root.querySelector('#fb_s').value;
      const o = +root.querySelector('#fb_o').value;
      const profit = BSMath.freeBetSnr(s, o);
      root.querySelector('#fbOut').innerHTML = `<div class="row between mt-3"><span>Profit potencial</span><strong class="text-success num">${BSUI.money(profit)}</strong></div>`;
    });

    if (id === 'clv') live(() => {
      const t = +root.querySelector('#clv_t').value;
      const c = +root.querySelector('#clv_c').value;
      const r = BSMath.clv(1/c, t);
      root.querySelector('#clvOut').innerHTML = `<div class="row between mt-3"><span>CLV</span><strong class="${r>0?'text-success':'text-danger'} num">${r.toFixed(2)}%</strong></div><p class="muted tiny mt-2">${r>0?'Tomaste mejor cuota que la línea de cierre. Indicador de skill.':'Tomaste peor cuota que la línea de cierre.'}</p>`;
    });

    if (id === 'drawdown') live(() => {
      const p = +root.querySelector('#dd_p').value;
      const e = +root.querySelector('#dd_e').value;
      const n = +root.querySelector('#dd_n').value;
      const dd = BSMath.drawdownEstimate(p, e, n);
      root.querySelector('#ddOut').innerHTML = `<div class="row between mt-3"><span>Drawdown estimado (95%)</span><strong class="text-danger num">${BSUI.pct(Math.max(-1, dd / n))}</strong></div>`;
    });

    if (id === 'middle') live(() => {
      const o1 = +root.querySelector('#m_o1').value;
      const o2 = +root.querySelector('#m_o2').value;
      const s1 = +root.querySelector('#m_s1').value;
      const s2 = +root.querySelector('#m_s2').value;
      const r = BSMath.middling(o1, o2, s1, s2);
      root.querySelector('#mOut').innerHTML = `
        <div class="grid grid-2 mt-3">
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win-both (middle)</div><strong class="text-success num">${BSUI.money(r.winBoth)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win-one A</div><strong class="num">${BSUI.money(r.winOne1)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win-one B</div><strong class="num">${BSUI.money(r.winOne2)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Lose-both</div><strong class="text-danger num">${BSUI.money(r.loseBoth)}</strong></div>
        </div>`;
    });
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('calc', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('calc', render));
  }
  doRegister();
  window.__bsCalcRender = render;
})();
