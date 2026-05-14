/* BetSafe — AI Picks tab (curated combos)
 * ============================================================================
 * Re-diseño completo: en lugar de mostrar un pick por partido, la IA analiza
 * TODOS los partidos del día y devuelve las MEJORES COMBINADAS POSIBLES (2-5
 * legs cada una, la IA decide cuántas). Foco en CALIDAD, no cantidad.
 *
 * Cada combinada incluye:
 *   - 2 a 5 legs cuidadosamente seleccionadas
 *   - Narrativa de por qué esos partidos juntos tienen sentido
 *   - Edge sobre el mercado (en lenguaje claro)
 *   - Factor clave a vigilar antes del kickoff
 *   - Cuota total + ganancia esperada
 *   - Nivel de riesgo: seguro / equilibrado / agresivo
 *
 * Filtro principal:
 *   - Deporte (estricto: si elegís fútbol, NO mostramos esports)
 * ============================================================================
 */
(function () {
  'use strict';

  // Estado local
  let state = {
    combos: [],
    loading: false,
    filters: {
      sport: 'all'
    },
    error: null,
    meta: null
  };

  async function render(panel) {
    const isVip = BSAuth.isVip();
    const count = isVip ? 6 : 3;

    panel.innerHTML = baseLayout(isVip, count);
    bindFilters(panel);

    // Cargar primera tanda
    await reload(panel, count);

    // Re-render cuando se actualiza el snapshot del backend
    const onLive = () => { if (state.combos.length === 0) reload(panel, count); };
    window.addEventListener('bs:live-snapshot', onLive);
    panel.__cleanup = () => window.removeEventListener('bs:live-snapshot', onLive);
  }

  function baseLayout(isVip, count) {
    // Mostramos los 8 deportes principales incluyendo eSports (que es una
    // categoría independiente: NO mezclar con fútbol).
    const SPORTS = (BSData.SPORTS || []).slice(0, 8);
    return `
      <header class="bs-ai-tab-header bs-ai-tab-header--picks" role="banner">
        <div class="bs-ai-tab-header__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </div>
        <div class="bs-ai-tab-header__text">
          <span class="bs-ai-tab-header__eyebrow">Motor IA · curado automático</span>
          <h2 class="bs-ai-tab-header__title">AI Picks</h2>
          <p class="bs-ai-tab-header__desc">La IA analiza todos los partidos del día y te entrega las mejores combinadas ya armadas. No configurás nada — lo elige el motor.</p>
        </div>
        <div class="bs-ai-tab-header__alts">
          <a href="#aigenerator" class="bs-ai-tab-header__alt" title="¿Querés controlar los filtros vos? Probá Constructor Quant">⚙ Constructor Quant</a>
          <a href="#betsafeai" class="bs-ai-tab-header__alt" title="¿Preferís pedirlo en lenguaje natural? Probá Coach IA">💬 Coach IA</a>
        </div>
      </header>
      <div class="row between mb-4">
        <div>
          <h2 class="h3">Picks del día — combinadas hechas por la IA<a class="help-q" tabindex="0" data-tip="La IA mira TODOS los partidos del día y te muestra solo las mejores combinadas. Cada una junta entre 2 y 5 apuestas (la IA decide cuántas según qué tan fuertes son las señales). Mezcla: 1 conservadora, 1-2 equilibradas, opcionalmente 1 agresiva para pagar más."></a></h2>
          <p class="muted">${isVip ? `VIP — hasta ${count} combinadas curadas por día` : `Standard — top ${count} combinadas curadas (VIP desbloquea más)`}</p>
        </div>
        <div class="cluster">
          <button class="btn btn-primary mag" id="aiAnalyze">${BSIcons.svg('bolt', { size: 16 })} Reanalizar</button>
        </div>
      </div>

      <!-- Filtro DEPORTIVO ESTRICTO -->
      <div class="card stack mb-3">
        <div class="row between">
          <strong>Filtrar por deporte<a class="help-q" tabindex="0" data-tip="Si elegís un deporte específico, la IA solo analiza partidos de ese deporte. NUNCA se mezclan esports con fútbol salvo que pidas esports explícitamente."></a></strong>
          <span class="muted tiny" id="aiFilterCount">Cargando…</span>
        </div>

        <div>
          <div class="cluster" id="aiSportChips">
            <button class="league-chip active" data-sport="all">Todos los deportes</button>
            ${SPORTS.map(s => `<button class="league-chip${s.accent ? ' is-' + s.accent : ''}" data-sport="${s.key}" title="${s.key === 'esports' ? 'Apuestas sobre videojuegos competitivos (CS:GO, LoL, Dota 2, Valorant)' : s.name}">${BSIcons.svg(s.icon || 'soccer', {size:14})}<span>${s.name}</span></button>`).join('')}
          </div>
        </div>
      </div>

      <!-- Estado del backend -->
      <div class="card card-tinted card-pad-sm mb-3" id="aiBackendStatus">
        <div class="row between">
          <span class="tiny"><strong>Motor IA · análisis curado</strong></span>
          <span class="tiny muted" id="aiMeta">—</span>
        </div>
      </div>

      <!-- Mercados que la IA analiza -->
      <details class="card card-tinted card-pad-sm mb-3" style="border-left:3px solid var(--brand-500);background:rgba(30,75,200,0.04)">
        <summary style="cursor:pointer;display:flex;align-items:center;gap:8px;font-weight:600;font-size:.88rem">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          La IA analiza 140+ mercados por deporte
        </summary>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:.78rem">
          <p class="tiny muted" style="margin-bottom:10px">Algunos picks vienen <strong>directos de las 6 casas oficiales</strong> (cuota real). Otros marcados <span class="badge tiny" style="background:#9b59b6;color:white;padding:2px 6px;font-size:.65rem">ANÁLISIS IA</span> son <strong>análisis interno cuantitativo</strong> — verificá disponibilidad en tu casa.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
            <div>
              <strong style="display:block;margin-bottom:4px;color:#3a6cd6">⚽ Fútbol (40+ mercados)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">1X2, DC, DNB, goles, BTTS, hándicap, marcador exacto, HT/FT, córners (total + 1T + equipo), tarjetas, rojas, penales, faltas, tiros, goleador anytime, primer goleador.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#e67e22">🏀 Básquet (22+ mercados)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">ML, spread, totales por cuarto/mitad, prórroga, jugador: pts/reb/ast/3pt/blk/stl/dbl-dbl/triple-doble/PRA.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#27ae60">🎾 Tenis (15)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">Ganador, sets, games totales, hándicap, tiebreaks, aces, doble faltas.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#9b59b6">🎮 eSports (15)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">Mapas, hándicap, kills, primera sangre, primera torre, duración mapa, pistol rounds.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#e74c3c">🏈 NFL (16)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">Spread, totales, 1H, TD anytime/first, yds pase/run/rec por jugador, OT.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#3498db">🏒 NHL (12)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">ML+OT, regular, puck line, goles totales, 1er período, tiros/puntos jugador.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#f39c12">⚾ MLB (15)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">ML, run line, F5, YRFI, hits, HR jugador, bases, RBI, K por lanzador.</p>
            </div>
            <div>
              <strong style="display:block;margin-bottom:4px;color:#c0392b">🥊 MMA / UFC (8)</strong>
              <p class="muted" style="line-height:1.5;font-size:.72rem">Ganador, método de victoria, rounds, completa los rounds, 1er minuto, decisión.</p>
            </div>
          </div>
        </div>
      </details>

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
        // Auto-reload con filtro estricto: si elige fútbol, NUNCA esports.
        reload(panel);
      });
    });
  }

  async function reload(panel, count) {
    const isVip = BSAuth.isVip();
    count = count || (isVip ? 6 : 3);
    if (state.loading) return;
    state.loading = true;
    const host = panel.querySelector('#aiPicks');
    if (host) host.innerHTML = renderLoadingState(count);
    // Contador visual + steps
    const startedAt = Date.now();
    let stepIdx = 0;
    const timer = setInterval(() => {
      const el = host?.querySelector('.ai-loading__seconds');
      if (el) {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        el.textContent = `${s}s`;
      }
      const steps = host?.querySelectorAll('.ai-loading__steps li');
      if (steps && steps.length) {
        const elapsedS = (Date.now() - startedAt) / 1000;
        const targetIdx = Math.min(steps.length - 1, Math.floor(elapsedS / 10));
        while (stepIdx < targetIdx) {
          steps[stepIdx].classList.remove('is-active');
          steps[stepIdx].classList.add('is-done');
          stepIdx++;
          steps[stepIdx]?.classList.add('is-active');
        }
      }
    }, 1000);
    try {
      // Filtro deportivo ESTRICTO: si el usuario elige fútbol, jamás se incluyen
      // esports. El backend respeta esto en /api/picks/curated.
      const res = await BSLive.getCuratedCombos({
        sport: state.filters.sport,
        count
      });
      state.combos = res.combos || [];
      state.meta = res.meta;
      // v5.8: capturar estado IA del backend para mostrarle al usuario.
      // NO mentimos si la IA falló — banner honesto.
      state.aiHealth = res.aiHealth || 'unknown';
      state.aiProvider = res.aiProvider || null;
      state.aiReason = res.aiReason || null;
      state.error = null;
    } catch (e) {
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
      state.combos = [];
    } finally {
      clearInterval(timer);
      state.loading = false;
      renderCombos(panel);
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

  function renderCombos(panel) {
    const host = panel.querySelector('#aiPicks');
    if (!host) return;
    const meta = panel.querySelector('#aiMeta');
    if (meta && state.meta) {
      const m = state.meta;
      meta.textContent = m.analyzedEvents
        ? `${m.analyzedEvents} partidos analizados · ${m.poolSize} picks con valor · ${state.combos.length} combinadas curadas`
        : (m.message || '—');
    }

    // Banner unificado de estado IA: honestidad por encima de pretensión.
    // Si hay keys faltantes o IA degradada, el usuario lo ve claramente,
    // con razón concreta del servidor.
    const aiBannerHtml = BSUI.aiHealthBanner({
      health: state.aiHealth,
      provider: state.aiProvider,
      reason: state.aiReason,
      onRetry: state.aiHealth !== 'ok' ? 'aiHealthRetry' : null,
      context: 'AI Picks'
    });

    if (state.error) {
      host.innerHTML = `
        ${aiBannerHtml}
        <div class="ai-empty-card">
          <div class="ai-empty-icon ai-empty-icon--err">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <strong>No pudimos cargar las combinadas</strong>
          <p class="muted tiny">${BSUI.esc(state.error)}</p>
          <button class="btn btn-primary btn-sm" id="aiRetry">Reintentar</button>
        </div>`;
      panel.querySelector('#aiRetry')?.addEventListener('click', () => reload(panel));
      panel.querySelector('#aiHealthRetry')?.addEventListener('click', () => reload(panel));
      return;
    }
    if (!state.combos.length) {
      const reason = state.meta?.reason;
      const message = state.meta?.message;
      host.innerHTML = `
        ${aiBannerHtml}
        <div class="ai-empty-card">
          <div class="ai-empty-icon">
            <span class="ai-empty-ring"></span>
            <span class="ai-empty-ring ai-empty-ring--2"></span>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <strong>Hoy no hay combinadas curadas con la calidad suficiente</strong>
          <p class="muted tiny" style="max-width:520px;margin:0 auto">${BSUI.esc(message || 'La IA prefirió no mostrar combinadas mediocres antes que armar cualquier cosa. Volvé en un rato — el motor analiza constantemente los partidos del día.')}</p>
          <button class="btn btn-primary btn-sm mag" id="aiRetry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
            Reintentar
          </button>
        </div>`;
      panel.querySelector('#aiRetry')?.addEventListener('click', () => reload(panel));
      panel.querySelector('#aiHealthRetry')?.addEventListener('click', () => reload(panel));
      return;
    }
    const isVip = BSAuth.isVip();
    let html = aiBannerHtml + state.combos.map((c, idx) => comboCard(c, idx)).join('');
    // Teaser VIP al final si no-VIP (limit 3) para tentarlo
    if (!isVip) {
      html += `
        <div class="ai-vip-teaser" role="region" aria-label="Más picks para VIP">
          <div class="ai-vip-teaser__shine" aria-hidden="true"></div>
          <div class="ai-vip-teaser__content">
            <span class="badge-vip" style="align-self:flex-start">VIP exclusivo</span>
            <strong class="ai-vip-teaser__title">Te estás perdiendo <span class="num">17 picks</span> más</strong>
            <p class="muted tiny" style="max-width:480px">Los miembros VIP ven el análisis completo de hasta 20 partidos por día — fútbol europeo top, Libertadores, tenis Grand Slam, NBA y más. Cada apuesta con datos reales del partido, indicación de dónde la cuota está más floja y una combinada pensada para pagar fuerte.</p>
            <div class="ai-vip-teaser__features">
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Hasta 20 picks/día</span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Smart Money en vivo</span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Arbitraje 24/7</span>
              <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Coach IA (NLP)</span>
            </div>
            <a href="pricing.html" class="btn btn-gold btn-lg mag" style="align-self:flex-start">Pasar a VIP →</a>
          </div>
        </div>`;
    }
    host.innerHTML = html;
    // Bind "Agregar combinada al builder": agrega TODAS las legs al slip
    host.querySelectorAll('[data-add-combo]').forEach(b => b.addEventListener('click', () => {
      const idx = Number(b.dataset.addCombo);
      const c = state.combos[idx];
      if (!c || !c.legs) return;
      let added = 0;
      c.legs.forEach(l => {
        try {
          BSDash.addToSlip({
            matchId: l.eventId,
            eventId: l.eventId,
            label: l.label,
            odd: l.odd,
            book: l.book,
            market: l.market,
            outcome: l.outcome
          });
          added++;
        } catch (_) {}
      });
      BSUI.toast?.({ title: 'Combinada agregada', message: `${added} legs sumadas al builder.`, type: 'success' });
    }));
    // Bind "Compartir combinada"
    host.querySelectorAll('[data-share-combo]').forEach(b => b.addEventListener('click', async () => {
      const idx = Number(b.dataset.shareCombo);
      const c = state.combos[idx];
      if (!c) return;
      const legsText = c.legs.map((l, i) =>
        `${i+1}. ${l.home} vs ${l.away} · ${l.label} @ ${l.odd.toFixed(2)} (${l.book})`
      ).join('\n');
      const txt = `🎯 BetSafe · Combinada IA curada · Riesgo ${c.risk}

${c.legs.length} legs · cuota total ${c.totalOdd.toFixed(2)}

${legsText}

💡 ${c.narrative}

⚡ Por qué jugarla: ${c.edge}

— Análisis generado por BetSafe`;
      try {
        if (navigator.share && navigator.canShare?.({ text: txt })) {
          await navigator.share({ title: `Combinada IA · cuota ${c.totalOdd}`, text: txt, url: location.href });
        } else {
          await navigator.clipboard.writeText(txt);
          BSUI.toast?.({ title: 'Combinada copiada', message: 'Pegala donde quieras compartirla.', type: 'success' });
        }
      } catch (e) {
        if (e.name !== 'AbortError') BSUI.toast?.({ title: 'No se pudo compartir', type: 'error' });
      }
    }));
  }

  function renderSkeleton(n) {
    return Array.from({ length: n }, () => `
      <div class="card card-pad-md skeleton-card" style="height:200px;background:linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite"></div>
    `).join('');
  }

  // ─────────────────────────────────────────────────────────────────────
  // comboCard: nueva visualización para combinadas curadas por IA.
  // Cada combo trae 2-5 legs, narrativa, edge, factor clave, riesgo.
  // ─────────────────────────────────────────────────────────────────────
  function comboCard(c, idx) {
    const bookName = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
    const riskClass = c.risk === 'seguro' ? 'low' : c.risk === 'agresivo' ? 'high' : 'mid';
    const riskColor = c.risk === 'seguro' ? '#1f8a4c' : c.risk === 'agresivo' ? '#c49a1a' : '#3a6cd6';
    const riskLabel = c.risk === 'seguro' ? 'SEGURA' : c.risk === 'agresivo' ? 'AGRESIVA' : 'EQUILIBRADA';

    // Probabilidad combinada conservadora (multiplica las prob ajustadas por confianza)
    const combinedProb = c.legs.reduce((a, l) => a * (l.confidence || 0.5), 1);
    const expectedPayout = c.totalOdd;
    const profitMultiplier = c.totalOdd - 1;

    const legsHtml = c.legs.map((l, i) => {
      const home = { id: (l.home||'').toLowerCase().replace(/[^a-z]/g,''), name: l.home };
      const away = { id: (l.away||'').toLowerCase().replace(/[^a-z]/g,''), name: l.away };
      const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(home.id, { size: 22, name: l.home, sport: l.sport }) : BSIcons.teamLogo(home, { size: 22, sport: l.sport });
      const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(away.id, { size: 22, name: l.away, sport: l.sport }) : BSIcons.teamLogo(away, { size: 22, sport: l.sport });
      const bookLogo = window.BSLogos && l.book ? BSLogos.bookLogo(l.book, { size: 14 }) : '';
      const evClass = (l.ev || 0) > 0 ? 'text-success' : 'muted';
      // Detectar picks analíticos del motor multi-mercado (córners, tarjetas,
      // goleadores, marcador exacto, props de jugador, etc.)
      const ANALYTICAL_MARKETS = new Set([
        'corners-total', 'corners-ht', 'corners-team', 'cards-total',
        'goalscorer-anytime', 'first-goalscorer',
        'exact-score', 'ht-result', 'totals-ht', 'dnb',
        'result-btts', 'first-team-score',
        'red-card', 'penalty', 'fouls-total', 'shots-on-target-total',
        'totals-points', 'totals-points-team', 'totals-q1', 'overtime',
        'player-points', 'player-rebounds', 'player-assists',
        'tennis-totals-games', 'tennis-tiebreak', 'tennis-aces-total',
        'nfl-totals', 'nfl-overtime',
        'hockey-totals', 'hockey-totals-p1',
        'mlb-totals', 'mlb-yrfi',
        'mma-rounds', 'mma-method', 'mma-first-minute',
        'esports-maps-total', 'esports-rounds-total', 'esports-kills-total',
        // legacy
        'corners', 'cards'
      ]);
      const isAnalytical = !!l.analytical || ANALYTICAL_MARKETS.has(l.market);
      // Mapa amplio de labels por market
      const marketLabel = {
        // Fútbol
        'h2h': 'Ganador', 'totals': 'Más/Menos goles', 'btts': 'Ambos marcan',
        'ah': 'Hándicap asiático', 'dc': 'Doble oportunidad',
        'corners-total': 'Córners totales', 'corners-ht': 'Córners 1T',
        'corners-team': 'Córners por equipo',
        'cards-total': 'Tarjetas', 'red-card': 'Tarjeta roja', 'penalty': 'Penal',
        'fouls-total': 'Faltas totales', 'shots-on-target-total': 'Tiros al arco',
        'goalscorer-anytime': 'Goleador anytime', 'first-goalscorer': 'Primer goleador',
        'exact-score': 'Marcador exacto', 'ht-result': 'Resultado 1T',
        'totals-ht': 'Goles 1T', 'dnb': 'Empate no apuesta',
        'result-btts': '1X2 + ambos marcan', 'first-team-score': '1er gol',
        // Básquet
        'totals-points': 'Total puntos', 'totals-points-team': 'Puntos por equipo',
        'totals-q1': 'Total 1Q', 'overtime': 'Prórroga',
        'player-points': 'Puntos jugador', 'player-rebounds': 'Rebotes jugador',
        'player-assists': 'Asistencias jugador',
        // Tenis
        'tennis-totals-games': 'Total games', 'tennis-tiebreak': 'Tiebreak',
        'tennis-aces-total': 'Aces totales',
        // NFL
        'nfl-totals': 'Total puntos NFL', 'nfl-overtime': 'OT NFL',
        // NHL
        'hockey-totals': 'Total goles', 'hockey-totals-p1': 'Goles 1P',
        // MLB
        'mlb-totals': 'Total carreras', 'mlb-yrfi': '1ra entrada',
        // MMA
        'mma-rounds': 'Total rounds', 'mma-method': 'Método',
        'mma-first-minute': '1er minuto',
        // eSports
        'esports-maps-total': 'Total mapas', 'esports-rounds-total': 'Total rondas',
        'esports-kills-total': 'Total kills',
        // legacy
        'corners': 'Córners', 'cards': 'Tarjetas'
      }[l.market] || l.market || '';
      return `
        <div class="ai-combo-leg" style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;background:rgba(255,255,255,0.02);border-radius:8px;border-left:3px solid ${isAnalytical ? '#9b59b6' : riskColor}">
          <div style="display:flex;align-items:center;gap:6px;min-width:0">
            <span style="font-weight:700;font-size:.72rem;color:var(--muted);min-width:14px">${i+1}.</span>
            ${homeLogo}
            <strong style="font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${BSUI.esc(l.home)}</strong>
            <span class="dim" style="font-size:.72rem">vs</span>
            <strong style="font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${BSUI.esc(l.away)}</strong>
            ${awayLogo}
          </div>
          <div style="display:flex;flex-direction:column;min-width:0;gap:2px">
            <span class="tiny" style="font-weight:600">${BSUI.esc(l.label)}${isAnalytical ? ' <span class="badge tiny" style="background:#9b59b6;color:white;padding:1px 5px;margin-left:4px;font-size:.6rem;letter-spacing:.04em">ANÁLISIS IA</span>' : ''}</span>
            <span class="muted" style="font-size:.7rem">${marketLabel ? marketLabel + ' · ' : ''}${BSUI.esc(l.league || '')}${l.start ? ' · ' + BSUI.dt(l.start) : ''}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:80px">
            <strong class="num text-brand" style="font-size:1.05rem">${l.odd ? l.odd.toFixed(2) : '—'}</strong>
            ${isAnalytical
              ? `<span class="muted" style="font-size:.6rem;font-style:italic">cuota estimada</span>`
              : `<div class="cluster" style="gap:3px;font-size:.65rem">${bookLogo}<span class="muted">${BSUI.esc(bookName(l.book))}</span></div>`}
            ${l.ev != null ? `<span class="${evClass}" style="font-size:.65rem" title="Cuán generosa es la cuota comparada con lo justo. Positivo = la casa te está pagando más de lo que debería.">Ventaja ${l.ev > 0 ? '+' : ''}${l.ev.toFixed(1)}%</span>` : ''}
          </div>
        </div>`;
    }).join('');

    // v5.8: usar probTotal del backend (prob real producto de confidences),
    // no recalcular. evReal y impliedProb también del backend.
    const probPct = c.probTotalPct != null
      ? c.probTotalPct
      : Math.max(1, Math.round(combinedProb * 100));
    const evReal = c.evReal != null ? c.evReal : (combinedProb * c.totalOdd);
    const impliedPct = c.impliedProb != null
      ? Math.round(c.impliedProb * 100)
      : Math.round(100 / c.totalOdd);
    const evRealClass = evReal >= 1.2 ? 'text-success' : evReal >= 1.05 ? 'text-success' : 'muted';
    const probClass = probPct >= 25 ? 'text-success' : probPct >= 15 ? '' : 'muted';

    return `
      <article class="card card-pad-md ai-combo-card" data-combo-idx="${idx}" style="border-left:3px solid ${riskColor}">
        <header class="row between" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div class="cluster" style="gap:8px;flex-wrap:wrap">
            <strong style="font-size:1.05rem">Combinada IA #${idx+1}</strong>
            <span class="badge tiny" style="background:${riskColor};color:white;font-weight:700;letter-spacing:.04em">${riskLabel}</span>
            <span class="tiny muted">${c.legCount} legs${c.sportsCount > 1 ? ` · ${c.sportsCount} deportes` : ''}</span>
            ${evReal >= 1.15 ? `<span class="badge badge-success tiny" title="EV real ${evReal.toFixed(2)}x — la combinada paga más de lo que vale estadísticamente.">+EV ${evReal.toFixed(2)}x</span>` : ''}
          </div>
          <div class="text-right">
            <strong class="num text-brand" style="font-size:1.4rem">${c.totalOdd.toFixed(2)}</strong>
            <div class="muted tiny">cuota total</div>
          </div>
        </header>

        ${c.narrative ? `<div class="card card-pad-sm" style="background:rgba(30,75,200,0.05);border-left:3px solid var(--brand-500);margin-bottom:10px">
          <strong class="tiny" style="color:var(--brand-500)">💡 Por qué esta combinada</strong>
          <p class="tiny" style="margin-top:4px;line-height:1.5">${BSUI.esc(c.narrative)}</p>
        </div>` : ''}

        <div class="stack-sm" style="margin-bottom:10px">
          ${legsHtml}
        </div>

        ${c.edge ? `<div class="card card-pad-sm" style="background:rgba(212,160,23,0.08);border-left:3px solid var(--gold-700,#c49a1a);margin-bottom:8px">
          <strong class="tiny" style="color:var(--gold-700,#c49a1a)">⚡ Edge vs mercado</strong>
          <p class="tiny" style="margin-top:4px;line-height:1.45">${BSUI.esc(c.edge)}</p>
        </div>` : ''}

        ${c.keyFactor ? `<div class="row between" style="font-size:.72rem;margin-bottom:8px;padding:6px 10px;background:var(--surface-2);border-radius:6px;align-items:center">
          <strong style="color:var(--muted)">🎯 Factor clave a vigilar</strong>
          <span class="muted" style="text-align:right;max-width:60%">${BSUI.esc(c.keyFactor)}</span>
        </div>` : ''}

        <div class="row between" style="font-size:.72rem;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:10px;gap:6px;flex-wrap:wrap">
          <div title="Probabilidad REAL de que pegue la combinada: producto de las prob de cada leg. La casa cobra como si fuera ${impliedPct}%; el modelo cree que es ${probPct}%.">
            <div class="muted">Prob real</div>
            <strong class="${probClass}">${probPct}%</strong>
            <span class="muted tiny" style="display:block">casa: ${impliedPct}%</span>
          </div>
          <div title="EV real = prob × cuota. >1.0 = la combinada paga MÁS de lo que estadísticamente vale (valor positivo).">
            <div class="muted">EV real</div>
            <strong class="${evRealClass}">${evReal.toFixed(2)}x</strong>
            <span class="muted tiny" style="display:block">${evReal >= 1.2 ? 'excelente' : evReal >= 1.05 ? 'positivo' : evReal >= 1.0 ? 'marginal' : 'negativo'}</span>
          </div>
          <div title="Confianza promedio de las legs.">
            <div class="muted">Conf prom</div>
            <strong>${(c.avgConfidence * 100).toFixed(0)}%</strong>
          </div>
          <div class="text-right">
            <div class="muted">Si pega × $10.000</div>
            <strong class="text-success num">${BSUI.money(10000 * c.totalOdd)}</strong>
          </div>
        </div>

        <div class="row between" style="margin-top:8px;flex-wrap:wrap;gap:6px">
          <button class="btn btn-primary btn-sm" data-add-combo="${idx}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Agregar al builder
          </button>
          <button class="btn btn-ghost btn-sm" data-share-combo="${idx}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Compartir
          </button>
        </div>
      </article>
    `;
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
            ${analysis.llmProvider && analysis.llmProvider !== 'offline'
              ? `<span class="badge badge-success tiny" title="Análisis con IA generativa (${BSUI.esc(analysis.llmProvider)})">Análisis IA · ${BSUI.esc(analysis.llmProvider)}</span>`
              : `<span class="badge badge-warning tiny" title="La IA generativa no está disponible en este momento. El análisis usa solo nuestros modelos estadísticos. Refrescá en 1 min para que la IA revise.">⚠ Análisis sin IA</span>`}
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
    if (s.consensusProb != null) probs.push({ label: 'Final', v: s.consensusProb, highlight: true });

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

    // Edge sign/class para mostrar como pill prominente (igual que combinadas)
    const evSign = ev_pct != null && ev_pct >= 0 ? '+' : '';
    const edgeCls = ev_pct == null ? '' : ev_pct >= 0 ? '' : 'bs-prem__edge--negative';
    const confPct = Math.round(conf * 100);
    const confLevel = confPct >= 70 ? 'high' : confPct >= 50 ? '' : 'low';

    return `
      <div class="ai-pick ai-pick--prem" data-type="${s.type}"${isCombo ? ' data-combo="1"' : ''}>
        <div class="row between" style="align-items:center">
          <span class="risk-pill ${typeClass}">${typeLabel}${isCombo ? ` · ${s.legs.length} legs` : ''}</span>
          ${ev_pct != null ? `<span class="bs-prem__edge ${edgeCls}" style="padding:3px 9px;font-size:.85rem" title="Cuán generosa es esta cuota comparada con la cuota justa. Positivo = la casa paga más de lo que debería.">${evSign}${ev_pct.toFixed(1)}% a favor</span>` : ''}
        </div>
        ${isCombo ? legsHtml : `<strong style="display:block;margin:10px 0 4px;font-size:.95rem;line-height:1.3">${BSUI.esc(s.label || s.outcome)}</strong>`}
        <div class="ai-pick__odd-row">
          <div>
            <span class="bs-prem__hero-label">Cuota</span>
            <span class="bs-prem__odd ai-pick__odd">${s.odd?.toFixed?.(2) || '—'}</span>
          </div>
          <div class="ai-pick__book">
            ${bookLogo}
            <span class="muted tiny">${BSUI.esc(bookName(s.book))}</span>
          </div>
        </div>
        <div class="bs-prem__conf" style="padding:8px 10px;margin-top:8px">
          <div class="bs-prem__conf-head">
            <span>Confianza del modelo</span><strong>${confPct}%</strong>
          </div>
          <div class="bs-prem__conf-track">
            <div class="bs-prem__conf-fill ${confLevel ? 'bs-prem__conf-fill--' + confLevel : ''}" style="width:${confPct}%"></div>
          </div>
        </div>
        ${probs.length ? `<div class="ai-probs">${probs.map(p => `<span class="ai-prob${p.highlight?' is-consensus':''}"><span class="muted tiny">${p.label}</span><strong>${(p.v*100).toFixed(0)}%</strong></span>`).join('')}</div>` : ''}
        <div class="ai-metrics-grid">
          ${s.valueGap != null ? `<div class="ai-metric" title="Cuán diferente es la probabilidad REAL de la probabilidad que sugiere la cuota. Positivo = la cuota está sobreestimando la dificultad — te conviene jugarla."><span class="muted tiny">Valor extra</span><strong class="${s.valueGap > 0 ? 'text-success' : 'muted'}">${s.valueGap > 0 ? '+' : ''}${s.valueGap.toFixed(1)}%</strong></div>` : ''}
          ${s.modelConvergence ? `<div class="ai-metric" title="Si los distintos modelos (estadístico, forma reciente, IA) coinciden en el pronóstico"><span class="muted tiny">Modelos</span><strong class="${s.modelConvergence === 'alta' ? 'text-success' : s.modelConvergence === 'baja' ? 'text-warning' : ''}">${s.modelConvergence === 'alta' ? 'coinciden' : s.modelConvergence === 'baja' ? 'discrepan' : 'parcial'}</strong></div>` : ''}
          ${s.kellyFractional ? `<div class="ai-metric" title="Cuánto de tu plata total te conviene apostar — calculado para crecer la banca sin riesgo de quemarla. Es conservador, podés apostar menos si querés."><span class="muted tiny">Apostá</span><strong>${(s.kellyFractional*100).toFixed(1)}% de tu plata</strong></div>` : ''}
        </div>
        ${s.rationale ? `<p class="muted tiny" style="margin-top:8px;line-height:1.4">${BSUI.esc(s.rationale).slice(0, 180)}${s.rationale.length > 180 ? '…' : ''}</p>` : ''}
        ${(s.warnings || []).length ? `<div class="cluster tiny" style="margin-top:6px;flex-wrap:wrap">${s.warnings.map(w => `<span class="badge badge-warning tiny">⚠ ${BSUI.esc(w)}</span>`).join('')}</div>` : ''}
        <button class="btn btn-primary btn-sm w-full" style="margin-top:10px" data-add-slip='${addPayload}'>${BSIcons.svg('plus',{size:14})} Agregar a la combinada</button>
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
          <div><span class="muted tiny" title="Cuota matemáticamente justa (sin margen de la casa)">Cuota justa</span><div class="tiny">${(q.fairOdds || []).map(o => o?.toFixed(2) || '—').join(' / ')}</div></div>
          <div><span class="muted tiny">Ventaja sobre la casa</span><div class="tiny">${(q.ev || []).map(v => (v > 0 ? '+' : '') + v.toFixed(2) + '%').join(' / ')}</div></div>
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
