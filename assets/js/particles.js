/* BetSafe — Particle network background
 *  - Floating dots in brand colors (green / navy / gold)
 *  - Thin lines connect particles within a neighborhood radius
 *  - Subtle parallax follows mouse movement
 *  - GPU-friendly (single canvas, rAF, no DOM thrash)
 *  - Respects prefers-reduced-motion (renders a still frame and stops)
 *  - Auto-pauses when document is hidden
 */
(function () {
  'use strict';

  // SINGLE brand color — no more multi-color trails. Pure brand-green,
  // subtle alpha range. Dark mode uses same green slightly more saturated.
  const COLORS_LIGHT = ['34,197,94'];
  const COLORS_DARK  = ['74,222,128'];
  function currentColors() {
    return document.documentElement.dataset.theme === 'dark' ? COLORS_DARK : COLORS_LIGHT;
  }
  let COLORS = currentColors();
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init() {
    if (document.querySelector('.bs-particles canvas')) return; // already running

    // Container
    const wrap = document.createElement('div');
    wrap.className = 'bs-particles';
    wrap.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(wrap, document.body.firstChild);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    wrap.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];
    let mouseX = -9999, mouseY = -9999;
    let raf = null;
    let running = true;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width  = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width  = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seed();
    }

    function seed() {
      COLORS = currentColors();
      // Lower density + slower velocity for a calmer, more professional feel
      // 1 particle per ~32000 px², capped between 35 and 75
      const target = Math.max(35, Math.min(75, Math.round((W * H) / 32000)));
      particles = new Array(target).fill(0).map(() => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.20,
        vy: (Math.random() - 0.5) * 0.20,
        r: 1.0 + Math.random() * 1.4,
        c: COLORS[0],
        a: 0.25 + Math.random() * 0.30,
        phi: Math.random() * Math.PI * 2,
        wob: 0.7 + Math.random() * 0.8
      }));
    }

    // Re-seed particle colors when theme attribute on <html> changes
    function bindThemeObserver() {
      try {
        const obs = new MutationObserver(() => {
          COLORS = currentColors();
          // Recolor existing particles in place (no respawn flash)
          for (const p of particles) p.c = COLORS[Math.floor(Math.random() * COLORS.length)];
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      } catch (e) { /* noop */ }
    }
    bindThemeObserver();

    function step(ts) {
      ctx.clearRect(0, 0, W, H);

      // Update + draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        // Mouse parallax pull (subtle)
        const dxM = mouseX - p.x, dyM = mouseY - p.y;
        const dM2 = dxM * dxM + dyM * dyM;
        if (dM2 < 22500) { // 150px radius
          const f = 0.0006 * (1 - Math.sqrt(dM2) / 150);
          p.vx += dxM * f;
          p.vy += dyM * f;
        }

        // Friction so velocity doesn't snowball
        p.vx *= 0.992; p.vy *= 0.992;

        // Wrap around edges instead of bouncing (smoother visual)
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;

        // Breathing
        const breathe = Math.sin((ts || 0) * 0.0018 + p.phi) * 0.5 + 0.5;
        const radius = p.r * (0.85 + 0.3 * breathe);
        const alpha  = p.a * (0.7 + 0.3 * breathe);

        // Subtle glow
        ctx.fillStyle = `rgba(${p.c},${alpha * 0.10})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.6, 0, Math.PI * 2);
        ctx.fill();
        // Core
        ctx.fillStyle = `rgba(${p.c},${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Subtle short connections — only nearby, very low alpha
      const MAX = 110;
      const MAX2 = MAX * MAX;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < MAX2) {
            const d = Math.sqrt(d2);
            const t = 1 - d / MAX;
            ctx.strokeStyle = `rgba(${a.c},${0.08 * t})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      if (running) raf = requestAnimationFrame(step);
    }

    // Bindings
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    }, { passive: true });

    window.addEventListener('mousemove', e => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running && !raf) raf = requestAnimationFrame(step);
      else if (!running && raf) { cancelAnimationFrame(raf); raf = null; }
    });

    resize();
    if (REDUCED) {
      // Render a single still frame for users that opted out of motion
      step(0);
      running = false;
    } else {
      raf = requestAnimationFrame(step);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
