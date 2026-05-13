/* BetSafe — What-If Simulator (VIP) */
(function () {
  'use strict';

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">What-If Simulator<a class="help-q" tabindex="0" data-tip="Simulación de escenarios sobre tu combinada. Calculamos profit en cada combinación posible de victorias/derrotas + Monte Carlo con 1000+ runs aleatorios para ver la distribución completa de outcomes."></a></h2><p class="muted">Simulación de escenarios + Monte Carlo.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }
    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">What-If Simulator<a class="help-q" tabindex="0" data-tip="Cada leg de tu combinada puede ganar o perder. Si tenés N legs, hay 2 elevado a N escenarios totales (ej: 3 legs = 8 escenarios). Te mostramos la probabilidad de cada uno y el profit/pérdida. Plus Monte Carlo con 1000+ runs para distribución estadística."></a></h2>
          <p class="muted">Simulá todos los escenarios posibles de tu combinada antes de operarla. Cada leg puede ganar o perder — te mostramos la probabilidad y profit de cada combinación.</p>
        </div>
      </div>
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap:16px">
        <div class="card stack">
          <strong>Legs</strong>
          <div id="wfLegs" class="stack-sm"></div>
          <button class="btn btn-outline btn-sm" id="wfAdd">+ Leg</button>
          <label class="field mt-2"><span class="field-label">Stake</span><input class="input" id="wfStake" type="number" value="1000"></label>
          <div class="row gap-2">
            <button class="btn btn-primary" id="wfRun">Correr simulación</button>
            <button class="btn btn-outline" id="wfMC">Monte Carlo</button>
          </div>
        </div>
        <div class="card stack">
          <strong>Resultados</strong>
          <div id="wfOut" style="min-height:240px"></div>
        </div>
      </div>
    `;

    // Cargar legs desde el slip activo del user si existe — sino defaults
    // razonables. Probabilidades se estiman vía Shin no-vig (1/cuota descontando
    // margen) cuando vienen del slip.
    const slip = BSStore.get(BSStore.KEYS.slip) || { legs: [] };
    let legs = (slip.legs && slip.legs.length)
      ? slip.legs.slice(0, 8).map(l => ({
          p: l.odd ? Math.min(0.99, Math.max(0.01, (1 / l.odd) * 0.92)) : 0.5,   // Shin aprox
          odd: Number(l.odd) || 2.0,
          label: l.label || `${l.home || '?'} vs ${l.away || '?'}`
        }))
      : [{p:0.55, odd:1.95, label:'Leg 1'}, {p:0.6, odd:1.85, label:'Leg 2'}, {p:0.5, odd:2.10, label:'Leg 3'}];
    function renderLegs() {
      const ls = panel.querySelector('#wfLegs');
      ls.innerHTML = legs.map((l, i) => `
        <div class="row gap-2">
          <input class="input" type="number" min="0" max="1" step="0.01" value="${l.p}" data-p="${i}" placeholder="prob">
          <input class="input" type="number" min="1.01" step="0.01" value="${l.odd}" data-o="${i}" placeholder="cuota">
          <button class="btn-ghost btn-icon" data-rm="${i}">×</button>
        </div>`).join('');
      ls.querySelectorAll('[data-p]').forEach(i => i.addEventListener('input', e => legs[Number(e.target.dataset.p)].p = +e.target.value));
      ls.querySelectorAll('[data-o]').forEach(i => i.addEventListener('input', e => legs[Number(e.target.dataset.o)].odd = +e.target.value));
      ls.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { legs.splice(Number(b.dataset.rm), 1); renderLegs(); }));
    }
    panel.querySelector('#wfAdd').addEventListener('click', () => { if (legs.length < 8) { legs.push({p:0.5, odd:2.0}); renderLegs(); } });
    panel.querySelector('#wfRun').addEventListener('click', () => {
      const stake = +panel.querySelector('#wfStake').value;
      const r = BSMath.whatIf(legs, stake);
      const totalProb = legs.reduce((a,b)=>a*b.p,1);
      const totalOdd = legs.reduce((a,b)=>a*b.odd,1);
      const ev = stake * (totalProb * (totalOdd - 1) - (1 - totalProb));
      panel.querySelector('#wfOut').innerHTML = `
        <div class="grid grid-3 gap-2">
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Cuota total</div><strong class="num">${totalOdd.toFixed(2)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">P(todo gana)</div><strong>${BSUI.pct(totalProb)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">EV</div><strong class="${ev>0?'text-success':'text-danger'} num">${BSUI.money(ev)}</strong></div>
        </div>
        <div class="table-wrap mt-3"><table class="table"><thead><tr><th>Bits</th><th>Prob</th><th>Profit</th></tr></thead><tbody>${r.slice(0,16).map(x => `<tr><td class="mono">${x.mask.toString(2).padStart(legs.length,'0')}</td><td class="num">${BSUI.pct(x.prob)}</td><td class="num ${x.profit>=0?'text-success':'text-danger'}">${BSUI.money(x.profit)}</td></tr>`).join('')}</tbody></table></div>
      `;
    });
    panel.querySelector('#wfMC').addEventListener('click', () => {
      const stake = +panel.querySelector('#wfStake').value;
      const r = BSMath.monteCarlo({ legs, stake, runs: 1000 });
      panel.querySelector('#wfOut').innerHTML = `
        <strong>Monte Carlo · 1000 runs</strong>
        <div class="grid grid-3 mt-3 gap-2">
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Mediana</div><strong class="num">${BSUI.money(r.median)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">P5</div><strong class="text-danger num">${BSUI.money(r.p5)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">P95</div><strong class="text-success num">${BSUI.money(r.p95)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win rate</div><strong>${(r.hits/r.runs*100).toFixed(1)}%</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Promedio</div><strong class="num">${BSUI.money(r.mean)}</strong></div>
        </div>`;
    });
    renderLegs();
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('whatif', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('whatif', render));
  }
  doRegister();
  window.__bsWhatifRender = render;
})();
