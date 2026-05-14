/* BetSafe — UI layer: theme, toast, modal, drawer, tooltip, palette, animations, format */
(function (global) {
  'use strict';

  // ---- Format helpers (es-AR) ----
  const fmtAR = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const fmtPct = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
  const fmtNumX = (digits = 2) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  function money(n) { if (!isFinite(n)) return '—'; return fmtAR.format(n); }
  function pct(n) { if (!isFinite(n)) return '—'; return fmtPct.format(n); }
  function num(n, d) { if (!isFinite(n)) return '—'; return d != null ? fmtNumX(d).format(n) : fmtNum.format(n); }
  function dt(ts) { return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function dur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return { d, h, m, s: sec };
  }

  // ---- Theme ----
  function applyTheme(t) {
    const html = document.documentElement;
    html.setAttribute('data-theme', t);
    BSStore.set(BSStore.KEYS.theme, t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0a0e14' : '#ffffff');
  }
  function initTheme() {
    const stored = BSStore.get(BSStore.KEYS.theme);
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const t = stored || 'light'; // default light per spec
    applyTheme(t);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  // ---- VIP gold accent ----
  function applyVip(isVip) {
    if (isVip) document.documentElement.setAttribute('data-vip', 'true');
    else document.documentElement.removeAttribute('data-vip');
  }

  // ---- Toasts (Sonner-like) ----
  function ensureToastHost() {
    let h = document.querySelector('.toasts');
    if (!h) { h = document.createElement('div'); h.className = 'toasts'; h.setAttribute('aria-live', 'polite'); document.body.appendChild(h); }
    return h;
  }
  function toast({ title, message = '', type = 'info', duration = 4500 } = {}) {
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="body">${title ? `<strong>${esc(title)}</strong>` : ''}${esc(message)}</div><button class="btn-ghost btn-icon" aria-label="Cerrar">×</button><div class="progress"></div>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    const prog = el.querySelector('.progress');
    prog.style.transition = `transform ${duration}ms linear`;
    requestAnimationFrame(() => prog.style.transform = 'scaleX(0)');
    const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 240); };
    el.querySelector('button').addEventListener('click', close);
    setTimeout(close, duration);
    return el;
  }

  // ---- Modal helper ----
  function openModal(html, opts = {}) {
    let overlay = document.querySelector('.overlay.bs-modal-overlay');
    let modal = document.querySelector('.modal.bs-modal');
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'overlay bs-modal-overlay'; document.body.appendChild(overlay); }
    if (!modal) { modal = document.createElement('div'); modal.className = 'modal bs-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); document.body.appendChild(modal); }
    modal.classList.toggle('modal-lg', !!opts.large);
    modal.innerHTML = `<button class="modal-close" aria-label="Cerrar">×</button>` + html;
    overlay.classList.add('open'); modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    const close = () => closeModal(modal, overlay, opts.onClose);
    modal.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', close, { once: true });
    document.addEventListener('keydown', escListener);
    function escListener(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escListener); } }
    // Focus trap
    setTimeout(() => { const f = modal.querySelector('input,button,select,textarea,a'); if (f) f.focus(); }, 60);
    return { close, modal };
  }
  function closeModal(modal, overlay, cb) {
    if (modal) modal.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (cb) cb();
  }

  // ---- Drawer helper ----
  function openDrawer(html, side = 'right') {
    let overlay = document.querySelector('.overlay.bs-drawer-overlay');
    let dr = document.querySelector('.drawer.bs-drawer');
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'overlay bs-drawer-overlay'; document.body.appendChild(overlay); }
    if (!dr) { dr = document.createElement('aside'); dr.className = 'drawer bs-drawer'; document.body.appendChild(dr); }
    dr.classList.toggle('drawer-left', side === 'left');
    dr.innerHTML = html;
    overlay.classList.add('open'); dr.classList.add('open');
    const close = () => { dr.classList.remove('open'); overlay.classList.remove('open'); };
    overlay.addEventListener('click', close, { once: true });
    return { close, drawer: dr };
  }

  // ---- Tooltip ----
  // Single source of truth: .help-q and .bs-help render their own CSS-only popover
  // (via ::after with data-tip). The JS layer below ONLY targets elements that
  // explicitly opt-in with [data-tip-js="1"] — this avoids the duplicate "extra
  // bar" that appeared when both systems fired together.
  function bindTooltips(root = document) {
    let tip = document.querySelector('.tooltip.bs-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip bs-tip'; document.body.appendChild(tip); }
    root.querySelectorAll('[data-tip-js="1"]').forEach(el => {
      if (el.__bound) return; el.__bound = true;
      el.addEventListener('mouseenter', () => { tip.textContent = el.getAttribute('data-tip'); place(); tip.classList.add('show'); });
      el.addEventListener('mouseleave', () => { tip.classList.remove('show'); });
      el.addEventListener('focus', () => { tip.textContent = el.getAttribute('data-tip'); place(); tip.classList.add('show'); });
      el.addEventListener('blur', () => { tip.classList.remove('show'); });
      function place() {
        const r = el.getBoundingClientRect();
        tip.style.left = Math.min(window.innerWidth - 200, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
        tip.style.top = (r.top - tip.offsetHeight - 8 + window.scrollY) + 'px';
      }
    });
  }

  // ---- Portal tooltip for .help-q and .bs-help ----
  // The CSS ::after approach was being clipped by sibling stacking contexts
  // (cards with transforms create their own stacking context, so z-index has
  // no effect across them). We render the tooltip on document.body with
  // position: fixed so it always stays above everything.
  let _portalEl = null;
  let _portalActive = null;
  function _ensurePortal() {
    if (_portalEl) return _portalEl;
    const el = document.createElement('div');
    el.className = 'bs-tip-portal';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    _portalEl = el;
    return el;
  }
  function _placePortal(target, portal) {
    const r = target.getBoundingClientRect();
    const pw = portal.offsetWidth;
    const ph = portal.offsetHeight;
    const gap = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = r.bottom + gap;
    let placement = 'below';
    if (top + ph > vh - 8) {
      const aboveTop = r.top - ph - gap;
      if (aboveTop >= 8) { top = aboveTop; placement = 'above'; }
      else { top = Math.max(8, vh - ph - 8); }
    }

    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(vw - pw - 8, left));

    portal.style.left = left + 'px';
    portal.style.top = top + 'px';
    portal.setAttribute('data-placement', placement);
  }
  function _showPortal(target) {
    const tip = target.getAttribute('data-tip');
    if (!tip) return;
    const portal = _ensurePortal();
    portal.textContent = tip;
    _portalActive = target;
    requestAnimationFrame(() => {
      _placePortal(target, portal);
      portal.classList.add('show');
    });
  }
  function _hidePortal() {
    if (_portalEl) _portalEl.classList.remove('show');
    _portalActive = null;
  }
  function bindHelpPortalTooltips() {
    const SEL = '.help-q[data-tip], .bs-help[data-tip]';
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest(SEL);
      if (!t || _portalActive === t) return;
      _showPortal(t);
    });
    document.addEventListener('mouseout', (e) => {
      const t = e.target.closest && e.target.closest(SEL);
      if (!t) return;
      if (e.relatedTarget && t.contains(e.relatedTarget)) return;
      if (_portalActive === t) _hidePortal();
    });
    document.addEventListener('focusin', (e) => {
      const t = e.target.closest && e.target.closest(SEL);
      if (t) _showPortal(t);
    });
    document.addEventListener('focusout', (e) => {
      const t = e.target.closest && e.target.closest(SEL);
      if (t && _portalActive === t) _hidePortal();
    });
    window.addEventListener('scroll', () => {
      if (_portalActive && _portalEl) _placePortal(_portalActive, _portalEl);
    }, { passive: true, capture: true });
    window.addEventListener('resize', () => {
      if (_portalActive && _portalEl) _placePortal(_portalActive, _portalEl);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _portalActive) _hidePortal();
    });
  }

  // ---- Reveal observer ----
  // Observer singleton compartido entre llamadas a bindReveal y el
  // MutationObserver global. Esto garantiza que cualquier elemento `.reveal`
  // agregado dinámicamente al DOM (combos de Quant IA, AI Picks, BetSafe
  // AI, etc.) sea observado y se muestre cuando entra al viewport.
  let _revealIO = null;
  function getRevealIO() {
    if (_revealIO) return _revealIO;
    if (!('IntersectionObserver' in window)) return null;
    _revealIO = new IntersectionObserver((ents) => {
      ents.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          _revealIO.unobserve(en.target);
        }
      });
    }, { threshold: 0.04, rootMargin: '0px 0px 0px 0px' });
    return _revealIO;
  }

  function bindReveal(root = document) {
    const io = getRevealIO();
    const elems = root.querySelectorAll('.reveal,.reveal-stagger');
    if (!io) {
      // Sin IntersectionObserver → mostrar todo de una.
      elems.forEach(el => el.classList.add('in'));
      return;
    }
    elems.forEach(el => {
      // Si ya está visible al momento de bind, marcar inmediatamente.
      const r = el.getBoundingClientRect();
      if (r.top < (window.innerHeight || 0) && r.bottom > 0) {
        el.classList.add('in');
      } else {
        io.observe(el);
      }
    });
  }

  // ── GLOBAL: auto-bind a cualquier .reveal/.reveal-stagger insertado al DOM ──
  // Esto resuelve el bug donde contenido dinámico (combinadas generadas,
  // picks de IA, surebets, etc.) quedaba con opacity:0 porque el observer
  // original solo corría una vez al cargar la sección.
  function startGlobalRevealAutoBind() {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver((muts) => {
      const io = getRevealIO();
      if (!io) return;
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // El propio nodo
          if (node.classList && (node.classList.contains('reveal') || node.classList.contains('reveal-stagger'))) {
            const r = node.getBoundingClientRect();
            if (r.top < (window.innerHeight || 0) && r.bottom > 0) {
              node.classList.add('in');
            } else {
              io.observe(node);
            }
          }
          // Sus hijos
          if (node.querySelectorAll) {
            node.querySelectorAll('.reveal,.reveal-stagger').forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.top < (window.innerHeight || 0) && r.bottom > 0) {
                el.classList.add('in');
              } else {
                io.observe(el);
              }
            });
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startGlobalRevealAutoBind);
  } else {
    startGlobalRevealAutoBind();
  }

  // ---- Count-up ----
  function countUp(el, to, opts = {}) {
    if (!el || !isFinite(to)) return;
    const from = parseFloat(el.getAttribute('data-from')) || 0;
    const dur = opts.duration || 900;
    const dec = opts.decimals != null ? opts.decimals : 0;
    const prefix = opts.prefix || '';
    const suffix = opts.suffix || '';
    const fmtFn = opts.fmt || ((n) => num(n, dec));
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      el.textContent = `${prefix}${fmtFn(v)}${suffix}`;
      if (t < 1) requestAnimationFrame(frame);
      else el.setAttribute('data-from', String(to));
    }
    requestAnimationFrame(frame);
  }

  // ---- Sparkline ----
  function sparkline(el, values, opts = {}) {
    if (!el || !values?.length) return;
    const w = 240, h = 60, pad = 4;
    const min = Math.min(...values), max = Math.max(...values);
    const dx = (w - pad * 2) / (values.length - 1 || 1);
    const points = values.map((v, i) => [pad + i * dx, h - pad - ((v - min) / Math.max(1e-9, max - min)) * (h - pad * 2)]);
    const d = points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${d} L ${points[points.length-1][0].toFixed(1)} ${h-pad} L ${pad} ${h-pad} Z`;
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark"><path class="area" d="${area}"/><path d="${d}"/></svg>`;
  }

  // ---- Confetti ----
  function confetti(count = 80) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = document.createElement('div'); host.className = 'confetti-host'; document.body.appendChild(host);
    const colors = ['#0b6b3a', '#12b76a', '#d4a017', '#f6c84a', '#34d399'];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span'); p.className = 'confetti-piece';
      p.style.background = colors[i % colors.length];
      p.style.left = (Math.random() * 100) + '%';
      p.style.transform = `translateY(-30vh) rotate(${Math.random()*360}deg)`;
      p.style.animationDelay = (Math.random() * 0.4) + 's';
      p.style.animationDuration = (1.2 + Math.random()*1.2) + 's';
      host.appendChild(p);
    }
    setTimeout(() => host.remove(), 2500);
  }

  // ---- Magnetic buttons ----
  function bindMagnetic(root = document) {
    root.querySelectorAll('.mag').forEach(el => {
      if (el.__mag) return; el.__mag = true;
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${dx * .12}px, ${dy * .12}px)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  }

  // ---- Scroll progress ----
  function bindScrollProgress() {
    const bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    const onScroll = () => {
      const h = document.documentElement;
      const p = h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight);
      bar.style.transform = `scaleX(${p})`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function bindHeaderShadow() {
    const h = document.querySelector('.site-header'); if (!h) return;
    const onS = () => { h.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onS, { passive: true }); onS();
  }

  // ---- Command palette ----
  let palette;
  function openCommandPalette(items = [], opts = {}) {
    const html = `
      <input class="cmd-input input" placeholder="Buscar comandos…" aria-label="Buscar comandos" />
      <div class="cmd-list" role="listbox"></div>
    `;
    const { modal, close } = openModal(html);
    modal.classList.add('cmd-palette');
    const input = modal.querySelector('.cmd-input');
    const list = modal.querySelector('.cmd-list');
    let active = 0;
    const render = (q = '') => {
      const filtered = items.filter(it => !q || (it.label + ' ' + (it.desc || '')).toLowerCase().includes(q.toLowerCase()));
      list.innerHTML = filtered.map((it, i) =>
        `<div class="cmd-item ${i===active?'active':''}" role="option" data-i="${i}">
          <span style="flex:1">${esc(it.label)}${it.desc?`<div class="dim tiny">${esc(it.desc)}</div>`:''}</span>
          ${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}
        </div>`
      ).join('') || `<div class="dim" style="padding:14px;text-align:center">Sin resultados</div>`;
      list.querySelectorAll('.cmd-item').forEach(el => el.addEventListener('click', () => { items[Number(el.dataset.i)]?.action?.(); close(); }));
    };
    render();
    input.addEventListener('input', e => { active = 0; render(e.target.value); });
    input.addEventListener('keydown', e => {
      const cur = list.querySelectorAll('.cmd-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % cur.length; render(input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + cur.length) % cur.length; render(input.value); }
      else if (e.key === 'Enter') { const i = Number(cur[active]?.dataset.i || 0); items[i]?.action?.(); close(); }
    });
    setTimeout(() => input.focus(), 80);
  }

  // ---- Helpers ----
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function $(sel, root = document) { return root.querySelector(sel); }

  // ---- Web Share with clipboard fallback ----
  async function share({ title, text, url } = {}) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return true; } catch {}
    }
    try { await navigator.clipboard.writeText(url || text || ''); toast({ title: 'Copiado', message: 'Link copiado al portapapeles', type: 'success' }); return true; }
    catch { toast({ title: 'No se pudo compartir', type: 'danger' }); return false; }
  }

  // ---- Cookie banner ----
  function bindCookieBanner() {
    const stored = BSStore.get(BSStore.KEYS.cookies);
    if (stored) return;
    const el = document.createElement('div');
    el.className = 'cookie-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Aviso de cookies');
    el.innerHTML = `
      <p><strong>Cookies & datos</strong> — Usamos almacenamiento local para guardar tu sesión y preferencias. Sin tracking publicitario.</p>
      <div class="row" style="gap:8px">
        <button class="btn btn-outline btn-sm" data-act="reject">Rechazar</button>
        <button class="btn btn-ghost btn-sm" data-act="custom">Personalizar</button>
        <button class="btn btn-primary btn-sm" data-act="accept">Aceptar</button>
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 800);
    el.addEventListener('click', e => {
      const a = e.target?.dataset?.act; if (!a) return;
      BSStore.set(BSStore.KEYS.cookies, { choice: a, at: Date.now() });
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    });
  }

  // ---- Age verification ----
  function bindAgeVerification() {
    if (BSStore.get(BSStore.KEYS.age)) return;
    const html = `
      <h3 class="h3 mb-2">Verificación de edad</h3>
      <p class="muted mb-4">BetSafe es una herramienta de análisis para mayores de 18 años. Confirmá tu edad para continuar.</p>
      <div class="card card-tinted mb-4" style="font-size:.85rem">
        <strong>Juego responsable.</strong> Si necesitás ayuda, llamá al <strong>0800-444-4000</strong> (SEDRONAR) o visitá <a href="https://www.juegoresponsable.com.ar" target="_blank" rel="noopener" class="text-brand">juegoresponsable.com.ar</a>.
      </div>
      <div class="row gap-3">
        <button class="btn btn-primary btn-block" data-age="yes">Tengo +18 años</button>
        <button class="btn btn-outline btn-block" data-age="no">Soy menor</button>
      </div>`;
    const { modal, close } = openModal(html);
    modal.querySelector('[data-age="yes"]').addEventListener('click', () => {
      BSStore.set(BSStore.KEYS.age, { ok: true, at: Date.now() });
      close();
    });
    modal.querySelector('[data-age="no"]').addEventListener('click', () => {
      window.location.href = 'https://www.juegoresponsable.com.ar';
    });
  }

  // ---- Smooth scroll for anchors ----
  function bindAnchorScroll() {
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]'); if (!a) return;
      const id = a.getAttribute('href').slice(1); if (!id) return;
      const target = document.getElementById(id); if (!target) return;
      e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ===================================================================
   * v2 enhancements: tilt 3D, VIP cursor, gold particles, spotlight,
   * AI status indicator, odds flash, scroll-stagger, hero orbs
   * =================================================================*/
  function bindTilt(scope = document) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    $$('.tilt', scope).forEach(card => {
      let rect = null;
      card.addEventListener('mouseenter', () => { rect = card.getBoundingClientRect(); });
      card.addEventListener('mousemove', e => {
        if (!rect) rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const rx = (.5 - y) * 7;
        const ry = (x - .5) * 9;
        card.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
        card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  function bindSpotlight(scope = document) {
    $$('.spotlight', scope).forEach(el => {
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    });
  }

  function bindStagger(scope = document) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { $$('.reveal, .reveal-x, .stagger', scope).forEach(el => el.classList.add('is-in')); return; }
    if (!('IntersectionObserver' in window)) {
      $$('.reveal, .reveal-x, .stagger', scope).forEach(el => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: .12 });
    $$('.reveal, .reveal-x, .stagger', scope).forEach(el => io.observe(el));
  }

  function spawnVipParticles(host, count = 14) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.createElement('div');
    layer.className = 'vip-particles';
    layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      const dur = 5 + Math.random() * 5;
      const delay = Math.random() * 4;
      const left = Math.random() * 100;
      const dx = (Math.random() * 60 - 30).toFixed(1) + 'px';
      const size = 3 + Math.random() * 4;
      s.style.left = left + '%';
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.animationDuration = dur + 's';
      s.style.animationDelay = delay + 's';
      s.style.setProperty('--dx', dx);
      layer.appendChild(s);
    }
    host.style.position = host.style.position || 'relative';
    host.appendChild(layer);
    return layer;
  }

  // VIP cursor — only mounts on >=1024px when body has [data-vip=1]
  function bindVipCursor() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!matchMedia('(pointer: fine)').matches) return;
    if (document.body.getAttribute('data-vip') !== '1') return;
    if (document.querySelector('.vip-cursor-dot')) return;
    document.body.classList.add('vip-cursor');
    const dot = document.createElement('div');
    const ring = document.createElement('div');
    dot.className = 'vip-cursor-dot';
    ring.className = 'vip-cursor-ring';
    document.body.append(dot, ring);
    let mx = -100, my = -100, rx = mx, ry = my;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    function loop() {
      rx += (mx - rx) * .22; ry += (my - ry) * .22;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    document.addEventListener('mouseover', e => {
      if (e.target.closest('a, button, [role=button], input, select')) ring.classList.add('is-active');
    });
    document.addEventListener('mouseout', e => {
      if (e.target.closest('a, button, [role=button], input, select')) ring.classList.remove('is-active');
    });
  }

  function unbindVipCursor() {
    document.body.classList.remove('vip-cursor');
    document.querySelectorAll('.vip-cursor-dot, .vip-cursor-ring').forEach(n => n.remove());
  }

  // AI status pill — listens to bs:ai-status events
  function mountAiStatus(host) {
    if (!host) return;
    host.classList.add('ai-status');
    host.dataset.state = 'idle';
    host.innerHTML = `<span class="dot"></span><span class="lbl">IA: en espera</span>`;
    function set(state, label) { host.dataset.state = state; host.querySelector('.lbl').textContent = label; }
    window.addEventListener('bs:ai-status', e => {
      const { ok, primary, health } = e.detail || {};
      if (ok || health === 'ok') set('live', primary ? `IA · ${primary}` : 'IA en vivo');
      else if (health === 'no-keys') set('offline', 'IA no configurada');
      else if (health === 'degraded') set('offline', 'IA degradada');
      else set('offline', 'IA offline');
    });
    window.addEventListener('bs:odds-status', e => {
      // optional: piggy-back odds status into title
      if (host.dataset.state === 'idle') set(e.detail?.ok ? 'live' : 'offline', e.detail?.ok ? 'Datos en vivo' : 'Datos en caché');
    });
  }

  /**
   * Banner unificado para mostrar estado IA dentro de cualquier panel.
   * @param {object} opts
   * @param {'ok'|'degraded'|'no-keys'|'unknown'} opts.health
   * @param {string|null} opts.provider — 'gemini' | 'groq' | etc
   * @param {string|null} opts.reason — mensaje humano del servidor
   * @param {string} [opts.onRetry] — id del botón retry (si no, no se renderiza)
   * @param {string} [opts.context] — etiqueta extra para el banner (ej. 'Coach IA')
   * @returns {string} HTML del banner — '' si health === 'ok'
   */
  function aiHealthBanner(opts) {
    const { health, provider, reason, onRetry, context } = opts || {};
    // Si IA está OK, mostramos un mini-badge sutil, no un banner
    if (health === 'ok' && provider) {
      return `<span class="bs-ai-pill bs-ai-pill--ok" title="Análisis generado con ${esc(provider)}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        IA · ${esc(provider)}
      </span>`;
    }
    let title, body, tone;
    if (health === 'no-keys') {
      tone = 'info';
      title = 'IA no configurada en el servidor';
      body = reason || 'El admin del servidor todavía no cargó keys de Gemini o Groq. Lo que ves abajo viene de los modelos cuantitativos puros (Poisson + Elo), sin análisis IA generativo.';
    } else if (health === 'degraded') {
      tone = 'warn';
      title = 'La IA no está disponible en este momento';
      body = reason || 'Rate limit, cuota agotada o red lenta. El motor cuantitativo armó esto sin lectura IA — esperá 30-60s y reintentá para que la IA lo revise.';
    } else if (health === 'unknown') {
      tone = 'neutral';
      title = 'No sabemos si la IA está activa';
      body = reason || 'No pudimos consultar el estado de la IA. Intentá refrescar la página.';
    } else {
      return '';
    }
    const icon = tone === 'warn'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      : tone === 'info'
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`;
    return `<div class="bs-ai-banner bs-ai-banner--${tone}" role="status" aria-live="polite">
      <span class="bs-ai-banner__icon" aria-hidden="true">${icon}</span>
      <div class="bs-ai-banner__body">
        <strong>${esc(title)}${context ? ` <span class="muted tiny">· ${esc(context)}</span>` : ''}</strong>
        <p>${esc(body)}</p>
      </div>
      ${onRetry ? `<button class="btn btn-outline btn-sm bs-ai-banner__retry" id="${esc(onRetry)}" type="button">Reintentar</button>` : ''}
    </div>`;
  }

  // Odds flash — apply odd-up / odd-down based on previous value
  function flashOdd(el, prev, next) {
    if (prev == null || next == null || prev === next) return;
    el.classList.remove('odd-up', 'odd-down');
    void el.offsetWidth;
    el.classList.add(next > prev ? 'odd-up' : 'odd-down');
  }

  // Hero orb auto-mount
  function mountHeroOrbs(scope) {
    $$('.hero', scope).forEach(h => {
      if (h.querySelector('.hero-orbs')) return;
      const div = document.createElement('div');
      div.className = 'hero-orbs';
      div.setAttribute('aria-hidden', 'true');
      div.innerHTML = '<span></span><span></span><span></span>';
      h.prepend(div);
      // NOTE: do NOT add `spotlight` here — that class is reserved for the
      // onboarding tour overlay and would paint a dark veil over the hero.
    });
  }

  // Auto count-up for [data-count] elements
  function autoCount(scope = document) {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const el = en.target;
          const to = parseFloat(el.dataset.count || el.textContent.replace(/[^\d.-]/g, ''));
          const fmt = el.dataset.format || '';
          countUp(el, to, { duration: 1400, format: v => {
            if (fmt === 'pct') return v.toFixed(1) + '%';
            if (fmt === 'money') return BSUI.money(v);
            return BSUI.num(Math.round(v));
          }});
          io.unobserve(el);
        }
      });
    }, { threshold: .35 });
    $$('[data-count]', scope).forEach(el => io.observe(el));
  }

  global.BSUI = {
    money, pct, num, dt, dur, fmtAR,
    applyTheme, initTheme, toggleTheme, applyVip,
    toast, openModal, closeModal, openDrawer,
    bindTooltips, bindHelpPortalTooltips, bindReveal, countUp, sparkline,
    confetti, bindMagnetic, bindScrollProgress, bindHeaderShadow,
    openCommandPalette, share, bindCookieBanner, bindAgeVerification,
    bindAnchorScroll, esc, $, $$,
    // v2
    bindTilt, bindSpotlight, bindStagger, spawnVipParticles,
    bindVipCursor, unbindVipCursor, mountAiStatus, flashOdd,
    mountHeroOrbs, autoCount,
    // v5.8: banner unificado para mostrar status IA en cualquier panel
    aiHealthBanner
  };
})(window);
