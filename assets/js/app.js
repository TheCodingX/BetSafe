/* BetSafe — Global app boot */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    BSUI.initTheme();
    BSUI.applyVip(BSAuth.isVip());
    // Aplicar preferencia de reduce-motion guardada
    try {
      const s = (typeof BSStore !== 'undefined' && BSStore.get) ? (BSStore.get(BSStore.KEYS?.settings || 'bs:settings') || {}) : {};
      if (s.reducedMotion) document.documentElement.classList.add('reduce-motion');
    } catch {}
    BSUI.bindHeaderShadow();
    BSUI.bindScrollProgress();
    BSUI.bindAnchorScroll();
    BSUI.bindReveal();
    BSUI.bindMagnetic();
    BSUI.bindTooltips();
    if (BSUI.bindHelpPortalTooltips) BSUI.bindHelpPortalTooltips();
    BSUI.bindCookieBanner();
    // v2 enhancements
    if (BSUI.bindStagger)    BSUI.bindStagger();
    if (BSUI.bindTilt)       BSUI.bindTilt();
    if (BSUI.bindSpotlight)  BSUI.bindSpotlight();
    if (BSUI.mountHeroOrbs)  BSUI.mountHeroOrbs();
    if (BSUI.autoCount)      BSUI.autoCount();
    // VIP cursor mounts only when body[data-vip="1"]
    if (BSAuth.isVip() && BSUI.bindVipCursor) BSUI.bindVipCursor();
    // Auto-init AI status pill if marker present
    document.querySelectorAll('[data-ai-status]').forEach(el => BSUI.mountAiStatus(el));
    // Inject VIP particles host on .vip-particles-host elements
    document.querySelectorAll('.vip-particles-host').forEach(el => BSUI.spawnVipParticles(el));

    // Age verification on first visit (skip on legal pages and 404)
    const path = location.pathname;
    if (!/responsable|terminos|privacidad|cookies|404/.test(path)) {
      BSUI.bindAgeVerification();
    }

    // Theme toggle binding
    document.querySelectorAll('[data-theme-toggle]').forEach(b =>
      b.addEventListener('click', () => {
        BSUI.toggleTheme();
        b.setAttribute('aria-label', document.documentElement.getAttribute('data-theme') === 'dark' ? 'Pasar a modo claro' : 'Pasar a modo oscuro');
      })
    );

    // Hamburger
    const ham = document.querySelector('[data-hamburger]');
    if (ham) ham.addEventListener('click', openMobileNav);

    // Auth UI hooks
    const authChip = document.querySelector('[data-auth-chip]');
    if (authChip) renderAuthChip(authChip);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleShortcuts);

    // Service worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }

    // v5.8 — Pre-warm de estado IA: el dashboard espera el evento 'bs:ai-status'
    // antes de quitar el preloader (loading global real). Lo disparamos
    // automáticamente al boot consultando el backend. Si NO estamos en
    // dashboard.html, igual disparamos para que cualquier widget se entere.
    if (typeof window.BSLive !== 'undefined' && typeof BSLive.getAiStatus === 'function') {
      // No esperamos: si el backend no responde, `getAiStatus()` dispara el
      // evento con health: 'unknown' y el preloader sigue de largo.
      BSLive.getAiStatus().catch(() => {});
    }
  });

  function renderAuthChip(host) {
    const s = BSAuth.current();
    if (s) {
      host.innerHTML = `
        <a href="dashboard.html" class="btn btn-outline btn-sm">${BSUI.esc(s.name)}${s.tier === 'vip' ? '<span class="badge-vip" style="margin-left:6px">VIP</span>' : ''}</a>
        <button class="btn btn-ghost btn-sm" data-logout>Salir</button>
      `;
      host.querySelector('[data-logout]')?.addEventListener('click', () => { BSAuth.logout(); location.reload(); });
    } else {
      host.innerHTML = `
        <a href="login.html" class="btn btn-ghost btn-sm">Ingresar</a>
        <a href="login.html" class="btn btn-primary btn-sm mag">Empezar</a>
      `;
    }
  }

  function openMobileNav() {
    const items = [
      { label: 'Inicio', href: 'index.html' },
      { label: 'Funciones', href: 'features.html' },
      { label: 'Herramientas', href: 'tools.html' },
      { label: 'Academia', href: 'learn.html' },
      { label: 'Precios', href: 'pricing.html' },
      { label: 'Mundial 2026', href: 'dashboard.html#worldcup' },
      { label: 'Juego Responsable', href: 'responsable.html' }
    ];
    const html = `
      <div class="drawer-header">
        <strong>Menú</strong>
        <button class="btn-ghost btn-icon" aria-label="Cerrar" data-close>×</button>
      </div>
      <div class="drawer-body">
        <div class="stack">
          ${items.map(i => `<a class="btn btn-outline btn-block" href="${i.href}">${i.label}</a>`).join('')}
        </div>
      </div>
      <div class="drawer-footer">
        ${BSAuth.isAuthed()
          ? `<a href="dashboard.html" class="btn btn-primary btn-block">Ir al Dashboard</a>`
          : `<a href="login.html" class="btn btn-primary btn-block">Ingresar</a>`}
      </div>
    `;
    const { close } = BSUI.openDrawer(html, 'right');
    document.querySelector('.drawer .btn-ghost.btn-icon')?.addEventListener('click', close);
  }

  function handleShortcuts(e) {
    if (e.target.matches('input, textarea, select')) return;

    // Cmd+K / Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      BSUI.openCommandPalette(commandItems());
      return;
    }
    if (e.key === '?') { e.preventDefault(); openShortcutsHelp(); return; }

    // g <letter> chord
    if (window.__waitG && Date.now() - window.__waitG.t < 1500) {
      const map = { d: 'dashboard.html', a: 'dashboard.html#arbitrage', f: 'features.html', t: 'tools.html', l: 'learn.html', p: 'pricing.html', w: 'dashboard.html#worldcup', h: 'index.html' };
      const dest = map[e.key.toLowerCase()];
      if (dest) { e.preventDefault(); location.href = dest; window.__waitG = null; return; }
    }
    if (e.key.toLowerCase() === 'g') window.__waitG = { t: Date.now() };
  }

  function commandItems() {
    return [
      { label: 'Ir al Dashboard', kbd: 'g d', action: () => location.href = 'dashboard.html' },
      { label: 'Ir a Funciones',  kbd: 'g f', action: () => location.href = 'features.html' },
      { label: 'Ir a Herramientas', kbd: 'g t', action: () => location.href = 'tools.html' },
      { label: 'Ir al Mundial 2026', kbd: 'g w', action: () => location.href = 'dashboard.html#worldcup' },
      { label: 'Arbitraje Pro (VIP)', kbd: 'g a', action: () => location.href = 'dashboard.html#arbitrage' },
      { label: 'Cambiar tema', action: () => BSUI.toggleTheme() },
      { label: 'Cerrar sesión', action: () => { BSAuth.logout(); location.href = 'index.html'; } }
    ];
  }

  function openShortcutsHelp() {
    const html = `
      <h3 class="h3 mb-3">Atajos de teclado</h3>
      <div class="grid grid-2" style="gap:14px">
        <div class="card card-tinted"><strong>Navegación</strong><br><span class="kbd">g</span> + <span class="kbd">d</span> Dashboard<br><span class="kbd">g</span> + <span class="kbd">a</span> Arbitraje<br><span class="kbd">g</span> + <span class="kbd">f</span> Funciones<br><span class="kbd">g</span> + <span class="kbd">t</span> Tools<br><span class="kbd">g</span> + <span class="kbd">w</span> Mundial</div>
        <div class="card card-tinted"><strong>Generales</strong><br><span class="kbd">⌘</span>+<span class="kbd">K</span> Command Palette<br><span class="kbd">?</span> Esta ayuda<br><span class="kbd">Esc</span> Cerrar modales</div>
      </div>`;
    BSUI.openModal(html);
  }
})();
