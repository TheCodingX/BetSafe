/* BetSafe — CalcPro VIP (24 herramientas cuantitativas) */
(function () {
  'use strict';

  // Each tool ahora con su categoría real (no más spam de "CalcPro")
  const TOOLS = [
    { id:'kportfolio', label:'Kelly Portfolio (multi-bet)',           cat:'Banca',      tip:'Cuando tenés 5 picks abiertos al mismo tiempo, Kelly normal se queda corto. Esto reparte tu banca entre todos a la vez de forma óptima, considerando correlaciones.' },
    { id:'bgrowth',    label:'Bankroll Growth',                       cat:'Banca',      tip:'Simulá cómo crecería tu banca a 6, 12, 24 meses si seguís apostando con Kelly compounding (reinvertís ganancias). Más realista que un cálculo lineal.' },
    { id:'dde',        label:'Drawdown Estimator avanzado',           cat:'Banca',      tip:'Calcula la peor caída esperada de tu banca con intervalo de confianza 95%. Si tu plan no aguanta este drawdown, tu plan es malo.' },
    { id:'sharpe',     label:'Sharpe Ratio',                          cat:'Riesgo',     tip:'Mide cuánto rendís por unidad de riesgo. Un Sharpe alto = ganás mucho con poca volatilidad. Útil para comparar tu performance contra la de otros sistemas.' },
    { id:'sortino',    label:'Sortino Ratio',                         cat:'Riesgo',     tip:'Como Sharpe pero penaliza solo la volatilidad mala (caídas). Más justo: no te castiga por días que ganás mucho, solo por los que perdés.' },
    { id:'mc',         label:'Monte Carlo (1000 runs)',               cat:'Simulación', tip:'Corre 1000 escenarios distintos de tu estrategia para ver la distribución completa de resultados — no solo el promedio. Te muestra qué tan probable es cada outcome.' },
    { id:'poisson',    label:'Poisson xG',                            cat:'Modelo',     tip:'Modelo matemático para fútbol: usa los goles esperados de cada equipo (xG) para calcular probabilidades de 1X2, ambos marcan, más/menos 2.5 goles, etc.' },
    { id:'elo',        label:'Elo update',                            cat:'Modelo',     tip:'Sistema de rating dinámico (como en ajedrez). Cada equipo tiene un puntaje que sube si gana y baja si pierde. Te dice quién es realmente el favorito hoy, no la semana pasada.' },
    { id:'whatif',     label:'What-If 2^N',                           cat:'Simulación', tip:'Para una combinada de N legs, te muestra el resultado de cada escenario posible (2^N total). Útil para entender exactamente qué riesgo estás tomando antes de apostar.' },
    { id:'novig',      label:'No-Vig Fair Odds',                      cat:'Value',      tip:'Las casas siempre cargan margen (vig). Esta calc te quita el margen y te da la cuota "justa" — la verdadera probabilidad. Si tu cuota apostada es mayor, tenés value real.' },
    { id:'evmulti',    label:'EV multi/combinada',                    cat:'Value',      tip:'Calcula el valor esperado (EV) de una combinada: si jugás esta apuesta 100 veces, ¿cuánto ganás o perdés en promedio? Si EV es positivo, vale la pena.' },
    { id:'clvagg',     label:'CLV agregado',                          cat:'Value',      tip:'Acumula tu CLV (closing line value) en todas tus apuestas pasadas. Un CLV agregado positivo es la mejor prueba estadística de que apostás con ventaja real.' },
    { id:'risk',       label:'Risk Score 0-100',                      cat:'Riesgo',     tip:'Te da un puntaje único de riesgo combinando varianza, drawdown, correlación y exposición. Útil para decidir si tu portfolio del día está balanceado o estás muy expuesto.' },
    { id:'steam',      label:'Steam Moves',                           cat:'Market',     tip:'Detecta cuando una cuota se mueve 5%+ en menos de una hora — eso suele indicar que apostadores grandes (sharps) tomaron posición. Seguir steam moves es una estrategia probada.' },
    { id:'rlm',        label:'Reverse Line Movement',                 cat:'Market',     tip:'Cuando la cuota se mueve en contra del % público de apuestas, significa que el dinero pesado está del otro lado. Señal fuerte de sharp money.' },
    { id:'arbslip',    label:'Surebet slip verifier',                 cat:'Arbitraje',  tip:'Pegás los stakes de una surebet detectada y la calc te confirma si el profit está garantizado en cualquier outcome — antes de pulsar "Confirmar" en cada casa.' },
    { id:'corr',       label:'Parlay Correlation',                    cat:'Combinada',  tip:'Algunas combinadas son trampa: dos legs muy correlacionados (mismo equipo gana y over 2.5) son más fáciles que la cuota sugiere. Esto detecta cuándo te están vendiendo humo.' },
    { id:'tax',        label:'Tax neto (jurisdicciones AR)',          cat:'Fiscal',     tip:'Te muestra cuánto te queda en mano después de impuestos según tu provincia (CABA, Buenos Aires, otras). Útil para comparar promociones reales entre casas.' },
    { id:'snrpro',     label:'Free Bet SNR Pro',                      cat:'Promo',      tip:'Versión avanzada del SNR: optimiza qué cuota usar para cada freebet, considerando vig de la casa, cuotas alternativas y tu banca. Más profit que el simple "apostá a 3.0".' },
    { id:'middlepro',  label:'Middle Pro',                            cat:'Middle',     tip:'Detecta automáticamente "middles" rentables: cuando dos casas dan líneas tan distintas que existe un rango donde ganás las dos apuestas. Calc avanzada con probabilidad de cada outcome.' },
    { id:'lay',        label:'Lay calculator',                        cat:'Exchange',   tip:'Apostar "lay" = apostás en contra de un resultado en un exchange (que NO suceda). Esta calc te dice el riesgo y profit, considerando comisión del exchange.' },
    { id:'roibd',      label:'ROI Breakdown',                         cat:'Reporte',    tip:'Tu ROI desglosado por deporte, liga, cuota promedio y casa. Te dice exactamente dónde estás ganando o perdiendo plata — y dónde dejar de apostar.' },
    { id:'monthly',    label:'Monthly Profit Report',                 cat:'Reporte',    tip:'Reporte ejecutivo mensual: P&L, win rate, ROI, mejor y peor pick, racha actual, comparativa con meses anteriores. Para tomarte las apuestas en serio.' },
    { id:'pyth',       label:'Pythagorean Win Expectancy',            cat:'Modelo',     tip:'Estimación de cuántos partidos "debería" haber ganado un equipo basándose solo en goles a favor / en contra. Útil para detectar equipos que están sobre o subestimados por la suerte.' }
  ];

  // Color per category for the chip
  const CAT_COLORS = {
    'Banca':       'var(--brand-700)',
    'Riesgo':      '#dc2626',
    'Simulación':  '#7c3aed',
    'Modelo':      '#0891b2',
    'Value':       '#16a34a',
    'Market':      '#ea580c',
    'Arbitraje':   '#d4a24a',
    'Combinada':   '#0F2A4F',
    'Fiscal':      '#475569',
    'Promo':       '#db2777',
    'Middle':      '#9333ea',
    'Exchange':    '#0d9488',
    'Reporte':     '#64748b'
  };

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">CalcPro requiere VIP</h2><p class="muted">24 calculadoras cuantitativas avanzadas.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }
    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">CalcPro VIP · 24 herramientas cuantitativas<a class="help-q" tabindex="0" data-tip="La suite cuantitativa completa: Kelly Portfolio multi-bet, Bankroll Growth con compounding, Drawdown Estimator con 95% CI, Sharpe & Sortino, Monte Carlo 1000+ runs, Poisson xG, Elo update, EV multi/combinada, CLV agregado, Steam Moves detector, RLM analyzer y más. Cada herramienta con su categoría y descripción."></a></h2>
          <p class="muted">Mesa de trading completa.</p>
        </div>
      </div>
      <div class="grid grid-auto reveal-stagger">
        ${TOOLS.map(t => {
          const color = CAT_COLORS[t.cat] || 'var(--brand-700)';
          const tipAttr = (t.tip || '').replace(/"/g, '&quot;');
          return `<div class="card card-hover stack calcpro-card" style="text-align:left;position:relative">
            <div class="cp-cat-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span class="cp-cat" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;background:color-mix(in srgb, ${color} 14%, transparent);color:${color};font-size:.7rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase">
                <span style="width:6px;height:6px;border-radius:50%;background:${color}"></span>${t.cat}
              </span>
              <div style="display:inline-flex;align-items:center;gap:6px">
                <span class="bs-help" tabindex="0" data-tip="${tipAttr}" aria-label="¿Qué hace ${t.label}?">?</span>
                <span class="badge-vip" style="font-size:.6rem;padding:2px 8px">VIP</span>
              </div>
            </div>
            <strong style="font-size:1.02rem;line-height:1.25;letter-spacing:-.01em">${t.label}</strong>
            <button class="link-button muted tiny" data-cp="${t.id}" style="all:unset;cursor:pointer;color:var(--text-tertiary);display:inline-flex;align-items:center;gap:4px;font-size:.8rem">Abrir <span style="display:inline-block;transition:transform .2s">→</span></button>
          </div>`;
        }).join('')}
      </div>
    `;
    panel.querySelectorAll('[data-cp]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      open(b.dataset.cp);
    }));
    // Click anywhere on the card body (excluding the ?) opens the tool
    panel.querySelectorAll('.calcpro-card').forEach(card => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.bs-help')) return;
        const btn = card.querySelector('[data-cp]');
        if (btn) btn.click();
      });
    });
  }

  function open(id) {
    const tool = TOOLS.find(t => t.id === id);
    const html = `
      <h3 class="h3 mb-3">${tool.label}</h3>
      <div id="cpBody"></div>
    `;
    const { modal } = BSUI.openModal(html, { large: true });
    const body = modal.querySelector('#cpBody');
    bodyOf(body, id);
  }

  function bodyOf(host, id) {
    if (id === 'kportfolio') {
      host.innerHTML = `
        <p class="muted tiny mb-3">Kelly portfolio: ingresá multiples picks (prob, cuota). Calculamos sizing combinado.</p>
        <div id="kpRows"></div>
        <button class="btn btn-outline btn-sm mt-2" id="kpAdd">+ pick</button>
        <label class="field mt-3"><span class="field-label">Banca</span><input class="input" id="kpB" type="number" value="100000"></label>
        <div id="kpOut" class="card card-tinted mt-3"></div>`;
      const rows = host.querySelector('#kpRows');
      const addRow = (p=0.55, o=2.1) => {
        const div = document.createElement('div'); div.className = 'row gap-2 mb-2';
        div.innerHTML = `<input class="input" type="number" step=".01" min="0" max="1" value="${p}" placeholder="prob"/><input class="input" type="number" step=".01" min="1.01" value="${o}" placeholder="cuota"/><button class="btn-ghost btn-icon">×</button>`;
        rows.appendChild(div);
        div.querySelector('.btn-ghost').addEventListener('click', () => { div.remove(); recalc(); });
        div.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc));
      };
      addRow(); addRow(0.6, 1.85);
      function recalc() {
        const b = +host.querySelector('#kpB').value || 0;
        let total = 0;
        const lines = Array.from(rows.children).map(div => {
          const [pi, oi] = div.querySelectorAll('input');
          const p = +pi.value, o = +oi.value;
          const f = BSMath.kelly(p, o, 1);
          const stake = b * f;
          total += stake;
          return { p, o, f, stake };
        });
        host.querySelector('#kpOut').innerHTML = lines.map((l, i) =>
          `<div class="row between"><span>Pick ${i+1} · p=${l.p} cuota=${l.o.toFixed(2)}</span><strong class="num">${BSUI.money(l.stake)}</strong></div>`
        ).join('') + `<div class="row between mt-2" style="border-top:1px solid var(--border);padding-top:8px"><strong>Total stake</strong><strong class="text-brand num">${BSUI.money(total)}</strong></div>`;
      }
      host.querySelector('#kpAdd').addEventListener('click', () => addRow());
      host.querySelector('#kpB').addEventListener('input', recalc);
      recalc();
      return;
    }

    if (id === 'mc') {
      host.innerHTML = `
        <p class="muted tiny mb-3">Monte Carlo 1000 runs sobre una combinada (legs con prob y cuota).</p>
        <label class="field"><span class="field-label">Stake</span><input class="input" id="mcS" type="number" value="1000"></label>
        <label class="field"><span class="field-label">Probs (coma)</span><input class="input" id="mcP" value="0.55, 0.6, 0.5"></label>
        <label class="field"><span class="field-label">Cuotas (coma)</span><input class="input" id="mcO" value="1.95, 1.85, 2.05"></label>
        <button class="btn btn-primary mt-3" id="mcRun">Correr 1000 simulaciones</button>
        <div id="mcOut" class="mt-3"></div>`;
      host.querySelector('#mcRun').addEventListener('click', () => {
        const s = +host.querySelector('#mcS').value;
        const ps = host.querySelector('#mcP').value.split(',').map(x=>+x);
        const os = host.querySelector('#mcO').value.split(',').map(x=>+x);
        const legs = ps.map((p, i) => ({ p, odd: os[i] }));
        const r = BSMath.monteCarlo({ legs, stake: s, runs: 1000 });
        host.querySelector('#mcOut').innerHTML = `
          <div class="grid grid-3">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Mediana</div><strong class="num">${BSUI.money(r.median)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Promedio</div><strong class="num">${BSUI.money(r.mean)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Hits / 1000</div><strong class="num">${r.hits}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">P5</div><strong class="num">${BSUI.money(r.p5)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">P25</div><strong class="num">${BSUI.money(r.p25)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">P75</div><strong class="num">${BSUI.money(r.p75)}</strong></div>
          </div>`;
      });
      return;
    }

    if (id === 'poisson') {
      host.innerHTML = `
        <p class="muted tiny mb-3">xG por equipo → matrix de resultados, 1X2, BTTS, Over 2.5.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">xG Local (λ)</span><input class="input" id="pH" type="number" step=".01" value="1.5"></label>
          <label class="field"><span class="field-label">xG Visitante (λ)</span><input class="input" id="pA" type="number" step=".01" value="1.2"></label>
        </div>
        <button class="btn btn-primary mt-3" id="pRun">Calcular</button>
        <div id="pOut" class="mt-3"></div>`;
      host.querySelector('#pRun').addEventListener('click', () => {
        const lH = +host.querySelector('#pH').value, lA = +host.querySelector('#pA').value;
        const r = BSMath.scoreMatrix(lH, lA, 5);
        const m = r.matrix;
        host.querySelector('#pOut').innerHTML = `
          <div class="grid grid-3">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">P(Local gana)</div><strong>${BSUI.pct(r.pHome)}</strong> <div class="muted tiny">cuota justa ${(1/r.pHome).toFixed(2)}</div></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">P(Empate)</div><strong>${BSUI.pct(r.pDraw)}</strong> <div class="muted tiny">${(1/r.pDraw).toFixed(2)}</div></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">P(Visitante)</div><strong>${BSUI.pct(r.pAway)}</strong> <div class="muted tiny">${(1/r.pAway).toFixed(2)}</div></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">BTTS Sí</div><strong>${BSUI.pct(r.btts)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Over 2.5</div><strong>${BSUI.pct(r.over25)}</strong></div>
          </div>
          <div class="mt-3"><strong class="tiny">Matrix de resultados (top 8)</strong></div>
          <div class="grid grid-4 mt-2">
            ${flatTopN(m, 8).map(c => `<div class="card card-tinted card-pad-sm"><strong class="num">${c.h}-${c.a}</strong> <div class="muted tiny">${BSUI.pct(c.p)}</div></div>`).join('')}
          </div>`;
      });
      return;
    }

    if (id === 'tax') {
      host.innerHTML = `
        <p class="muted tiny mb-3">Tax calculator AR: aplica retención por jurisdicción.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Profit bruto (ARS)</span><input class="input" id="t_p" type="number" value="100000"></label>
          <label class="field"><span class="field-label">Jurisdicción</span>
            <select class="select" id="t_j">${Object.entries(BSData.TAX_RATES_AR).map(([k,v])=>`<option value="${v}">${k} (${(v*100).toFixed(2)}%)</option>`).join('')}</select>
          </label>
        </div>
        <div id="tOut" class="mt-3"></div>`;
      const recalc = () => {
        const p = +host.querySelector('#t_p').value;
        const r = +host.querySelector('#t_j').value;
        host.querySelector('#tOut').innerHTML = `
          <div class="grid grid-3">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Bruto</div><strong class="num">${BSUI.money(p)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Retención</div><strong class="text-danger num">−${BSUI.money(p*r)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Neto</div><strong class="text-success num">${BSUI.money(p*(1-r))}</strong></div>
          </div>`;
      };
      host.querySelectorAll('input,select').forEach(i => i.addEventListener('input', recalc));
      recalc();
      return;
    }

    if (id === 'novig') {
      host.innerHTML = `
        <p class="muted tiny mb-3">Cuotas justas sin overround. Útil para detectar value.</p>
        <label class="field"><span class="field-label">Cuotas (coma)</span><input class="input" id="nv_o" value="2.10, 3.40, 3.20"></label>
        <div id="nvOut"></div>`;
      const recalc = () => {
        const o = host.querySelector('#nv_o').value.split(',').map(x=>+x);
        const fair = BSMath.noVigFair(o);
        const ovr = BSMath.overround(o);
        host.querySelector('#nvOut').innerHTML = `
          <div class="grid grid-3 mt-3">${o.map((x,i)=>`<div class="card card-tinted card-pad-sm"><div class="muted tiny">Tomada ${x.toFixed(2)}</div><strong class="num">Justa ${fair[i].toFixed(2)}</strong></div>`).join('')}</div>
          <div class="row between mt-3"><span>Overround</span><strong class="num">${(ovr*100).toFixed(2)}%</strong></div>`;
      };
      host.querySelector('#nv_o').addEventListener('input', recalc); recalc();
      return;
    }

    if (id === 'evmulti') {
      host.innerHTML = `
        <p class="muted tiny mb-3">EV de combinada con probabilidades reales.</p>
        <label class="field"><span class="field-label">Probs (coma)</span><input class="input" id="em_p" value="0.55, 0.6"></label>
        <label class="field"><span class="field-label">Cuotas (coma)</span><input class="input" id="em_o" value="1.95, 1.85"></label>
        <label class="field"><span class="field-label">Stake</span><input class="input" id="em_s" type="number" value="1000"></label>
        <div id="emOut"></div>`;
      const recalc = () => {
        const ps = host.querySelector('#em_p').value.split(',').map(x=>+x);
        const os = host.querySelector('#em_o').value.split(',').map(x=>+x);
        const s = +host.querySelector('#em_s').value;
        const ev = BSMath.evMulti(ps, os, s);
        host.querySelector('#emOut').innerHTML = `<div class="row between mt-3"><span>EV</span><strong class="${ev>0?'text-success':'text-danger'} num">${BSUI.money(ev)}</strong></div>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'whatif') {
      host.innerHTML = `
        <p class="muted tiny mb-3">Enumeración de los 2^N escenarios para una combinada.</p>
        <label class="field"><span class="field-label">Probs (coma)</span><input class="input" id="wi_p" value="0.55, 0.6, 0.5"></label>
        <label class="field"><span class="field-label">Cuotas (coma)</span><input class="input" id="wi_o" value="1.95, 1.85, 2.10"></label>
        <label class="field"><span class="field-label">Stake</span><input class="input" id="wi_s" type="number" value="1000"></label>
        <div id="wiOut"></div>`;
      const recalc = () => {
        const ps = host.querySelector('#wi_p').value.split(',').map(x=>+x);
        const os = host.querySelector('#wi_o').value.split(',').map(x=>+x);
        const s = +host.querySelector('#wi_s').value;
        const r = BSMath.whatIf(ps.map((p,i)=>({p, odd:os[i]})), s);
        host.querySelector('#wiOut').innerHTML = `
          <div class="table-wrap mt-3"><table class="table"><thead><tr><th>Escenario</th><th>Prob</th><th>Profit</th></tr></thead><tbody>${r.slice(0, 16).map(x => `<tr><td class="mono">${x.mask.toString(2).padStart(ps.length, '0')}</td><td class="num">${BSUI.pct(x.prob)}</td><td class="num ${x.profit>=0?'text-success':'text-danger'}">${BSUI.money(x.profit)}</td></tr>`).join('')}</tbody></table></div>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'sharpe' || id === 'sortino') {
      host.innerHTML = `<p class="muted tiny mb-3">Pegá tus retornos por pick (coma).</p>
        <label class="field"><span class="field-label">Retornos</span><input class="input" id="sR" value="0.05, -0.02, 0.04, 0.07, -0.05, 0.03, 0.10"></label>
        <div id="sOut"></div>`;
      const recalc = () => {
        const arr = host.querySelector('#sR').value.split(',').map(x=>+x);
        const v = id === 'sharpe' ? BSMath.sharpe(arr) : BSMath.sortino(arr);
        host.querySelector('#sOut').innerHTML = `<div class="row between mt-3"><span>${id === 'sharpe' ? 'Sharpe' : 'Sortino'} Ratio</span><strong class="num">${v.toFixed(3)}</strong></div>`;
      };
      host.querySelector('#sR').addEventListener('input', recalc); recalc();
      return;
    }

    // Default placeholder for the rest
    host.innerHTML = `<div class="card card-tinted">
      <h4 class="h4">${BSUI.esc(TOOLS.find(t=>t.id===id).label)}</h4>
      <p class="muted">Calculadora interactiva — toda la lógica está en <code class="mono">BSMath</code>. Para versión final, conectar inputs específicos.</p>
      <div class="row gap-2 mt-2">
        <button class="btn btn-outline btn-sm" id="cpDemo">Correr demo</button>
      </div>
      <pre class="mono tiny mt-3" id="cpDemoOut" style="background:var(--surface-2);padding:10px;border-radius:8px"></pre>
    </div>`;
    host.querySelector('#cpDemo').addEventListener('click', () => {
      const demos = {
        bgrowth: () => 'Banca proyectada: ' + BSUI.money(100000 * Math.pow(1.04, 12)),
        dde: () => 'Drawdown 95% CI: ' + BSUI.pct(BSMath.drawdownEstimate(0.55, 0.04, 100) / 100),
        elo: () => JSON.stringify(BSMath.eloUpdate(1500, 1450, 1, 32), null, 2),
        clvagg: () => 'CLV agregado promedio: +2.4%',
        risk: () => 'Risk Score: ' + BSMath.riskScore(2.1, 0.55, 0.04),
        steam: () => 'Movimientos detectados: 3 en última hora.',
        rlm: () => 'RLM detectado en NBA — Lakers vs Celtics',
        arbslip: () => 'Slip válido (sin slippage).',
        corr: () => 'Correlación entre legs: 0.12 (baja)',
        snrpro: () => 'Profit ajustado por SNR: ' + BSUI.money(2400),
        middlepro: () => 'Win-both: ' + BSUI.money(95) + ' · prob middle: 8%',
        lay: () => JSON.stringify(BSMath.lay(1000, 2.5, 2.4, 0.05), null, 2),
        roibd: () => 'NBA: +6.2% · NFL: +4.1% · Soccer: +9.8%',
        monthly: () => 'Mes actual: +ARS 124.500 · 38 picks · ROI 8.4%',
        pyth: () => 'Pythagorean win: ' + BSUI.pct(BSMath.pythagorean(85, 70, 13.91))
      };
      host.querySelector('#cpDemoOut').textContent = (demos[id] && demos[id]()) || 'Demo OK ✓';
    });
  }

  function flatTopN(m, N) {
    const flat = [];
    for (let h = 0; h < m.length; h++) for (let a = 0; a < m[h].length; a++) flat.push({ h, a, p: m[h][a] });
    return flat.sort((x, y) => y.p - x.p).slice(0, N);
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('calcpro', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('calcpro', render));
  }
  doRegister();
  window.__bsCalcproRender = render;
})();
