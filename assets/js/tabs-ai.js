/* BetSafe — AI Picks tab (HIPER-AVANZADO v2)
 * ============================================================================
 * Reformulación completa de la página de recomendaciones. Cada combinada se
 * presenta como una "Pro Card" con:
 *   - Hero numérico (cuota, prob combinada, payout en $ basado en TU bankroll)
 *   - Multi-model consensus bar (5 modelos visualmente comparados por leg)
 *   - Line shopping inline (cuotas de las 6 casas, badge "MEJOR")
 *   - Sharp money panel (movimientos >5% en última hora con dirección)
 *   - Sparkline (movimiento de cuota desde primera vista vía localStorage)
 *   - Smart actions: track / hedge / casa deeplink / share / add slip
 *
 * Layout:
 *   1) Command Bar — bankroll, riesgo (Kelly fraction), refresh, live indicator
 *   2) Smart Insights Banner — narrativa del día auto-generada server-side
 *   3) Quick Stats Strip — analizados, EV promedio, sharp activos, ligas
 *   4) Combo Pro Cards (la grilla principal)
 *   5) Bankroll Tracker Widget — picks tracked en localStorage, ROI histórico
 * ============================================================================
 */
(function () {
  'use strict';

  // Estado local persistido a localStorage
  const LS_BANKROLL = 'bs_ai_bankroll';
  const LS_RISK     = 'bs_ai_risk_kelly';
  const LS_TRACKED  = 'bs_ai_tracked_picks';
  const LS_AUTOREF  = 'bs_ai_auto_refresh';
  const LS_FILTERS  = 'bs_ai_advanced_filters';
  const LS_PICKS_CACHE = 'bs_ai_picks_cache_v1';

  // Thresholds de freshness del cache de picks (ms)
  // Filosofía: cada generación cuesta IA. Si el user entra/sale del tab sin
  // hacer nada, NO regeneramos — mostramos los últimos con un banner que
  // informa cuándo se generaron y recomienda regenerar si pasó mucho tiempo.
  const PICKS_AGE_OK     = 15 * 60 * 1000;       // ≤15min: muy fresco, banner verde
  const PICKS_AGE_WARN   = 60 * 60 * 1000;       // ≤1h:  fresco, banner neutral
  const PICKS_AGE_STALE  = 6  * 3600 * 1000;     // ≤6h:  recomendar regenerar
  // >6h: insistir mucho en regenerar

  // Mercados disponibles para el filtro (las keys del backend + label legible)
  const FILTER_MARKETS = [
    { key: 'h2h',           label: 'Ganador 1X2' },
    { key: 'dc',            label: 'Doble oport.' },
    { key: 'totals',        label: 'Más/Menos goles' },
    { key: 'btts',          label: 'Ambos marcan' },
    { key: 'ah',            label: 'Hándicap asiático' },
    { key: 'corners-total', label: 'Córners totales' },
    { key: 'cards-total',   label: 'Tarjetas' },
    { key: 'goalscorer-anytime', label: 'Goleador anytime' },
    { key: 'exact-score',   label: 'Marcador exacto' },
    { key: 'totals-points', label: 'Puntos (NBA)' },
    { key: 'player-points', label: 'Puntos jugador' },
    { key: 'nfl-totals',    label: 'Totales NFL' }
  ];

  function loadAdvancedFilters() {
    try { return Object.assign({ oddMin: '', oddMax: '', timeWindowH: 36, marketsAllow: [] }, JSON.parse(localStorage.getItem(LS_FILTERS) || '{}')); }
    catch { return { oddMin: '', oddMax: '', timeWindowH: 36, marketsAllow: [] }; }
  }
  function saveAdvancedFilters(f) { localStorage.setItem(LS_FILTERS, JSON.stringify(f)); }

  let state = {
    combos: [],
    loading: false,
    filters: {
      sport: 'all',
      advanced: loadAdvancedFilters()
    },
    bankroll: Number(localStorage.getItem(LS_BANKROLL)) || 100000,
    kellyFraction: Number(localStorage.getItem(LS_RISK)) || 0.25,
    autoRefreshSec: Number(localStorage.getItem(LS_AUTOREF)) || 0,  // 0 = OFF
    autoRefreshTimer: null,
    error: null,
    meta: null,
    lastLoadedAt: null
  };

  // Persistencia ligera
  function saveBankroll(v) { state.bankroll = v; localStorage.setItem(LS_BANKROLL, String(v)); }
  function saveKelly(v) { state.kellyFraction = v; localStorage.setItem(LS_RISK, String(v)); }
  function saveAutoRefresh(s) { state.autoRefreshSec = s; localStorage.setItem(LS_AUTOREF, String(s)); }
  function trackedPicks() {
    try { return JSON.parse(localStorage.getItem(LS_TRACKED) || '[]'); } catch { return []; }
  }
  function saveTrackedPicks(arr) { localStorage.setItem(LS_TRACKED, JSON.stringify(arr.slice(-200))); }

  // ─── Cache de picks generados ───────────────────────────────────────────
  // Estructura: { sport, advancedFiltersHash, savedAt, combos, meta }
  // El advancedFiltersHash invalida el cache si el user cambia filtros
  // (porque las combinadas serían diferentes).
  function _filtersHash(adv) {
    return [adv?.oddMin || '', adv?.oddMax || '', adv?.timeWindowH || 36, (adv?.marketsAllow || []).slice().sort().join(',')].join('|');
  }
  function loadPicksCache(sport, advancedFilters) {
    try {
      const raw = localStorage.getItem(LS_PICKS_CACHE);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || c.sport !== sport) return null;
      if (c.filtersHash !== _filtersHash(advancedFilters)) return null;
      if (!Array.isArray(c.combos) || !c.combos.length) return null;
      return c;
    } catch { return null; }
  }
  function savePicksCache(sport, advancedFilters, res) {
    try {
      const c = {
        sport,
        filtersHash: _filtersHash(advancedFilters),
        savedAt: Date.now(),
        combos: res.combos || [],
        meta: res.meta || null
      };
      localStorage.setItem(LS_PICKS_CACHE, JSON.stringify(c));
    } catch (e) {
      console.warn('[picks-cache] save fail:', e.message);
    }
  }
  function clearPicksCache() {
    try { localStorage.removeItem(LS_PICKS_CACHE); } catch {}
  }
  function picksCacheAge(cache) {
    return cache?.savedAt ? Date.now() - cache.savedAt : Infinity;
  }
  function picksCacheStatus(age) {
    if (age <= PICKS_AGE_OK)    return 'fresh';
    if (age <= PICKS_AGE_WARN)  return 'ok';
    if (age <= PICKS_AGE_STALE) return 'warn';
    return 'old';
  }
  function fmtAge(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1)   return 'recién';
    if (min < 60)  return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `hace ${h}h ${min % 60}min`;
    return `hace ${Math.floor(h / 24)}d ${h % 24}h`;
  }

  async function render(panel) {
    const isVip = BSAuth.isVip();
    const count = isVip ? 6 : 3;

    panel.innerHTML = baseLayout(isVip, count);
    bindFilters(panel);

    // ── NO auto-generar — política "ahorrar tokens": el user reportó que
    // entrar/salir del tab gastaba IA innecesariamente. Ahora:
    //   1) Si hay cache para el sport actual, lo mostramos con banner de edad
    //   2) Si no hay cache, mostramos empty state con botón "Generar"
    //   3) El user controla cuándo regenerar (botón Re-analizar o el del
    //      empty state) — nunca disparamos auto desde el render del tab.
    const cached = loadPicksCache(state.filters.sport, state.filters.advanced);
    if (cached) {
      state.combos = cached.combos;
      state.meta = cached.meta;
      state.lastLoadedAt = cached.savedAt;
      state.error = null;
      renderCombos(panel);
    } else {
      renderEmptyState(panel);
    }
    // Sin auto-refresh, sin listener de bs:live-snapshot que regenere
    panel.__cleanup = () => {
      if (state.autoRefreshTimer) { clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null; }
    };
  }

  // Empty state: card grande con CTA explícito. Aparece la primera vez que
  // entrás al tab o cuando cambiás de sport y no hay cache para ese sport.
  function renderEmptyState(panel) {
    const host = panel.querySelector('#aiPicks');
    if (!host) return;
    host.innerHTML = `
      <div class="ai-empty-cta">
        <div class="ai-empty-cta__icon">${BSIcons.svg('bolt', { size: 56 })}</div>
        <h3 class="ai-empty-cta__title">Generá los picks del día con IA</h3>
        <p class="ai-empty-cta__desc">La IA analiza todos los partidos del día y arma las mejores combinadas. <strong>Cada generación cuesta tokens</strong> — los resultados quedan guardados y los vas a ver al volver al tab sin regenerar.</p>
        <button class="btn btn-primary btn-lg mag" id="aiEmptyGenerate">
          ${BSIcons.svg('sparkle', { size: 18 })} Generar picks del día
        </button>
        <p class="muted tiny" style="margin-top:14px">Tarda 10-30 segundos. Vas a poder regenerar cuando quieras.</p>
      </div>
    `;
    panel.querySelector('#aiEmptyGenerate')?.addEventListener('click', async () => {
      const isVip = BSAuth.isVip();
      await reload(panel, isVip ? 6 : 3);
    });
  }

  function baseLayout(isVip, count) {
    const SPORTS = (BSData.SPORTS || []).slice(0, 8);
    return `
      <!-- ════════════════════════════════════════════════════════════════════
           COMMAND BAR — bankroll, riesgo, refresh, live indicator, stats
           ════════════════════════════════════════════════════════════════════ -->
      <div class="bsai-command-bar reveal">
        <div class="bsai-command-bar__title">
          <h2 class="h3" style="margin:0;line-height:1.15">Centro de Recomendaciones</h2>
          <span class="muted tiny">${isVip ? `VIP · hasta ${count} combinadas premium · análisis multi-modelo` : `Standard · top ${count} combinadas (VIP desbloquea +)`}</span>
        </div>

        <div class="bsai-command-bar__controls">
          <!-- Bankroll input -->
          <div class="bsai-cmd-field" title="Tu banca total. Usado para calcular el stake recomendado por pick (Kelly fraccionario).">
            <span class="bsai-cmd-field__label">Banca</span>
            <div class="bsai-cmd-field__input">
              <span class="bsai-cmd-field__prefix">$</span>
              <input type="number" id="aiBankroll" min="1000" step="1000" value="${state.bankroll}" inputmode="numeric">
            </div>
          </div>

          <!-- Kelly fraction slider -->
          <div class="bsai-cmd-field" title="Fracción de Kelly para sizing. 1.0 = Kelly completo (agresivo). 0.25 = un cuarto Kelly (conservador, recomendado).">
            <span class="bsai-cmd-field__label">Riesgo Kelly: <strong id="aiKellyVal">${BSUI.pctInt(state.kellyFraction, 0)}</strong></span>
            <input type="range" id="aiKellySlider" min="0.05" max="1" step="0.05" value="${state.kellyFraction}" class="bsai-slider">
          </div>

          <!-- Auto-refresh -->
          <div class="bsai-cmd-field" title="Re-cargar combinadas automáticamente cada X segundos.">
            <span class="bsai-cmd-field__label">Auto-refresh</span>
            <select id="aiAutoRefresh" class="bsai-cmd-field__select">
              <option value="0" ${state.autoRefreshSec === 0 ? 'selected' : ''}>OFF</option>
              <option value="60" ${state.autoRefreshSec === 60 ? 'selected' : ''}>1 min</option>
              <option value="180" ${state.autoRefreshSec === 180 ? 'selected' : ''}>3 min</option>
              <option value="300" ${state.autoRefreshSec === 300 ? 'selected' : ''}>5 min</option>
            </select>
          </div>

          <!-- Live indicator + reanalizar -->
          <div class="bsai-cmd-actions">
            <span class="bsai-live-dot" id="aiLiveDot" title="Estado del motor: verde = cuotas frescas">
              <span class="bsai-live-dot__pulse"></span>
            </span>
            <button class="btn btn-primary btn-sm mag" id="aiAnalyze">${BSIcons.svg('bolt', { size: 14 })} Re-analizar</button>
          </div>
        </div>
      </div>

      <!-- Brief del día REMOVIDO a pedido del user (2026-05-17): se mostraba
           "No pudimos generar el brief en este momento. Reintentando…" en
           loop cuando el LLM curator no respondía. Mejor sin banner que con
           un loader infinito. Si en el futuro queremos brief, generar solo
           cuando el data esté GARANTIZADO disponible y nunca mostrar estado
           "reintentando". -->

      <!-- QUICK STATS STRIP — analizados, EV%, sharp, ligas, confidence -->
      <div class="bsai-quickstats-strip reveal" id="aiQuickStats" hidden></div>

      <!-- Filtro deportivo ESTRICTO (chips compactos) -->
      <div class="card stack mb-3">
        <div class="row between" style="margin-bottom:6px">
          <strong style="font-size:.92rem">Filtrar por deporte<a class="help-q" tabindex="0" data-tip="Si elegís un deporte específico, la IA solo analiza partidos de ese deporte. NUNCA se mezclan esports con fútbol salvo que pidas esports explícitamente."></a></strong>
          <span class="muted tiny" id="aiFilterCount">—</span>
        </div>
        <div class="cluster" id="aiSportChips">
          <button class="league-chip active" data-sport="all">Todos los deportes</button>
          ${SPORTS.map(s => `<button class="league-chip${s.accent ? ' is-' + s.accent : ''}" data-sport="${s.key}" title="${s.key === 'esports' ? 'Apuestas sobre videojuegos competitivos (CS:GO, LoL, Dota 2, Valorant)' : s.name}">${BSIcons.svg(s.icon || 'soccer', {size:14})}<span>${s.name}</span></button>`).join('')}
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════════
           FILTROS AVANZADOS — cuota min/max, hora del partido, mercados
           ════════════════════════════════════════════════════════════════════ -->
      <details class="bsai-advfilters card stack mb-3" id="aiAdvFiltersDetails" ${(() => {
        const f = state.filters.advanced;
        const hasAny = (f.oddMin && f.oddMin !== '') || (f.oddMax && f.oddMax !== '') || (f.timeWindowH != 36) || (f.marketsAllow && f.marketsAllow.length);
        return hasAny ? 'open' : '';
      })()}>
        <summary class="bsai-advfilters__summary">
          <span style="display:inline-flex;align-items:center;gap:8px">
            ${BSIcons.svg('filter', { size: 16 })}
            <strong style="font-size:.92rem">Filtros avanzados</strong>
            <span class="muted tiny" id="aiAdvFiltersBadge"></span>
          </span>
          <button class="btn btn-ghost btn-sm" id="aiAdvFiltersReset" type="button">Limpiar</button>
        </summary>
        <div class="bsai-advfilters__grid">
          <!-- CUOTA TOTAL min/max -->
          <div class="bsai-advfilters__group">
            <label class="bsai-advfilters__label" title="Filtrar combinadas por rango de cuota total. Dejá vacío para no filtrar.">Cuota total</label>
            <div class="bsai-advfilters__range">
              <input type="number" id="aiAdvOddMin" class="bsai-advfilters__input" placeholder="min" step="0.1" min="1.01" inputmode="decimal" value="${BSUI.esc(String(state.filters.advanced.oddMin || ''))}">
              <span class="dim">–</span>
              <input type="number" id="aiAdvOddMax" class="bsai-advfilters__input" placeholder="max" step="0.1" min="1.01" inputmode="decimal" value="${BSUI.esc(String(state.filters.advanced.oddMax || ''))}">
            </div>
            <span class="muted tiny">Ej: 3 a 12 = combinadas con cuota entre 3.00 y 12.00</span>
          </div>

          <!-- HORA DEL PARTIDO -->
          <div class="bsai-advfilters__group">
            <label class="bsai-advfilters__label" title="Solo partidos que arrancan en la ventana elegida.">Empieza en</label>
            <select id="aiAdvTimeWindow" class="bsai-advfilters__select">
              <option value="2"  ${state.filters.advanced.timeWindowH == 2  ? 'selected' : ''}>Próximas 2 horas</option>
              <option value="6"  ${state.filters.advanced.timeWindowH == 6  ? 'selected' : ''}>Próximas 6 horas</option>
              <option value="12" ${state.filters.advanced.timeWindowH == 12 ? 'selected' : ''}>Próximas 12 horas</option>
              <option value="24" ${state.filters.advanced.timeWindowH == 24 ? 'selected' : ''}>Próximas 24 horas</option>
              <option value="36" ${state.filters.advanced.timeWindowH == 36 ? 'selected' : ''}>Próximas 36 horas (default)</option>
              <option value="72" ${state.filters.advanced.timeWindowH == 72 ? 'selected' : ''}>Próximos 3 días</option>
              <option value="168" ${state.filters.advanced.timeWindowH == 168 ? 'selected' : ''}>Próxima semana</option>
            </select>
          </div>

          <!-- MERCADOS PERMITIDOS -->
          <div class="bsai-advfilters__group bsai-advfilters__group--full">
            <label class="bsai-advfilters__label" title="Si marcás alguno, la IA SOLO arma combinadas con esos mercados. Si dejás todo desmarcado, usa todos.">Mercados permitidos <span class="muted tiny" style="font-weight:400">(vacío = todos)</span></label>
            <div class="cluster" id="aiAdvMarkets" style="gap:6px;flex-wrap:wrap">
              ${FILTER_MARKETS.map(m => `
                <label class="bsai-advfilters__chip${state.filters.advanced.marketsAllow?.includes(m.key) ? ' is-active' : ''}">
                  <input type="checkbox" data-mkt="${m.key}" ${state.filters.advanced.marketsAllow?.includes(m.key) ? 'checked' : ''} hidden>
                  <span>${m.label}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- APLICAR -->
          <div class="bsai-advfilters__group bsai-advfilters__group--full" style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" id="aiAdvFiltersApply">${BSIcons.svg('check', { size: 14 })} Aplicar filtros</button>
          </div>
        </div>
      </details>

      <!-- Catálogo plegado (discreto, info para usuario nuevo) -->
      <details class="card card-tinted card-pad-sm mb-3" style="border-left:3px solid var(--brand-500);background:rgba(30,75,200,0.04)">
        <summary style="cursor:pointer;display:flex;align-items:center;gap:8px;font-weight:600;font-size:.85rem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
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

      <!-- ════════════════════════════════════════════════════════════════════
           BANKROLL TRACKER — picks tracked + ROI histórico (localStorage)
           ════════════════════════════════════════════════════════════════════ -->
      <div class="bsai-bankroll-widget reveal" id="aiBankrollWidget"></div>
    `;
  }

  function bindFilters(panel) {
    panel.querySelector('#aiAnalyze')?.addEventListener('click', async () => {
      const btn = panel.querySelector('#aiAnalyze');
      // Anti-double-click + cooldown 5s (cada re-analyze es ~10 calls IA)
      if (btn.dataset.busy === '1') return;
      const last = Number(btn.dataset.lastRun || 0);
      if (Date.now() - last < 5000) {
        BSUI.toast?.({ title: 'Esperá un momento', message: 'Acabás de re-analizar. Cooldown 5s.', type: 'info' });
        return;
      }
      btn.dataset.busy = '1';
      btn.classList.add('shimmer');
      try {
        // fetchSnapshot no debe bloquear el reload — si cuelga o falla, igual
        // procedemos. Antes: si fetchSnapshot tardaba 30s o tiraba excepción,
        // el reload NUNCA se llamaba y el botón parecía "no andar".
        try {
          await Promise.race([
            BSLive?.fetchSnapshot?.() || Promise.resolve(),
            new Promise(r => setTimeout(r, 3000))   // máx 3s, después seguimos
          ]);
        } catch {}
        await reload(panel);
      } catch (e) {
        BSUI.toast?.({ title: 'No se pudo regenerar', message: e?.message?.slice(0, 100) || 'Intentá de nuevo', type: 'error' });
      } finally {
        btn.classList.remove('shimmer');
        btn.dataset.busy = '0';
        btn.dataset.lastRun = String(Date.now());
      }
    });

    panel.querySelectorAll('#aiSportChips button').forEach(b => {
      b.addEventListener('click', () => {
        panel.querySelectorAll('#aiSportChips button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        state.filters.sport = b.dataset.sport;
        // Cambio de sport: si hay cache para ese sport, lo mostramos. Si no,
        // empty state con botón (NO auto-genera — política ahorro tokens).
        const cached = loadPicksCache(state.filters.sport, state.filters.advanced);
        if (cached) {
          state.combos = cached.combos;
          state.meta = cached.meta;
          state.lastLoadedAt = cached.savedAt;
          state.error = null;
          renderCombos(panel);
        } else {
          state.combos = [];
          state.meta = null;
          renderEmptyState(panel);
        }
      });
    });

    // Bankroll input — re-render combos al cambiar (cambia el stake $ recomendado)
    const bankInput = panel.querySelector('#aiBankroll');
    bankInput?.addEventListener('input', () => {
      const v = Math.max(1000, Number(bankInput.value) || 1000);
      saveBankroll(v);
      // Re-render solo los combos para actualizar stake $ + payout $
      renderCombos(panel);
      renderBankrollWidget(panel);
    });

    // Kelly slider
    const kSlider = panel.querySelector('#aiKellySlider');
    const kVal = panel.querySelector('#aiKellyVal');
    kSlider?.addEventListener('input', () => {
      const v = Number(kSlider.value);
      saveKelly(v);
      if (kVal) kVal.textContent = `${BSUI.pctInt(v, 0)}`;
      renderCombos(panel);
    });

    // Auto-refresh
    const arSel = panel.querySelector('#aiAutoRefresh');
    arSel?.addEventListener('change', () => {
      const sec = Number(arSel.value);
      saveAutoRefresh(sec);
      setupAutoRefresh(panel);
    });
    setupAutoRefresh(panel);

    // ─────── Filtros avanzados (cuota, tiempo, mercados) ───────
    // No re-cargan automáticamente — el user aprieta "Aplicar" para evitar
    // múltiples requests mientras tipea valores.
    const advReset = panel.querySelector('#aiAdvFiltersReset');
    const advApply = panel.querySelector('#aiAdvFiltersApply');
    const advOddMin = panel.querySelector('#aiAdvOddMin');
    const advOddMax = panel.querySelector('#aiAdvOddMax');
    const advTime   = panel.querySelector('#aiAdvTimeWindow');
    const advMkts   = panel.querySelector('#aiAdvMarkets');

    function readAdvancedFilters() {
      const marketsAllow = [...(advMkts?.querySelectorAll('input[type=checkbox][data-mkt]:checked') || [])]
        .map(i => i.dataset.mkt);
      return {
        oddMin: advOddMin?.value ? Number(advOddMin.value) : '',
        oddMax: advOddMax?.value ? Number(advOddMax.value) : '',
        timeWindowH: Number(advTime?.value || 36),
        marketsAllow
      };
    }

    function updateAdvFiltersBadge() {
      const f = state.filters.advanced;
      const badge = panel.querySelector('#aiAdvFiltersBadge');
      if (!badge) return;
      const active = [];
      if (f.oddMin && Number(f.oddMin) > 1) active.push(`cuota ≥ ${f.oddMin}`);
      if (f.oddMax && Number(f.oddMax) > 1) active.push(`cuota ≤ ${f.oddMax}`);
      if (f.timeWindowH && f.timeWindowH !== 36) active.push(`próximas ${f.timeWindowH}h`);
      if (f.marketsAllow?.length) active.push(`${f.marketsAllow.length} mercado${f.marketsAllow.length > 1 ? 's' : ''}`);
      badge.textContent = active.length ? `· ${active.join(' · ')}` : '';
    }
    updateAdvFiltersBadge();

    // Toggle chip visual cuando se hace click en el label (sin recargar)
    advMkts?.querySelectorAll('.bsai-advfilters__chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        // Si clickearon dentro del input, dejamos pasar el toggle nativo
        if (e.target.tagName === 'INPUT') return;
        const inp = chip.querySelector('input[type=checkbox]');
        if (inp) {
          inp.checked = !inp.checked;
          chip.classList.toggle('is-active', inp.checked);
          e.preventDefault();
        }
      });
    });

    advApply?.addEventListener('click', () => {
      const f = readAdvancedFilters();
      // Validación: si min > max, swap
      if (f.oddMin && f.oddMax && Number(f.oddMin) > Number(f.oddMax)) {
        [f.oddMin, f.oddMax] = [f.oddMax, f.oddMin];
        if (advOddMin) advOddMin.value = f.oddMin;
        if (advOddMax) advOddMax.value = f.oddMax;
      }
      state.filters.advanced = f;
      saveAdvancedFilters(f);
      updateAdvFiltersBadge();
      reload(panel);
    });

    advReset?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.filters.advanced = { oddMin: '', oddMax: '', timeWindowH: 36, marketsAllow: [] };
      saveAdvancedFilters(state.filters.advanced);
      if (advOddMin) advOddMin.value = '';
      if (advOddMax) advOddMax.value = '';
      if (advTime)   advTime.value = '36';
      advMkts?.querySelectorAll('input[type=checkbox][data-mkt]').forEach(i => {
        i.checked = false;
        i.closest('.bsai-advfilters__chip')?.classList.remove('is-active');
      });
      updateAdvFiltersBadge();
      reload(panel);
    });
  }

  function setupAutoRefresh(panel) {
    if (state.autoRefreshTimer) { clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null; }
    if (state.autoRefreshSec >= 60) {
      state.autoRefreshTimer = setInterval(() => {
        // SOLO regenera si el cache actual es viejo (>warn). Si el user puso
        // auto-refresh de 1min pero el cache tiene 30s, NO regeneramos —
        // sería derroche de tokens. Auto-refresh respeta thresholds de edad.
        if (state.loading) return;
        if (document.visibilityState !== 'visible') return;
        const cached = loadPicksCache(state.filters.sport, state.filters.advanced);
        const age = cached ? picksCacheAge(cached) : Infinity;
        if (age >= PICKS_AGE_WARN) reload(panel);
      }, state.autoRefreshSec * 1000);
    }
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
      const adv = state.filters.advanced || {};
      const res = await BSLive.getCuratedCombos({
        sport: state.filters.sport,
        count,
        oddMin: adv.oddMin && Number(adv.oddMin) > 1 ? Number(adv.oddMin) : null,
        oddMax: adv.oddMax && Number(adv.oddMax) > 1 ? Number(adv.oddMax) : null,
        timeWindowH: adv.timeWindowH || 36,
        marketsAllow: Array.isArray(adv.marketsAllow) && adv.marketsAllow.length ? adv.marketsAllow : null
      });
      state.combos = res.combos || [];
      state.meta = res.meta;
      state.error = null;
      state.lastLoadedAt = Date.now();
      // Persistir en cache para que entrar/salir del tab no regenere
      if (state.combos.length) {
        savePicksCache(state.filters.sport, state.filters.advanced, res);
      }
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

    // Brief del día removido (era el banner que loopeaba "Reintentando...")
    // renderInsightsBanner(panel);  // <- DISABLED 2026-05-17
    renderQuickStats(panel);
    renderBankrollWidget(panel);

    // Filter count viejo (compat)
    const fc = panel.querySelector('#aiFilterCount');
    if (fc && state.meta) {
      const m = state.meta;
      fc.textContent = m.analyzedEvents
        ? `${m.analyzedEvents} partidos · ${m.poolSize || 0} picks con valor`
        : (m.message || '—');
    }

    if (state.error) {
      host.innerHTML = `
        <div class="ai-empty-card">
          <div class="ai-empty-icon ai-empty-icon--err">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <strong>No pudimos cargar las combinadas</strong>
          <p class="muted tiny">${BSUI.esc(state.error)}</p>
          <button class="btn btn-primary btn-sm" id="aiRetry">Reintentar</button>
        </div>`;
      panel.querySelector('#aiRetry')?.addEventListener('click', () => reload(panel));
      return;
    }
    if (!state.combos.length) {
      const reason = state.meta?.reason;
      const message = state.meta?.message;
      host.innerHTML = `
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
      return;
    }
    const isVip = BSAuth.isVip();
    let html = renderAgeBanner() + state.combos.map((c, idx) => comboCardPro(c, idx)).join('');
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
    // Bind regenerar desde el banner de edad
    host.querySelector('#aiBannerRegen')?.addEventListener('click', async () => {
      const isVip = BSAuth.isVip();
      const count = isVip ? 6 : 3;
      // Confirmación si los picks son frescos — evita gasto innecesario de tokens
      const age = state.lastLoadedAt ? Date.now() - state.lastLoadedAt : Infinity;
      if (age < PICKS_AGE_OK) {
        const ok = confirm(`Los picks tienen ${fmtAge(age)} (muy recientes). ¿Igual querés regenerar? Cada generación consume tokens IA.`);
        if (!ok) return;
      }
      await reload(panel, count);
    });
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
    // Bind "Trackear combinada" — guarda el pick en localStorage para tracking
    host.querySelectorAll('[data-track-combo]').forEach(b => b.addEventListener('click', () => {
      try {
        const data = JSON.parse(b.dataset.trackCombo);
        const arr = trackedPicks();
        // Dedup por id
        if (!arr.some(p => p.id === data.id)) {
          arr.push(data);
          saveTrackedPicks(arr);
          BSUI.toast?.({ title: 'Pick guardado', message: `Lo vas a ver en "Mi tracking" abajo. Marcá el resultado cuando termine el partido.`, type: 'success' });
          renderBankrollWidget(panel);
        } else {
          BSUI.toast?.({ title: 'Ya está trackeado', type: 'info' });
        }
      } catch (e) {
        BSUI.toast?.({ title: 'No se pudo guardar', type: 'error' });
      }
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

  // ═════════════════════════════════════════════════════════════════════════
  // HELPERS UTILITARIOS
  // ═════════════════════════════════════════════════════════════════════════
  function formatRelTime(ts) {
    if (!ts) return 'recién';
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `hace ${sec}s`;
    if (sec < 3600) return `hace ${Math.floor(sec/60)}min`;
    if (sec < 86400) return `hace ${Math.floor(sec/3600)}h`;
    return `hace ${Math.floor(sec/86400)}d`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AGE BANNER — muestra cuándo se generaron los picks + recomendación de
  // regenerar según freshness. Política "ahorrar tokens": NO regeneramos
  // automáticamente cuando el user entra al tab, solo informamos la edad
  // y dejamos que él decida si quiere refresh.
  // ═════════════════════════════════════════════════════════════════════════
  function renderAgeBanner() {
    if (!state.lastLoadedAt) return '';
    const age = Date.now() - state.lastLoadedAt;
    const status = picksCacheStatus(age);
    const cfg = {
      fresh: { color: '#1f8a4c', bg: 'rgba(31,138,76,0.08)', icon: '✓', text: 'Picks frescos', recommend: '' },
      ok:    { color: '#3a6cd6', bg: 'rgba(58,108,214,0.08)', icon: '⏱', text: 'Generados',     recommend: '' },
      warn:  { color: '#c49a1a', bg: 'rgba(196,154,26,0.10)', icon: '⚠',  text: 'Hace un rato', recommend: 'Las cuotas pueden haber cambiado — conviene regenerar si vas a apostar ahora.' },
      old:   { color: '#c0392b', bg: 'rgba(192,57,43,0.10)',  icon: '🔴', text: 'Hace mucho',    recommend: 'Estos picks son viejos — regenerá para datos actualizados.' }
    }[status];
    return `
      <div class="ai-age-banner" style="background:${cfg.bg};border-left:3px solid ${cfg.color}">
        <div class="ai-age-banner__l">
          <span class="ai-age-banner__icon" style="color:${cfg.color}">${cfg.icon}</span>
          <div class="ai-age-banner__txt">
            <strong style="color:${cfg.color}">${cfg.text} ${fmtAge(age)}</strong>
            ${cfg.recommend ? `<span class="muted tiny">${cfg.recommend}</span>` : '<span class="muted tiny">Entrar y salir del tab no regenera (ahorra tokens IA). Usá el botón para regenerar cuando quieras.</span>'}
          </div>
        </div>
        <button class="btn btn-${status === 'old' || status === 'warn' ? 'primary' : 'outline'} btn-sm mag" id="aiBannerRegen">
          ${BSIcons.svg('refresh', { size: 14 })} Regenerar ahora
        </button>
      </div>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SMART INSIGHTS BANNER (deshabilitada — el call a renderInsightsBanner
  // está comentado en renderCombos pero la función queda por si se quiere
  // re-habilitar en el futuro con mejor manejo de fallos)
  // ═════════════════════════════════════════════════════════════════════════
  function renderInsightsBanner(panel) {
    const banner = panel.querySelector('#aiInsightsBanner');
    if (!banner) return;
    const insights = state.meta?.quickInsights || [];
    if (!insights.length) { banner.hidden = true; banner.innerHTML = ''; return; }
    banner.hidden = false;
    banner.innerHTML = `
      <div class="bsai-insights-banner__inner">
        <span class="bsai-insights-banner__icon">${BSIcons.svg('bolt', { size: 18 })}</span>
        <div class="bsai-insights-banner__content">
          <strong class="bsai-insights-banner__title">Lo que está pasando hoy</strong>
          <ul class="bsai-insights-banner__list">
            ${insights.map(i => `<li>${BSUI.esc(i)}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // QUICK STATS STRIP — 5 KPIs del día con sparkbar visual cada uno
  // ═════════════════════════════════════════════════════════════════════════
  function renderQuickStats(panel) {
    const strip = panel.querySelector('#aiQuickStats');
    if (!strip) return;
    const s = state.meta?.stats;
    if (!s || state.combos.length === 0) { strip.hidden = true; strip.innerHTML = ''; return; }
    strip.hidden = false;
    const evClass = s.avgEvPct > 4 ? 'is-positive' : s.avgEvPct > 0 ? 'is-neutral' : 'is-negative';
    const sharpClass = s.totalSharpMoves > 5 ? 'is-positive' : s.totalSharpMoves > 0 ? 'is-neutral' : '';
    strip.innerHTML = `
      <div class="bsai-stat-tile">
        <div class="bsai-stat-tile__num">${state.meta?.analyzedEvents || 0}</div>
        <div class="bsai-stat-tile__label">partidos analizados</div>
      </div>
      <div class="bsai-stat-tile">
        <div class="bsai-stat-tile__num">${s.combosCount}</div>
        <div class="bsai-stat-tile__label">combinadas curadas</div>
      </div>
      <div class="bsai-stat-tile ${evClass}">
        <div class="bsai-stat-tile__num">${Number.isFinite(s.avgEvPct) ? `${s.avgEvPct > 0 ? '+' : ''}${s.avgEvPct}%` : '—'}</div>
        <div class="bsai-stat-tile__label">EV promedio</div>
      </div>
      <div class="bsai-stat-tile ${sharpClass}">
        <div class="bsai-stat-tile__num">${Number.isFinite(s.totalSharpMoves) ? s.totalSharpMoves : '—'}</div>
        <div class="bsai-stat-tile__label">sharp moves activos</div>
      </div>
      <div class="bsai-stat-tile">
        <div class="bsai-stat-tile__num">${Number.isFinite(s.avgConfidence) ? `${s.avgConfidence}%` : '—'}</div>
        <div class="bsai-stat-tile__label">confianza promedio</div>
      </div>
      <div class="bsai-stat-tile">
        <div class="bsai-stat-tile__num">${Number.isFinite(s.ligasCount) ? s.ligasCount : '—'}</div>
        <div class="bsai-stat-tile__label">ligas representadas</div>
      </div>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // BANKROLL WIDGET — picks tracked + ROI histórico (localStorage)
  // ═════════════════════════════════════════════════════════════════════════
  function renderBankrollWidget(panel) {
    const w = panel.querySelector('#aiBankrollWidget');
    if (!w) return;
    const tracked = trackedPicks();
    const settled = tracked.filter(p => p.result != null);
    const wins = settled.filter(p => p.result === 'win').length;
    const losses = settled.filter(p => p.result === 'loss').length;
    const pendings = tracked.length - settled.length;
    const stakeTotal = settled.reduce((a, p) => a + (p.stake || 0), 0);
    const returnTotal = settled.reduce((a, p) => a + (p.result === 'win' ? (p.stake || 0) * (p.odd || 1) : 0), 0);
    const profit = returnTotal - stakeTotal;
    const roiPct = stakeTotal > 0 ? (profit / stakeTotal * 100) : 0;
    const profitClass = profit > 0 ? 'text-success' : profit < 0 ? 'text-danger' : 'muted';

    w.innerHTML = `
      <header class="bsai-bw__head">
        <div>
          <strong>Mi tracking de picks</strong>
          <p class="muted tiny" style="margin:2px 0 0">Guardás picks acá para ver cómo te fue después. Los datos viven en tu navegador.</p>
        </div>
        <div class="cluster" style="gap:8px">
          ${tracked.length > 0 ? `<button class="btn btn-ghost btn-sm" id="aiBwExport">Exportar CSV</button>` : ''}
          ${tracked.length > 0 ? `<button class="btn btn-ghost btn-sm" id="aiBwClear">Limpiar todo</button>` : ''}
        </div>
      </header>
      ${tracked.length === 0 ? `
        <p class="muted tiny" style="margin:14px 0 0">No tenés picks tracked todavía. Guardá una combinada con el botón "Trackear" en cualquier card.</p>
      ` : `
        <div class="bsai-bw__grid">
          <div class="bsai-bw__tile">
            <div class="bsai-bw__num">${tracked.length}</div>
            <div class="bsai-bw__lbl">picks totales</div>
          </div>
          <div class="bsai-bw__tile">
            <div class="bsai-bw__num">${pendings}</div>
            <div class="bsai-bw__lbl">pendientes</div>
          </div>
          <div class="bsai-bw__tile">
            <div class="bsai-bw__num text-success">${wins}</div>
            <div class="bsai-bw__lbl">ganados</div>
          </div>
          <div class="bsai-bw__tile">
            <div class="bsai-bw__num text-danger">${losses}</div>
            <div class="bsai-bw__lbl">perdidos</div>
          </div>
          <div class="bsai-bw__tile">
            <div class="bsai-bw__num ${profitClass}">${profit >= 0 ? '+' : ''}${BSUI.money(Math.abs(profit))}</div>
            <div class="bsai-bw__lbl">profit / loss</div>
          </div>
          <div class="bsai-bw__tile">
            <div class="bsai-bw__num ${profitClass}">${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%</div>
            <div class="bsai-bw__lbl">ROI</div>
          </div>
        </div>
        ${pendings > 0 ? `
          <details class="bsai-bw__pending">
            <summary><strong class="tiny">Marcar resultados de los ${pendings} pendientes</strong></summary>
            <div class="bsai-bw__pending-list">
              ${tracked.filter(p => p.result == null).slice(0, 12).map((p, i) => `
                <div class="bsai-bw__pending-row" data-pick-id="${BSUI.esc(p.id || '')}">
                  <span class="tiny" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>${BSUI.esc(p.title || `Pick ${i+1}`)}</strong> · cuota ${(p.odd||1).toFixed(2)}</span>
                  <button class="btn btn-ghost btn-sm" data-mark-result="win">✓ Ganó</button>
                  <button class="btn btn-ghost btn-sm" data-mark-result="loss">✗ Perdió</button>
                  <button class="btn btn-ghost btn-sm" data-mark-result="void">↻ Anulado</button>
                </div>
              `).join('')}
            </div>
          </details>
        ` : ''}
      `}
    `;

    // Bind: marcar resultados
    w.querySelectorAll('.bsai-bw__pending-row').forEach(row => {
      const pid = row.dataset.pickId;
      row.querySelectorAll('button[data-mark-result]').forEach(btn => {
        btn.addEventListener('click', () => {
          const result = btn.dataset.markResult;
          const arr = trackedPicks();
          const idx = arr.findIndex(p => p.id === pid);
          if (idx >= 0) {
            arr[idx].result = result;
            arr[idx].settledAt = Date.now();
            saveTrackedPicks(arr);
            renderBankrollWidget(panel);
            BSUI.toast?.({ title: result === 'win' ? '¡Ganada!' : result === 'loss' ? 'Perdida registrada' : 'Anulada', type: result === 'win' ? 'success' : 'info' });
          }
        });
      });
    });

    w.querySelector('#aiBwClear')?.addEventListener('click', () => {
      if (confirm('¿Borrar TODOS los picks tracked? No se puede deshacer.')) {
        saveTrackedPicks([]);
        renderBankrollWidget(panel);
      }
    });
    w.querySelector('#aiBwExport')?.addEventListener('click', () => {
      const arr = trackedPicks();
      const headers = ['fecha','title','odd','stake','result','settledAt','profit'];
      const rows = arr.map(p => [
        new Date(p.savedAt || Date.now()).toISOString(),
        (p.title || '').replace(/[",\n]/g, ' '),
        (p.odd || 0).toFixed(2),
        p.stake || 0,
        p.result || 'pending',
        p.settledAt ? new Date(p.settledAt).toISOString() : '',
        p.result === 'win' ? ((p.stake || 0) * ((p.odd || 1) - 1)).toFixed(0) : (p.result === 'loss' ? -(p.stake || 0) : 0)
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `betsafe-tracking-${Date.now()}.csv`; a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // MULTI-MODEL BAR — barras visuales mostrando 5 modelos por leg
  // (mercado, poisson, elo, llm, consensus). Resalta la convergencia.
  // ═════════════════════════════════════════════════════════════════════════
  function multiModelBar(probs) {
    if (!probs) return '';
    const models = [
      { key: 'market',   label: 'Mercado',   v: probs.market,   color: '#7a8b9e' },
      { key: 'poisson',  label: 'Goles esp.', v: probs.poisson,  color: '#3a6cd6' },
      { key: 'elo',      label: 'Forma',      v: probs.elo,      color: '#9b59b6' },
      { key: 'llm',      label: 'IA',         v: probs.llm,      color: '#1f8a4c' },
      { key: 'consensus', label: 'Consenso',  v: probs.consensus, color: '#c49a1a' }
    ].filter(m => Number.isFinite(m.v));
    if (!models.length) return '';
    const convergenceLabel = probs.modelConvergence === 'alta' ? 'modelos coinciden' :
                             probs.modelConvergence === 'baja' ? 'modelos discrepan' : 'consenso parcial';
    const convergenceColor = probs.modelConvergence === 'alta' ? '#1f8a4c' :
                             probs.modelConvergence === 'baja' ? '#c0392b' : '#c49a1a';
    return `
      <div class="bsai-mmbar">
        <div class="bsai-mmbar__head">
          <strong class="tiny">Probabilidad por modelo</strong>
          ${probs.modelConvergence ? `<span class="tiny" style="color:${convergenceColor}">● ${convergenceLabel}</span>` : ''}
        </div>
        <div class="bsai-mmbar__rows">
          ${models.map(m => `
            <div class="bsai-mmbar__row" title="${m.label}: ${BSUI.pctInt(m.v, 1)}${m.key === 'consensus' ? ' (ponderado)' : ''}">
              <span class="bsai-mmbar__label">${m.label}</span>
              <span class="bsai-mmbar__track">
                <span class="bsai-mmbar__fill" style="width:${BSUI.pctInt(m.v, 1)};background:${m.color}${m.key === 'consensus' ? ';box-shadow:0 0 8px ' + m.color + '88' : ''}"></span>
              </span>
              <strong class="bsai-mmbar__num num">${BSUI.pctInt(m.v, 0)}</strong>
            </div>
          `).join('')}
        </div>
        ${Number.isFinite(probs.valueGap) && Math.abs(probs.valueGap) > 0.5 ? `
          <p class="bsai-mmbar__gap"><strong style="color:${probs.valueGap > 0 ? '#1f8a4c' : '#c0392b'}">${probs.valueGap > 0 ? '+' : ''}${probs.valueGap.toFixed(1)}%</strong> ${probs.valueGap > 0 ? 'más probable de lo que dice la cuota' : 'menos probable que la cuota'}</p>
        ` : ''}
      </div>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LINE SHOPPING INLINE — barras horizontales con cada book y su cuota
  // ═════════════════════════════════════════════════════════════════════════
  function lineShopInline(bookOdds) {
    if (!bookOdds || !bookOdds.books || Object.keys(bookOdds.books).length < 2) return '';
    const sorted = Object.entries(bookOdds.books).sort((a, b) => b[1] - a[1]);
    const bookName = (k) => BSData.ALL_BOOKS?.find(b => b.key === k)?.name || k;
    const bookLogo = (k) => window.BSLogos ? BSLogos.bookLogo(k, { size: 14 }) : '';
    return `
      <details class="bsai-lineshop">
        <summary class="bsai-lineshop__summary">
          <span class="bsai-lineshop__icon">${BSIcons.svg('chart', { size: 14 })}</span>
          <span><strong>${bookOdds.bookCount} casas</strong> · mejor ${bookOdds.best.toFixed(2)} en <strong>${BSUI.esc(bookName(bookOdds.bestBook))}</strong>${bookOdds.edgePct >= 1 ? ` · <span style="color:#1f8a4c">+${bookOdds.edgePct.toFixed(1)}% vs peor</span>` : ''}</span>
        </summary>
        <div class="bsai-lineshop__rows">
          ${sorted.map(([book, odd]) => {
            const isBest = odd === bookOdds.best;
            const widthPct = bookOdds.best > 1 ? ((odd - 1) / (bookOdds.best - 1) * 100) : 100;
            return `
              <div class="bsai-lineshop__row${isBest ? ' is-best' : ''}">
                <span class="bsai-lineshop__book">${bookLogo(book)}<span>${BSUI.esc(bookName(book))}</span></span>
                <span class="bsai-lineshop__bar"><span class="bsai-lineshop__bar-fill" style="width:${widthPct}%"></span></span>
                <strong class="bsai-lineshop__odd num">${odd.toFixed(2)}</strong>
                ${isBest ? '<span class="bsai-lineshop__crown">★</span>' : ''}
              </div>
            `;
          }).join('')}
        </div>
      </details>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SPARKLINE — mini-chart SVG del movimiento de cuota desde primera vista
  // ═════════════════════════════════════════════════════════════════════════
  function sparkline(eventId, market, outcome, line, currentOdd) {
    if (!eventId || !currentOdd) return '';
    const key = `bs_clv_${eventId}_${market}_${outcome}_${line || ''}`;
    let history = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p.history)) history = p.history;
        else if (p.firstOdd) history = [{ ts: p.firstSeen || Date.now(), odd: p.firstOdd }];
      }
    } catch {}
    // Empujar el valor actual
    const now = Date.now();
    if (!history.length || (now - history[history.length-1].ts) > 60000) {
      history.push({ ts: now, odd: currentOdd });
      try {
        localStorage.setItem(key, JSON.stringify({
          firstOdd: history[0].odd,
          firstSeen: history[0].ts,
          lastOdd: currentOdd,
          history: history.slice(-20)  // máximo 20 puntos
        }));
      } catch {}
    }
    if (history.length < 2) return '';
    const first = history[0].odd;
    const last = currentOdd;
    const delta = last - first;
    const deltaPct = first > 0 ? (delta / first * 100) : 0;
    const min = Math.min(...history.map(h => h.odd));
    const max = Math.max(...history.map(h => h.odd));
    const range = (max - min) || 0.01;
    const W = 80, H = 22;
    const points = history.map((h, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = H - ((h.odd - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const color = delta > 0.01 ? '#1f8a4c' : delta < -0.01 ? '#c0392b' : '#7a8b9e';
    const arrow = delta > 0.01 ? '↑' : delta < -0.01 ? '↓' : '→';
    return `
      <span class="bsai-spark" title="Movimiento desde primera vista: ${first.toFixed(2)} → ${last.toFixed(2)} (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%)">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="${(W).toFixed(1)}" cy="${((H - ((last - min) / range) * (H - 4) - 2)).toFixed(1)}" r="2" fill="${color}"/>
        </svg>
        <span class="bsai-spark__label" style="color:${color}">${arrow} ${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%</span>
      </span>
    `;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // COMBO CARD PRO — la card principal rediseñada
  // ═════════════════════════════════════════════════════════════════════════
  function comboCardPro(c, idx) {
    const bookName = (k) => BSData.ALL_BOOKS?.find(b => b.key === k)?.name || k;
    const riskColor = c.risk === 'seguro' ? '#1f8a4c' : c.risk === 'agresivo' ? '#c49a1a' : '#3a6cd6';
    const riskLabel = c.risk === 'seguro' ? 'CONSERVADOR' : c.risk === 'agresivo' ? 'AGRESIVO' : 'EQUILIBRADO';

    // Stake calculation usando Kelly fraccionario
    const combinedProb = c.stats?.combinedProb || c.legs.reduce((p, l) => p * (l.confidence || 0.5), 1);
    const totalOdd = c.totalOdd;
    const b = totalOdd - 1;
    const q = 1 - combinedProb;
    const kellyFull = b > 0 ? (b * combinedProb - q) / b : 0;
    const kellyAdj = Math.max(0, Math.min(0.20, kellyFull * state.kellyFraction));
    const stakeRecommended = Math.round(state.bankroll * kellyAdj);
    const potentialPayout = stakeRecommended * totalOdd;
    const potentialProfit = potentialPayout - stakeRecommended;

    // Stats agregados
    const sharpAlerts = c.stats?.totalSharpMoves || 0;
    const lineEdgeAvg = c.legs.length ? (c.stats?.lineShopEdgePctSum / c.legs.length) : 0;

    const legsHtml = c.legs.map((l, i) => renderProLeg(l, i, riskColor)).join('');

    const trackData = JSON.stringify({
      id: `combo-${c.id || idx}-${Date.now()}`,
      title: c.legs.map(l => `${l.home}/${l.away} ${l.label}`).join(' + ').slice(0, 100),
      odd: totalOdd,
      stake: stakeRecommended,
      legCount: c.legCount,
      savedAt: Date.now(),
      result: null
    });

    return `
      <article class="bsai-pro-card reveal" data-combo-idx="${idx}" style="--risk:${riskColor}">
        <!-- HERO -->
        <header class="bsai-pro-card__hero">
          <div class="bsai-pro-card__hero-l">
            <div class="bsai-pro-card__title-row">
              <span class="bsai-pro-card__num">#${idx+1}</span>
              <strong class="bsai-pro-card__title">Combinada IA</strong>
              <span class="bsai-pill bsai-pill--risk" style="--c:${riskColor}">${riskLabel}</span>
              ${sharpAlerts > 0 ? `<span class="bsai-pill bsai-pill--sharp">📊 ${sharpAlerts} sharp move${sharpAlerts > 1 ? 's' : ''}</span>` : ''}
              ${c.marketsCount > 1 ? `<span class="bsai-pill bsai-pill--diverse">${c.marketsCount} mercados</span>` : ''}
            </div>
            <div class="bsai-pro-card__sub">
              <span>${c.legCount} legs</span>
              <span>·</span>
              <span>${c.sportsCount > 1 ? `${c.sportsCount} deportes` : (c.legs[0]?.sport || 'multi-deporte')}</span>
              <span>·</span>
              <span>Confianza ${BSUI.pctInt(c.avgConfidence, 0)}</span>
              <span>·</span>
              <span class="${c.avgEv > 0 ? 'text-success' : 'muted'}">EV ${c.avgEv > 0 ? '+' : ''}${c.avgEv.toFixed(1)}%</span>
            </div>
          </div>
          <div class="bsai-pro-card__hero-r">
            <div class="bsai-pro-card__odd">
              <span class="bsai-pro-card__odd-label">Cuota total</span>
              <strong class="bsai-pro-card__odd-num num">${totalOdd.toFixed(2)}</strong>
            </div>
          </div>
        </header>

        <!-- STAKE / PAYOUT BAR -->
        <div class="bsai-pro-card__money">
          <div class="bsai-pro-card__money-tile">
            <span class="bsai-pro-card__money-lbl">Stake recomendado <span class="muted tiny">(Kelly ${BSUI.pctInt(state.kellyFraction, 0)})</span></span>
            <strong class="bsai-pro-card__money-num">${BSUI.money(stakeRecommended)}</strong>
            <span class="muted tiny">${stakeRecommended > 0 ? `${(stakeRecommended/state.bankroll*100).toFixed(1)}% de tu banca` : 'EV insuficiente — no apostar'}</span>
          </div>
          <div class="bsai-pro-card__money-tile bsai-pro-card__money-tile--gain">
            <span class="bsai-pro-card__money-lbl">Si ganás</span>
            <strong class="bsai-pro-card__money-num text-success">${BSUI.money(potentialPayout)}</strong>
            <span class="muted tiny">profit: <strong class="text-success">+${BSUI.money(potentialProfit)}</strong></span>
          </div>
          <div class="bsai-pro-card__money-tile">
            <span class="bsai-pro-card__money-lbl">Probabilidad estimada</span>
            <strong class="bsai-pro-card__money-num">${BSUI.pctInt(combinedProb, 1)}</strong>
            <span class="muted tiny">prob. implícita: ${(100/totalOdd).toFixed(1)}%</span>
          </div>
        </div>

        <!-- NARRATIVA — 100% IA. Si null, mostramos placeholder explícito en lugar de texto genérico -->
        ${c.narrative ? `<div class="bsai-pro-card__narrative">
          <strong class="tiny" style="color:${riskColor}">💡 Por qué esta combinada</strong>
          <p>${BSUI.esc(c.narrative)}</p>
        </div>` : `<div class="bsai-pro-card__narrative" style="opacity:.7;border-left-color:#7a8b9e">
          <strong class="tiny" style="color:#7a8b9e">💭 Análisis IA en regeneración</strong>
          <p class="muted tiny" style="font-style:italic;margin:4px 0 0">Refrescá en unos segundos para ver el análisis personalizado de esta combinada.</p>
        </div>`}

        <!-- LEGS -->
        <div class="bsai-pro-card__legs">
          ${legsHtml}
        </div>

        <!-- EDGE + KEY FACTOR -->
        <div class="bsai-pro-card__insights">
          ${c.edge ? `<div class="bsai-pro-card__insight">
            <strong class="tiny" style="color:var(--gold-700,#c49a1a)">⚡ Edge vs mercado</strong>
            <p>${BSUI.esc(c.edge)}</p>
          </div>` : ''}
          ${c.keyFactor ? `<div class="bsai-pro-card__insight">
            <strong class="tiny">🎯 Factor clave a vigilar</strong>
            <p>${BSUI.esc(c.keyFactor)}</p>
          </div>` : ''}
        </div>

        <!-- ACTION FOOTER -->
        <footer class="bsai-pro-card__footer">
          <button class="btn btn-primary btn-sm" data-add-combo="${idx}">
            ${BSIcons.svg('plus', { size: 14 })} Agregar al builder
          </button>
          <button class="btn btn-outline btn-sm" data-track-combo='${BSUI.esc(trackData)}' title="Guardar este pick para ver cómo te fue después">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            Trackear
          </button>
          <button class="btn btn-ghost btn-sm" data-share-combo="${idx}">
            ${BSIcons.svg('share', { size: 14 })} Compartir
          </button>
          <span class="muted tiny" style="margin-left:auto">Generado ${state.meta?.generatedAt ? formatRelTime(state.meta.generatedAt) : 'recién'}</span>
        </footer>
      </article>
    `;
  }

  // Renderiza una leg PRO con multi-model bar + line shop + sparkline
  function renderProLeg(l, i, riskColor) {
    const bookName = (k) => BSData.ALL_BOOKS?.find(b => b.key === k)?.name || k;
    const home = { id: (l.home||'').toLowerCase().replace(/[^a-z]/g,''), name: l.home };
    const away = { id: (l.away||'').toLowerCase().replace(/[^a-z]/g,''), name: l.away };
    const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(home.id, { size: 22, name: l.home, sport: l.sport, league: l.leagueName || l.league }) : BSIcons.teamLogo(home, { size: 22, sport: l.sport });
    const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(away.id, { size: 22, name: l.away, sport: l.sport, league: l.leagueName || l.league }) : BSIcons.teamLogo(away, { size: 22, sport: l.sport });
    const bookLogo = window.BSLogos && l.book ? BSLogos.bookLogo(l.book, { size: 14 }) : '';
    const isAnalytical = !!l.analytical;
    const marketLabel = MARKET_LABELS[l.market] || l.market || '';

    return `
      <div class="bsai-pro-leg" style="--leg-color:${isAnalytical ? '#9b59b6' : riskColor}">
        <div class="bsai-pro-leg__head">
          <span class="bsai-pro-leg__num">${i+1}</span>
          <div class="bsai-pro-leg__teams">
            ${homeLogo}<strong>${BSUI.esc(l.home)}</strong>
            <span class="dim tiny">vs</span>
            <strong>${BSUI.esc(l.away)}</strong>${awayLogo}
          </div>
          <div class="bsai-pro-leg__odd-block">
            <strong class="num bsai-pro-leg__odd">${(l.odd || 0).toFixed(2)}</strong>
            ${isAnalytical
              ? `<span class="muted tiny" style="font-style:italic">cuota estimada</span>`
              : `<span class="cluster tiny" style="gap:3px">${bookLogo}<span class="muted">${BSUI.esc(bookName(l.book))}</span></span>`}
            ${sparkline(l.eventId, l.market, l.outcome, l.line, l.odd)}
          </div>
        </div>
        <div class="bsai-pro-leg__pick">
          <span class="bsai-pro-leg__label">${BSUI.esc(l.label)}${isAnalytical ? ' <span class="badge tiny" style="background:#9b59b6;color:white;padding:1px 5px;font-size:.6rem">ANÁLISIS IA</span>' : ''}</span>
          <span class="muted tiny">${marketLabel ? marketLabel + ' · ' : ''}${BSUI.esc(l.league || '')}${l.start ? ' · ' + BSUI.dt(l.start) : ''}</span>
        </div>
        ${l.modelProbs ? multiModelBar(l.modelProbs) : ''}
        ${l.bookOdds ? lineShopInline(l.bookOdds) : ''}
        ${l.sharpMoves && l.sharpMoves.length ? `
          <div class="bsai-pro-leg__sharp">
            <strong class="tiny">📊 Sharp moves</strong>
            ${l.sharpMoves.slice(0, 3).map(m => {
              const dir = (m.deltaPct || 0) > 0 ? '↑' : '↓';
              return `<span class="tiny" style="color:#cc6f00">${dir} ${Math.abs(m.deltaPct || 0).toFixed(1)}% en ${BSUI.esc(m.market || '?')}</span>`;
            }).join(' · ')}
          </div>
        ` : ''}
        ${l.rationale ? `<p class="muted tiny bsai-pro-leg__rationale">${BSUI.esc(l.rationale).slice(0, 220)}${l.rationale.length > 220 ? '…' : ''}</p>` : ''}
      </div>
    `;
  }

  // Catálogo compartido de market labels (compatible con la versión vieja)
  const MARKET_LABELS = {
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
    'totals-points': 'Total puntos', 'totals-points-team': 'Puntos por equipo',
    'totals-q1': 'Total 1Q', 'overtime': 'Prórroga',
    'player-points': 'Puntos jugador', 'player-rebounds': 'Rebotes jugador',
    'player-assists': 'Asistencias jugador',
    'tennis-totals-games': 'Total games', 'tennis-tiebreak': 'Tiebreak',
    'tennis-aces-total': 'Aces totales',
    'nfl-totals': 'Total puntos NFL', 'nfl-overtime': 'OT NFL',
    'hockey-totals': 'Total goles', 'hockey-totals-p1': 'Goles 1P',
    'mlb-totals': 'Total carreras', 'mlb-yrfi': '1ra entrada',
    'mma-rounds': 'Total rounds', 'mma-method': 'Método', 'mma-first-minute': '1er minuto',
    'esports-maps-total': 'Total mapas', 'esports-rounds-total': 'Total rondas',
    'esports-kills-total': 'Total kills',
    'corners': 'Córners', 'cards': 'Tarjetas'
  };

  // ─────────────────────────────────────────────────────────────────────
  // comboCard (LEGACY) — dejado solo por compatibilidad. comboCardPro lo
  // reemplaza para todos los renders nuevos.
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

    return `
      <article class="card card-pad-md ai-combo-card" data-combo-idx="${idx}" style="border-left:3px solid ${riskColor}">
        <header class="row between" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div class="cluster" style="gap:8px;flex-wrap:wrap">
            <strong style="font-size:1.05rem">Combinada IA #${idx+1}</strong>
            <span class="badge tiny" style="background:${riskColor};color:white;font-weight:700;letter-spacing:.04em">${riskLabel}</span>
            <span class="tiny muted">${c.legCount} legs${c.sportsCount > 1 ? ` · ${c.sportsCount} deportes` : ''}</span>
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

        <div class="row between" style="font-size:.72rem;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:10px">
          <div>
            <div class="muted">Confianza promedio</div>
            <strong>${BSUI.pctInt(c.avgConfidence, 0)}</strong>
          </div>
          <div>
            <div class="muted">Ventaja promedio</div>
            <strong class="${c.avgEv > 0 ? 'text-success' : 'muted'}">${c.avgEv > 0 ? '+' : ''}${c.avgEv.toFixed(1)}%</strong>
          </div>
          <div class="text-right">
            <div class="muted">Si ganás × $10.000</div>
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
    const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(ev.home.id, { size: 28, name: ev.home.name, sport: ev.sport, league: ev.leagueName || ev.league }) : BSIcons.teamLogo(ev.home, { size: 28, sport: ev.sport });
    const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(ev.away.id, { size: 28, name: ev.away.name, sport: ev.sport, league: ev.leagueName || ev.league }) : BSIcons.teamLogo(ev.away, { size: 28, sport: ev.sport });
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
            ${renderSharpBadge(analysis)}
            ${analysis.llmProvider && analysis.llmProvider !== 'offline'
              ? `<span class="badge badge-success tiny" title="Análisis con IA generativa (${BSUI.esc(analysis.llmProvider)})">Análisis IA · ${BSUI.esc(analysis.llmProvider)}</span>`
              : `<span class="badge badge-warning tiny" title="La IA generativa no está disponible en este momento. El análisis usa solo nuestros modelos estadísticos. Refrescá en 1 min para que la IA revise.">⚠ Análisis sin IA</span>`}
          </div>
        </header>

        ${renderSharpPanel(analysis)}
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
    // Safe: si conf es NaN/null, confPct = null y se renderiza '—%' → '—'
    const confPct = Number.isFinite(conf) ? Math.round(conf * 100) : null;
    const confLabel = confPct == null ? '—' : `${confPct}%`;
    const confLevel = confPct == null ? '' : (confPct >= 70 ? 'high' : confPct >= 50 ? '' : 'low');
    const confBarWidth = confPct == null ? 0 : confPct;

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
            <span>Confianza del modelo</span><strong>${confLabel}</strong>
          </div>
          <div class="bs-prem__conf-track">
            <div class="bs-prem__conf-fill ${confLevel ? 'bs-prem__conf-fill--' + confLevel : ''}" style="width:${confBarWidth}%"></div>
          </div>
        </div>
        ${probs.length ? `<div class="ai-probs">${probs.map(p => `<span class="ai-prob${p.highlight?' is-consensus':''}"><span class="muted tiny">${p.label}</span><strong>${BSUI.pctInt(p.v, 0)}</strong></span>`).join('')}</div>` : ''}
        <div class="ai-metrics-grid">
          ${s.valueGap != null ? `<div class="ai-metric" title="Cuán diferente es la probabilidad REAL de la probabilidad que sugiere la cuota. Positivo = la cuota está sobreestimando la dificultad — te conviene jugarla."><span class="muted tiny">Valor extra</span><strong class="${s.valueGap > 0 ? 'text-success' : 'muted'}">${s.valueGap > 0 ? '+' : ''}${s.valueGap.toFixed(1)}%</strong></div>` : ''}
          ${s.modelConvergence ? `<div class="ai-metric" title="Si los distintos modelos (estadístico, forma reciente, IA) coinciden en el pronóstico"><span class="muted tiny">Modelos</span><strong class="${s.modelConvergence === 'alta' ? 'text-success' : s.modelConvergence === 'baja' ? 'text-warning' : ''}">${s.modelConvergence === 'alta' ? 'coinciden' : s.modelConvergence === 'baja' ? 'discrepan' : 'parcial'}</strong></div>` : ''}
          ${s.kellyFractional ? `<div class="ai-metric" title="Cuánto de tu plata total te conviene apostar — calculado para crecer la banca sin riesgo de quemarla. Es conservador, podés apostar menos si querés."><span class="muted tiny">Apostá</span><strong>${BSUI.pctInt(s.kellyFractional, 1)} de tu plata</strong></div>` : ''}
        </div>
        ${s.rationale ? `<p class="muted tiny" style="margin-top:8px;line-height:1.4">${BSUI.esc(s.rationale).slice(0, 180)}${s.rationale.length > 180 ? '…' : ''}</p>` : ''}
        ${(s.warnings || []).length ? `<div class="cluster tiny" style="margin-top:6px;flex-wrap:wrap">${s.warnings.map(w => `<span class="badge badge-warning tiny">⚠ ${BSUI.esc(w)}</span>`).join('')}</div>` : ''}
        ${renderLineShopping(s, ev)}
        ${renderClvDelta(s, ev)}
        <button class="btn btn-primary btn-sm w-full" style="margin-top:10px" data-add-slip='${addPayload}'>${BSIcons.svg('plus',{size:14})} Agregar a la combinada</button>
      </div>
    `;
  }

  // ─────── Line shopping: tabla colapsada con cuotas de las 6 books ───────
  // Soporta s.bookOdds = { books: { bplay: 2.15, betano: 2.18, ... }, best, bestBook, edgePct }
  // generado por server.js → bookOddsForSelection() para el endpoint /api/picks.
  function renderLineShopping(s, ev) {
    const bo = s.bookOdds;
    if (!bo || !bo.books || Object.keys(bo.books).length < 2) return '';
    const sorted = Object.entries(bo.books).sort((a, b) => b[1] - a[1]);
    const bookName = (k) => BSData.ALL_BOOKS?.find(b => b.key === k)?.name || k;
    const bookLogo = (k) => window.BSLogos ? BSLogos.bookLogo(k, { size: 14 }) : '';
    const summary = bo.edgePct >= 1.5
      ? `<strong style="color:var(--success-700,#1e7a3e)">+${bo.edgePct.toFixed(1)}% extra</strong> apostando en <strong>${BSUI.esc(bookName(bo.bestBook))}</strong> vs la peor (${bo.worst.toFixed(2)})`
      : `Comparación de cuotas en ${bo.bookCount} casas`;
    return `
      <details class="ai-line-shop" style="margin-top:10px;background:rgba(30,75,200,0.04);border-left:3px solid var(--brand-500);padding:8px 10px;border-radius:6px;font-size:.78rem">
        <summary style="cursor:pointer;display:flex;align-items:center;gap:6px;font-weight:600">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
          Line shopping · ${summary}
        </summary>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr;gap:3px">
          ${sorted.map(([book, odd], i) => {
            const isBest = odd === bo.best;
            const diffPct = bo.best > 0 ? ((odd - bo.best) / bo.best * 100) : 0;
            return `
              <div class="row between" style="padding:4px 6px;background:${isBest ? 'rgba(30,160,80,0.12)' : 'transparent'};border-radius:4px">
                <span class="cluster" style="gap:6px">
                  ${bookLogo(book)}
                  <span class="${isBest ? '' : 'muted'}">${BSUI.esc(bookName(book))}</span>
                  ${isBest ? '<span class="badge badge-success tiny" style="font-size:.6rem;padding:1px 5px">MEJOR</span>' : ''}
                </span>
                <span class="cluster" style="gap:8px">
                  <strong class="num" style="${isBest ? 'color:var(--success-700,#1e7a3e)' : ''}">${odd.toFixed(2)}</strong>
                  ${!isBest ? `<span class="muted tiny" style="min-width:48px;text-align:right">${diffPct.toFixed(2)}%</span>` : '<span class="tiny" style="min-width:48px;text-align:right;color:var(--success-700,#1e7a3e)">+0.00%</span>'}
                </span>
              </div>
            `;
          }).join('')}
        </div>
        <p class="muted tiny" style="margin:8px 0 0;font-size:.7rem">Promedio: <strong>${bo.avg.toFixed(2)}</strong> · Implícita: <strong>${(100/bo.best).toFixed(1)}%</strong></p>
      </details>
    `;
  }

  // ─────── CLV tracker básico (client-side via localStorage) ───────
  // Cada vez que renderizamos un pick, guardamos { eventId+market+outcome+line: { firstSeen, firstOdd, lastOdd } }
  // en localStorage. Mostramos el delta vs la primera vez que vimos esa cuota.
  // Esto NO es CLV verdadero (closing line), pero da al usuario una señal de
  // "la cuota mejoró" / "empeoró" desde que lo vio por primera vez.
  function renderClvDelta(s, ev) {
    if (!s.odd || !ev?.id) return '';
    try {
      const key = `bs_clv_${ev.id}_${s.market}_${s.outcome}_${s.line || ''}`;
      const raw = localStorage.getItem(key);
      const now = Date.now();
      let firstSeen = now, firstOdd = s.odd, lastOdd = s.odd;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.firstOdd) {
            firstSeen = parsed.firstSeen || now;
            firstOdd = parsed.firstOdd;
            lastOdd = parsed.lastOdd || s.odd;
          }
        } catch {}
      }
      // Actualizamos lastOdd con la cuota actual
      localStorage.setItem(key, JSON.stringify({ firstSeen, firstOdd, lastOdd: s.odd, updated: now }));
      const delta = s.odd - firstOdd;
      const deltaPct = firstOdd > 0 ? (delta / firstOdd * 100) : 0;
      const ageMin = (now - firstSeen) / 60000;
      // Solo mostramos si pasó >5min Y el cambio es significativo (>0.5%)
      if (ageMin < 5 || Math.abs(deltaPct) < 0.5) return '';
      const dir = delta > 0 ? '↑' : '↓';
      const cls = delta > 0 ? 'text-success' : 'text-warning';
      const ageLabel = ageMin > 60 ? `${(ageMin/60).toFixed(1)}h` : `${Math.round(ageMin)}min`;
      return `
        <div class="row between tiny" style="margin-top:6px;padding:5px 8px;background:var(--surface-2);border-radius:5px">
          <span class="muted">Movimiento desde que la viste (hace ${ageLabel}):</span>
          <strong class="${cls}">${dir} ${firstOdd.toFixed(2)} → ${s.odd.toFixed(2)} (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%)</strong>
        </div>
      `;
    } catch { return ''; }
  }

  // ─────── Sharp money badge en el header del pick ───────
  function renderSharpBadge(analysis) {
    const score = Number(analysis?.sharpScore || analysis?.factors?.sharp?.score || 0);
    const moves = Number(analysis?.sharpMovesCount || analysis?.factors?.sharp?.steamMoves?.length || 0);
    if (score < 0.3 && moves === 0) return '';
    const lvl = score >= 0.7 ? 'fuerte' : score >= 0.45 ? 'moderado' : 'leve';
    const cls = score >= 0.7 ? 'badge-warning' : 'badge-tertiary';
    const title = `Detectamos ${moves} movimiento(s) de cuota >5% en la última hora — el dinero "sharp" (apostadores informados) se está moviendo. Nivel: ${lvl}.`;
    return `<span class="badge ${cls} tiny" title="${title}">📊 Sharp money · ${lvl}</span>`;
  }

  // ─────── Panel sharp money expandido (si hay steam moves específicos) ───────
  function renderSharpPanel(analysis) {
    const moves = analysis?.factors?.sharp?.steamMoves || [];
    const score = Number(analysis?.sharpScore || analysis?.factors?.sharp?.score || 0);
    if (!moves.length || score < 0.4) return '';
    const top = moves.slice(0, 3);
    return `
      <div class="card card-pad-sm" style="background:linear-gradient(90deg, rgba(255,165,0,0.08), rgba(255,140,0,0.04));border-left:3px solid #ff8c00;margin:10px 0">
        <div class="row between" style="margin-bottom:6px">
          <strong class="tiny" style="color:#cc6f00">📊 Movimientos sharp detectados</strong>
          <span class="tiny muted">Última hora</span>
        </div>
        ${top.map(m => {
          const dir = (m.deltaPct || 0) > 0 ? '↑' : '↓';
          const pct = Math.abs(Number(m.deltaPct) || 0).toFixed(1);
          return `<div class="row between tiny" style="padding:3px 0">
            <span><strong>${BSUI.esc(m.market || '?')}</strong> · ${BSUI.esc(m.outcome || '?')}</span>
            <span style="color:#cc6f00"><strong>${dir} ${pct}%</strong></span>
          </div>`;
        }).join('')}
        ${moves.length > 3 ? `<p class="muted tiny" style="margin:4px 0 0">+ ${moves.length - 3} movimiento${moves.length - 3 > 1 ? 's' : ''} más</p>` : ''}
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
      items.push(`<span class="ai-factor ${cls}"><span class="ai-factor-ic">💰</span><strong class="tiny">Sharp money</strong><span class="muted tiny">${BSUI.pctInt(sharp, 0)}</span></span>`);
    } else {
      items.push(`<span class="ai-factor ai-factor-na"><span class="ai-factor-ic">💰</span><strong class="tiny">Sharp money</strong><span class="muted tiny">sin señal</span></span>`);
    }

    // Histórico H2H
    if (f.historical && !f.historical.unavailable && f.historical.h2h?.matches > 0) {
      const h = f.historical.h2h;
      items.push(`<span class="ai-factor"><span class="ai-factor-ic">📊</span><strong class="tiny">H2H</strong><span class="muted tiny">${h.matches} partidos · local ${BSUI.pctInt(h.homeWinRate, 0)}</span></span>`);
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
          <div><span class="muted tiny">H2H (${h.matches})</span><div>${BSUI.pctInt(h.homeWinRate, 0)} / ${BSUI.pctInt(h.drawRate, 0)} / ${BSUI.pctInt(h.awayWinRate, 0)}</div></div>
          <div><span class="muted tiny">Goles avg H2H</span><div class="num">${h.avgGoals?.toFixed(2)}</div></div>
          <div><span class="muted tiny">BTTS H2H</span><div class="num">${BSUI.pctInt(h.bttsRate, 0)}</div></div>
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
        <div class="row between"><span class="muted tiny">Score</span><strong class="num">${BSUI.pctInt(f.sharp.score, 0)}</strong></div>
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
          <div><span class="muted tiny">Ventaja sobre la casa</span><div class="tiny">${(q.ev || []).map(v => (v > 0 ? '+' : '') + BSUI.pctRaw(v, 2)).join(' / ')}</div></div>
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
