/* BetSafe — AI Picks tab (hyper-detailed)
 * ============================================================================
 * Pide picks completos al backend (cuotas reales + clima + lesiones + sharp
 * money + histórico + modelos cuantitativos + LLM analysis).
 *
 * Cada pick muestra:
 *   - Selección + cuota + casa que MEJOR paga
 *   - 4 probabilidades: fair (Shin), Poisson xG, Elo ajustado, LLM
 *   - Consenso + EV vs cierre del mercado
 *   - Stake Kelly recomendado
 *   - Confidence score (0-1) en base a divergencia entre modelos
 *   - Factores que pesan: clima, lesiones, sharp money, histórico
 *   - Warnings (lesiones críticas, clima adverso)
 *   - Justificación LLM en lenguaje natural
 *
 * Filtros REALES que se aplican en el backend:
 *   - Sharp ≥ N: solo partidos con movimiento de dinero pro
 *   - Skip injured: descarta partidos con bajas severas
 *   - Skip bad weather: descarta partidos con clima muy adverso
 *   - Deporte + ligas
 * ============================================================================
 */
(function () {
  'use strict';

  // Estado local
  let state = {
    picks: [],
    loading: false,
    filters: {
      sport: 'all',
      league: null,
      minSharp: 0,
      skipInjured: false,
      skipBadWeather: false
    },
    error: null,
    meta: null
  };

  async function render(panel) {
    const isVip = BSAuth.isVip();
    const limit = isVip ? 20 : 6;

    panel.innerHTML = baseLayout(isVip, limit);
    bindFilters(panel);

    // Cargar primera tanda
    await reload(panel, limit);

    // Re-render cuando se actualiza el snapshot del backend
    const onLive = () => { if (state.picks.length === 0) reload(panel, limit); };
    window.addEventListener('bs:live-snapshot', onLive);
    panel.__cleanup = () => window.removeEventListener('bs:live-snapshot', onLive);
  }

  function baseLayout(isVip, limit) {
    // Mostramos los 8 deportes principales incluyendo eSports (que es una
    // categoría independiente: NO mezclar con fútbol).
    const SPORTS = (BSData.SPORTS || []).slice(0, 8);
    return `
      <div class="row between mb-4">
        <div>
          <h2 class="h3">AI Picks · análisis ultra profundo<a class="help-q" tabindex="0" data-tip="Cada pick combina cuotas reales de casas legales + clima del estadio + lesiones reportadas + movimientos del mercado + histórico cara a cara + análisis IA. Score de confianza basado en consistencia entre múltiples señales."></a></h2>
          <p class="muted">${isVip ? `VIP — análisis ilimitado · backend a tiempo real` : `Standard — top ${limit} partidos por EV`}</p>
        </div>
        <div class="cluster">
          <button class="btn btn-primary mag" id="aiAnalyze">${BSIcons.svg('bolt', { size: 16 })} Reanalizar</button>
        </div>
      </div>

      <!-- Filtros REALES (se aplican en backend) -->
      <div class="card stack mb-3">
        <div class="row between">
          <strong>Filtros profesionales<a class="help-q" tabindex="0" data-tip="Los filtros se aplican con datos en tiempo real: lesiones, clima del estadio y movimientos del mercado detectados constantemente."></a></strong>
          <span class="muted tiny" id="aiFilterCount">Cargando…</span>
        </div>

        <div>
          <span class="muted tiny" style="display:block;margin-bottom:6px">Deporte</span>
          <div class="cluster" id="aiSportChips">
            <button class="league-chip active" data-sport="all">Todos</button>
            ${SPORTS.map(s => `<button class="league-chip${s.accent ? ' is-' + s.accent : ''}" data-sport="${s.key}" title="${s.key === 'esports' ? 'Apuestas sobre videojuegos competitivos (CS:GO, LoL, Dota 2, Valorant)' : s.name}">${BSIcons.svg(s.icon || 'soccer', {size:14})}<span>${s.name}</span></button>`).join('')}
          </div>
        </div>

        <div class="row gap-2" style="flex-wrap:wrap;align-items:center">
          <label class="field" style="margin:0;flex:1;min-width:200px">
            <span class="field-label">Sharp money mínimo</span>
            <div class="cluster">
              <input type="range" class="slider" id="aiMinSharp" min="0" max="1" step="0.05" value="0" style="flex:1">
              <strong class="num" id="aiMinSharpVal" style="min-width:42px">0.00</strong>
            </div>
          </label>
          <label class="cluster" style="cursor:pointer;margin:0">
            <input type="checkbox" id="aiSkipInjured">
            <span class="tiny">Saltear partidos con bajas severas</span>
            <a class="help-q" tabindex="0" data-tip="Descarta partidos donde algún equipo tiene severityScore > 0.5 (típicamente 3+ bajas confirmadas incluyendo posiciones críticas como portero/defensa central)."></a>
          </label>
          <label class="cluster" style="cursor:pointer;margin:0">
            <input type="checkbox" id="aiSkipWeather">
            <span class="tiny">Saltear clima adverso</span>
            <a class="help-q" tabindex="0" data-tip="Descarta partidos con multiplicador de goles ESPERADO por clima &lt; 0.90 (típicamente lluvia intensa + viento fuerte combinado)."></a>
          </label>
          <button class="btn btn-outline btn-sm" id="aiApplyFilters">Aplicar filtros</button>
        </div>
      </div>

      <!-- Estado del backend -->
      <div class="card card-tinted card-pad-sm mb-3" id="aiBackendStatus">
        <div class="row between">
          <span class="tiny"><strong>Backend AI</strong> · ${BSData.liveFreshness()}</span>
          <span class="tiny muted" id="aiMeta">—</span>
        </div>
      </div>

      <div id="aiPicks" class="stack-md"></div>
    `;
  }

  function bindFilters(panel) {
    panel.querySelector('#aiAnalyze')?.addEventListener('click', async () => {
      panel.querySelector('#aiAnalyze').classList.add('shimmer');
      // Forzar re-fetch del snapshot
      await BSLive?.fetchSnapshot?.();
      await reload(panel);
      panel.querySelector('#aiAnalyze').classList.remove('shimmer');
    });
    panel.querySelectorAll('#aiSportChips button').forEach(b => {
      b.addEventListener('click', () => {
        panel.querySelectorAll('#aiSportChips button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.filters.sport = b.dataset.sport;
        // Auto-reload: antes el chip solo cambiaba state pero NO refrescaba los
        // picks. Usuario clickeaba "Fútbol" y seguía viendo esports/otros.
        reload(panel);
      });
    });
    const slider = panel.querySelector('#aiMinSharp');
    const sliderVal = panel.querySelector('#aiMinSharpVal');
    slider?.addEventListener('input', e => {
      state.filters.minSharp = Number(e.target.value);
      sliderVal.textContent = state.filters.minSharp.toFixed(2);
    });
    panel.querySelector('#aiSkipInjured')?.addEventListener('change', e => { state.filters.skipInjured = e.target.checked; });
    panel.querySelector('#aiSkipWeather')?.addEventListener('change', e => { state.filters.skipBadWeather = e.target.checked; });
    panel.querySelector('#aiApplyFilters')?.addEventListener('click', () => reload(panel));
  }

  async function reload(panel, limit) {
    // VIP: hasta 20 picks. Standard: solo 3 (teaser para VIP).
    const isVip = BSAuth.isVip();
    // Standard: 3 picks. VIP: 12 (cap server-side por timeout).
    limit = limit || (isVip ? 12 : 3);
    if (state.loading) return;
    state.loading = true;
    const host = panel.querySelector('#aiPicks');
    if (host) host.innerHTML = renderLoadingState(limit);
    // Iniciar contador visual de tiempo transcurrido + activar pasos secuenciales
    const startedAt = Date.now();
    let stepIdx = 0;
    const timer = setInterval(() => {
      const el = host?.querySelector('.ai-loading__seconds');
      if (el) {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        el.textContent = `${s}s`;
      }
      // Avanzar a la siguiente step cada ~8s (proporcional al tiempo esperado)
      const steps = host?.querySelectorAll('.ai-loading__steps li');
      if (steps && steps.length) {
        const elapsedS = (Date.now() - startedAt) / 1000;
        const targetIdx = Math.min(steps.length - 1, Math.floor(elapsedS / 8));
        while (stepIdx < targetIdx) {
          steps[stepIdx].classList.remove('is-active');
          steps[stepIdx].classList.add('is-done');
          stepIdx++;
          steps[stepIdx]?.classList.add('is-active');
        }
      }
    }, 1000);
    try {
      const res = await BSLive.getPicks({ ...state.filters, limit });
      state.picks = res.picks || [];
      state.meta = res.meta;
      state.error = null;
    } catch (e) {
      // Mensaje amigable según el tipo de error
      const msg = e?.message || String(e);
      if (msg.includes('aborted') || msg.includes('abort')) {
        state.error = 'El análisis tardó más de lo esperado. Intentá de nuevo en unos segundos.';
      } else if (msg.includes('HTTP 429')) {
        state.error = 'Demasiadas solicitudes. Esperá un momento e intentá de nuevo.';
      } else if (msg.includes('HTTP 5') || msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
        state.error = 'No pudimos conectar con el servidor. Verificá tu conexión.';
      } else {
        state.error = msg;
      }
      state.picks = [];
    } finally {
      clearInterval(timer);
      state.loading = false;
      renderPicks(panel);
    }
  }

  /* Loading state RICO: explica que la IA está analizando cada partido en
   * profundidad, con animación radar + contador de segundos transcurridos +
   * lista de pasos visuales. Justifica la espera (~30-60s la primera vez).
   * Después del primer load, el cache de 5min lo hace instant. */
  function renderLoadingState(n) {
    return `
      <div class="ai-loading-state">
        <div class="ai-loading__visual">
          <span class="bsai-radar" style="width:80px;height:80px">
            <span class="bsai-radar__sweep"></span>
            <span class="bsai-radar__dot" style="--x:30%;--y:40%"></span>
            <span class="bsai-radar__dot" style="--x:65%;--y:55%"></span>
            <span class="bsai-radar__dot" style="--x:45%;--y:70%"></span>
          </span>
          <div class="ai-loading__text">
            <strong>Analizando ${n} partidos con IA…</strong>
            <span class="muted tiny">Esto puede tardar 30-60 segundos la primera vez. Después es instantáneo.</span>
          </div>
          <span class="ai-loading__seconds num">0s</span>
        </div>
        <ul class="bsai-loading__steps ai-loading__steps">
          <li class="is-active"><span class="bsai-tick"></span>Cargando partidos del día filtrados por tus criterios</li>
          <li><span class="bsai-tick"></span>Reuniendo clima, lesiones, histórico y movimientos del mercado</li>
          <li><span class="bsai-tick"></span>Corriendo modelos cuantitativos (goles esperados, forma, rendimiento)</li>
          <li><span class="bsai-tick"></span>Análisis IA profundo de cada partido</li>
          <li><span class="bsai-tick"></span>Generando picks coherentes: conservador / equilibrado / agresivo</li>
        </ul>
        <div class="ai-loading__skeleton">
          ${Array.from({ length: Math.min(n, 3) }, () => `
            <div class="card card-pad-md skeleton-card" style="height:140px;background:linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:14px"></div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderPicks(panel) {
    const host = panel.querySelector('#aiPicks');
    if (!host) return;
    const meta = panel.querySelector('#aiMeta');
    if (meta && state.meta) meta.textContent = `${state.meta.filtered}/${state.meta.analyzed} pasaron filtros · ${state.picks.length} picks`;

    if (state.error) {
      host.innerHTML = `
        <div class="ai-empty-card">
          <div class="ai-empty-icon ai-empty-icon--err">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <strong>No pudimos cargar el análisis</strong>
          <p class="muted tiny">${BSUI.esc(state.error)}</p>
          <button class="btn btn-primary btn-sm" id="aiRetry">Reintentar</button>
        </div>`;
      panel.querySelector('#aiRetry')?.addEventListener('click', () => reload(panel));
      return;
    }
    if (!state.picks.length) {
      // Distinguir: "AI procesando aún" vs "Sin picks por filtros"
      const aiPending = state.meta?.aiPending || 0;
      if (aiPending > 0) {
        host.innerHTML = `
          <div class="ai-empty-card ai-empty-card--processing">
            <div class="ai-empty-icon">
              <span class="ai-empty-ring"></span>
              <span class="ai-empty-ring ai-empty-ring--2"></span>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            </div>
            <strong>La IA está analizando los partidos…</strong>
            <p class="muted tiny" style="max-width:480px;margin:0 auto">${aiPending} análisis en proceso. Esperá <strong>20-40 segundos</strong> y refrescá. Una vez analizados, los siguientes picks aparecen instantáneo (cache 5min).</p>
            <button class="btn btn-primary btn-sm mag" id="aiRetry">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
              Refrescar
            </button>
          </div>`;
      } else {
        host.innerHTML = `
          <div class="ai-empty-card">
            <div class="ai-empty-icon">
              <span class="ai-empty-ring"></span>
              <span class="ai-empty-ring ai-empty-ring--2"></span>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <strong>Sin picks por ahora</strong>
            <p class="muted tiny" style="max-width:380px;margin:0 auto">Estamos esperando partidos que cumplan tus filtros. Probá <em>bajar el sharp mínimo</em>, destildar <em>saltear lesiones</em>, o cambiar el deporte.</p>
          </div>`;
      }
      panel.querySelector('#aiRetry')?.addEventListener('click', () => reload(panel));
      return;
    }
    const isVip = BSAuth.isVip();
    let html = state.picks.map(p => pickAnalysisCard(p)).join('');
    // Teaser VIP al final si no-VIP (limit 3) para tentarlo
    if (!isVip) {
      html += `
        <div class="ai-vip-teaser" role="region" aria-label="Más picks para VIP">
          <div class="ai-vip-teaser__shine" aria-hidden="true"></div>
          <div class="ai-vip-teaser__content">
            <span class="badge-vip" style="align-self:flex-start">VIP exclusivo</span>
            <strong class="ai-vip-teaser__title">Te estás perdiendo <span class="num">17 picks</span> más</strong>
            <p class="muted tiny" style="max-width:480px">Los miembros VIP ven análisis completo de hasta 20 partidos por día — fútbol europeo top, Libertadores, tenis Grand Slam, NBA y más. Cada pick con factores reales, edge calculado y combinada agresiva.</p>
            <div class="ai-vip-teaser__features">
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Hasta 20 picks/día</span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Smart Money en vivo</span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Arbitraje 24/7</span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> BetSafe AI (NLP)</span>
            </div>
            <a href="pricing.html" class="btn btn-gold btn-lg mag" style="align-self:flex-start">Pasar a VIP →</a>
          </div>
        </div>`;
    }
    host.innerHTML = html;
    // Bind clicks de "Ver factores" / "Agregar a slip"
    host.querySelectorAll('[data-add-slip]').forEach(b => b.addEventListener('click', () => {
      const data = JSON.parse(b.dataset.addSlip);
      BSDash.addToSlip(data);
    }));
    host.querySelectorAll('[data-open-factors]').forEach(b => b.addEventListener('click', () => openFactorsModal(b.dataset.openFactors)));
    // Share pick: usa Web Share API o clipboard fallback
    host.querySelectorAll('[data-share-pick]').forEach(b => b.addEventListener('click', () => {
      const eventId = b.dataset.sharePick;
      const pick = state.picks.find(p => p.event?.id === eventId);
      if (!pick) return;
      const ev = pick.event;
      const eqSel = pick.selections?.find(s => s.type === 'eq') || pick.selections?.[0];
      const txt = `📊 Análisis IA · BetSafe

${ev.home.name} vs ${ev.away.name}
${ev.leagueName || ''} · ${BSUI.dt(ev.start)}

Pick principal: ${eqSel?.label || eqSel?.outcome || '?'} @ ${eqSel?.odd?.toFixed?.(2) || '?'}
EV: ${eqSel?.consensusEv != null ? `${eqSel.consensusEv > 0 ? '+' : ''}${eqSel.consensusEv.toFixed(1)}%` : '?'}
Confianza: ${eqSel?.confidence ? (eqSel.confidence * 100).toFixed(0) + '%' : '?'}

${pick.llmKeyFactor ? '⚡ ' + pick.llmKeyFactor : ''}

— Análisis generado en betsafe.bet`;
      const shareData = { title: `${ev.home.name} vs ${ev.away.name}`, text: txt, url: location.href };
      (async () => {
        try {
          if (navigator.share && navigator.canShare?.(shareData)) {
            await navigator.share(shareData);
          } else {
            await navigator.clipboard.writeText(txt);
            BSUI.toast?.({ title: 'Pick copiado', message: 'Pegalo en redes o WhatsApp.', type: 'success' });
          }
        } catch (e) {
          if (e.name !== 'AbortError') BSUI.toast?.({ title: 'No se pudo compartir', type: 'error' });
        }
      })();
    }));
  }

  function renderSkeleton(n) {
    return Array.from({ length: n }, () => `
      <div class="card card-pad-md skeleton-card" style="height:200px;background:linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite"></div>
    `).join('');
  }

  function pickAnalysisCard(analysis) {
    const ev = analysis.event;
    const f = analysis.factors || {};
    // Ordenar: cons → eq → agg (no por EV) para que el card siempre muestre
    // la triada coherente: Conservador / Equilibrado / Agresivo.
    const typeOrder = { cons: 0, eq: 1, agg: 2 };
    const sel = (analysis.selections || [])
      .slice()
      .sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9))
      .slice(0, 3);
    const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(ev.home.id, { size: 28, name: ev.home.name, sport: ev.sport }) : BSIcons.teamLogo(ev.home, { size: 28, sport: ev.sport });
    const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(ev.away.id, { size: 28, name: ev.away.name, sport: ev.sport }) : BSIcons.teamLogo(ev.away, { size: 28, sport: ev.sport });
    const leagueLogo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(ev.league || ev.leagueName, { size: 14 }) : '';

    return `
      <article class="card card-pad-md ai-pick-card" data-event="${ev.id}">
        <header class="row between" style="margin-bottom:14px">
          <div class="cluster">
            ${homeLogo}<strong>${BSUI.esc(ev.home.name)}</strong>
            <span class="dim">vs</span>
            <strong>${BSUI.esc(ev.away.name)}</strong>${awayLogo}
          </div>
          <div class="cluster" style="gap:6px;flex-wrap:wrap">
            <span class="badge badge-brand tiny">${leagueLogo} ${BSUI.esc(ev.leagueName || ev.league || '')}</span>
            <span class="muted tiny">${BSUI.dt(ev.start)}</span>
            ${analysis.llmProvider !== 'offline' ? `<span class="badge badge-success tiny" title="Análisis con IA">Análisis IA</span>` : '<span class="badge tiny">Análisis</span>'}
          </div>
        </header>

        ${renderFactorsStrip(f)}

        ${analysis.llmKeyFactor ? `<div class="card card-pad-sm" style="background:rgba(212,160,23,0.08);border-left:3px solid var(--gold-700,#c49a1a);margin:10px 0">
          <strong class="tiny" style="color:var(--gold-700,#c49a1a)">⚡ Factor clave (IA)</strong>
          <p class="tiny" style="margin-top:4px;line-height:1.45">${BSUI.esc(analysis.llmKeyFactor)}</p>
        </div>` : ''}

        ${analysis.llmModelConsensus ? `<div class="row between tiny muted" style="margin:6px 0;padding:5px 8px;background:var(--surface-2);border-radius:6px">
          <strong>Consenso modelos:</strong><span>${BSUI.esc(analysis.llmModelConsensus)}</span>
        </div>` : ''}

        <div class="ai-picks-grid">
          ${sel.map(s => renderSelection(s, ev)).join('')}
        </div>

        ${analysis.llmMarketEdge ? `<div class="card card-pad-sm" style="margin-top:10px;background:rgba(30,75,200,0.05);border-left:3px solid var(--brand-500)">
          <strong class="tiny">🎯 Edge vs mercado</strong>
          <p class="tiny" style="margin-top:4px;line-height:1.45">${BSUI.esc(analysis.llmMarketEdge)}</p>
        </div>` : ''}

        ${analysis.llmSynthesis ? `<details style="margin-top:10px">
          <summary style="cursor:pointer;padding:6px 0"><strong class="tiny">📋 Lectura institucional completa</strong></summary>
          <div class="card card-tinted card-pad-sm" style="margin-top:6px;border-left:3px solid var(--brand-500)">
            <p class="muted tiny" style="line-height:1.55">${BSUI.esc(analysis.llmSynthesis)}</p>
          </div>
        </details>` : ''}

        <div class="row between" style="margin-top:10px;flex-wrap:wrap;gap:8px">
          <div class="cluster" style="gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-open-factors="${ev.id}" title="Ver todos los factores: clima, lesiones, histórico, modelos">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              Ver factores
            </button>
            <button class="btn btn-ghost btn-sm" data-share-pick="${ev.id}" title="Compartir este pick">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Compartir
            </button>
          </div>
          <span class="muted tiny">${f.weather && !f.weather.unavailable ? `Clima: ${f.weather.tempC?.toFixed?.(0) || '?'}°C · ${f.weather.conditionDesc || f.weather.condition || ''}` : ''}</span>
        </div>
      </article>
    `;
  }

  function renderSelection(s, ev) {
    const conf = (s.confidence || 0);
    const confClass = conf > 0.7 ? 'success' : conf > 0.4 ? 'warning' : 'danger';
    const ev_pct = s.consensusEv != null ? s.consensusEv : (s.evPct != null ? s.evPct : null);
    const evClass = ev_pct == null ? '' : ev_pct > 3 ? 'text-success' : ev_pct < -3 ? 'text-danger' : 'muted';
    const typeLabel = s.type === 'cons' ? 'Conservador' : s.type === 'agg' ? 'Agresivo' : 'Equilibrado';
    const typeClass = s.type === 'cons' ? 'low' : s.type === 'agg' ? 'high' : 'mid';
    const bookName = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
    const bookLogo = s.book && window.BSLogos ? BSLogos.bookLogo(s.book, { size: 18 }) : '';

    const probs = [];
    if (s.fairProb != null)    probs.push({ label: 'Mercado', v: s.fairProb });
    if (s.poissonProb != null) probs.push({ label: 'Modelo', v: s.poissonProb });
    if (s.eloProb != null)     probs.push({ label: 'Forma', v: s.eloProb });
    if (s.llmProb != null)     probs.push({ label: 'IA', v: s.llmProb });
    if (s.consensusProb != null) probs.push({ label: 'Consenso', v: s.consensusProb, highlight: true });

    const addPayload = JSON.stringify({
      matchId: ev.id, eventId: ev.id, label: s.label || s.outcome,
      odd: s.odd, book: s.book, home: ev.home.name, away: ev.away.name,
      market: s.market, outcome: s.outcome, line: s.line
    });

    // Si es combo multi-leg (agresivo), renderizar legs por separado.
    const isCombo = s.market === 'combo' && Array.isArray(s.legs) && s.legs.length > 1;
    const legsHtml = isCombo ? `
      <div class="ai-combo-legs" style="background:rgba(212,160,23,0.06);border-left:2px solid var(--gold-700,#c49a1a);padding:8px 10px;border-radius:6px;margin:6px 0">
        <strong class="tiny" style="color:var(--gold-700,#c49a1a);display:block;margin-bottom:4px">⚡ Combinada ${s.legs.length} legs</strong>
        ${s.legs.map((l, i) => `
          <div class="row between tiny" style="padding:3px 0${i < s.legs.length - 1 ? ';border-bottom:1px dashed rgba(0,0,0,0.06)' : ''}">
            <span><strong>${i + 1}.</strong> ${BSUI.esc(l.label)}</span>
            <strong class="num">${l.odd?.toFixed?.(2) || '—'}</strong>
          </div>
        `).join('')}
      </div>` : '';

    return `
      <div class="ai-pick" data-type="${s.type}"${isCombo ? ' data-combo="1"' : ''}>
        <div class="row between">
          <span class="risk-pill ${typeClass}">${typeLabel}${isCombo ? ` · ${s.legs.length} legs` : ''}</span>
          <span class="badge badge-${confClass} tiny" title="Score de confianza del análisis">Conf ${(conf*100).toFixed(0)}%</span>
        </div>
        ${isCombo ? legsHtml : `<strong style="display:block;margin:8px 0">${BSUI.esc(s.label || s.outcome)}</strong>`}
        <div class="cluster" style="justify-content:space-between;align-items:baseline">
          <strong class="num text-brand" style="font-size:1.4rem">${s.odd?.toFixed?.(2) || '—'}</strong>
          <span class="cluster tiny">${bookLogo}<span class="muted">${BSUI.esc(bookName(s.book))}</span></span>
        </div>
        ${probs.length ? `<div class="ai-probs">${probs.map(p => `<span class="ai-prob${p.highlight?' is-consensus':''}"><span class="muted tiny">${p.label}</span><strong>${(p.v*100).toFixed(0)}%</strong></span>`).join('')}</div>` : ''}
        <div class="ai-metrics-grid">
          ${ev_pct != null ? `<div class="ai-metric"><span class="muted tiny">EV</span><strong class="${evClass}">${ev_pct > 0 ? '+' : ''}${ev_pct.toFixed(2)}%</strong></div>` : ''}
          ${s.valueGap != null ? `<div class="ai-metric" title="Diferencia entre la probabilidad real y la implícita por la cuota"><span class="muted tiny">Valor</span><strong class="${s.valueGap > 0 ? 'text-success' : 'muted'}">${s.valueGap > 0 ? '+' : ''}${s.valueGap.toFixed(1)}%</strong></div>` : ''}
          ${s.modelConvergence ? `<div class="ai-metric" title="Qué tan de acuerdo están los 4 modelos entre sí"><span class="muted tiny">Convergencia</span><strong class="${s.modelConvergence === 'alta' ? 'text-success' : s.modelConvergence === 'baja' ? 'text-warning' : ''}">${s.modelConvergence}</strong></div>` : ''}
          ${s.kellyFractional ? `<div class="ai-metric" title="Stake recomendado según Kelly fraccional 1/4 (conservador)"><span class="muted tiny">Stake</span><strong>${(s.kellyFractional*100).toFixed(1)}% banca</strong></div>` : ''}
        </div>
        ${s.rationale ? `<p class="muted tiny" style="margin-top:6px;line-height:1.4">${BSUI.esc(s.rationale).slice(0, 180)}${s.rationale.length > 180 ? '…' : ''}</p>` : ''}
        ${(s.warnings || []).length ? `<div class="cluster tiny" style="margin-top:6px;flex-wrap:wrap">${s.warnings.map(w => `<span class="badge badge-warning tiny">⚠ ${BSUI.esc(w)}</span>`).join('')}</div>` : ''}
        <button class="btn btn-primary btn-sm w-full" style="margin-top:8px" data-add-slip='${addPayload}'>Agregar al slip</button>
      </div>
    `;
  }

  function renderFactorsStrip(f) {
    const items = [];

    // Clima
    if (f.weather && !f.weather.unavailable) {
      const w = f.weather;
      const icon = w.rainMm > 1 ? '🌧' : w.windKmh > 25 ? '💨' : w.tempC < 5 ? '❄' : '☀';
      const note = w.impact?.notes?.[0] || `${w.tempC?.toFixed?.(0)}°C · viento ${w.windKmh || 0} km/h`;
      items.push(`<span class="ai-factor"><span class="ai-factor-ic">${icon}</span><strong class="tiny">Clima</strong><span class="muted tiny">${BSUI.esc(note)}</span></span>`);
    } else {
      items.push(`<span class="ai-factor ai-factor-na"><span class="ai-factor-ic">☁</span><strong class="tiny">Clima</strong><span class="muted tiny">N/D</span></span>`);
    }

    // Lesiones
    if (f.injuries && !f.injuries.unavailable) {
      const sev = f.injuries.severityScore;
      const outsH = (f.injuries.home?.injuries || []).filter(i => i.status === 'out').length;
      const outsA = (f.injuries.away?.injuries || []).filter(i => i.status === 'out').length;
      const severe = sev && (sev.home > 0.4 || sev.away > 0.4);
      items.push(`<span class="ai-factor ${severe?'ai-factor-warn':''}"><span class="ai-factor-ic">🏥</span><strong class="tiny">Lesiones</strong><span class="muted tiny">${outsH}+${outsA} bajas</span></span>`);
    } else {
      items.push(`<span class="ai-factor ai-factor-na"><span class="ai-factor-ic">🏥</span><strong class="tiny">Lesiones</strong><span class="muted tiny">N/D</span></span>`);
    }

    // Sharp money
    const sharp = f.sharp?.score || 0;
    if (sharp > 0) {
      const cls = sharp > 0.5 ? 'ai-factor-hot' : '';
      items.push(`<span class="ai-factor ${cls}"><span class="ai-factor-ic">💰</span><strong class="tiny">Sharp money</strong><span class="muted tiny">${(sharp*100).toFixed(0)}%</span></span>`);
    } else {
      items.push(`<span class="ai-factor ai-factor-na"><span class="ai-factor-ic">💰</span><strong class="tiny">Sharp money</strong><span class="muted tiny">sin señal</span></span>`);
    }

    // Histórico H2H
    if (f.historical && !f.historical.unavailable && f.historical.h2h?.matches > 0) {
      const h = f.historical.h2h;
      items.push(`<span class="ai-factor"><span class="ai-factor-ic">📊</span><strong class="tiny">H2H</strong><span class="muted tiny">${h.matches} partidos · local ${(h.homeWinRate*100).toFixed(0)}%</span></span>`);
    }

    // Modelo de goles esperados (xG)
    if (f.poisson && !f.poisson.unavailable) {
      items.push(`<span class="ai-factor"><span class="ai-factor-ic">🎯</span><strong class="tiny">Goles esperados</strong><span class="muted tiny">Local ${f.poisson.lambdaH} · Visitante ${f.poisson.lambdaA}</span></span>`);
    }

    // Margen libro
    if (f.quantitative?.margin != null) {
      items.push(`<span class="ai-factor"><span class="ai-factor-ic">📈</span><strong class="tiny">Margen</strong><span class="muted tiny">${f.quantitative.margin.toFixed(2)}%</span></span>`);
    }

    return `<div class="ai-factors-strip">${items.join('')}</div>`;
  }

  async function openFactorsModal(matchId) {
    const ev = BSData.liveEvents({}).find(e => e.id === matchId);
    if (!ev) return;
    const { modal, close } = BSUI.openModal(`<div class="stack"><h3 class="h3">${BSUI.esc(ev.home.name)} vs ${BSUI.esc(ev.away.name)}</h3><div class="muted tiny">${BSUI.esc(ev.leagueName || '')} · ${BSUI.dt(ev.start)}</div><div id="modalFactors"><div class="empty" style="padding:20px">Cargando factores en vivo del backend…</div></div></div>`, { large: true });
    try {
      const f = await BSLive.getFactors(matchId);
      const host = modal.querySelector('#modalFactors');
      host.innerHTML = renderFullFactors(f, ev);
    } catch (e) {
      modal.querySelector('#modalFactors').innerHTML = `<div class="empty">Error: ${BSUI.esc(e?.message)}</div>`;
    }
  }

  function renderFullFactors(f, ev) {
    const sections = [];

    // Clima
    if (f.weather && !f.weather.unavailable) {
      const w = f.weather;
      sections.push(`<div class="card stack">
        <strong>🌦 Clima en el venue</strong>
        <div class="grid grid-3 gap-2">
          <div><span class="muted tiny">Temperatura</span><div class="num">${w.tempC?.toFixed?.(1) || '?'}°C</div></div>
          <div><span class="muted tiny">Viento</span><div class="num">${w.windKmh || 0} km/h</div></div>
          <div><span class="muted tiny">Humedad</span><div class="num">${w.humidity || 0}%</div></div>
          <div><span class="muted tiny">Lluvia 3h</span><div class="num">${w.rainMm?.toFixed?.(1) || 0}mm</div></div>
          <div><span class="muted tiny">Condición</span><div>${BSUI.esc(w.conditionDesc || w.condition || '—')}</div></div>
          <div><span class="muted tiny">Nubes</span><div class="num">${w.cloudPct || 0}%</div></div>
        </div>
        ${(w.impact?.notes || []).length ? `<div class="card card-tinted card-pad-sm" style="background:var(--warning-bg);color:#92400e"><strong class="tiny">Impacto inferido</strong>${w.impact.notes.map(n => `<div class="tiny">• ${BSUI.esc(n)}</div>`).join('')}</div>` : ''}
      </div>`);
    }

    // Lesiones
    if (f.injuries && !f.injuries.unavailable) {
      const { home, away } = f.injuries;
      sections.push(`<div class="card stack">
        <strong>🏥 Lesiones reportadas</strong>
        <div class="grid grid-2 gap-2">
          <div><strong class="tiny">${BSUI.esc(home?.team || ev.home.name)}</strong>
            ${(home?.injuries || []).length === 0 ? '<div class="muted tiny">Plantel completo</div>' : (home.injuries || []).slice(0, 10).map(i => `<div class="row between tiny" style="padding:4px 0;border-bottom:1px solid var(--border)"><span>${BSUI.esc(i.name)}${i.position ? ` <span class="muted">(${BSUI.esc(i.position)})</span>` : ''}</span><span class="badge badge-${i.status==='out'?'danger':'warning'} tiny">${i.status}</span></div>`).join('')}
            <div class="muted tiny" style="margin-top:6px">Fuente: ${BSUI.esc(home?.source || 'N/D')}</div>
          </div>
          <div><strong class="tiny">${BSUI.esc(away?.team || ev.away.name)}</strong>
            ${(away?.injuries || []).length === 0 ? '<div class="muted tiny">Plantel completo</div>' : (away.injuries || []).slice(0, 10).map(i => `<div class="row between tiny" style="padding:4px 0;border-bottom:1px solid var(--border)"><span>${BSUI.esc(i.name)}${i.position ? ` <span class="muted">(${BSUI.esc(i.position)})</span>` : ''}</span><span class="badge badge-${i.status==='out'?'danger':'warning'} tiny">${i.status}</span></div>`).join('')}
            <div class="muted tiny" style="margin-top:6px">Fuente: ${BSUI.esc(away?.source || 'N/D')}</div>
          </div>
        </div>
        ${f.injuries.severityScore ? `<div class="muted tiny">Severity score: local ${f.injuries.severityScore.home.toFixed(2)} · visitante ${f.injuries.severityScore.away.toFixed(2)}</div>` : ''}
      </div>`);
    }

    // Histórico
    if (f.historical && !f.historical.unavailable) {
      const h = f.historical.h2h;
      const fh = f.historical.form?.home, fa = f.historical.form?.away;
      sections.push(`<div class="card stack">
        <strong>📊 Histórico y forma reciente</strong>
        ${h?.matches > 0 ? `<div class="grid grid-3 gap-2">
          <div><span class="muted tiny">H2H (${h.matches})</span><div>${(h.homeWinRate*100).toFixed(0)}% / ${(h.drawRate*100).toFixed(0)}% / ${(h.awayWinRate*100).toFixed(0)}%</div></div>
          <div><span class="muted tiny">Goles avg H2H</span><div class="num">${h.avgGoals?.toFixed(2)}</div></div>
          <div><span class="muted tiny">BTTS H2H</span><div class="num">${(h.bttsRate*100).toFixed(0)}%</div></div>
        </div>` : ''}
        <div class="grid grid-2 gap-2">
          ${fh ? `<div><strong class="tiny">${BSUI.esc(ev.home.name)} forma</strong><div class="tiny">${fh.wdl} · ${fh.pointsPerGame} ppg · ${fh.goalsFor}/${fh.goalsAgainst}</div></div>` : ''}
          ${fa ? `<div><strong class="tiny">${BSUI.esc(ev.away.name)} forma</strong><div class="tiny">${fa.wdl} · ${fa.pointsPerGame} ppg · ${fa.goalsFor}/${fa.goalsAgainst}</div></div>` : ''}
        </div>
      </div>`);
    }

    // Sharp money
    if (f.sharp) {
      sections.push(`<div class="card stack">
        <strong>💰 Sharp money</strong>
        <div class="row between"><span class="muted tiny">Score</span><strong class="num">${(f.sharp.score*100).toFixed(0)}%</strong></div>
        <div class="row between"><span class="muted tiny">Steam moves detectados</span><strong>${f.sharp.steamMoves?.length || 0}</strong></div>
        <div class="row between"><span class="muted tiny">Surebet activa</span><strong>${f.sharp.hasArbActive ? 'SÍ' : 'no'}</strong></div>
        ${(f.sharp.steamMoves || []).slice(0, 5).map(s => `<div class="tiny muted">• ${BSUI.esc(s.side)} ${s.from?.toFixed(2)} → ${s.to?.toFixed(2)} (${s.deltaPct > 0 ? '+' : ''}${s.deltaPct}%)</div>`).join('')}
      </div>`);
    }

    // Cuantitativo
    if (f.quantitative && !f.quantitative.unavailable) {
      const q = f.quantitative;
      sections.push(`<div class="card stack">
        <strong>🧮 Análisis del mercado</strong>
        <div class="grid grid-3 gap-2">
          <div><span class="muted tiny">Margen libro</span><div class="num">${q.margin?.toFixed(2)}%</div></div>
          <div><span class="muted tiny">Cuotas fair</span><div class="tiny">${(q.fairOdds || []).map(o => o?.toFixed(2) || '—').join(' / ')}</div></div>
          <div><span class="muted tiny">EV vs mercado</span><div class="tiny">${(q.ev || []).map(v => (v > 0 ? '+' : '') + v.toFixed(2) + '%').join(' / ')}</div></div>
        </div>
      </div>`);
    }

    return sections.join('') || '<div class="empty">Sin factores disponibles para este partido.</div>';
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('ai', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('ai', render));
  }
  doRegister();
  window.__bsAiRender = render;
})();
