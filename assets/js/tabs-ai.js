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
          <h2 class="h3">AI Picks · análisis ultra profundo<a class="help-q" tabindex="0" data-tip="Cada pick combina cuotas reales de casas legales + clima del venue + lesiones reportadas + movimiento sharp del mercado + histórico H2H + 4 modelos cuantitativos (Shin no-vig, Poisson xG, Elo ajustado, LLM). Confidence score basado en consistencia entre modelos. Esto NO es ChatGPT diciéndote 'apostá a tal' — es análisis quant institucional."></a></h2>
          <p class="muted">${isVip ? `VIP — análisis ilimitado · backend a tiempo real` : `Standard — top ${limit} partidos por EV`}</p>
        </div>
        <div class="cluster">
          <button class="btn btn-primary mag" id="aiAnalyze">${BSIcons.svg('bolt', { size: 16 })} Reanalizar</button>
        </div>
      </div>

      <!-- Filtros REALES (se aplican en backend) -->
      <div class="card stack mb-3">
        <div class="row between">
          <strong>Filtros profesionales<a class="help-q" tabindex="0" data-tip="Los filtros se aplican EN EL BACKEND con datos reales: lesiones de ESPN/API-Football, clima de OpenWeatherMap, movimiento sharp detectado por nuestro motor en cada ciclo de scraping."></a></strong>
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
    limit = limit || (BSAuth.isVip() ? 20 : 6);
    if (state.loading) return;
    state.loading = true;
    const host = panel.querySelector('#aiPicks');
    if (host) host.innerHTML = renderSkeleton(limit);
    try {
      const res = await BSLive.getPicks({ ...state.filters, limit });
      state.picks = res.picks || [];
      state.meta = res.meta;
      state.error = null;
    } catch (e) {
      state.error = e?.message;
      state.picks = [];
    } finally {
      state.loading = false;
      renderPicks(panel);
    }
  }

  function renderPicks(panel) {
    const host = panel.querySelector('#aiPicks');
    if (!host) return;
    const meta = panel.querySelector('#aiMeta');
    if (meta && state.meta) meta.textContent = `${state.meta.filtered}/${state.meta.analyzed} pasaron filtros · ${state.picks.length} picks`;

    if (state.error) {
      host.innerHTML = `<div class="card stack" style="padding:32px;text-align:center"><strong>Error al cargar análisis</strong><p class="muted tiny">${BSUI.esc(state.error)}</p><button class="btn btn-outline btn-sm" id="aiRetry">Reintentar</button></div>`;
      panel.querySelector('#aiRetry')?.addEventListener('click', () => reload(panel));
      return;
    }
    if (!state.picks.length) {
      host.innerHTML = `<div class="card stack" style="padding:32px;text-align:center"><strong>Sin picks que pasen los filtros</strong><p class="muted">Probá relajar filtros (bajar sharp mínimo, destildar "saltear lesiones") o cambiá de deporte.</p></div>`;
      return;
    }
    host.innerHTML = state.picks.map(p => pickAnalysisCard(p)).join('');
    // Bind clicks de "Ver factores" / "Agregar a slip"
    host.querySelectorAll('[data-add-slip]').forEach(b => b.addEventListener('click', () => {
      const data = JSON.parse(b.dataset.addSlip);
      BSDash.addToSlip(data);
    }));
    host.querySelectorAll('[data-open-factors]').forEach(b => b.addEventListener('click', () => openFactorsModal(b.dataset.openFactors)));
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
            ${analysis.llmProvider !== 'offline' ? `<span class="badge badge-success tiny" title="LLM provider activo">IA: ${analysis.llmProvider}</span>` : '<span class="badge tiny" title="Análisis cuantitativo determinístico (Poisson + Elo + Shin) — sumá BS_GROQ_API_KEY en Render para activar análisis LLM">Análisis quant</span>'}
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

        <div class="row between" style="margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-open-factors="${ev.id}">Ver todos los factores</button>
          <span class="muted tiny">${f.weather && !f.weather.unavailable ? `Clima: ${f.weather.tempC?.toFixed?.(0) || '?'}°C · ${f.weather.condition || ''}` : ''}</span>
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
    if (s.fairProb != null)    probs.push({ label: 'Shin', v: s.fairProb });
    if (s.poissonProb != null) probs.push({ label: 'Poisson', v: s.poissonProb });
    if (s.eloProb != null)     probs.push({ label: 'Elo', v: s.eloProb });
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
          <span class="badge badge-${confClass} tiny" title="Confidence basado en consistencia entre Shin/Poisson/Elo/IA">Conf ${(conf*100).toFixed(0)}%</span>
        </div>
        ${isCombo ? legsHtml : `<strong style="display:block;margin:8px 0">${BSUI.esc(s.label || s.outcome)}</strong>`}
        <div class="cluster" style="justify-content:space-between;align-items:baseline">
          <strong class="num text-brand" style="font-size:1.4rem">${s.odd?.toFixed?.(2) || '—'}</strong>
          <span class="cluster tiny">${bookLogo}<span class="muted">${BSUI.esc(bookName(s.book))}</span></span>
        </div>
        ${probs.length ? `<div class="ai-probs">${probs.map(p => `<span class="ai-prob${p.highlight?' is-consensus':''}"><span class="muted tiny">${p.label}</span><strong>${(p.v*100).toFixed(0)}%</strong></span>`).join('')}</div>` : ''}
        ${ev_pct != null ? `<div class="row between tiny" style="margin-top:6px"><span class="muted">EV</span><strong class="${evClass}">${ev_pct > 0 ? '+' : ''}${ev_pct.toFixed(2)}%</strong></div>` : ''}
        ${s.kellyHalf ? `<div class="row between tiny"><span class="muted">Stake ½ Kelly</span><strong>${s.kellyHalf.toFixed(2)}% banca</strong></div>` : ''}
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

    // Quant / modelo Poisson
    if (f.poisson && !f.poisson.unavailable) {
      items.push(`<span class="ai-factor"><span class="ai-factor-ic">🎯</span><strong class="tiny">Poisson</strong><span class="muted tiny">μH ${f.poisson.lambdaH} · μA ${f.poisson.lambdaA}</span></span>`);
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
        <strong>🧮 Modelo cuantitativo</strong>
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
