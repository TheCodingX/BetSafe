/* BetSafe — Smart Money Alerts (VIP) */
(function () {
  'use strict';

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">Smart Money Alerts<a class="help-q" tabindex="0" data-tip="Smart Money es el dinero profesional/sharp que mueve las cuotas. Detectamos cuando una cuota se mueve 5%+ en menos de una hora — eso suele indicar que apostadores grandes (sharps) tomaron posición. Te avisamos en tiempo real para que sigas el flujo del dinero serio."></a></h2><p class="muted">Detección de movimientos sharp >5% por hora.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }
    const alerts = BSStore.get(BSStore.KEYS.vipAlerts) || demoAlerts();
    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Smart Money Alerts<a class="help-q" tabindex="0" data-tip="Smart Money = dinero profesional/sharp. Detectamos cuando una cuota se mueve 5%+ en menos de una hora (steam move) — señal de que sharps tomaron posición. También Reverse Line Movement (RLM): si la cuota se mueve contra el % público de apuestas, es sharp money."></a></h2>
          <p class="muted">Flujo del dinero sharp en tiempo real · steam moves · RLM · Public/Sharp split.</p>
        </div>
        <button class="btn btn-primary mag" id="newAlert">+ Crear alerta</button>
      </div>

      <div class="grid grid-3 gap-4">
        <div class="card stack" style="grid-column: span 2">
          <strong>Stream en vivo</strong>
          <div id="smStream" class="stack-sm" style="max-height:520px;overflow-y:auto"></div>
        </div>
        <div class="card stack">
          <strong>Mis alertas</strong>
          <div id="smList" class="stack-sm"></div>
        </div>
      </div>
    `;

    function renderStream() {
      const items = demoStream();
      panel.querySelector('#smStream').innerHTML = items.map(it => `
        <div class="card card-tinted card-pad-sm">
          <div class="row between">
            <div>
              <div class="cluster">
                <span class="badge ${it.sharp ? 'badge-warning' : 'badge-info'}">${it.sharp?'SHARP':'PUBLIC'}</span>
                <strong>${BSUI.esc(it.event)}</strong>
              </div>
              <div class="muted tiny">${BSUI.esc(it.market)} · cuota ${it.from} → ${it.to} (${it.delta>0?'+':''}${it.delta}%)</div>
            </div>
            <span class="num ${it.delta>=0?'text-success':'text-danger'}">${it.delta>=0?'↗':'↘'} ${Math.abs(it.delta)}%</span>
          </div>
        </div>`).join('') || '<div class="empty">Sin movimientos</div>';
    }
    function renderList() {
      panel.querySelector('#smList').innerHTML = alerts.map((a, i) => `
        <div class="card card-tinted card-pad-sm">
          <div class="row between">
            <div>
              <strong>${BSUI.esc(a.name)}</strong>
              <div class="muted tiny">${BSUI.esc(a.cond)} · disparos: ${a.fires}</div>
            </div>
            <label class="toggle"><input type="checkbox" data-toggle="${i}" ${a.on?'checked':''}><span class="track"></span></label>
          </div>
        </div>`).join('') || '<div class="muted tiny">Sin alertas. Creá la primera.</div>';
      panel.querySelectorAll('[data-toggle]').forEach(t => t.addEventListener('change', e => {
        alerts[Number(t.dataset.toggle)].on = e.target.checked;
        BSStore.set(BSStore.KEYS.vipAlerts, alerts);
      }));
    }

    panel.querySelector('#newAlert').addEventListener('click', () => {
      const html = `
        <h3 class="h3 mb-3">Nueva alerta</h3>
        <div class="stack">
          <label class="field"><span class="field-label">Nombre</span><input class="input" id="alName" placeholder="EPL ROI > 5%"></label>
          <label class="field"><span class="field-label">Deporte</span>
            <select class="select" id="alSport">${BSData.SPORTS.map(s=>`<option value="${s.key}">${s.name}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="field-label">Condición</span>
            <select class="select" id="alCond">
              <option value="sharp">Movimiento sharp >5%</option>
              <option value="rlm">Reverse Line Movement</option>
              <option value="public80">Public bets >80%</option>
              <option value="value">Value &gt; 3%</option>
            </select>
          </label>
          <button class="btn btn-primary" id="alSave">Crear</button>
        </div>`;
      const { modal, close } = BSUI.openModal(html);
      modal.querySelector('#alSave').addEventListener('click', () => {
        const a = {
          name: modal.querySelector('#alName').value || 'Alerta',
          cond: modal.querySelector('#alCond').selectedOptions[0].textContent,
          sport: modal.querySelector('#alSport').value,
          on: true, fires: 0, at: Date.now()
        };
        alerts.unshift(a); BSStore.set(BSStore.KEYS.vipAlerts, alerts); renderList(); close();
        BSUI.toast({ title: 'Alerta creada', type: 'success' });
      });
    });

    renderStream(); renderList();
    const interval = setInterval(renderStream, 8000);
    panel.__cleanup = () => clearInterval(interval);
  }

  function demoAlerts() {
    return [
      { name: 'NBA · Movimientos sharp', cond: 'Movimiento sharp >5%', sport: 'basketball', on: true, fires: 14, at: Date.now() },
      { name: 'EPL · RLM', cond: 'Reverse Line Movement', sport: 'soccer', on: true, fires: 7, at: Date.now() },
      { name: 'UFC · Value >3%', cond: 'Value > 3%', sport: 'mma', on: false, fires: 2, at: Date.now() }
    ];
  }
  function demoStream() {
    const seed = Math.floor(Date.now() / 8000);
    const rng = BSMath.lcg(seed);
    const evs = ['Lakers vs Celtics','PSG vs Lyon','Boca vs River','Bayern vs Dortmund','Yankees vs Red Sox','Real Madrid vs Barcelona'];
    return Array.from({ length: 8 }, (_, i) => {
      const r = rng();
      const delta = +((r * 12 - 4).toFixed(1));
      return {
        event: evs[i % evs.length],
        market: ['1X2', 'Over 2.5', 'Spread', 'BTTS'][i % 4],
        from: (1.85 + r * 0.5).toFixed(2),
        to: (1.85 + r * 0.5 + delta / 100).toFixed(2),
        delta,
        sharp: Math.abs(delta) > 4
      };
    });
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('smartmoney', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('smartmoney', render));
  }
  doRegister();
  window.__bsSmartmoneyRender = render;
})();
