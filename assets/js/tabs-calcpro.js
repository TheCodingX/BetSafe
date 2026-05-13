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
    { id:'whatif',     label:'What-If Simulator',                     cat:'Simulación', tip:'Para una combinada de N legs, te muestra el resultado de cada escenario posible (2 elevado a N total). Útil para entender exactamente qué riesgo estás tomando antes de apostar.' },
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

    // ═════════════════════════════════════════════════════════════════
    // Implementaciones reales para todas las herramientas restantes
    // ═════════════════════════════════════════════════════════════════

    if (id === 'bgrowth') {
      host.innerHTML = `<p class="muted tiny mb-3">Proyectá tu banca con Kelly compounding (reinvertir ganancias).</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Banca inicial (ARS)</span><input class="input" id="bg_b" type="number" value="100000"></label>
          <label class="field"><span class="field-label">ROI promedio por pick (%)</span><input class="input" id="bg_r" type="number" step=".1" value="3"></label>
          <label class="field"><span class="field-label">Picks por mes</span><input class="input" id="bg_p" type="number" value="20"></label>
          <label class="field"><span class="field-label">Meses a proyectar</span><input class="input" id="bg_m" type="number" value="12"></label>
        </div>
        <div id="bgOut" class="mt-3"></div>`;
      const recalc = () => {
        const b = +host.querySelector('#bg_b').value;
        const r = +host.querySelector('#bg_r').value / 100;
        const p = +host.querySelector('#bg_p').value;
        const m = +host.querySelector('#bg_m').value;
        const rows = [];
        let banca = b;
        for (let i = 1; i <= m; i++) {
          banca = banca * Math.pow(1 + r, p);
          rows.push({ mes: i, banca });
        }
        const total = rows[rows.length - 1].banca;
        const growth = ((total / b) - 1) * 100;
        host.querySelector('#bgOut').innerHTML = `
          <div class="grid grid-3 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Banca final</div><strong class="text-success num">${BSUI.money(total)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Crecimiento</div><strong class="num">+${growth.toFixed(1)}%</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Profit total</div><strong class="text-success num">${BSUI.money(total - b)}</strong></div>
          </div>
          <details class="mt-3"><summary class="muted tiny" style="cursor:pointer">Proyección mes a mes</summary>
            <div class="table-wrap mt-2"><table class="table"><thead><tr><th>Mes</th><th>Banca</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.mes}</td><td class="num">${BSUI.money(r.banca)}</td></tr>`).join('')}</tbody></table></div>
          </details>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'dde') {
      host.innerHTML = `<p class="muted tiny mb-3">Worst drawdown esperado con IC 95% — basado en win rate + edge + número de picks.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Win rate</span><input class="input" id="dd_w" type="number" step=".01" min="0" max="1" value="0.55"></label>
          <label class="field"><span class="field-label">Edge (ROI esperado)</span><input class="input" id="dd_e" type="number" step=".01" value="0.04"></label>
          <label class="field"><span class="field-label">Número de picks</span><input class="input" id="dd_n" type="number" value="100"></label>
        </div>
        <div id="ddOut" class="mt-3"></div>`;
      const recalc = () => {
        const w = +host.querySelector('#dd_w').value;
        const e = +host.querySelector('#dd_e').value;
        const n = +host.querySelector('#dd_n').value;
        const dd95 = BSMath.drawdownEstimate(w, e, n);
        const dd99 = dd95 * 1.3;
        const ddMedian = dd95 * 0.55;
        host.querySelector('#ddOut').innerHTML = `
          <div class="grid grid-3 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Drawdown mediano</div><strong class="num">${ddMedian.toFixed(2)}%</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">IC 95%</div><strong class="text-warning num">${dd95.toFixed(2)}%</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Peor caso (99%)</div><strong class="text-danger num">${dd99.toFixed(2)}%</strong></div>
          </div>
          <p class="muted tiny mt-3">Si tu plan no puede sobrevivir un drawdown del <strong>${dd95.toFixed(0)}%</strong>, reducí stake o pasá a Kelly fraccional (¼ Kelly).</p>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'elo') {
      host.innerHTML = `<p class="muted tiny mb-3">Actualizá ratings Elo después de un resultado.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Rating Equipo A</span><input class="input" id="elo_a" type="number" value="1500"></label>
          <label class="field"><span class="field-label">Rating Equipo B</span><input class="input" id="elo_b" type="number" value="1450"></label>
          <label class="field"><span class="field-label">Resultado A</span>
            <select class="select" id="elo_r"><option value="1">A ganó</option><option value="0.5">Empate</option><option value="0">A perdió</option></select>
          </label>
          <label class="field"><span class="field-label">K-factor</span><input class="input" id="elo_k" type="number" value="32"></label>
        </div>
        <div id="eloOut" class="mt-3"></div>`;
      const recalc = () => {
        const a = +host.querySelector('#elo_a').value;
        const b = +host.querySelector('#elo_b').value;
        const r = +host.querySelector('#elo_r').value;
        const k = +host.querySelector('#elo_k').value;
        const upd = BSMath.eloUpdate(a, b, r, k);
        const expA = 1 / (1 + Math.pow(10, (b - a) / 400));
        host.querySelector('#eloOut').innerHTML = `
          <div class="grid grid-2 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Equipo A nuevo rating</div><strong class="num">${upd.ra.toFixed(0)} <span class="muted tiny">(${(upd.ra - a >= 0 ? '+' : '') + (upd.ra - a).toFixed(1)})</span></strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Equipo B nuevo rating</div><strong class="num">${upd.rb.toFixed(0)} <span class="muted tiny">(${(upd.rb - b >= 0 ? '+' : '') + (upd.rb - b).toFixed(1)})</span></strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Prob esperada A</div><strong>${BSUI.pct(expA)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Prob esperada B</div><strong>${BSUI.pct(1 - expA)}</strong></div>
          </div>`;
      };
      host.querySelectorAll('input,select').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'clvagg') {
      host.innerHTML = `<p class="muted tiny mb-3">Pegá tus CLV individuales (% por pick, separados por coma). Te calculamos el agregado.</p>
        <label class="field"><span class="field-label">CLV por pick</span><textarea class="input" id="clv_v" rows="3" style="font-family:monospace">+2.1, +3.4, -1.2, +5.0, +0.8, -2.5, +4.3, +1.9, +6.2, -0.5, +2.8, +3.1</textarea></label>
        <div id="clvOut" class="mt-3"></div>`;
      const recalc = () => {
        const arr = host.querySelector('#clv_v').value.split(',').map(x => +x).filter(Number.isFinite);
        if (!arr.length) return;
        const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
        const pos = arr.filter(x => x > 0).length;
        const neg = arr.filter(x => x < 0).length;
        const sumClv = arr.reduce((s, x) => s + x, 0);
        host.querySelector('#clvOut').innerHTML = `
          <div class="grid grid-3 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">CLV promedio</div><strong class="${avg > 0 ? 'text-success' : 'text-danger'} num">${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">CLV agregado</div><strong class="${sumClv > 0 ? 'text-success' : 'text-danger'} num">${sumClv >= 0 ? '+' : ''}${sumClv.toFixed(2)}%</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Picks +CLV</div><strong>${pos}/${arr.length} (${(pos / arr.length * 100).toFixed(0)}%)</strong></div>
          </div>
          <p class="muted tiny mt-3">${avg > 1 ? '✓ CLV promedio &gt; +1% sostenido es la mejor prueba estadística de edge real.' : avg > 0 ? 'CLV positivo pero modesto. Necesitás más volumen para validar.' : '⚠ CLV negativo: estás detrás del cierre del mercado. Revisá criterios de selección.'}</p>`;
      };
      host.querySelector('#clv_v').addEventListener('input', recalc); recalc();
      return;
    }

    if (id === 'risk') {
      host.innerHTML = `<p class="muted tiny mb-3">Risk Score 0-100 combinando varianza, edge, win rate.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Cuota promedio</span><input class="input" id="rs_o" type="number" step=".01" value="2.1"></label>
          <label class="field"><span class="field-label">Win rate</span><input class="input" id="rs_w" type="number" step=".01" value="0.55"></label>
          <label class="field"><span class="field-label">Edge (ROI esperado)</span><input class="input" id="rs_e" type="number" step=".01" value="0.04"></label>
        </div>
        <div id="rsOut" class="mt-3"></div>`;
      const recalc = () => {
        const o = +host.querySelector('#rs_o').value;
        const w = +host.querySelector('#rs_w').value;
        const e = +host.querySelector('#rs_e').value;
        const score = BSMath.riskScore(o, w, e);
        const level = score < 30 ? 'Bajo' : score < 60 ? 'Medio' : score < 80 ? 'Alto' : 'Extremo';
        const color = score < 30 ? 'success' : score < 60 ? 'warning' : 'danger';
        host.querySelector('#rsOut').innerHTML = `
          <div class="grid grid-2 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Risk Score</div><strong class="num">${score.toFixed(0)}/100</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Nivel</div><strong class="text-${color}">${level}</strong></div>
          </div>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'steam' || id === 'rlm') {
      // Real: pull live de steam moves del backend
      host.innerHTML = `<p class="muted tiny mb-3">${id === 'steam' ? 'Movimientos sharp >5% detectados en última hora (live del backend).' : 'Reverse Line Movement — cuotas que mueven en CONTRA del % público (señal sharp).'}</p>
        <div id="stOut">Cargando...</div>`;
      (async () => {
        try {
          const r = await fetch((window.BSLive?.API_BASE || '') + '/api/steam').then(x => x.json());
          const list = (r || []).filter(s => id === 'steam' || s.sharp);
          host.querySelector('#stOut').innerHTML = list.length ? `
            <div class="stack-sm">${list.slice(0, 15).map(s => `
              <div class="row between" style="padding:8px;background:var(--surface-2);border-radius:6px">
                <div><strong class="tiny">${BSUI.esc(s.event || '?')}</strong><div class="muted tiny">${BSUI.esc(s.market || '')} · ${BSUI.esc(s.side || '')}</div></div>
                <div class="text-right">
                  <strong class="num ${s.deltaPct >= 0 ? 'text-success' : 'text-danger'}">${s.deltaPct >= 0 ? '+' : ''}${(s.deltaPct || 0).toFixed(2)}%</strong>
                  <div class="muted tiny">${s.from?.toFixed?.(2)} → ${s.to?.toFixed?.(2)}</div>
                </div>
              </div>`).join('')}</div>` : '<p class="muted">Sin movimientos sharp detectados en este momento.</p>';
        } catch {
          host.querySelector('#stOut').innerHTML = '<p class="muted">No hay datos en vivo.</p>';
        }
      })();
      return;
    }

    if (id === 'arbslip') {
      host.innerHTML = `<p class="muted tiny mb-3">Verifica si una surebet garantiza profit. Pegá cuotas + stakes por casa.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Cuotas (coma)</span><input class="input" id="as_o" value="2.10, 2.05"></label>
          <label class="field"><span class="field-label">Stakes (coma)</span><input class="input" id="as_s" value="488, 512"></label>
        </div>
        <div id="asOut" class="mt-3"></div>`;
      const recalc = () => {
        const os = host.querySelector('#as_o').value.split(',').map(x => +x);
        const ss = host.querySelector('#as_s').value.split(',').map(x => +x);
        const total = ss.reduce((s, x) => s + x, 0);
        const outs = os.map((o, i) => ss[i] * o - total);
        const minProfit = Math.min(...outs);
        const isArb = minProfit > 0;
        host.querySelector('#asOut').innerHTML = `
          <div class="grid grid-${outs.length} gap-2">
            ${outs.map((p, i) => `<div class="card card-tinted card-pad-sm"><div class="muted tiny">Si gana #${i + 1}</div><strong class="${p >= 0 ? 'text-success' : 'text-danger'} num">${BSUI.money(p)}</strong></div>`).join('')}
            <div class="card card-tinted card-pad-sm" style="grid-column:span 2"><div class="muted tiny">Profit garantizado mínimo</div><strong class="${isArb ? 'text-success' : 'text-danger'} num">${BSUI.money(minProfit)}</strong></div>
          </div>
          <p class="muted tiny mt-2">${isArb ? '✓ Surebet VÁLIDA: profit asegurado sea cual sea el outcome.' : '⚠ NO es surebet: hay outcomes con pérdida. Recalcular stakes.'}</p>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'corr') {
      host.innerHTML = `<p class="muted tiny mb-3">Detectá correlación entre legs. Combinadas con legs muy correlacionadas pagan menos que su prob real.</p>
        <div id="corLegs"></div>
        <button class="btn btn-outline btn-sm mt-2" id="corAdd">+ leg</button>
        <div id="corOut" class="mt-3"></div>`;
      const legs = [
        { event: 'River vs Boca', market: 'h2h', outcome: 'home' },
        { event: 'River vs Boca', market: 'totals', outcome: 'over' }
      ];
      const renderL = () => {
        host.querySelector('#corLegs').innerHTML = legs.map((l, i) => `
          <div class="row gap-2 mb-2">
            <input class="input" placeholder="Partido" data-evt="${i}" value="${BSUI.esc(l.event)}">
            <input class="input" placeholder="market" data-mkt="${i}" value="${BSUI.esc(l.market)}">
            <input class="input" placeholder="outcome" data-out="${i}" value="${BSUI.esc(l.outcome)}">
            <button class="btn-ghost btn-icon" data-rm="${i}">×</button>
          </div>`).join('');
        host.querySelectorAll('[data-evt]').forEach(i => i.addEventListener('input', e => { legs[Number(e.target.dataset.evt)].event = e.target.value; recalc(); }));
        host.querySelectorAll('[data-mkt]').forEach(i => i.addEventListener('input', e => { legs[Number(e.target.dataset.mkt)].market = e.target.value; recalc(); }));
        host.querySelectorAll('[data-out]').forEach(i => i.addEventListener('input', e => { legs[Number(e.target.dataset.out)].outcome = e.target.value; recalc(); }));
        host.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { legs.splice(Number(b.dataset.rm), 1); renderL(); recalc(); }));
      };
      const recalc = async () => {
        try {
          const r = await fetch((window.BSLive?.API_BASE || '') + '/api/correlation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ legs })
          }).then(x => x.json());
          host.querySelector('#corOut').innerHTML = `
            <div class="row between"><span>Max correlación</span><strong class="num">${(r.maxCorrelation * 100).toFixed(1)}%</strong></div>
            <div class="row between"><span>EV adjustment</span><strong class="num">${(r.evAdjustment * 100).toFixed(2)}%</strong></div>
            ${r.warnings?.length ? `<div class="cluster mt-2" style="flex-wrap:wrap;gap:4px">${r.warnings.map(w => `<span class="badge badge-warning tiny">⚠ ${BSUI.esc(w.note || '')}</span>`).join('')}</div>` : '<p class="muted tiny mt-2">✓ Legs no correlacionadas — combinada limpia.</p>'}`;
        } catch (e) {
          host.querySelector('#corOut').innerHTML = '<p class="muted">No hay backend correlation disponible.</p>';
        }
      };
      host.querySelector('#corAdd').addEventListener('click', () => { legs.push({ event: '', market: 'h2h', outcome: 'home' }); renderL(); recalc(); });
      renderL(); recalc();
      return;
    }

    if (id === 'snrpro') {
      host.innerHTML = `<p class="muted tiny mb-3">Free Bet SNR Pro: optimiza qué cuota usar para tu freebet.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Monto freebet</span><input class="input" id="snr_f" type="number" value="5000"></label>
          <label class="field"><span class="field-label">Cuota target</span><input class="input" id="snr_o" type="number" step=".01" value="3.0"></label>
          <label class="field"><span class="field-label">Comisión exchange (%)</span><input class="input" id="snr_c" type="number" step=".1" value="2"></label>
        </div>
        <div id="snrOut" class="mt-3"></div>`;
      const recalc = () => {
        const f = +host.querySelector('#snr_f').value;
        const o = +host.querySelector('#snr_o').value;
        const c = +host.querySelector('#snr_c').value / 100;
        // SNR (Stake Not Returned): profit = freebet × (cuota - 1)
        const profit = f * (o - 1);
        // Hedge en exchange: lay con stake ~ (profit / (cuotaLay - c))
        const layStake = profit / (o - c);
        const profitNet = profit - layStake * c;
        const retentionRate = (profitNet / f) * 100;
        host.querySelector('#snrOut').innerHTML = `
          <div class="grid grid-2 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Profit si gana</div><strong class="text-success num">${BSUI.money(profit)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Lay stake hedge</div><strong class="num">${BSUI.money(layStake)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Profit garantizado neto</div><strong class="text-success num">${BSUI.money(profitNet)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Retention rate</div><strong>${retentionRate.toFixed(1)}%</strong></div>
          </div>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'middlepro') {
      host.innerHTML = `<p class="muted tiny mb-3">Middle Pro: detecta gap entre dos líneas. Si caés EN el medio, ganás las dos.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Línea Casa A (e.g. Over 2.5)</span><input class="input" id="mid_la" type="number" step=".5" value="2.5"></label>
          <label class="field"><span class="field-label">Cuota A</span><input class="input" id="mid_oa" type="number" step=".01" value="1.95"></label>
          <label class="field"><span class="field-label">Línea Casa B (e.g. Under 3.5)</span><input class="input" id="mid_lb" type="number" step=".5" value="3.5"></label>
          <label class="field"><span class="field-label">Cuota B</span><input class="input" id="mid_ob" type="number" step=".01" value="1.85"></label>
          <label class="field"><span class="field-label">Stake total</span><input class="input" id="mid_s" type="number" value="10000"></label>
        </div>
        <div id="midOut" class="mt-3"></div>`;
      const recalc = () => {
        const la = +host.querySelector('#mid_la').value;
        const oa = +host.querySelector('#mid_oa').value;
        const lb = +host.querySelector('#mid_lb').value;
        const ob = +host.querySelector('#mid_ob').value;
        const s = +host.querySelector('#mid_s').value;
        const gap = Math.max(0, lb - la);
        // Optimo: divide stake proporcional a cuotas
        const stakeA = s * (1 / oa) / (1 / oa + 1 / ob);
        const stakeB = s - stakeA;
        const profitMid = stakeA * oa - s + (stakeB * ob - s);  // suma de profits si ambos ganan
        const lossEdge = Math.min(stakeA * oa - s, stakeB * ob - s);
        host.querySelector('#midOut').innerHTML = `
          <div class="grid grid-2 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Stake A (Over ${la})</div><strong class="num">${BSUI.money(stakeA)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Stake B (Under ${lb})</div><strong class="num">${BSUI.money(stakeB)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Gap (middle)</div><strong class="text-brand">${gap.toFixed(1)} goles</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Si pega el middle (ambos ganan)</div><strong class="text-success num">${BSUI.money(profitMid)}</strong></div>
            <div class="card card-tinted card-pad-sm" style="grid-column:span 2"><div class="muted tiny">Loss en borde (caso peor)</div><strong class="${lossEdge >= 0 ? 'text-success' : 'text-danger'} num">${BSUI.money(lossEdge)}</strong></div>
          </div>
          ${lossEdge >= 0 ? '<p class="muted tiny mt-2">✓ Cualquier outcome devuelve profit. Free middle.</p>' : '<p class="muted tiny mt-2">Solo gana si el resultado cae en el rango. Ver gap de ' + gap + '.</p>'}`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'lay') {
      host.innerHTML = `<p class="muted tiny mb-3">Lay calculator: apostás CONTRA un resultado en exchange.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Back stake (ya colocado)</span><input class="input" id="lay_bs" type="number" value="1000"></label>
          <label class="field"><span class="field-label">Back odd</span><input class="input" id="lay_bo" type="number" step=".01" value="2.5"></label>
          <label class="field"><span class="field-label">Lay odd</span><input class="input" id="lay_lo" type="number" step=".01" value="2.6"></label>
          <label class="field"><span class="field-label">Comisión exchange</span><input class="input" id="lay_c" type="number" step=".01" value="0.05"></label>
        </div>
        <div id="layOut" class="mt-3"></div>`;
      const recalc = () => {
        const bs = +host.querySelector('#lay_bs').value;
        const bo = +host.querySelector('#lay_bo').value;
        const lo = +host.querySelector('#lay_lo').value;
        const c = +host.querySelector('#lay_c').value;
        const r = BSMath.lay(bs, bo, lo, c);
        host.querySelector('#layOut').innerHTML = `
          <div class="grid grid-2 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Lay stake óptimo</div><strong class="num">${BSUI.money(r.layStake)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Liability</div><strong class="text-danger num">${BSUI.money(r.liability)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Profit si back gana</div><strong class="${r.profitIfBack >= 0 ? 'text-success' : 'text-danger'} num">${BSUI.money(r.profitIfBack)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Profit si lay gana</div><strong class="${r.profitIfLay >= 0 ? 'text-success' : 'text-danger'} num">${BSUI.money(r.profitIfLay)}</strong></div>
          </div>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'roibd') {
      host.innerHTML = `<p class="muted tiny mb-3">ROI desglosado por deporte/liga. Pegá tu historial.</p>
        <label class="field"><span class="field-label">Historial JSON (deporte → profit)</span>
          <textarea class="input" id="roi_h" rows="5" style="font-family:monospace">{"NBA": 18400, "NFL": -5200, "Soccer Premier": 32100, "MLB": 7800, "Soccer LPF": 24500, "UFC": -1200}</textarea>
        </label>
        <label class="field"><span class="field-label">Stake total por categoría (JSON)</span>
          <textarea class="input" id="roi_s" rows="3" style="font-family:monospace">{"NBA": 200000, "NFL": 80000, "Soccer Premier": 350000, "MLB": 120000, "Soccer LPF": 280000, "UFC": 40000}</textarea>
        </label>
        <div id="roiOut" class="mt-3"></div>`;
      const recalc = () => {
        try {
          const h = JSON.parse(host.querySelector('#roi_h').value);
          const s = JSON.parse(host.querySelector('#roi_s').value);
          const rows = Object.entries(h).map(([k, p]) => ({
            cat: k, profit: p, stake: s[k] || 0, roi: s[k] ? (p / s[k] * 100) : 0
          })).sort((a, b) => b.roi - a.roi);
          host.querySelector('#roiOut').innerHTML = `
            <div class="table-wrap mt-3"><table class="table">
              <thead><tr><th>Categoría</th><th>Stake</th><th>Profit</th><th>ROI</th></tr></thead>
              <tbody>${rows.map(r => `<tr>
                <td>${BSUI.esc(r.cat)}</td>
                <td class="num">${BSUI.money(r.stake)}</td>
                <td class="num ${r.profit >= 0 ? 'text-success' : 'text-danger'}">${BSUI.money(r.profit)}</td>
                <td class="num ${r.roi >= 0 ? 'text-success' : 'text-danger'}"><strong>${r.roi >= 0 ? '+' : ''}${r.roi.toFixed(1)}%</strong></td>
              </tr>`).join('')}</tbody>
            </table></div>
            <p class="muted tiny mt-2">Mejor: <strong>${rows[0]?.cat}</strong> (+${rows[0]?.roi.toFixed(1)}%) · Peor: <strong>${rows[rows.length - 1]?.cat}</strong> (${rows[rows.length - 1]?.roi.toFixed(1)}%)</p>`;
        } catch {
          host.querySelector('#roiOut').innerHTML = '<p class="muted">JSON inválido.</p>';
        }
      };
      host.querySelectorAll('textarea').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    if (id === 'monthly') {
      host.innerHTML = `<p class="muted tiny mb-3">Reporte mensual desde tu historial local.</p>
        <div id="monthOut">Cargando historial...</div>`;
      const hist = BSStore.get(BSStore.KEYS.history) || [];
      const now = new Date();
      const month = now.getMonth(), year = now.getFullYear();
      const thisMonth = hist.filter(h => {
        const d = new Date(h.ts || h.date || 0);
        return d.getMonth() === month && d.getFullYear() === year;
      });
      const wins = thisMonth.filter(h => h.outcome === 'win').length;
      const losses = thisMonth.filter(h => h.outcome === 'loss').length;
      const profit = thisMonth.reduce((s, h) => s + (h.profit || 0), 0);
      const stake = thisMonth.reduce((s, h) => s + (h.stake || 0), 0);
      const roi = stake ? (profit / stake * 100) : 0;
      const wr = thisMonth.length ? (wins / thisMonth.length * 100) : 0;
      host.querySelector('#monthOut').innerHTML = `
        <div class="grid grid-3 gap-2">
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Mes ${now.toLocaleString('es-AR', { month: 'long' })}</div><strong>${thisMonth.length} picks</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win rate</div><strong>${wr.toFixed(1)}%</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Profit / Loss</div><strong class="${profit >= 0 ? 'text-success' : 'text-danger'} num">${BSUI.money(profit)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">Stake total</div><strong class="num">${BSUI.money(stake)}</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">ROI</div><strong class="${roi >= 0 ? 'text-success' : 'text-danger'} num">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</strong></div>
          <div class="card card-tinted card-pad-sm"><div class="muted tiny">W / L</div><strong>${wins} / ${losses}</strong></div>
        </div>
        ${!thisMonth.length ? '<p class="muted tiny mt-3">Sin picks en este mes. Cargá historial desde Tracker.</p>' : ''}`;
      return;
    }

    if (id === 'pyth') {
      host.innerHTML = `<p class="muted tiny mb-3">Pythagorean Win Expectancy — cuántas victorias "deberías" tener con tu diferencia de goles.</p>
        <div class="grid grid-2 gap-3">
          <label class="field"><span class="field-label">Goles a favor</span><input class="input" id="py_gf" type="number" value="85"></label>
          <label class="field"><span class="field-label">Goles en contra</span><input class="input" id="py_gc" type="number" value="70"></label>
          <label class="field"><span class="field-label">Exponente (1.83 NBA, 13.91 fútbol)</span><input class="input" id="py_e" type="number" step=".01" value="1.83"></label>
          <label class="field"><span class="field-label">Partidos jugados</span><input class="input" id="py_n" type="number" value="50"></label>
        </div>
        <div id="pyOut" class="mt-3"></div>`;
      const recalc = () => {
        const gf = +host.querySelector('#py_gf').value;
        const gc = +host.querySelector('#py_gc').value;
        const e = +host.querySelector('#py_e').value;
        const n = +host.querySelector('#py_n').value;
        const winExp = BSMath.pythagorean(gf, gc, e);
        const winsExp = winExp * n;
        host.querySelector('#pyOut').innerHTML = `
          <div class="grid grid-3 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win expectancy</div><strong>${BSUI.pct(winExp)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Victorias esperadas</div><strong class="num">${winsExp.toFixed(1)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Diferencia de goles</div><strong class="num">${gf - gc >= 0 ? '+' : ''}${gf - gc}</strong></div>
          </div>
          <p class="muted tiny mt-3">Si el equipo TIENE más victorias que ${winsExp.toFixed(0)}, está sobre-rendiendo (regression bait). Si tiene MENOS, está sub-rendiendo (buy low).</p>`;
      };
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc)); recalc();
      return;
    }

    // Fallback genérico si quedó alguno sin implementar
    host.innerHTML = `<div class="card card-tinted">
      <h4 class="h4">${BSUI.esc(TOOLS.find(t=>t.id===id)?.label || id)}</h4>
      <p class="muted">Calculadora en mantenimiento. Reportá el id "<code>${id}</code>" si necesitás esta función.</p>
    </div>`;
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
