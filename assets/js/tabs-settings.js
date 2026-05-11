/* BetSafe — Settings tab */
(function () {
  'use strict';

  function render(panel) {
    const settings = BSStore.get(BSStore.KEYS.settings) || { lang: 'es-AR', notifications: false, sound: false, riskBand: 'mid' };
    const session = BSAuth.current();

    panel.innerHTML = `
      <h2 class="h3 mb-4">Settings<a class="help-q" tabindex="0" data-tip="Configurá tu cuenta: tema (claro/oscuro), notificaciones, banca, deportes y casas favoritas, atajos de teclado, perfil y preferencias regionales (es-AR es la default)."></a></h2>

      <div class="grid grid-2 gap-4">
        <div class="card stack">
          <strong>Cuenta</strong>
          <div class="row between"><span>Usuario</span><strong>${BSUI.esc(session?.user || '—')}</strong></div>
          <div class="row between"><span>Plan</span><span class="badge ${session?.tier==='vip'?'badge-gold':'badge-brand'}">${session?.tier?.toUpperCase()}</span></div>
          <div class="row between"><span>Email</span><strong>${BSUI.esc(session?.email || '—')}</strong></div>
          <button class="btn btn-outline" id="logout">Cerrar sesión</button>
          ${session?.tier !== 'vip' ? `<button class="btn btn-gold mag" id="goVip">Pasar a VIP (demo)</button>` : ''}
        </div>

        <div class="card stack">
          <strong>Apariencia</strong>
          <label class="toggle"><input type="checkbox" id="setDark" ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'checked' : ''}><span class="track"></span><span>Modo oscuro</span></label>
          <label class="toggle"><input type="checkbox" id="setMotion"><span class="track"></span><span>Reducir movimiento</span></label>
          <label class="toggle"><input type="checkbox" id="setSound" ${settings.sound ? 'checked' : ''}><span class="track"></span><span>Sonidos de UI</span></label>
        </div>

        <div class="card stack">
          <strong>Notificaciones</strong>
          <label class="toggle"><input type="checkbox" id="setN1" ${settings.notifications ? 'checked' : ''}><span class="track"></span><span>Toasts in-app</span></label>
          <label class="toggle"><input type="checkbox" id="setN2"><span class="track"></span><span>Push (FCM) — pendiente backend</span></label>
          <label class="toggle"><input type="checkbox" id="setN3"><span class="track"></span><span>Email digest diario — pendiente backend</span></label>
        </div>

        <div class="card stack">
          <strong>Datos &amp; privacidad</strong>
          <p class="muted tiny">Tus datos viven en localStorage. Nada se envía a servidores externos hasta integrar Supabase.</p>
          <button class="btn btn-outline" id="exportAll">Exportar todo (JSON)</button>
          <button class="btn btn-outline" id="importAll">Importar desde JSON</button>
          <button class="btn btn-danger" id="wipeAll">Borrar todos mis datos</button>
        </div>

        <!-- (Card de API keys ocultada — info técnica que el usuario no necesita ver) -->
        <div class="card stack" hidden></div>

        <div class="card stack">
          <strong>Atajos</strong>
          <div class="grid grid-2 gap-2">
            <span><span class="kbd">⌘K</span> Command palette</span>
            <span><span class="kbd">g d</span> Dashboard</span>
            <span><span class="kbd">g a</span> Arbitraje</span>
            <span><span class="kbd">g w</span> Mundial</span>
            <span><span class="kbd">?</span> Ayuda</span>
            <span><span class="kbd">Esc</span> Cerrar modal</span>
          </div>
        </div>
      </div>
    `;

    panel.querySelector('#logout').addEventListener('click', () => { BSAuth.logout(); location.href = 'index.html'; });
    panel.querySelector('#goVip')?.addEventListener('click', () => { BSAuth.upgradeToVip(); BSUI.applyVip(true); BSUI.confetti(80); BSUI.toast({ title: 'VIP activo', type: 'success' }); BSDash.go('settings'); });
    panel.querySelector('#setDark').addEventListener('change', e => BSUI.applyTheme(e.target.checked ? 'dark' : 'light'));
    panel.querySelector('#setSound').addEventListener('change', e => { settings.sound = e.target.checked; BSStore.set(BSStore.KEYS.settings, settings); });
    panel.querySelector('#setN1').addEventListener('change', e => { settings.notifications = e.target.checked; BSStore.set(BSStore.KEYS.settings, settings); });

    panel.querySelector('#exportAll').addEventListener('click', () => {
      const dump = {};
      Object.keys(localStorage).forEach(k => { if (k.startsWith('bs:') || k === BSStore.KEYS.session) dump[k] = JSON.parse(localStorage.getItem(k)); });
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'betsafe-backup.json'; a.click();
      BSUI.toast({ title: 'Exportado', type: 'success' });
    });
    panel.querySelector('#importAll').addEventListener('click', () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
      inp.addEventListener('change', () => {
        const f = inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { const o = JSON.parse(r.result); Object.entries(o).forEach(([k,v]) => localStorage.setItem(k, JSON.stringify(v))); BSUI.toast({ title: 'Importado', type: 'success' }); setTimeout(()=>location.reload(), 600); } catch { BSUI.toast({ title: 'JSON inválido', type: 'danger' }); } };
        r.readAsText(f);
      });
      inp.click();
    });
    panel.querySelector('#wipeAll').addEventListener('click', () => {
      if (!confirm('Esto borra tu sesión y todos los datos locales. ¿Continuar?')) return;
      Object.keys(localStorage).forEach(k => { if (k.startsWith('bs:') || k === BSStore.KEYS.session) localStorage.removeItem(k); });
      BSUI.toast({ title: 'Datos borrados', type: 'info' }); setTimeout(()=>location.href='index.html', 800);
    });
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('settings', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('settings', render));
  }
  doRegister();
  window.__bsSettingsRender = render;
})();
