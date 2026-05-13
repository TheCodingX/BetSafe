/* BetSafe — Inicio (Overview) minimalista: bienvenida + próximos eventos + accesos rápidos */
(function () {
  'use strict';

  async function render(panel) {
    const session = BSAuth.current();
    const name = (session?.name || 'apostador').split(' ')[0];
    const isVip = BSAuth.isVip();

    panel.innerHTML = `
      <section class="ov-hero reveal">
        <span class="ov-eyebrow">${isVip ? 'VIP · Gold' : 'Bienvenida'}</span>
        <h1 class="ov-welcome">Bienvenido, <span class="ov-name">${BSUI.esc(name)}</span></h1>
        <p class="ov-sub">Esto es lo que tenés disponible hoy.</p>
      </section>

      <section class="reveal mt-6">
        <div class="ov-section-head">
          <h2 class="h3 ov-section-title">Próximos eventos</h2>
          <span class="muted tiny">Los partidos más relevantes del día</span>
        </div>
        <div id="ovUpNext" class="ov-events"></div>
      </section>

      <section class="reveal mt-6">
        <div class="ov-section-head">
          <h2 class="h3 ov-section-title">Accesos rápidos</h2>
          <span class="muted tiny">Tus herramientas más usadas</span>
        </div>
        <div class="ov-quick" id="ovQuick"></div>
      </section>
    `;

    // ---- Próximos eventos ----
    const SPORT_LABEL = (key) => BSData.prettySport(key);
    function whenLabel(ts) {
      const diff = ts - Date.now();
      if (diff < 0) return 'en vivo';
      const m = Math.floor(diff / 60000);
      if (m < 60)        return `en ${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24)        return `en ${h}h ${m % 60}m`;
      const d = Math.floor(h / 24);
      return `en ${d}d`;
    }
    // Live events del backend de scraping (no mock).
    const renderNext = (events) => {
      const host = panel.querySelector('#ovUpNext');
      if (!host) return;
      if (!events.length) {
        host.innerHTML = `<div class="empty" style="padding:40px;text-align:center">
          <strong>Cargando próximos partidos…</strong>
          <p class="muted tiny">Conectando con las casas argentinas legales. En cuanto tengamos partidos disponibles, aparecen acá.</p>
          <span class="muted tiny">Estado: ${BSData.liveFreshness()}</span>
        </div>`;
        return;
      }
      const nextEv = events.slice().sort((a, b) => (a.start || 0) - (b.start || 0)).slice(0, 6);
      host.innerHTML = nextEv.map((m, i) => {
      const homeCrest = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.home.id, { size: 28, name: m.home.name, sport: m.sport }) : BSIcons.teamLogo(m.home, { size: 28, sport: m.sport });
      const awayCrest = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.away.id, { size: 28, name: m.away.name, sport: m.sport }) : BSIcons.teamLogo(m.away, { size: 28, sport: m.sport });
      const leagueLogo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(m.league || m.leagueName, { size: 14 }) : '';
      const sportName = SPORT_LABEL(m.sport);
      return `
        <button type="button" class="ov-event-row" style="--i:${i}" data-match-id="${m.id}">
          <div class="ov-event-meta">
            <span class="ov-event-league">${leagueLogo}<span>${BSUI.esc(m.leagueName)}</span></span>
            <span class="ov-event-sport">${sportName}</span>
          </div>
          <div class="ov-event-teams">
            <span class="ov-event-side">
              <span class="ov-event-crest">${homeCrest}</span>
              <span class="ov-event-name">${BSUI.esc(m.home.name)}</span>
            </span>
            <span class="ov-event-vs">vs</span>
            <span class="ov-event-side">
              <span class="ov-event-crest">${awayCrest}</span>
              <span class="ov-event-name">${BSUI.esc(m.away.name)}</span>
            </span>
          </div>
          <div class="ov-event-foot">
            <span class="ov-event-when">${whenLabel(m.start)}</span>
            <span class="ov-event-date">${BSUI.dt(m.start)}</span>
            <span class="ov-event-arrow" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </span>
          </div>
        </button>`;
    }).join('');
      host.querySelectorAll('.ov-event-row').forEach(row => {
        row.addEventListener('click', () => { if (window.BSDash?.go) BSDash.go('builder'); });
      });
    };
    // Render inicial + suscripción a updates en vivo
    renderNext(BSData.liveEvents({}));
    const onUpdate = () => renderNext(BSData.liveEvents({}));
    // Solo snapshot — bs:live-update (cada 1.2s) re-renderiza la grilla → tiembla
    window.addEventListener('bs:live-snapshot', onUpdate);
    panel.__cleanup = () => {
      window.removeEventListener('bs:live-snapshot', onUpdate);
    };
    // Esperar primer snapshot si todavía no tenemos data
    if (!BSData.liveReady()) await BSData.awaitLive({ timeoutMs: 10000 });

    // ---- Accesos rápidos ----
    const QUICK = [
      { id: 'ai',          label: 'AI Picks',     desc: 'Picks listos por la IA',         icon: 'bolt', accent: 'brand' },
      { id: 'aigenerator', label: 'Generador IA', desc: 'Combinadas óptimas automáticas', icon: 'bolt', accent: 'gold', vip: true },
      { id: 'builder',     label: 'Builder',      desc: 'Armá tu combinada paso a paso',  icon: 'list', accent: 'brand' },
      { id: 'arbitrage',   label: 'Arbitraje',    desc: 'Ganancia matemática sin riesgo', icon: 'arb',  accent: 'gold', vip: true },
      { id: 'worldcup',    label: 'Mundial 2026', desc: 'Todo el Mundial en un solo lugar', icon: 'cup',  accent: 'brand' }
    ];
    panel.querySelector('#ovQuick').innerHTML = QUICK.map((q, i) => `
      <button type="button" class="ov-quick-card ov-quick-card--${q.accent}" data-go="${q.id}" style="--i:${i}">
        <span class="ov-quick-icon">${BSIcons.svg(q.icon, { size: 22 })}</span>
        <span class="ov-quick-text">
          <span class="ov-quick-label">${q.label}${q.vip ? ' <span class="vip-tag">VIP</span>' : ''}</span>
          <span class="ov-quick-desc">${q.desc}</span>
        </span>
        <span class="ov-quick-arrow" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </span>
      </button>
    `).join('');
    panel.querySelectorAll('.ov-quick-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.go;
        if (window.BSDash?.go) BSDash.go(id);
      });
    });
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('overview', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('overview', render));
  }
  doRegister();
  window.__bsOverviewRender = render;
})();
