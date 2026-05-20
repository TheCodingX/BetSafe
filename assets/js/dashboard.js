/* BetSafe — Dashboard core: tab routing, sidebar, slip bar, locks */
(function (global) {
  'use strict';

  // Primary (always visible, large): orden definido por UX — Inicio primero
  // porque es el punto de entrada natural de un usuario nuevo.
  const TABS_PRIMARY = [
    { id: 'overview',    label: 'Inicio',         icon: 'home',    vipOnly: false, desc: 'Bienvenida y accesos' },
    // ── Los 3 motores de IA están ordenados de MENOS a MÁS interacción
    //    para que el usuario entienda rápido qué tab elegir:
    //    1) Picks del día: ya están armados → leer y apostar
    //    2) Constructor Quant: vos configurás filtros → el motor arma
    //    3) Coach IA: lenguaje natural → la IA conversa y arma
    { id: 'ai',          label: 'Picks del día',  icon: 'bolt',    vipOnly: false, desc: 'Curados por IA — listos para apostar' },
    { id: 'aigenerator', label: 'Constructor Quant', icon: 'layers', vipOnly: true,  desc: 'Vos elegís filtros, el motor arma combinadas' },
    { id: 'betsafeai',   label: 'Coach IA',       icon: 'sparkle', vipOnly: true,  desc: 'Pedí en lenguaje natural lo que querés',
      flagshipVip: true },
    // Builder REMOVIDO del sidebar a pedido del usuario (2026-05-17). El
    // tabs-builder.js sigue existiendo y registrado por compatibilidad de
    // links viejos (deeplinks con #builder), pero no aparece en el nav.
    { id: 'arbitrage',   label: 'Arbitraje',      icon: 'arb',     vipOnly: true,  desc: 'Ganancia matemática sin riesgo' },
    { id: 'worldcup',    label: 'Mundial 2026',   icon: 'cup',     vipOnly: false, desc: 'Todo el Mundial en un lugar' }
  ];
  // Advanced (collapsible): herramientas secundarias.
  const TABS_ADVANCED = [
    { id: 'simulator',   label: 'Simulador',    icon: 'play',     vipOnly: false, desc: 'Probá sin arriesgar' },
    { id: 'comparator',  label: 'Comparador',   icon: 'trend',    vipOnly: false, desc: 'La casa que mejor paga' },
    { id: 'calc',        label: 'Calc Hub',     icon: 'calc',     vipOnly: false, desc: 'Calculadoras esenciales' },
    { id: 'calcpro',     label: 'CalcPro',      icon: 'calc',     vipOnly: true,  desc: 'Calculadoras avanzadas' },
    { id: 'smartmoney',  label: 'Smart Money',  icon: 'flame',    vipOnly: true,  desc: 'Movimientos sharp >5%' },
    { id: 'whatif',      label: 'What-If',      icon: 'shield',   vipOnly: true,  desc: 'Escenarios hipotéticos' },
    { id: 'tracker',     label: 'Tracker',      icon: 'chart',    vipOnly: false, desc: 'Tu banca y resultados' },
    { id: 'settings',    label: 'Ajustes',      icon: 'settings', vipOnly: false, desc: 'Preferencias y cuenta' }
  ];
  const TABS = [...TABS_PRIMARY, ...TABS_ADVANCED];

  const TAB_RENDERERS = {}; // populated by tab-*.js files via BSDash.register

  let currentTab = null;

  function init() {
    if (!BSAuth.requireAuth('login.html')) return;
    BSUI.applyVip(BSAuth.isVip());

    renderSidebar();
    bindHashRouting();
    bindBottomNav();
    initialTab();
    bindUpgradeCard();
    renderSlipBar();
    bindKeyboardShortcuts();

    // First-run onboarding
    if (BSOnboarding && !BSStore.get(BSStore.KEYS.onboarding)?.done) {
      setTimeout(() => BSOnboarding.start(), 800);
    }
  }

  function renderSidebar() {
    const nav = document.getElementById('sideNav');
    if (!nav) return;
    const isVip = BSAuth.isVip();
    const advOpen = !!BSStore.get('sidebar.advanced.open');

    const renderBtn = (t, isPrimary) => {
      const isVipItem = t.vipOnly;
      const locked = isVipItem && !isVip;
      const isFlagship = t.flagshipVip === true;
      const cls = [
        locked ? 'lock' : '',
        isVipItem ? 'vip-item' : '',
        isPrimary ? 'is-primary' : '',
        isFlagship ? 'flagship-item' : ''
      ].filter(Boolean).join(' ');
      const meta = t.desc ? `<span class="tab-desc">${t.desc}</span>` : '';
      const tagHtml = isFlagship
        ? `<span class="vip-tag vip-tag--flagship">${locked ? 'VIP' : 'NUEVO'}</span>`
        : (isVipItem ? `<span class="vip-tag">VIP</span>` : '');
      return `
        <button data-tab="${t.id}" class="${cls}">
          <span class="tab-icon">${BSIcons.svg(t.icon, { size: isPrimary ? 20 : 18 })}</span>
          <span class="tab-text">
            <span class="tab-label">${t.label}</span>
            ${isPrimary ? meta : ''}
          </span>
          ${locked ? `<span class="tab-lock" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          </span>` : tagHtml}
        </button>`;
    };

    nav.innerHTML = `
      <div class="sidenav-section sidenav-primary">
        ${TABS_PRIMARY.map(t => renderBtn(t, true)).join('')}
      </div>
      <details class="sidenav-advanced" ${advOpen ? 'open' : ''}>
        <summary>
          <svg class="adv-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
          <span class="adv-title">Avanzadas</span>
          <span class="adv-count">${TABS_ADVANCED.length}</span>
        </summary>
        <div class="sidenav-section sidenav-secondary">
          ${TABS_ADVANCED.map(t => renderBtn(t, false)).join('')}
        </div>
      </details>
    `;

    nav.querySelectorAll('button[data-tab]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.tab;
      const tab = TABS.find(x => x.id === id);
      if (tab.vipOnly && !isVip) { showVipUpsell(tab); return; }
      go(id);
    }));

    const det = nav.querySelector('.sidenav-advanced');
    if (det) det.addEventListener('toggle', () => BSStore.set('sidebar.advanced.open', det.open));
  }

  function bindUpgradeCard() {
    const c = document.getElementById('upgradeCard');
    if (c) c.hidden = BSAuth.isVip();
  }

  function bindHashRouting() {
    window.addEventListener('hashchange', () => initialTab());
  }
  function initialTab() {
    const fromHash = (location.hash || '').replace('#', '');
    const valid = TABS.find(t => t.id === fromHash);
    if (valid && (!valid.vipOnly || BSAuth.isVip())) go(fromHash);
    else go('overview');   // Inicio por defecto
  }

  function go(id) {
    const tab = TABS.find(t => t.id === id);
    if (!tab) return;
    if (tab.vipOnly && !BSAuth.isVip()) { showVipUpsell(tab); return; }
    currentTab = id;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);

    document.querySelectorAll('#sideNav button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('[data-tab-link]').forEach(a => a.classList.toggle('active', a.dataset.tabLink === id));

    // Auto-open Avanzadas if the selected tab lives inside it
    const inAdvanced = TABS_ADVANCED.some(t => t.id === id);
    const det = document.querySelector('.sidenav-advanced');
    if (det && inAdvanced && !det.open) { det.open = true; BSStore.set('sidebar.advanced.open', true); }

    const host = document.getElementById('tabHost');
    // Llamar cleanup del tab anterior antes de destruirlo, así los tabs que
    // registran setInterval/setTimeout/addEventListener pueden liberarlos.
    // Convención: el renderer setea `panel.__cleanup = () => {...}`.
    const oldPanel = host.firstElementChild;
    if (oldPanel && typeof oldPanel.__cleanup === 'function') {
      try { oldPanel.__cleanup(); } catch (e) { console.warn('[tab cleanup]', e); }
    }
    host.innerHTML = `<div class="tab-panel active" id="panel-${id}"></div>`;
    const panel = host.firstElementChild;
    const renderer = TAB_RENDERERS[id];
    if (renderer) {
      try { renderer(panel); } catch (e) { console.error(e); panel.innerHTML = errorPanel(e); }
    } else {
      panel.innerHTML = pendingPanel(tab);
    }
    BSUI.bindReveal(panel);
    BSUI.bindTooltips(panel);
    BSUI.bindMagnetic(panel);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindBottomNav() {
    document.querySelectorAll('[data-tab-link]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); go(a.dataset.tabLink);
    }));
    const more = document.querySelector('[data-bottom-more]');
    if (more) more.addEventListener('click', openMobileAdvancedDrawer);
  }

  function openMobileAdvancedDrawer() {
    const isVip = BSAuth.isVip();
    const items = TABS_ADVANCED.map(t => {
      const locked = t.vipOnly && !isVip;
      return `
        <button data-tab="${t.id}" class="mob-adv-item ${locked ? 'is-locked' : ''} ${t.vipOnly ? 'is-vip' : ''}">
          <span class="mob-adv-icon">${BSIcons.svg(t.icon, { size: 18 })}</span>
          <span class="mob-adv-text">
            <span class="mob-adv-label">${t.label}</span>
            ${t.desc ? `<span class="mob-adv-desc">${t.desc}</span>` : ''}
          </span>
          ${locked ? `<span class="vip-tag">VIP</span>` : (t.vipOnly ? `<span class="vip-tag">VIP</span>` : '')}
        </button>`;
    }).join('');
    const html = `
      <div class="drawer-header">
        <strong>Más herramientas</strong>
        <button class="btn-ghost btn-icon" aria-label="Cerrar" data-close>×</button>
      </div>
      <div class="drawer-body">
        <div class="mob-adv-grid">${items}</div>
      </div>
    `;
    const { close, drawer } = BSUI.openDrawer(html, 'right');
    drawer.querySelector('[data-close]')?.addEventListener('click', close);
    drawer.querySelectorAll('button[data-tab]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.tab;
      const tab = TABS.find(x => x.id === id);
      close();
      if (tab.vipOnly && !isVip) { showVipUpsell(tab); return; }
      go(id);
    }));
  }

  function showVipUpsell(tab) {
    const html = `
      <h3 class="h3 mb-2">${tab.label} es <span class="text-gold">VIP</span></h3>
      <p class="muted mb-4">Esta sección requiere plan VIP. Probá en modo demo o pasate ahora con la cuenta <span class="kbd">vip</span> / <span class="kbd">vip</span>.</p>
      <div class="grid grid-2">
        <button class="btn btn-outline btn-block" id="upDemo">Probar como demo VIP</button>
        <a href="pricing.html" class="btn btn-gold btn-block">Ver planes</a>
      </div>
    `;
    const { close, modal } = BSUI.openModal(html);
    modal.querySelector('#upDemo').addEventListener('click', () => {
      BSAuth.upgradeToVip();
      BSUI.applyVip(true);
      BSUI.confetti(80);
      BSUI.toast({ title: 'Modo VIP activado (demo)', message: 'Acceso completo desbloqueado.', type: 'success' });
      close();
      renderSidebar();
      bindUpgradeCard();
      go(tab.id);
    });
  }

  function pendingPanel(tab) {
    return `
      <div class="card stack">
        <span class="badge">Próximamente · Backend</span>
        <h2 class="h3">${tab.label}</h2>
        <p class="muted">Esta sección depende de servicios que se conectan en Render/Supabase. La UI ya está lista.</p>
      </div>`;
  }
  function errorPanel(e) {
    return `<div class="card stack"><span class="badge badge-danger">Error</span><pre class="mono tiny">${BSUI.esc(e?.message || e)}</pre></div>`;
  }

  // ---- Slip bar ----
  function renderSlipBar() {
    const host = document.getElementById('slipHost');
    if (!host) return;
    const slip = BSStore.get(BSStore.KEYS.slip) || { legs: [], stake: 1000 };
    if (!slip.legs.length) { host.innerHTML = ''; return; }
    const total = slip.legs.reduce((a, b) => a * b.odd, 1);
    host.innerHTML = `
      <div class="container">
        <div class="slip-bar reveal in">
          <div class="cluster" style="flex:1;flex-wrap:nowrap;overflow-x:auto">
            ${slip.legs.map((l, i) => `<span class="slip-leg"><strong>${BSUI.esc(l.label)}</strong> · <span class="num">${l.odd.toFixed(2)}</span><button data-rmleg="${i}" aria-label="Quitar">×</button></span>`).join('')}
          </div>
          <div class="cluster">
            <span class="muted tiny">Cuota</span><strong class="num">${total.toFixed(2)}</strong>
            <span class="muted tiny">Payout</span><strong class="num text-brand">${BSUI.money(total * (slip.stake || 0))}</strong>
            <button class="btn btn-ghost btn-sm" data-clear-slip>Limpiar</button>
            <button class="btn btn-primary btn-sm" data-share-slip>Compartir</button>
          </div>
        </div>
      </div>
    `;
    host.querySelectorAll('[data-rmleg]').forEach(b => b.addEventListener('click', () => {
      slip.legs.splice(Number(b.dataset.rmleg), 1);
      BSStore.set(BSStore.KEYS.slip, slip); renderSlipBar();
    }));
    host.querySelector('[data-clear-slip]')?.addEventListener('click', () => { BSStore.set(BSStore.KEYS.slip, { legs: [], stake: 1000 }); renderSlipBar(); });
    host.querySelector('[data-share-slip]')?.addEventListener('click', () => {
      const url = location.origin + '/dashboard.html#builder?slip=' + encodeURIComponent(JSON.stringify(slip.legs));
      BSUI.share({ title: 'Mi combinada — BetSafe', url });
    });
  }

  /* ───────────────────────────────────────────────────────────────────
   *  KEYBOARD SHORTCUTS — para power users
   *  ───────────────────────────────────────────────────────────────────
   *   G O = Inicio          G G = Quant IA      G A = AI Picks
   *   G B = Builder         G S = Coach IA        G R = Arbitraje
   *   G T = Tracker         G W = Mundial
   *   /   = Focus búsqueda  ?   = Mostrar ayuda     ESC = Cerrar modal
   */
  function bindKeyboardShortcuts() {
    let leader = false, leaderTimer = null;
    const SHORTCUTS = {
      'o': 'overview', 'g': 'aigenerator', 'a': 'ai', 'b': 'builder',
      's': 'betsafeai', 'r': 'arbitrage', 't': 'tracker', 'w': 'worldcup',
      'c': 'comparator', 'h': 'calc'
    };
    document.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      // No interferir con inputs / textareas / contenteditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        showShortcutsHelp();
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        const search = document.querySelector('[data-shell-header] input[type="search"], #aiFilter, .search-input');
        if (search) { search.focus(); search.select?.(); }
        return;
      }
      if (e.key === 'Escape') {
        document.querySelector('.modal-close, [data-modal-close]')?.click();
        return;
      }
      // Leader key 'g' + secondary
      if (leader && SHORTCUTS[e.key.toLowerCase()]) {
        e.preventDefault();
        const target = SHORTCUTS[e.key.toLowerCase()];
        leader = false; clearTimeout(leaderTimer);
        go(target);
        return;
      }
      if (e.key.toLowerCase() === 'g' && !leader) {
        leader = true;
        leaderTimer = setTimeout(() => { leader = false; }, 1500);
        return;
      }
    });
  }

  function showShortcutsHelp() {
    const html = `
      <h3 class="h3 mb-2">Atajos de teclado</h3>
      <p class="muted tiny mb-3">Las combos empiezan con <kbd>G</kbd> (de "go to") seguido de una letra:</p>
      <div class="kbd-shortcuts-grid">
        <div><kbd>G</kbd> <kbd>O</kbd></div><div>Inicio (Overview)</div>
        <div><kbd>G</kbd> <kbd>G</kbd></div><div>Quant IA</div>
        <div><kbd>G</kbd> <kbd>A</kbd></div><div>AI Picks</div>
        <div><kbd>G</kbd> <kbd>B</kbd></div><div>Builder</div>
        <div><kbd>G</kbd> <kbd>S</kbd></div><div>Coach IA ✨</div>
        <div><kbd>G</kbd> <kbd>R</kbd></div><div>Arbitraje</div>
        <div><kbd>G</kbd> <kbd>T</kbd></div><div>Tracker</div>
        <div><kbd>G</kbd> <kbd>C</kbd></div><div>Comparador</div>
        <div><kbd>G</kbd> <kbd>W</kbd></div><div>Mundial 2026</div>
        <div><kbd>/</kbd></div><div>Foco en búsqueda</div>
        <div><kbd>?</kbd></div><div>Esta ayuda</div>
        <div><kbd>Esc</kbd></div><div>Cerrar modales</div>
      </div>
    `;
    if (window.BSUI?.openModal) BSUI.openModal(html);
  }

  // Public API for tab files
  global.BSDash = {
    register(id, fn) { TAB_RENDERERS[id] = fn; },
    go,
    renderSlipBar,
    addToSlip(leg) {
      const slip = BSStore.get(BSStore.KEYS.slip) || { legs: [], stake: 1000 };
      slip.legs.push(leg);
      BSStore.set(BSStore.KEYS.slip, slip);
      renderSlipBar();
      BSUI.toast({ title: 'Agregado a tu combinada', message: leg.label, type: 'success' });
    },
    TABS
  };

  document.addEventListener('DOMContentLoaded', init);
})(window);
