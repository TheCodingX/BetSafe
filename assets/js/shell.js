/* BetSafe — Shell injector: header & footer (used on public pages) */
(function () {
  'use strict';

  // Brand mark — heraldic shield with two-tone checkmark (navy left + gold right).
  // Requires logos.js loaded; falls back to inline static shield if not.
  function BRAND_SVG(opts) {
    if (window.BSLogos && window.BSLogos.brandMark) return window.BSLogos.brandMark(opts || { size: 36 });
    return `<svg class="logo-mark" viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">
      <defs>
        <filter id="bs-sfx" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="1.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <!-- Classic heraldic shield -->
      <path class="shield-outline" d="M32 4 L57 13 L57 36 C57 50 44 59 32 63 C20 59 7 50 7 36 L7 13 Z"
            fill="rgba(12,30,69,.05)" stroke="#0c1e45" stroke-width="3.8" stroke-linejoin="round"/>
      <!-- Specular arc -->
      <path d="M15 16 C24 10 40 10 49 16" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1.4" stroke-linecap="round"/>
      <!-- Checkmark left (navy) -->
      <path class="check-navy" d="M17 37 L27 50" fill="none" stroke="#0c1e45" stroke-width="5.8"
            stroke-linecap="round" stroke-linejoin="round" filter="url(#bs-sfx)"/>
      <!-- Checkmark right (gold) -->
      <path class="check-gold" d="M27 50 L47 24" fill="none" stroke="#c49a1a" stroke-width="5.8"
            stroke-linecap="round" filter="url(#bs-sfx)"/>
    </svg>`;
  }

  // BetSafe wordmark — dos PNGs theme-aware:
  // - betsafe-brand.png:      "bet" navy + "safe" dorado (modo claro)
  // - betsafe-brand-dark.png: "bet" blanco + "safe" dorado (modo oscuro)
  // - betsafe-isotipo.png:    isotipo "b✓" navy + check dorado (theme-agnostic)
  // El CSS muestra el wordmark correcto según [data-theme]. El isotipo va siempre.
  function brandSvg(className) {
    return `<span class="brand-mark-wrap" style="display:inline-flex;align-items:center;gap:10px;line-height:1">
      <img src="assets/img/betsafe-isotipo.png" alt="" aria-hidden="true"
           class="brand-isotipo" width="32" height="32"
           style="width:32px;height:32px;border-radius:7px;display:block;flex-shrink:0"
           draggable="false" />
      <picture class="brand-logo-pic">
        <img src="assets/img/betsafe-brand.png" alt="BetSafe" class="${className} brand-logo-light" draggable="false" />
        <img src="assets/img/betsafe-brand-dark.png" alt="" aria-hidden="true" class="${className} brand-logo-dark" draggable="false" />
      </picture>
    </span>`;
  }

  const links = [
    { href: 'index.html',     text: 'Inicio' },
    { href: 'features.html',  text: 'Funciones' },
    { href: 'tools.html',     text: 'Herramientas' },
    { href: 'bonos.html',     text: 'Bonos' },
    { href: 'pricing.html',   text: 'Precios' },
    { href: 'about.html',     text: 'Quiénes somos' }
  ];
  function header() {
    const path = location.pathname.split('/').pop() || 'index.html';
    return `
      <div class="scroll-progress" aria-hidden="true"></div>
      <a class="skip-link" href="#main">Saltar al contenido</a>
      <header class="site-header">
        <div class="container">
          <a href="index.html" class="brand brand--img" aria-label="BetSafe — inicio">
            ${brandSvg('brand-logo-svg')}
          </a>
          <nav class="nav-primary" aria-label="Navegación principal">
            ${links.map(l => `<a href="${l.href}" ${l.href === path ? 'aria-current="page"' : ''}>${l.text}</a>`).join('')}
          </nav>
          <div class="header-actions">
            <button class="btn-ghost btn-icon hide-mobile" data-theme-toggle aria-label="Cambiar tema">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="ico-sun" d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.5-6.5L19 4M5 19l1.5-1.5M19 19l-1.5-1.5M5 4l1.5 1.5M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
            </button>
            <span class="hide-mobile" data-auth-chip></span>
            <a href="dashboard.html" class="btn btn-primary btn-sm mag show-mobile">App</a>
            <button class="hamburger" data-hamburger aria-label="Abrir menú"><span></span></button>
          </div>
        </div>
      </header>
    `;
  }

  function footer() {
    return `
      <footer class="site-footer">
        <div class="container">
          <div class="grid grid-4">
            <div class="stack">
              <a class="brand brand--img" href="index.html">${brandSvg('brand-logo-svg brand-logo-svg--footer')}</a>
              <p class="muted tiny">Plataforma argentina legal de análisis cuantitativo. No somos una casa de apuestas.</p>
              <div class="row" style="gap:6px;flex-wrap:wrap">
                <span class="seal">LOTBA</span><span class="seal">IPLyC</span><span class="seal">+18</span>
              </div>
            </div>
            <div>
              <h5>Producto</h5>
              <a href="features.html">Funciones</a>
              <a href="tools.html">Herramientas</a>
              <a href="pricing.html">Precios</a>
              <a href="dashboard.html#worldcup">Mundial 2026</a>
              <a href="dashboard.html#arbitrage">Arbitraje VIP</a>
            </div>
            <div>
              <h5>Empresa</h5>
              <a href="about.html">Quiénes somos</a>
              <a href="bonos.html">Bonos por casino</a>
              <a href="responsable.html">Juego Responsable</a>
              <a href="https://www.juegoresponsable.com.ar" target="_blank" rel="noopener noreferrer">juegoresponsable.com.ar</a>
            </div>
            <div>
              <h5>Legal</h5>
              <a href="terminos.html">Términos</a>
              <a href="privacidad.html">Privacidad</a>
              <a href="cookies.html">Cookies</a>
              <a href="responsable.html#self-test">Auto-test</a>
            </div>
          </div>
          <div class="legal-row">
            <small class="muted">© ${new Date().getFullYear()} BetSafe. Análisis cuantitativo. Ley 25.326 (Habeas Data).</small>
            <small class="muted">No garantizamos ganancias. Apostá con responsabilidad. <strong>+18</strong></small>
          </div>
        </div>
      </footer>
    `;
  }

  // Global SVG gradient defs (used by VIP gold strokes, etc.)
  function svgDefs() {
    return `
      <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="vip-gold-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stop-color="#FFE07A"/>
            <stop offset="50%"  stop-color="#D4A24A"/>
            <stop offset="100%" stop-color="#b6862c"/>
          </linearGradient>
          <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#22c55e"/>
            <stop offset="100%" stop-color="#0F2A4F"/>
          </linearGradient>
        </defs>
      </svg>
    `;
  }

  // Animated background layers — sweep + flowing wave lines
  function bgLayers() {
    return `
      <div class="aurora-sweep" aria-hidden="true"></div>
      <div class="aurora-waves" aria-hidden="true">
        <svg viewBox="0 0 1200 800" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path class="wave wave-1" d="M0,420 C200,360 360,500 540,420 C720,340 900,460 1080,400 C1180,380 1200,400 1200,400"/>
          <path class="wave wave-2" d="M0,500 C220,440 380,580 580,500 C760,420 940,540 1120,480 C1180,460 1200,480 1200,480"/>
          <path class="wave wave-3" d="M0,560 C240,500 400,640 620,560 C800,480 980,600 1140,540 C1180,520 1200,540 1200,540"/>
        </svg>
      </div>
    `;
  }

  // Insert header at [data-shell-header] and footer at [data-shell-footer]
  function init() {
    // Always inject the global SVG defs (needs to live in body to be referable)
    if (!document.getElementById('bs-svg-defs')) {
      const wrap = document.createElement('div'); wrap.id = 'bs-svg-defs'; wrap.innerHTML = svgDefs();
      document.body.insertBefore(wrap, document.body.firstChild);
    }
    // Inject particle background script (loads once globally)
    if (!document.getElementById('bs-particles-script')) {
      const s = document.createElement('script');
      s.id = 'bs-particles-script';
      s.src = 'assets/js/particles.js';
      s.defer = true;
      document.head.appendChild(s);
    }
    // Inject cyber background layers (perspective grid + scan + nodes + streaks + core)
    if (!document.querySelector('.bs-cyber')) {
      const cyber = document.createElement('div');
      cyber.className = 'bs-cyber';
      cyber.setAttribute('aria-hidden', 'true');
      cyber.innerHTML = `
        <div class="bs-cyber__core"></div>
        <div class="bs-cyber__grid"></div>
        <div class="bs-cyber__streak bs-cyber__streak--1"></div>
        <div class="bs-cyber__streak bs-cyber__streak--2"></div>
        <div class="bs-cyber__streak bs-cyber__streak--3"></div>
        <div class="bs-cyber__streak bs-cyber__streak--4"></div>
        <div class="bs-cyber__streak bs-cyber__streak--5"></div>
        <div class="bs-cyber__node bs-cyber__node--1"></div>
        <div class="bs-cyber__node bs-cyber__node--2"></div>
        <div class="bs-cyber__node bs-cyber__node--3"></div>
        <div class="bs-cyber__node bs-cyber__node--4"></div>
        <div class="bs-cyber__node bs-cyber__node--5"></div>
        <div class="bs-cyber__scan"></div>
      `;
      document.body.insertBefore(cyber, document.body.firstChild);
      document.body.classList.add('bs-cyber-on');
    }
    const h = document.querySelector('[data-shell-header]');
    const f = document.querySelector('[data-shell-footer]');
    if (h) h.outerHTML = header();
    if (f) f.outerHTML = footer();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
