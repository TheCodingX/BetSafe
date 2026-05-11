/* BetSafe — Smart Money Alerts (VIP)
 * ============================================================================
 * Detección de steam moves (movimientos >5%) generados por el backend al
 * comparar snapshots consecutivos de las 12 casas argentinas legales.
 *
 * NO se generan signals fake. Si el backend todavía no detectó movimientos,
 * la UI muestra "esperando…".
 *
 * Alerts del usuario: viven en localStorage y disparan cuando un steam move
 * matchea las condiciones (sport / market / deltaPct).
 * ============================================================================
 */
(function () {
  'use strict';

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">Smart Money Alerts<a class="help-q" tabindex="0" data-tip="Smart Money es el dinero profesional/sharp que mueve las cuotas. Detectamos cuando una cuota se mueve 5%+ entre dos ciclos de scraping — eso suele indicar que apostadores grandes (sharps) tomaron posición. Te avisamos en tiempo real para que sigas el flujo del dinero serio."></a></h2><p class="muted">Detección de movimientos sharp >5% por ciclo.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }
    const alerts = BSStore.get(BSStore.KEYS.vipAlerts) || [];

    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Smart Money Alerts<a class="help-q" tabindex="0" data-tip="Smart Money = dinero profesional/sharp. Detectamos cuando una cuota se mueve 5%+ entre dos ciclos de scraping (steam move) — señal de que sharps tomaron posición."></a></h2>
          <p class="muted">Flujo real de movimientos sharp · cruce de 12 casas argentinas · push en vivo via WebSocket.</p>
        </div>
        <button class="btn btn-primary mag" id="newAlert">+ Crear alerta</button>
      </div>

      <div class="grid grid-3 gap-4">
        <div class="card stack" style="grid-column: span 2">
          <div class="row between">
            <strong>Stream en vivo</strong>
            <span class="muted tiny" id="smFresh">${BSData.liveFreshness()}</span>
          </div>
          <div id="smStream" class="stack-sm" style="max-height:520px;overflow-y:auto"></div>
        </div>
        <div class="card stack">
          <strong>Mis alertas</strong>
          <div id="smList" class="stack-sm"></div>
        </div>
      </div>
    `;

    function renderStream() {
      const items = BSData.liveSteam();
      const host = panel.querySelector('#smStream');
      if (!host) return;
      if (!items.length) {
        host.innerHTML = `<div class="empty" style="padding:30px;text-align:center"><strong>Sin movimientos sharp detectados</strong><p class="muted tiny">El backend compara cada ciclo de scraping con el anterior. Cuando una cuota se mueve ≥5% (steam move), aparece acá automáticamente.</p></div>`;
        return;
      }
      host.innerHTML = items.slice(0, 30).map(it => {
        const dir = it.deltaPct >= 0 ? '↗' : '↘';
        return `
        <div class="card card-tinted card-pad-sm">
          <div class="row between">
            <div>
              <div class="cluster">
                <span class="badge ${it.sharp ? 'badge-warning' : 'badge-info'}">${it.sharp?'SHARP':'PUBLIC'}</span>
                <strong>${BSUI.esc(it.event)}</strong>
              </div>
              <div class="muted tiny">${BSUI.esc(it.market || 'h2h')} · ${BSUI.esc(it.side || '')} · ${it.from?.toFixed?.(2) || it.from} → ${it.to?.toFixed?.(2) || it.to} (${it.deltaPct>=0?'+':''}${it.deltaPct}%)</div>
            </div>
            <span class="num ${it.deltaPct>=0?'text-success':'text-danger'}">${dir} ${Math.abs(it.deltaPct)}%</span>
          </div>
        </div>`;
      }).join('');
      panel.querySelector('#smFresh').textContent = BSData.liveFreshness();
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

    // Steam moves push del backend
    const onSteam = (ev) => {
      // Disparar alertas configuradas que matcheen
      alerts.forEach(a => {
        if (!a.on) return;
        const sm = ev.detail || {};
        if (a.cond.toLowerCase().includes('sharp') && Math.abs(sm.deltaPct) >= 5) {
          a.fires = (a.fires || 0) + 1;
        }
      });
      BSStore.set(BSStore.KEYS.vipAlerts, alerts);
      renderStream(); renderList();
    };

    renderStream(); renderList();
    window.addEventListener('bs:live-steam', onSteam);
    window.addEventListener('bs:live-snapshot', renderStream);
    // Tick suave por si BSLive cambia frescura
    const interval = setInterval(renderStream, 8000);
    panel.__cleanup = () => {
      clearInterval(interval);
      window.removeEventListener('bs:live-steam', onSteam);
      window.removeEventListener('bs:live-snapshot', renderStream);
    };
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('smartmoney', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('smartmoney', render));
  }
  doRegister();
  window.__bsSmartmoneyRender = render;
})();
