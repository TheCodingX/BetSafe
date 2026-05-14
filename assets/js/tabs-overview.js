/* BetSafe — Inicio (Overview) minimalista: bienvenida + próximos eventos + accesos rápidos */
(function () {
  'use strict';

  function greetingByHour() {
    const h = new Date().getHours();
    if (h < 5) return 'Buenas noches';
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  async function render(panel) {
    const session = BSAuth.current();
    const name = (session?.name || 'apostador').split(' ')[0];
    const isVip = BSAuth.isVip();

    // ── WHAT'S NEW banner: aparece una vez por feature nueva (sticky en LS) ──
    const WHATS_NEW_VERSION = 'betsafe-ai-v1';
    const dismissedWhatsNew = localStorage.getItem('bs:whatsnew') === WHATS_NEW_VERSION;

    panel.innerHTML = `
      ${!dismissedWhatsNew ? `
        <section class="ov-whatsnew reveal" id="ovWhatsNew">
          <div class="ov-whatsnew__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M19 14l.8 2.7L22 17.5l-2.2.8L19 21l-.8-2.7L16 17.5l2.2-.8L19 14z"/></svg>
          </div>
          <div class="ov-whatsnew__body">
            <strong class="ov-whatsnew__title">NUEVO · Coach IA</strong>
            <p class="ov-whatsnew__desc">Pedile combinadas a medida hablando o escribiendo. "Haceme una combinada de 4 partidos de la Premier con cuota cerca de 6, dentro de todo segura" — y la IA arma todo cumpliendo tus condiciones.</p>
          </div>
          <div class="ov-whatsnew__actions">
            <a href="#betsafeai" class="btn btn-gold btn-sm mag">Probar ahora</a>
            <button class="btn-ghost btn-icon btn-sm" id="ovWhatsNewClose" aria-label="Cerrar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </section>
      ` : ''}

      <section class="ov-hero ov-hero--premium reveal">
        <div class="ov-hero__bg" aria-hidden="true"></div>
        <div class="ov-hero__content">
          <div class="ov-hero__row">
            <span class="ov-eyebrow ${isVip ? 'ov-eyebrow--vip' : ''}">
              ${isVip ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>' : ''}
              ${isVip ? 'VIP · Gold tier' : 'Bienvenida'}
            </span>
            <span class="ov-hero__greeting muted tiny">${greetingByHour()}</span>
          </div>
          <h1 class="ov-welcome">Bienvenido, <span class="ov-name">${BSUI.esc(name)}</span></h1>
          <p class="ov-sub">Esto es lo que tenés disponible hoy.</p>
        </div>
      </section>

      <!-- ── BRIEF DEL DÍA ────────────────────────────────────────── -->
      <section class="ov-brief reveal mt-4" id="ovBrief">
        <div class="ov-brief-loading">
          <span class="bsai-radar" style="width:64px;height:64px"><span class="bsai-radar__sweep"></span></span>
          <div class="stack-sm" style="flex:1">
            <strong>Generando brief del día…</strong>
            <span class="muted tiny">Analizando partidos, surebets activas y movimientos del mercado.</span>
          </div>
        </div>
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

    // ── Cargar Daily Report en background (no bloquea el render) ──
    loadDailyBrief(panel);

    // ── Bind What's New banner close ──
    panel.querySelector('#ovWhatsNewClose')?.addEventListener('click', () => {
      localStorage.setItem('bs:whatsnew', 'betsafe-ai-v1');
      const banner = panel.querySelector('#ovWhatsNew');
      if (banner) {
        banner.style.transition = 'opacity .25s, transform .25s';
        banner.style.opacity = '0';
        banner.style.transform = 'translateY(-8px)';
        setTimeout(() => banner.remove(), 250);
      }
    });

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
      { id: 'aigenerator', label: 'Quant IA', desc: 'Combinadas óptimas automáticas', icon: 'bolt', accent: 'gold', vip: true },
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

  /* Daily brief widget — fetch /api/daily-report y render con stats + AI summary */
  async function loadDailyBrief(panel) {
    const host = panel.querySelector('#ovBrief');
    if (!host) return;
    try {
      // 90s timeout: daily-report puede hacer LLM call que tarde 30-60s con
      // analizando 10 partidos. Antes 60s era demasiado ajustado y abortaba.
      const API_BASE = (window.BSLive && window.BSLive.API_BASE) || '';
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch(API_BASE + '/api/daily-report', { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('http ' + res.status);
      const r = await res.json();
      const ai = r.aiNarrative || {};
      const topPick = r.topPicks?.[0];
      const surebet = r.topSurebets?.[0];
      const sharp = r.steamMoves?.[0];

      // Si IA no respondió (aiNarrative null o aiHealth distinto de 'ok'),
      // mostramos un banner honesto al usuario explicando POR QUÉ, en lugar
      // de simplemente esconder el headline/summary.
      const aiBannerHtml = (!ai.headline || r.aiHealth !== 'ok')
        ? BSUI.aiHealthBanner({
            health: r.aiHealth || 'unknown',
            provider: r.aiProvider,
            reason: r.aiReason,
            onRetry: 'ovBriefRetry',
            context: 'Brief del día'
          })
        : '';

      host.innerHTML = `
        ${aiBannerHtml}
        <div class="ov-brief-card">
          <div class="ov-brief-head">
            <span class="ov-brief-eyebrow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              Brief del día${r.aiProvider ? ` · análisis IA` : ' · análisis cuantitativo'}
            </span>
            ${ai.headline ? `<strong class="ov-brief-headline">${BSUI.esc(ai.headline)}</strong>` : ''}
          </div>
          ${ai.summary ? `<p class="ov-brief-summary">${BSUI.esc(ai.summary)}</p>` : ''}
          ${ai.topTip ? `
            <div class="ov-brief-tip">
              <span class="ov-brief-tip-label">★ Pick del día</span>
              <span>${BSUI.esc(ai.topTip)}</span>
            </div>
          ` : ''}
          <div class="ov-brief-stats">
            <a href="#ai" class="ov-brief-stat" title="Partidos en vivo que el motor está analizando en este momento">
              <span class="ov-brief-stat-num">${r.counts?.totalEvents || 0}</span>
              <span class="ov-brief-stat-label">eventos analizables</span>
              <span class="muted tiny">en las 6 casas legales AR</span>
            </a>
            <a href="#arbitrage" class="ov-brief-stat ${(r.counts?.liveSurebets || 0) > 0 ? 'is-active' : ''}" title="Apuestas matemáticamente sin riesgo detectadas ahora">
              <span class="ov-brief-stat-num">${r.counts?.liveSurebets || 0}</span>
              <span class="ov-brief-stat-label">surebets ahora</span>
              ${surebet
                ? `<span class="tiny text-success">Mejor: +${surebet.roi.toFixed(2)}% ROI</span>`
                : `<span class="muted tiny">Escaneamos cada 5s</span>`}
            </a>
            <a href="#smartmoney" class="ov-brief-stat ${(r.counts?.sharpMoves || 0) > 0 ? 'is-active' : ''}" title="Partidos donde la cuota se movió más de 5% — eso indica que apostadores profesionales están tomando posición fuerte. Suele ser señal de que saben algo.">
              <span class="ov-brief-stat-num">${r.counts?.sharpMoves || 0}</span>
              <span class="ov-brief-stat-label">señales del mercado</span>
              ${sharp
                ? `<span class="tiny ${sharp.deltaPct > 0 ? 'text-success' : 'text-danger'}">${sharp.deltaPct > 0 ? '+' : ''}${sharp.deltaPct.toFixed(1)}% movimiento</span>`
                : `<span class="muted tiny">Mercado estable</span>`}
            </a>
            ${topPick ? (() => {
              const ev = Number(topPick.ev) || 0;
              const sign = ev >= 0 ? '+' : '';
              const cls = ev >= 0 ? 'text-success' : 'text-danger';
              return `
              <a href="#ai" class="ov-brief-stat ov-brief-stat--gold" title="La apuesta del día donde la cuota está más floja respecto a la probabilidad real. Más ventaja a tu favor.">
                <span class="ov-brief-stat-num">${topPick.odd.toFixed(2)}</span>
                <span class="ov-brief-stat-label">mejor apuesta hoy</span>
                <span class="tiny ${cls}">${sign}${ev.toFixed(1)}% a favor</span>
              </a>`;
            })() : `
              <span class="ov-brief-stat" title="El motor todavía no terminó de analizar los partidos del día">
                <span class="ov-brief-stat-num">…</span>
                <span class="ov-brief-stat-label">top pick</span>
                <span class="muted tiny">esperando análisis</span>
              </span>`}
          </div>
        </div>
      `;
      // Bind retry del banner IA (si está visible)
      host.querySelector('#ovBriefRetry')?.addEventListener('click', () => loadDailyBrief(panel));
    } catch (e) {
      // Mostrar fallback útil en lugar de ocultar silenciosamente
      host.innerHTML = `
        <div class="ov-brief-card">
          <div class="ov-brief-head">
            <span class="ov-brief-eyebrow">📊 Brief del día</span>
          </div>
          <p class="muted tiny">${e?.name === 'AbortError' ? 'El motor está procesando el reporte diario — análisis profundo de los partidos del día. Volvé en unos segundos.' : 'No pudimos generar el brief en este momento. Probablemente el backend no responde.'}</p>
          <button class="btn btn-outline btn-sm" id="ovBriefRetryErr" type="button">Reintentar</button>
        </div>`;
      host.querySelector('#ovBriefRetryErr')?.addEventListener('click', () => loadDailyBrief(panel));
    }
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('overview', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('overview', render));
  }
  doRegister();
  window.__bsOverviewRender = render;
})();
