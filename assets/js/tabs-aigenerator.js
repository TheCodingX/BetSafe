/* BetSafe — Quant IA (sección VIP completa)
 * ────────────────────────────────────────────────────────────────────
 * Spec del usuario:
 *  • Elegir un deporte
 *  • Elegir una o múltiples ligas (más ligas = mayor efectividad)
 *  • Nivel de riesgo: Conservador / Intermedio / Agresivo
 *  • Cantidad de combinadas: Standard ≤ 2, VIP ilimitado
 *  • Mercados: NO solo 1X2 — incluye goles, BTTS, hándicap, corners, tarjetas
 *  • Por cada combinada: 3 casas argentinas que mejor pagan + soportan los
 *    mercados usados, con cuota total y ganancia estimada en ARS
 */
(function () {
  'use strict';

  async function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `
        <div class="card card-vip card-pad-lg stack reveal" style="text-align:center">
          <span class="badge-vip" style="align-self:center">VIP · Quant IA Pro</span>
          <h2 class="h3">Quant IA es exclusivo VIP</h2>
          <p class="muted" style="max-width:560px;margin:0 auto">
            El motor cuántico que genera combinadas óptimas del día con todos los mercados disponibles
            (goles, corners, tarjetas, hándicap, BTTS, doble oportunidad), seleccionando las 3 casas
            argentinas que mejor pagan cada combinada específica.
          </p>
          <div class="row" style="justify-content:center;gap:8px">
            <a href="pricing.html" class="btn btn-premium btn-lg">Pasar a VIP</a>
            <a href="login.html" class="btn btn-outline btn-lg">Probar demo VIP</a>
          </div>
        </div>`;
      return;
    }

    // Esperar al primer snapshot del backend si todavía no lo tenemos
    if (!BSData.liveReady()) {
      panel.innerHTML = `<div class="card stack" style="min-height:240px;padding:40px;text-align:center"><strong>Cargando partidos en vivo…</strong><p class="muted tiny">Recibiendo cuotas reales de las casas argentinas legales.</p><span class="muted tiny">${BSData.liveFreshness()}</span></div>`;
      await BSData.awaitLive({ timeoutMs: 12000 });
    }
    const matches = BSData.liveEvents({});
    // 9 deportes — incluye eSports como categoría independiente.
    const SPORTS = (BSData.SPORTS || []).slice(0, 9);
    const LEAGUES = BSData.LEAGUES || [];
    const COVER = BSData.BOOK_MARKET_COVERAGE || {};
    const M = { h2h:'1X2', dc:'Doble Oport.', totals:'Goles O/U', btts:'BTTS', ah:'Hándicap', corners:'Corners', cards:'Tarjetas' };
    const M_ICON = { h2h:'⚖', dc:'2x', totals:'⚽', btts:'≡', ah:'±', corners:'⌐', cards:'▢' };

    panel.innerHTML = `
      <header class="bs-ai-tab-header bs-ai-tab-header--quant" role="banner">
        <div class="bs-ai-tab-header__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
        </div>
        <div class="bs-ai-tab-header__text">
          <span class="bs-ai-tab-header__eyebrow">Motor IA · wizard configurable</span>
          <h2 class="bs-ai-tab-header__title">Constructor Quant</h2>
          <p class="bs-ai-tab-header__desc">Vos elegís casinos, mercados y riesgo en 4 pasos. La IA analiza y arma combinadas que cumplen tus filtros exactos — con la casa que mejor paga cada leg.</p>
        </div>
        <div class="bs-ai-tab-header__alts">
          <a href="#ai" class="bs-ai-tab-header__alt" title="¿Querés que la IA elija todo por vos? Probá AI Picks">⚡ AI Picks</a>
          <a href="#betsafeai" class="bs-ai-tab-header__alt" title="¿Preferís pedirlo en lenguaje natural? Probá Coach IA">💬 Coach IA</a>
        </div>
      </header>
      <header class="agx-hero reveal">
        <div class="agx-hero__main">
          <span class="badge-vip agx-hero__chip">VIP · Quant IA</span>
          <h2 class="agx-hero__title">Configurá tus criterios en 4 pasos</h2>
          <p class="agx-hero__sub">Elegí casas, mercados, riesgo, y la IA arma combinadas optimizadas con la casa argentina que mejor paga cada una.</p>
        </div>
        <div class="agx-hero__steps" aria-hidden="true">
          <span class="agx-step is-active" data-step="1"><span class="agx-step__n">1</span><span class="agx-step__t">Casinos</span></span>
          <span class="agx-step" data-step="2"><span class="agx-step__n">2</span><span class="agx-step__t">Mercados</span></span>
          <span class="agx-step" data-step="3"><span class="agx-step__n">3</span><span class="agx-step__t">Riesgo</span></span>
          <span class="agx-step" data-step="4"><span class="agx-step__n">4</span><span class="agx-step__t">Generar</span></span>
        </div>
      </header>

      <!-- Step 1 — CASINOS (PRIMERO, todos desmarcados por defecto) -->
      <section class="agx-card reveal agx-card--books" data-step="1">
        <header class="agx-card__head">
          <span class="agx-card__n">1</span>
          <h3 class="agx-card__title">¿En qué casas apostás?</h3>
          <span class="agx-card__hint">Marcá solo las casas donde tenés cuenta</span>
          <span class="agx-card__badge" id="agBooksCount">0 seleccionadas</span>
        </header>
        <p class="muted tiny" style="margin:0 0 12px">La IA analiza cuotas <strong>solo de las casas que marques</strong> y te dice cuál paga más por tu combinada exacta. Si no marcás ninguna, te avisamos para no generar resultados inútiles.</p>
        <div class="agx-books-grid" id="agBooksFilter">
          ${(BSData.BOOKS_AR || []).map(b => `
            <label class="agx-book-card" data-book-key="${b.key}">
              <input type="checkbox" data-book="${b.key}" hidden>
              <span class="agx-book-logo">${window.BSLogos ? BSLogos.bookLogo(b.key, { size: 36 }) : ''}</span>
              <span class="agx-book-name">${BSUI.esc(b.name)}</span>
              <span class="agx-book-license tiny muted">${b.license}</span>
              <span class="agx-book-tick" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-11"/></svg>
              </span>
            </label>`).join('')}
        </div>
        <div class="row gap-2 mt-2" style="flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" id="agBooksAll">Seleccionar todas</button>
          <button type="button" class="btn btn-ghost btn-sm" id="agBooksNone">Limpiar selección</button>
        </div>
      </section>

      <!-- Step 2 — MERCADOS / Opciones de apuesta (todas marcadas por defecto) -->
      <section class="agx-card reveal" data-step="2">
        <header class="agx-card__head">
          <span class="agx-card__n">2</span>
          <h3 class="agx-card__title">¿Qué tener en cuenta para las apuestas?</h3>
          <span class="agx-card__hint">Destildá solo las opciones que NO querés usar</span>
        </header>
        <div class="ag-advanced-grid">
          <fieldset class="ag-mkt-set ag-mkt-set--full">
            <legend class="field-label">Mercados a considerar</legend>
            ${[
              {
                title:'⚽ Resultado',
                items:[
                  ['h2h','Resultado (1X2)'],
                  ['dc','Doble oportunidad'],
                  ['dnb','Empate no apuesta'],
                  ['ht-result','Resultado al descanso'],
                  ['first-team-score','Equipo que marca 1ro']
                ]
              },
              {
                title:'⚽ Hándicap',
                items:[
                  ['ah','Hándicap asiático']
                ]
              },
              {
                title:'⚽ Goles',
                items:[
                  ['totals','Más / Menos goles'],
                  ['totals-ht','Goles al descanso'],
                  ['btts','Ambos equipos marcan'],
                  ['result-btts','Resultado + Ambos marcan'],
                  ['exact-score','Marcador exacto']
                ]
              },
              {
                title:'⚽ Goleadores',
                items:[
                  ['goalscorer-anytime','Goleador anytime'],
                  ['first-goalscorer','Primer goleador']
                ]
              },
              {
                title:'⚽ Tarjetas / Disciplina',
                items:[
                  ['cards-total','Total de tarjetas'],
                  ['red-card','Habrá tarjeta roja'],
                  ['penalty','Habrá penal'],
                  ['fouls-total','Faltas totales']
                ]
              },
              {
                title:'⚽ Córners',
                items:[
                  ['corners-total','Total de córners'],
                  ['corners-ht','Córners 1er tiempo'],
                  ['corners-team','Córners por equipo']
                ]
              },
              {
                title:'⚽ Tiros',
                items:[
                  ['shots-on-target-total','Tiros al arco totales']
                ]
              },
              {
                title:'🏀 Básquet',
                items:[
                  ['totals-points','Total puntos'],
                  ['totals-points-team','Puntos por equipo'],
                  ['totals-q1','Total 1Q'],
                  ['overtime','Prórroga'],
                  ['player-points','Puntos jugador'],
                  ['player-rebounds','Rebotes jugador'],
                  ['player-assists','Asistencias jugador']
                ]
              },
              {
                title:'🎾 Tenis',
                items:[
                  ['tennis-totals-games','Total games'],
                  ['tennis-tiebreak','Tiebreak'],
                  ['tennis-aces-total','Aces totales']
                ]
              },
              {
                title:'🏈🏒⚾ NFL/NHL/MLB',
                items:[
                  ['nfl-totals','NFL: Total puntos'],
                  ['hockey-totals','NHL: Total goles'],
                  ['mlb-totals','MLB: Total carreras'],
                  ['mlb-yrfi','MLB: Carrera 1ra entrada']
                ]
              },
              {
                title:'🥊🎮 MMA / eSports',
                items:[
                  ['mma-rounds','MMA: pasa rounds'],
                  ['mma-method','MMA: método'],
                  ['esports-maps-total','eSports: total mapas'],
                  ['esports-rounds-total','eSports: rondas CS/Val']
                ]
              }
            ].map(group => `
              <div class="ag-mkt-group">
                <span class="ag-mkt-group-title">${group.title}</span>
                <div class="ag-mkt-chips">
                  ${group.items.map(([k, lbl]) => `
                    <label class="ag-mkt-chip is-on">
                      <input type="checkbox" data-mkt="${k}" checked hidden>
                      <span>${BSUI.esc(lbl)}</span>
                    </label>`).join('')}
                </div>
              </div>`).join('')}
          </fieldset>

          <div class="ag-toggle-grid">
            <label class="ag-toggle">
              <input type="checkbox" id="agUseInjuries" checked>
              <span>Filtrar por lesiones reportadas</span>
            </label>
            <label class="ag-toggle">
              <input type="checkbox" id="agUseWeather" checked>
              <span>Considerar clima (impacto en O/U y córners)</span>
            </label>
            <label class="ag-toggle">
              <input type="checkbox" id="agUseSmart">
              <span>Priorizar partidos con movimiento sharp <em class="muted tiny">(restrictivo — muchos partidos no tienen sharp)</em></span>
            </label>
            <label class="ag-toggle">
              <input type="checkbox" id="agAvoidCorr" checked>
              <span>Evitar legs correlacionadas (mismo evento)</span>
            </label>
          </div>

          <div class="row gap-2" style="flex-wrap:wrap;align-items:flex-end">
            <label class="field" style="margin:0;min-width:170px">
              <span class="field-label">Deporte</span>
              <div class="cluster agx-chip-row" id="agSportChips" style="margin-top:6px">
                <button type="button" class="league-chip active" data-sport="all">${BSIcons.svg('soccer',{size:14})}<span>Todos</span></button>
                ${SPORTS.map(s => `<button type="button" class="league-chip${s.accent ? ' is-' + s.accent : ''}" data-sport="${s.key}" title="${s.key === 'esports' ? 'Apuestas sobre videojuegos competitivos (CS2, LoL, Dota 2, Valorant)' : BSUI.esc(s.name)}">${BSIcons.svg(s.icon||'soccer',{size:14})}<span>${BSUI.esc(s.name)}</span></button>`).join('')}
              </div>
            </label>
          </div>

          <div>
            <span class="field-label" style="display:block;margin-bottom:6px">Ligas (opcional — vacío = todas las del deporte elegido)</span>
            <div class="cluster agx-chip-row" id="agLeagueChips">
              <button type="button" class="league-chip active" data-lg="all"><span>Todas</span></button>
              ${LEAGUES.slice(0, 14).map(l => {
                const logo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(l.key, { size: 14 }) : '';
                return `<button type="button" class="league-chip" data-lg="${l.key}">${logo}<span>${BSUI.esc(l.name)}</span></button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </section>

      <!-- Step 3 — Riesgo -->
      <section class="agx-card reveal" data-step="3">
        <header class="agx-card__head">
          <span class="agx-card__n">3</span>
          <h3 class="agx-card__title">Nivel de riesgo</h3>
        </header>
        <div class="risk-cards" role="radiogroup" aria-label="Nivel de riesgo">
          ${[
            {
              v:'cons', label:'Conservador', desc:'Cuotas 1.10 – 1.40', tone:'cons',
              hint:'Alta chance, premio chico',
              icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>'
            },
            {
              v:'eq', label:'Equilibrado', desc:'Cuotas 1.40 – 2.30', tone:'eq',
              hint:'Balance riesgo / premio',
              icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 8h14"/><path d="M5 8l-2 5a3 3 0 0 0 6 0L7 8"/><path d="M19 8l-2 5a3 3 0 0 0 6 0l-2-5"/></svg>'
            },
            {
              v:'agg', label:'Agresivo', desc:'Cuotas 2.30+', tone:'agg',
              hint:'Alta cuota, mayor riesgo',
              icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>'
            }
          ].map((o, i) => `
            <button type="button" class="risk-card risk-card--${o.tone}${i===1?' is-selected':''}" role="radio" aria-checked="${i===1}" data-risk="${o.v}" tabindex="${i===1?0:-1}">
              <span class="risk-card-head">
                <span class="risk-card-icon">${o.icon}</span>
                <span class="risk-card-tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l5 5 9-11"/></svg></span>
              </span>
              <strong class="risk-card-label">${o.label}</strong>
              <span class="risk-card-desc">${o.desc}</span>
              <span class="risk-card-hint">${o.hint}</span>
            </button>`).join('')}
        </div>
      </section>

      <!-- Step 4 — Configuración + Generar -->
      <section class="agx-card reveal" data-step="4">
        <header class="agx-card__head">
          <span class="agx-card__n">4</span>
          <h3 class="agx-card__title">Configurá y generá</h3>
        </header>
        <div class="agx-config">
          <div class="agx-config__item">
            <span class="agx-config__label">Legs por combinada</span>
            <select class="select agx-config__select" id="agLegs">
              <option value="2">2 legs</option>
              <option value="3" selected>3 legs</option>
              <option value="4">4 legs</option>
              <option value="5">5 legs</option>
              <option value="6">6 legs</option>
              <option value="8">8 legs (alto riesgo)</option>
              <option value="10">10 legs (extremo)</option>
            </select>
          </div>
          <div class="agx-config__item">
            <span class="agx-config__label">Legs por partido</span>
            <select class="select agx-config__select" id="agLegsPerMatch" title="Cuántas apuestas distintas podés tomar del mismo partido (por ejemplo: resultado + total de goles). Más apuestas del mismo partido pagan más pero son más arriesgadas porque dependen del mismo encuentro.">
              <option value="1" selected>1 (clásico)</option>
              <option value="2">2 (multi-mercado)</option>
              <option value="3">3 (avanzado)</option>
            </select>
          </div>
          <div class="agx-config__item">
            <span class="agx-config__label">Cantidad a generar</span>
            <div class="num-stepper" data-stepper="agcount">
              <button type="button" class="num-stepper-btn" data-step="-" aria-label="−"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
              <input class="num-stepper-input" id="agCount" type="text" inputmode="numeric" pattern="[0-9]*" value="3" />
              <button type="button" class="num-stepper-btn" data-step="+" aria-label="+"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
          </div>
          <div class="agx-config__item">
            <span class="agx-config__label">Monto a apostar (ARS)</span>
            <div class="num-stepper" data-stepper="agstake">
              <button type="button" class="num-stepper-btn" data-step="-" aria-label="−"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
              <input class="num-stepper-input" id="agStake" type="text" inputmode="numeric" pattern="[0-9]*" value="10000" />
              <button type="button" class="num-stepper-btn" data-step="+" aria-label="+"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
          </div>
          <div class="agx-config__item">
            <span class="agx-config__label">Cuota objetivo (opcional)</span>
            <input class="input agx-config__select" id="agTargetOdd" type="number" step="0.5" min="0" placeholder="ej: 12.0" title="Cuota total que querés que pague la combinada. Dejá vacío y la IA elige las mejores apuestas sin importar la cuota final."/>
          </div>
          <div class="agx-config__item" style="grid-column:span 2">
            <label class="ag-toggle" style="cursor:pointer">
              <input type="checkbox" id="agUseAiBuilder" checked>
              <span><strong>IA arma las combinadas</strong> · La IA elige apuestas que se complementen entre sí, dónde la cuota está más floja y dónde el mercado está moviéndose a tu favor. <em class="muted tiny">Recomendado.</em></span>
            </label>
          </div>
          <div class="agx-config__item">
            <label class="ag-toggle" style="cursor:pointer">
              <input type="checkbox" id="agMixSports" checked>
              <span>Mezclar deportes</span>
            </label>
          </div>
          <!-- hidden — mantienen IDs para no romper handlers existentes -->
          <input type="hidden" id="agMinEv" value="5">
          <input type="hidden" id="agTimeWindow" value="24">
          <input type="hidden" id="agKelly" value="0.5">
        </div>
      </section>

      <!-- Action — botón hero -->
      <section class="agx-action reveal">
        <div class="agx-action__info">
          <span class="agx-action__status" id="agStatusLine">Listo para generar</span>
          <span class="agx-action__hint">La IA arma las combinadas óptimas en segundos</span>
        </div>
        <div class="agx-action__btns">
          <button class="btn btn-outline" id="agReset">Reiniciar</button>
          <button class="btn btn-primary mag agx-action__cta" id="agGenerate">
            ${BSIcons.svg('bolt',{size:16})}
            <span class="ag-gen-label">Generar combinadas</span>
          </button>
        </div>
        <!-- Engine "thinking" sequence -->
        <div class="ag-engine" id="agEngine" hidden aria-live="polite">
          <div class="ag-engine-bar"><div class="ag-engine-bar-fill"></div></div>
          <ul class="ag-engine-steps">
            <li data-step="fetch">Trayendo cuotas live de las casas LOTBA</li>
            <li data-step="filter">Filtrando partidos por tu criterio</li>
            <li data-step="model">Análisis táctico de cada partido</li>
            <li data-step="ev">Calculando cuánto podés ganar en cada apuesta</li>
            <li data-step="match">Optimizando combinadas</li>
            <li data-step="books">Identificando casas que mejor pagan</li>
          </ul>
        </div>
      </section>

      <!-- Output (sin reveal-stagger porque las cards se inyectan dinámicamente y
           el IntersectionObserver inicial no las observa → quedarían invisibles) -->
      <div id="agOutput"></div>
    `;

    // ─────── State ───────
    let activeSport = 'all';
    let activeLeagues = new Set(['all']);
    let activeRisk = 'eq';

    // Toggle chips de mercados / casas en filtros avanzados
    panel.addEventListener('change', e => {
      const cb = e.target.closest('.ag-mkt-chip input[type=checkbox]');
      if (cb) cb.closest('.ag-mkt-chip').classList.toggle('is-on', cb.checked);
    });

    // ─────── Helpers ───────
    function applyFilters() {
      let list = matches;
      if (activeSport !== 'all') list = list.filter(m => m.sport === activeSport);
      if (!activeLeagues.has('all')) list = list.filter(m => activeLeagues.has(m.league));
      return list;
    }
    function updateStatus() {
      const list = applyFilters();
      const sportTxt = activeSport === 'all' ? 'Todos los deportes' : (BSData.SPORTS.find(s=>s.key===activeSport)?.name || activeSport);
      const lgTxt = activeLeagues.has('all') ? 'todas las ligas' : `${activeLeagues.size} liga${activeLeagues.size>1?'s':''}`;
      panel.querySelector('#agStatusLine').textContent = `${sportTxt} · ${lgTxt} · ${list.length} partidos · riesgo ${activeRisk==='cons'?'conservador':activeRisk==='eq'?'intermedio':'agresivo'}`;
      // #agLeagueCount es opcional — algunos layouts no lo incluyen
      const lgCountEl = panel.querySelector('#agLeagueCount');
      if (lgCountEl) lgCountEl.textContent = activeLeagues.has('all') ? 'Todas' : `${activeLeagues.size} seleccionada${activeLeagues.size>1?'s':''}`;
      // ── GATED PROGRESS: marcar pasos como done según el usuario va completando ──
      updateStepProgress();
    }

    /* Actualiza el estado visual de los 4 pasos del header (CASINOS/MERCADOS/RIESGO/GENERAR).
     * - Paso 1 (Casinos): done si hay al menos 1 casa marcada
     * - Paso 2 (Mercados): done si hay al menos 1 mercado marcado + Paso 1 done
     * - Paso 3 (Riesgo): siempre done (default 'eq') + Paso 2 done
     * - Paso 4 (Generar): is-active cuando 1+2+3 done; is-disabled si no
     * Bloquea visualmente steps siguientes con menos opacidad cuando los anteriores no se completaron.
     */
    function updateStepProgress() {
      const steps = [...panel.querySelectorAll('.agx-step')];
      if (!steps.length) return;
      const hasBooks = panel.querySelectorAll('#agBooksFilter input[type=checkbox]:checked').length > 0;
      const hasMarkets = panel.querySelectorAll('.ag-mkt-chip input[type=checkbox][data-mkt]:checked').length > 0;
      const hasRisk = !!activeRisk;

      const stepStates = [
        hasBooks,                                  // step 1
        hasBooks && hasMarkets,                    // step 2 requires step 1
        hasBooks && hasMarkets && hasRisk,         // step 3 requires step 2
        hasBooks && hasMarkets && hasRisk          // step 4 enabled when all done
      ];
      // El "current" step es el primero NO done
      let current = stepStates.findIndex(s => !s);
      if (current === -1) current = stepStates.length - 1;
      steps.forEach((el, i) => {
        el.classList.remove('is-active', 'is-done', 'is-locked');
        if (stepStates[i] && i < current) el.classList.add('is-done');
        else if (i === current) el.classList.add('is-active');
        else if (!stepStates[i - 1]) el.classList.add('is-locked');
      });
    }

    /* Books que COBREN todos los markets usados en la combinada.
     * No inventamos ranking aleatorio: devolvemos los eligibles en su orden
     * natural (priority del catálogo) limitado a 3. La cuota real por casa
     * se computa en `bestBookForCombo` más abajo. */
    function top3Books(_oddIgnored, marketsUsed = ['h2h']) {
      const ar = BSData.BOOKS_AR || [];
      const eligible = ar.filter(b => marketsUsed.every(mk => COVER[b.key]?.[mk]));
      return (eligible.length ? eligible : ar).slice(0, 3);
    }

    /** Para una combinada armada, calcula la cuota TOTAL en cada casa que el
     *  usuario marcó (multiplicando las cuotas de cada leg en ESA casa).
     *  Si una casa no ofrece alguno de los mercados, contamos solo las que cubre
     *  y reportamos coveredLegs separado para que el usuario vea la cobertura.
     *  Devuelve ranking ordenado por cuota total descendente. */
    function bestBookForCombo(legs, selectedBookKeys, marketLabels, cov) {
      if (!Array.isArray(legs) || !legs.length || !Array.isArray(selectedBookKeys) || !selectedBookKeys.length) return [];
      const books = (BSData.BOOKS_AR || []).filter(b => selectedBookKeys.includes(b.key));
      const ranked = books.map(book => {
        let totalOdd = 1;
        let coveredLegs = 0;
        for (const l of legs) {
          // El backend nos da `eventId`. Buscamos el evento live y la cuota en esa casa.
          const ev = BSData.liveEvents({}).find(e => e.id === l.match?.id || e.id === l.eventId);
          if (!ev) {
            // Si no encontramos el evento, asumimos la cuota base del backend (l.odd)
            totalOdd *= l.odd || 1;
            coveredLegs++;
            continue;
          }
          const mkt = (ev.markets || {})[l.market];
          const entry = mkt && mkt[book.key];
          let priceInBook = null;
          if (entry) {
            const o = l.line || l.outcome;
            if (l.market === 'h2h')        priceInBook = entry[o] || entry.home || entry.away;
            else if (l.market === 'dc')    priceInBook = entry[o] || entry.home_or_draw || entry.draw_or_away || entry.home_or_away;
            else if (l.market === 'btts')  priceInBook = entry[o] || entry.yes || entry.no;
            else if (l.market === 'totals') {
              // entry está indexado por línea
              const lineNum = parseFloat(String(o).replace(/[^\d.]/g, '')) || null;
              const byLine = lineNum && entry[lineNum];
              if (byLine) priceInBook = /under|menos/i.test(o) ? byLine.under : byLine.over;
            } else if (l.market === 'ah')  priceInBook = entry.home_minus || entry.away_plus;
          }
          if (priceInBook && priceInBook > 1) {
            totalOdd *= priceInBook;
            coveredLegs++;
          }
        }
        return { book, totalOdd, coveredLegs };
      }).filter(r => r.coveredLegs > 0);
      ranked.sort((a, b) => (b.coveredLegs - a.coveredLegs) || (b.totalOdd - a.totalOdd));
      return ranked;
    }
    function bookChip(b, payout) {
      if (!b) return '';
      const logo = window.BSLogos ? BSLogos.bookLogo(b.key, { size: 14 }) : '';
      return `<span class="ag-bookchip">
        ${logo}
        <span class="ag-bookchip-name">${BSUI.esc(b.name)}</span>
        ${payout ? `<span class="ag-bookchip-pay">${BSUI.money(payout)}</span>` : ''}
      </span>`;
    }

    // ─────── Bindings ───────
    panel.querySelector('#agSportChips').addEventListener('click', e => {
      const b = e.target.closest('button.league-chip'); if (!b) return;
      panel.querySelectorAll('#agSportChips button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      activeSport = b.dataset.sport;
      updateStatus();
    });

    panel.querySelector('#agLeagueChips').addEventListener('click', e => {
      const b = e.target.closest('button.league-chip'); if (!b) return;
      const k = b.dataset.lg;
      const allBtn = panel.querySelector('#agLeagueChips button[data-lg="all"]');
      if (k === 'all') {
        activeLeagues = new Set(['all']);
        panel.querySelectorAll('#agLeagueChips button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      } else {
        activeLeagues.delete('all');
        allBtn.classList.remove('active');
        if (activeLeagues.has(k)) { activeLeagues.delete(k); b.classList.remove('active'); }
        else                      { activeLeagues.add(k); b.classList.add('active'); }
        if (activeLeagues.size === 0) { activeLeagues.add('all'); allBtn.classList.add('active'); }
      }
      updateStatus();
    });

    // Risk cards
    panel.querySelectorAll('.risk-card').forEach(c => {
      c.addEventListener('click', () => {
        panel.querySelectorAll('.risk-card').forEach(x => x.classList.remove('is-selected'));
        c.classList.add('is-selected');
        activeRisk = c.dataset.risk;
        updateStatus();
      });
    });

    // Steppers
    [['agcount', 'agCount', 1, 50, 1], ['agstake', 'agStake', 1000, 10000000, 5000]].forEach(([sk, inp, mn, mx, step]) => {
      const el = panel.querySelector('#' + inp);
      panel.querySelectorAll(`[data-stepper="${sk}"] .num-stepper-btn`).forEach(btn => {
        btn.addEventListener('click', () => {
          const sign = btn.dataset.step === '+' ? 1 : -1;
          const cur = Number(String(el.value).replace(/[^\d]/g, '')) || 0;
          let s = step;
          if (sk === 'agstake') s = cur >= 100000 ? 10000 : cur >= 10000 ? 1000 : 500;
          el.value = String(Math.max(mn, Math.min(mx, cur + sign * s)));
        });
      });
      el.addEventListener('input', () => { el.value = String(el.value).replace(/[^\d]/g, ''); });
    });

    panel.querySelector('#agReset').addEventListener('click', () => {
      activeSport = 'all';
      activeLeagues = new Set(['all']);
      activeRisk = 'eq';
      panel.querySelectorAll('#agSportChips button').forEach(x => x.classList.toggle('active', x.dataset.sport === 'all'));
      panel.querySelectorAll('#agLeagueChips button').forEach(x => x.classList.toggle('active', x.dataset.lg === 'all'));
      panel.querySelectorAll('.risk-card').forEach(c => c.classList.toggle('is-selected', c.dataset.risk === 'eq'));
      panel.querySelector('#agCount').value = '3';
      panel.querySelector('#agStake').value = '10000';
      panel.querySelector('#agOutput').innerHTML = '';
      // Limpiar selección de casas (desmarcadas por defecto)
      panel.querySelectorAll('#agBooksFilter input[type=checkbox]').forEach(cb => { cb.checked = false; });
      panel.querySelectorAll('#agBooksFilter .agx-book-card').forEach(c => c.classList.remove('is-on'));
      updateBooksCount();
      updateStatus();
    });

    // ─────── Casinos: handlers + contador ───────
    function selectedBooks() {
      return [...panel.querySelectorAll('#agBooksFilter input[type=checkbox]:checked')].map(cb => cb.dataset.book);
    }
    function updateBooksCount() {
      const n = selectedBooks().length;
      const el = panel.querySelector('#agBooksCount');
      if (el) {
        el.textContent = n === 0 ? '0 seleccionadas' : `${n} seleccionada${n>1?'s':''}`;
        el.classList.toggle('is-empty', n === 0);
      }
      const btn = panel.querySelector('#agGenerate');
      if (btn) btn.classList.toggle('is-disabled', n === 0);
      updateStepProgress();
    }
    // También trackear cambios en mercados para gatear paso 2.
    // Antes apuntábamos a `#agMarkets` que NO existe en el DOM (los chips
    // reales son `.ag-mkt-chip input[data-mkt]`). Usamos event delegation
    // sobre el panel y filtramos por el data-mkt del checkbox.
    panel.addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox][data-mkt]');
      if (cb) updateStepProgress();
    });
    // BUG previo: clickear la label hacía DOBLE TOGGLE (browser auto + manual)
    // y resultaba en "no pasa nada". Ahora escuchamos el `change` del checkbox
    // (que dispara una sola vez por click via browser default).
    panel.querySelector('#agBooksFilter').addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox][data-book]');
      if (!cb) return;
      const card = cb.closest('.agx-book-card');
      if (card) card.classList.toggle('is-on', cb.checked);
      updateBooksCount();
    });
    panel.querySelector('#agBooksAll')?.addEventListener('click', () => {
      panel.querySelectorAll('#agBooksFilter input[type=checkbox]').forEach(cb => { cb.checked = true; });
      panel.querySelectorAll('#agBooksFilter .agx-book-card').forEach(c => c.classList.add('is-on'));
      updateBooksCount();
    });
    panel.querySelector('#agBooksNone')?.addEventListener('click', () => {
      panel.querySelectorAll('#agBooksFilter input[type=checkbox]').forEach(cb => { cb.checked = false; });
      panel.querySelectorAll('#agBooksFilter .agx-book-card').forEach(c => c.classList.remove('is-on'));
      updateBooksCount();
    });
    updateBooksCount();

    // ─────── Engine animation: pasos secuenciales con vida REAL ───────
    // ANTES: la animación tenía 6 setTimeouts de ~200ms y se cerraba sola
    // en ~1.2s, dejando al usuario sin feedback durante los 20-90s reales
    // que tarda el pipeline (factors + LLM + cross-validation).
    // AHORA: la animación queda VIVA hasta que el caller llama stop().
    // Cada paso tiene una duración mínima razonable y al llegar al último,
    // ENTRA EN MODO PULSE con mensajes rotantes "Analizando partido…",
    // "Verificando con The Odds API…", etc. — feedback honesto del backend.
    function runEngineAnimation() {
      const eng = panel.querySelector('#agEngine');
      const steps = [...panel.querySelectorAll('.ag-engine-steps li')];
      const fill = panel.querySelector('.ag-engine-bar-fill');
      const btn = panel.querySelector('#agGenerate');
      eng.hidden = false;
      steps.forEach(s => s.classList.remove('is-active', 'is-done'));
      if (fill) fill.style.width = '0%';
      if (btn) { btn.disabled = true; btn.querySelector('.ag-gen-label').textContent = 'Generando…'; }

      let i = 0;
      let stopped = false;
      let timer = null;
      const total = steps.length;
      // Duraciones BASE por paso (ms). El último ("books"/"Optimizando") queda
      // en pulse hasta que el caller termine — no se cierra solo.
      const baseDelay = [600, 800, 1500, 1500, 2200];

      const tick = () => {
        if (stopped) return;
        if (i > 0) steps[i-1]?.classList.add('is-done');
        if (i < total - 1) {
          steps[i].classList.add('is-active');
          // Progreso lineal hasta 90% — el 100% lo dejamos para el done()
          if (fill) fill.style.width = Math.min(90, ((i + 1) / total) * 90) + '%';
          const delay = baseDelay[i] || 1500;
          i++;
          timer = setTimeout(tick, delay);
        } else {
          // Último paso: queda activo con pulse hasta que llamen done()
          steps[total - 1].classList.add('is-active');
          if (fill) fill.style.width = '90%';
          // Mensaje rotante para que el usuario sepa que sigue trabajando
          // en lugar de ver un texto fijo durante 60s.
          const lastEl = steps[total - 1];
          const originalText = lastEl.textContent;
          const phases = [
            'Probando combinaciones',
            'Verificando cuotas en cada casa',
            'Chequeando que las apuestas se complementen',
            'Confirmando que la IA aprueba cada apuesta',
            'Buscando dónde te pagan más'
          ];
          let p = 0;
          const rotate = () => {
            if (stopped) return;
            lastEl.textContent = phases[p % phases.length] + '…';
            p++;
            timer = setTimeout(rotate, 2500);
          };
          rotate();
          // Guardamos para poder restaurar el texto cuando termine
          lastEl.dataset._originalText = originalText;
        }
      };
      tick();

      return {
        // Cierre exitoso — marca todo done, llena la barra, oculta.
        done: () => {
          if (stopped) return;
          stopped = true;
          if (timer) { clearTimeout(timer); timer = null; }
          steps.forEach(s => {
            s.classList.remove('is-active');
            s.classList.add('is-done');
            if (s.dataset._originalText) {
              s.textContent = s.dataset._originalText;
              delete s.dataset._originalText;
            }
          });
          if (fill) fill.style.width = '100%';
          setTimeout(() => {
            eng.hidden = true;
            if (btn) { btn.disabled = false; btn.querySelector('.ag-gen-label').textContent = 'Generar combinadas'; }
          }, 420);
        },
        // Cierre con error — colapsa la animación sin marcar done.
        fail: () => {
          if (stopped) return;
          stopped = true;
          if (timer) { clearTimeout(timer); timer = null; }
          steps.forEach(s => {
            if (s.dataset._originalText) {
              s.textContent = s.dataset._originalText;
              delete s.dataset._originalText;
            }
          });
          eng.hidden = true;
          if (btn) { btn.disabled = false; btn.querySelector('.ag-gen-label').textContent = 'Generar combinadas'; }
        }
      };
    }

    // ─────── Generate: usa el AI Pipeline del backend (factors + LLM + quant)
    panel.querySelector('#agGenerate').addEventListener('click', async () => {
      // Validar que el usuario haya marcado al menos 1 casino
      const books = selectedBooks();
      if (!books.length) {
        BSUI.toast({
          title: 'Marcá al menos 1 casino',
          message: 'La IA analiza cuotas solo de las casas donde tenés cuenta. Marcá las casinos en el paso 1.',
          type: 'warning'
        });
        // Llevar visualmente al usuario al paso 1
        panel.querySelector('.agx-card--books')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        panel.querySelector('.agx-card--books')?.classList.add('agx-card--pulse');
        setTimeout(() => panel.querySelector('.agx-card--books')?.classList.remove('agx-card--pulse'), 1200);
        return;
      }

      const n = Number(panel.querySelector('#agLegs').value);
      const count = Math.max(1, Math.min(50, Number(panel.querySelector('#agCount').value || 1)));
      const stake = Math.max(100, Number(panel.querySelector('#agStake').value || 10000));

      // Animación visual — handle queda vivo hasta done()/fail() después del fetch
      const engine = runEngineAnimation();
      // v5.8: trackear engine activo en el panel para que panel.__cleanup pueda
      // cancelarlo si el user cambia de tab mientras se está generando.
      panel.__activeEngine = engine;

      // Mercados desde los chips
      const marketsSet = new Set();
      panel.querySelectorAll('.ag-mkt-chip input[type=checkbox][data-mkt]').forEach(cb => {
        if (cb.checked) marketsSet.add(cb.dataset.mkt);
      });
      const markets = marketsSet.size ? [...marketsSet] : ['h2h', 'dc', 'totals', 'btts', 'ah'];

      // Filtros funcionales — directos del UI a los flags del backend
      const useInjuries = panel.querySelector('#agUseInjuries')?.checked;
      const useWeather  = panel.querySelector('#agUseWeather')?.checked;
      const useSharp    = panel.querySelector('#agUseSmart')?.checked;
      const avoidCorr   = panel.querySelector('#agAvoidCorr')?.checked;

      // Leagues seleccionadas
      const leagues = activeLeagues.has('all') ? [] : [...activeLeagues];

      // Configs nuevos del UI step 4
      const legsPerMatch = Math.max(1, Math.min(3, Number(panel.querySelector('#agLegsPerMatch')?.value) || 1));
      const targetOdd = Number(panel.querySelector('#agTargetOdd')?.value) || null;
      const useAiBuilder = panel.querySelector('#agUseAiBuilder')?.checked !== false;
      const mixSports = panel.querySelector('#agMixSports')?.checked !== false;

      // POST al backend: pipeline completa con factors + LLM + quant + correlation
      let payload = {
        sport: activeSport,
        leagues,
        risk: activeRisk,
        legs: n,
        count,
        markets,
        books,                       // SOLO las casas que marcó el usuario
        minSharp: useSharp ? 0.3 : 0,
        skipInjured: useInjuries,
        skipBadWeather: useWeather,
        skipCorrelated: avoidCorr,
        // Nuevas opciones
        legsPerMatch,
        targetOdd,
        useAiBuilder,
        mixSports
      };
      panel.querySelector('#agStatusLine').textContent = 'Analizando partidos con IA y modelos cuantitativos…';
      let resp;
      try {
        resp = await BSLive.generate(payload);
      } catch (e) {
        engine.fail();
        panel.querySelector('#agStatusLine').textContent = 'Error: ' + (e?.message || 'el servicio no responde por ahora');
        BSUI.toast({ title: 'Error generando combinadas', message: e?.message, type: 'error' });
        return;
      }
      // Backend respondió OK — completar la animación y revelar resultados
      engine.done();
      const backendCombos = resp.combos || [];
      panel.querySelector('#agStatusLine').textContent = `${backendCombos.length} combinadas · ${resp.meta?.passing}/${resp.meta?.analyzed} partidos pasaron los filtros`;

      if (!backendCombos.length) {
        const meta = resp.meta || {};
        const reasons = [];
        if (meta.analyzed === 0) reasons.push(`<li>No hay partidos analizados (¿el motor está caído?)</li>`);
        else if (meta.passing === 0) {
          reasons.push(`<li>${meta.analyzed} partidos analizados, pero <strong>0 pasaron tus filtros</strong></li>`);
          if (useSharp) reasons.push(`<li><strong>Destildá "Priorizar partidos con movimiento sharp"</strong> — la mayoría de los partidos no tiene sharp detectado</li>`);
          if (useInjuries) reasons.push(`<li>Destildá "Filtrar lesiones reportadas"</li>`);
          if (useWeather) reasons.push(`<li>Destildá "Considerar clima"</li>`);
        } else if (meta.poolSize === 0) {
          reasons.push(`<li>${meta.passing} partidos pasaron filtros, pero ninguna selection matchea tus mercados/casas</li>`);
          if (books.length < 3) reasons.push(`<li>Sumá MÁS casinos en el paso 1 (tenés ${books.length})</li>`);
          reasons.push(`<li>Asegurate que los mercados elegidos cubran las casas</li>`);
        } else {
          reasons.push(`<li>Pool de ${meta.poolSize} picks, pero no se pudo armar combo de ${n} legs</li>`);
          reasons.push(`<li>Bajá legs por combinada a 2-3</li>`);
        }
        panel.querySelector('#agOutput').innerHTML = `<div class="card stack" style="padding:32px"><strong style="text-align:center;display:block">Sin combinadas generadas</strong><p class="muted tiny" style="text-align:center;margin-top:8px">Motor analizó <strong>${meta.analyzed || 0}</strong> partidos · <strong>${meta.passing || 0}</strong> pasaron filtros · pool de <strong>${meta.poolSize || 0}</strong> picks</p><ul class="muted tiny" style="text-align:left;max-width:520px;margin:14px auto 0">${reasons.join('')}</ul></div>`;
        return;
      }

      // Adaptar la respuesta al shape que usaba la UI original
      const combos = backendCombos.map(c => ({
        legs: c.legs.map(l => ({
          match: { home: { id: l.home?.toLowerCase?.().replace(/[^a-z]/g,''), name: l.home }, away: { id: l.away?.toLowerCase?.().replace(/[^a-z]/g,''), name: l.away }, id: l.eventId },
          market: l.market,
          label: l.label,
          odd: l.odd,
          p: l.confidence,
          line: l.outcome,
          ev: l.ev,
          confidence: l.confidence,
          rationale: l.rationale,
          tacticalNotes: l.tacticalNotes,
          factors: l.factors,
          book: l.book,
          sport: l.sport,
          league: l.league
        })),
        total: c.totalOdd,
        prob: c.legs.reduce((a, b) => a * (b.confidence || 0.5), 1),  // prob real (producto de confidences)
        marketsUsed: [...new Set(c.legs.map(l => l.market))],
        ev: c.sumEv / 100,                    // EV bruto (sin correlación)
        evAdjusted: (c.evAdjusted != null ? c.evAdjusted : c.sumEv) / 100,  // EV post-correlación
        avgConfidence: c.avgConfidence,
        qualityScore: c.qualityScore,         // score compuesto v5.5
        correlation: c.correlation,
        aiNarrative: c.aiNarrative,
        aiEdge: c.aiEdge,
        sportsCount: c.sportsCount,
        legCount: c.legCount
      }));
      // Meta del motor para mostrar al user "evalué N candidatas, te muestro los K mejores"
      const candidatesEvaluated = resp.meta?.trace?.candidatesEvaluated || backendCombos.length;

      const aiGlobalNarrative = resp.aiNarrative || null;
      const aiProvider = resp.aiProvider || null;          // 'gemini' | 'groq' | null
      const aiHealth = resp.aiHealth || 'unknown';         // 'ok' | 'degraded' | 'no-keys' | 'unknown'
      const aiReason = resp.aiReason || null;

      // Banner uniforme (v5.8): mismo componente en todos los motores IA,
      // muestra razón concreta cuando falla, no mensaje genérico.
      const aiBannerHtml = BSUI.aiHealthBanner({
        health: aiHealth,
        provider: aiProvider,
        reason: aiReason,
        onRetry: aiHealth !== 'ok' ? 'agAiHealthRetry' : null,
        context: 'Constructor Quant'
      });

      const out = panel.querySelector('#agOutput');
      out.innerHTML = `
        ${aiBannerHtml}
        <div class="row between mb-3">
          <div>
            <strong>${combos.length} combinada${combos.length>1?'s':''} para vos</strong>
            <div class="muted tiny" style="margin-top:2px">Probé <strong>${candidatesEvaluated}</strong> combinaciones distintas y te muestro las <strong>${combos.length}</strong> con más chance de ganar dentro de la cuota que pediste.</div>
          </div>
          <span class="muted tiny">Stake base: ${BSUI.money(stake)} ARS</span>
        </div>
        ${aiGlobalNarrative ? `<div class="card card-tinted card-pad-sm mb-3" style="border-left:3px solid var(--brand-500);background:rgba(var(--brand-500-rgb,30,75,200),0.04)">
          <div class="row between" style="align-items:center"><strong class="tiny">Lectura global IA${aiProvider ? ` <span class="badge badge-success tiny" style="margin-left:6px">${BSUI.esc(aiProvider)}</span>` : ''}</strong></div>
          <p class="muted tiny" style="margin-top:6px;line-height:1.5">${BSUI.esc(aiGlobalNarrative)}</p>
        </div>` : ''}
        <div class="grid ${combos.length === 1 ? '' : 'grid-2'}" style="gap:18px">
          ${combos.map((c, ci) => {
            // Métricas computadas una sola vez para usar en el render premium.
            // probReal = producto real de confidences por leg (NO promedio).
            // Esta es la probabilidad HONESTA de que la combinada complete:
            // tres legs a 70% conf = 0.343 = 34.3% prob real, NO 70%.
            const probReal = c.prob || c.legs.reduce((a, l) => a * (l.confidence || 0.5), 1);
            const probPct = Math.max(1, Math.round(probReal * 100));
            const probLevel = probPct >= 50 ? 'high' : probPct >= 20 ? '' : 'low';
            // Quality score: cómo evaluó el motor esta combinada frente al pool.
            const qs = c.qualityScore;
            const qsLabel = qs == null ? null : qs >= 50 ? 'excelente' : qs >= 25 ? 'buena' : qs >= 10 ? 'aceptable' : 'baja';
            const qsBadgeClass = qs == null ? '' : qs >= 50 ? 'badge-success' : qs >= 25 ? 'badge-info' : qs >= 10 ? 'badge-warning' : 'badge-danger';
            const evPct = c.evAdjusted * 100;
            const evSign = evPct >= 0 ? '+' : '';
            const totalPayout = stake * c.total;
            const profit = stake * (c.total - 1);
            // Factors únicos de TODAS las legs, con icono por tipo
            const allFactors = c.legs.flatMap(l => l.factors || []);
            const seenFact = new Set();
            const uniqueFactors = [];
            for (const f of allFactors) {
              const k = (f.kind || '') + ':' + (f.note || '');
              if (!seenFact.has(k)) { seenFact.add(k); uniqueFactors.push(f); }
              if (uniqueFactors.length >= 5) break;
            }
            // Best book para esta combinada (cuota real en CADA casa seleccionada)
            const ranked = bestBookForCombo(c.legs, books, M, COVER);
            const winner = ranked[0];
            const runnerUp = ranked[1];
            return `
            <article class="bs-prem ag-combo">
              <header class="bs-prem__head">
                <strong class="bs-prem__title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                  Combinada #${ci+1} · ${c.legCount || c.legs.length} legs${c.sportsCount > 1 ? ' · ' + c.sportsCount + ' deportes' : ''}
                </strong>
                <div class="bs-prem__chips">
                  <span class="risk-pill ${c.total<2?'low':c.total<6?'mid':'high'}">${c.total<2?'Bajo':c.total<6?'Medio':'Alto'} riesgo</span>
                  ${qs != null ? `<span class="badge ${qsBadgeClass} tiny" title="Qué tan buena es esta combinada (0-100). Considera la probabilidad real de ganar, lo generosa que es la cuota y que las apuestas se complementen. 50+ es muy buena.">Calidad: ${qsLabel}</span>` : ''}
                  ${c.correlation?.warnings?.length
                    ? `<span class="badge badge-warning tiny" title="Algunas apuestas dependen entre sí — si una falla, otra también puede fallar. La cuota se ajustó para reflejar el riesgo real.">⚠ apuestas relacionadas</span>`
                    : `<span class="badge badge-success tiny" title="Cada apuesta es independiente — no se chocan entre sí.">✓ apuestas se complementan</span>`}
                </div>
              </header>

              <div class="bs-prem__hero">
                <div class="bs-prem__hero-cell">
                  <span class="bs-prem__hero-label">Cuota total</span>
                  <span class="bs-prem__odd">${c.total.toFixed(2)}</span>
                </div>
                <div class="bs-prem__hero-cell">
                  <span class="bs-prem__hero-label">Si gana, cobrás (stake ${BSUI.money(stake)})</span>
                  <span class="bs-prem__pay">${BSUI.money(totalPayout)}</span>
                  <span class="bs-prem__pay-sub">profit ${BSUI.money(profit)}</span>
                </div>
                <div class="bs-prem__hero-cell bs-prem__edge-cell">
                  <span class="bs-prem__hero-label" title="Cuán generosa es esta cuota comparada con la 'cuota justa' del mercado. Un +5% quiere decir que la cuota te paga 5% más de lo que debería. A largo plazo, eso es plata para vos.">Ventaja vs casa</span>
                  <span class="bs-prem__edge ${evPct >= 0 ? '' : 'bs-prem__edge--negative'}">${evSign}${evPct.toFixed(1)}%</span>
                  ${c.evAdjusted < c.ev ? `<span class="bs-prem__edge-explain">sin ajustar: ${evSign}${(c.ev*100).toFixed(1)}%</span>` : ''}
                </div>
              </div>

              <div class="bs-prem__conf" title="De cada 100 veces que jugaras esta combinada, en cuántas ganarías. Es el cálculo HONESTO: 3 apuestas a 70% cada una NO dan 70% — dan 34% combinado (porque tienen que ganar las 3 juntas).">
                <div class="bs-prem__conf-head">
                  <span>De cada 100 veces, ganás</span>
                  <strong>${probPct} veces</strong>
                </div>
                <div class="bs-prem__conf-track">
                  <div class="bs-prem__conf-fill ${probLevel ? 'bs-prem__conf-fill--' + probLevel : ''}" style="width:${Math.min(100, probPct * 2)}%"></div>
                </div>
                <div class="muted tiny" style="margin-top:4px">Esperado: 1 ganada cada <strong>${(1/probReal).toFixed(0)} intentos</strong> · Confianza promedio por apuesta: <strong>${Math.round((c.avgConfidence || 0.5) * 100)}%</strong></div>
              </div>

              <!-- Markets summary chips -->
              <div class="cluster" style="gap:4px;flex-wrap:wrap">
                ${c.marketsUsed.map(mk => `<span class="badge badge-info tiny" style="padding:2px 8px"><span style="margin-right:3px">${M_ICON[mk]||''}</span>${M[mk]||mk}</span>`).join('')}
              </div>

              <!-- Legs list premium -->
              <div class="bs-prem__legs">
              ${c.legs.map(l => `
                <div class="bs-prem__leg">
                  <div class="bs-prem__leg-info">
                    <div class="bs-prem__leg-teams">
                      ${BSIcons.teamLogo(l.match.home, { size: 16, sport: l.sport })}
                      <span>${BSUI.esc(l.match.home.name)}</span>
                      <span class="dim" style="font-weight:400">vs</span>
                      <span>${BSUI.esc(l.match.away.name)}</span>
                      ${BSIcons.teamLogo(l.match.away, { size: 16, sport: l.sport })}
                    </div>
                    <div class="bs-prem__leg-meta">
                      <span class="bs-prem__leg-mkt">${M[l.market]||l.market}</span>
                      <span>${BSUI.esc(l.label)}</span>
                    </div>
                  </div>
                  <strong class="bs-prem__leg-odd">${l.odd.toFixed(2)}</strong>
                </div>
              `).join('')}
              </div>

              <!-- Factors usados (clima/lesiones/sharp/H2H) — chips visibles -->
              ${uniqueFactors.length ? `
              <div class="bs-prem__factors" aria-label="Factores considerados">
                ${uniqueFactors.map(f => {
                  const ic = f.kind === 'injury' ? '🏥'
                           : f.kind === 'weather' ? '🌦'
                           : f.kind === 'sharp' ? '💰'
                           : f.kind === 'history' ? '📊'
                           : f.kind === 'lineup' ? '👥'
                           : f.kind === 'form' ? '📈'
                           : '•';
                  const cls = f.impact === 'positive' ? 'bs-prem__factor--good'
                            : f.impact === 'negative' ? 'bs-prem__factor--warn'
                            : '';
                  return `<span class="bs-prem__factor ${cls}"><span class="bs-prem__factor-ico">${ic}</span>${BSUI.esc(f.note)}</span>`;
                }).join('')}
              </div>` : ''}

              <!-- Rationale IA — por qué esta combinada -->
              ${(c.aiNarrative || c.aiEdge || c.legs[0]?.rationale) ? `
              <div class="bs-prem__rationale">
                <span class="bs-prem__rationale-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a6 6 0 0 0-6 6c0 2 1 4 3 5v3a3 3 0 0 0 6 0v-3c2-1 3-3 3-5a6 6 0 0 0-6-6z"/></svg>
                  Por qué esta combinada
                </span>
                ${c.aiNarrative ? `<p>${BSUI.esc(c.aiNarrative)}</p>` : ''}
                ${c.aiEdge ? `<p style="font-weight:600;color:var(--brand-700)">⚡ ${BSUI.esc(c.aiEdge)}</p>` : ''}
                ${c.legs[0]?.rationale && !c.aiNarrative ? `<p>${BSUI.esc(c.legs[0].rationale)}</p>` : ''}
              </div>` : ''}

              <!-- Best-payer destacado -->
              ${winner ? `
              <div class="bs-prem__bestbook" data-key="${winner.book.key}">
                ${window.BSLogos ? BSLogos.bookLogo(winner.book.key, { size: 36 }) : ''}
                <div>
                  <div class="bs-prem__bestbook-tag">MEJOR PAGA EN</div>
                  <div class="bs-prem__bestbook-name">${BSUI.esc(winner.book.name)}</div>
                  <div class="tiny muted">${winner.coveredLegs}/${c.legs.length} legs · cuota ${winner.totalOdd.toFixed(2)}${runnerUp ? ` · vs ${BSUI.esc(runnerUp.book.name)} ${runnerUp.totalOdd.toFixed(2)}` : ''}</div>
                </div>
                <div class="bs-prem__bestbook-pay">${BSUI.money(stake * winner.totalOdd)}</div>
              </div>` : ''}

              <!-- Acciones -->
              <footer class="bs-prem__actions">
                <button class="btn btn-primary" data-combo-idx="${ci}">${BSIcons.svg('plus',{size:14})} Agregar a mi combinada</button>
                <button class="btn btn-outline btn-sm" data-combo-share="${ci}">${BSIcons.svg('share',{size:14})} Compartir</button>
                <button class="btn btn-outline btn-sm" data-combo-whatif="${ci}">${BSIcons.svg('cpu',{size:14})} Simular escenarios</button>
                <button class="btn btn-ghost btn-sm" data-combo-detail="${ci}">${BSIcons.svg('info',{size:14})} Análisis detallado</button>
              </footer>
            </article>`;
          }).join('')}
        </div>
      `;
      // Retry del banner IA (si está visible) → re-trigger del generate
      out.querySelector('#agAiHealthRetry')?.addEventListener('click', () => {
        panel.querySelector('#agGenerate')?.click();
      });
      out.querySelectorAll('[data-combo-idx]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.comboIdx);
        combos[i].legs.forEach(l => BSDash.addToSlip({ matchId: l.match.id, label: l.label, odd: l.odd, market: l.market }));
        BSUI.confetti?.();
        BSUI.toast({ title: 'Combinada agregada al slip', message: `Cuota total ${combos[i].total.toFixed(2)}`, type: 'success' });
      }));
      // Compartir link (genera URL con hash de la combinada)
      out.querySelectorAll('[data-combo-share]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.comboShare); const c = combos[i];
        const payload = btoa(unescape(encodeURIComponent(JSON.stringify({
          legs: c.legs.map(l => ({ event: l.match.home.name + ' vs ' + l.match.away.name, market: l.market, pick: l.label, odd: l.odd })),
          total: c.total, prob: c.prob, ev: c.ev, ts: Date.now()
        }))));
        const url = location.origin + location.pathname + '#combo=' + payload;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            BSUI.toast({ title: 'Link copiado', message: 'Pegalo donde quieras — reproducirá la combinada exacta.', type: 'success' });
          }).catch(() => BSUI.toast({ title: 'Link generado', message: url.slice(0, 60) + '…', type: 'info' }));
        } else {
          BSUI.toast({ title: 'Link generado', message: url.slice(0, 60) + '…', type: 'info' });
        }
      }));
      // What-If: lleva al simulador con la combinada cargada
      out.querySelectorAll('[data-combo-whatif]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.comboWhatif); const c = combos[i];
        try { sessionStorage.setItem('bs:whatif:legs', JSON.stringify(c.legs.map(l => ({ event: l.match.home.name + ' vs ' + l.match.away.name, label: l.label, odd: l.odd, p: l.p })))); } catch (e) {}
        if (window.BSDash && BSDash.go) BSDash.go('whatif');
        BSUI.toast({ title: 'Cargada en What-If', message: 'Simulá los 2^' + c.legs.length + ' escenarios.', type: 'success' });
      }));
      // Análisis detallado: abre modal con expansión IA
      out.querySelectorAll('[data-combo-detail]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.comboDetail); const c = combos[i];
        const conf = Math.max(35, Math.min(95, Math.round(c.prob * 100 + (c.ev > 0 ? 8 : -8))));
        const html = `
          <div class="stack" style="max-width:600px">
            <h3 class="h4">Análisis IA · Combinada #${i+1}</h3>
            <p class="muted tiny">Confianza del motor: ${conf}% · EV: ${(c.ev*100).toFixed(1)}%</p>
            <div class="card stack-sm">
              <strong>Por qué esta combinada</strong>
              <p style="font-size:.85rem;line-height:1.6">El motor eligió estas apuestas porque cada una está mejor pagada de lo justo, o porque se complementan bien entre sí. ${c.ev>=0?'Las cuotas combinadas pagan más de lo que el mercado considera justo — eso es plata para vos a largo plazo.':'La ventaja es chica — solo jugala si tenés alta confianza en el partido.'}</p>
            </div>
            <div class="card stack-sm">
              <strong>Variables consideradas</strong>
              <ul style="font-size:.82rem;line-height:1.7;margin:0;padding-left:20px">
                <li>Forma reciente últimos 5 partidos (diferencial de goles esperados)</li>
                <li>Lesiones reportadas (feed live)</li>
                <li>Clima en sede del partido</li>
                <li>Histórico H2H 10 años</li>
                <li>Smart Money / movimiento de líneas</li>
                <li>Tendencias del árbitro (cards/foul rate)</li>
                <li>Motivación contextual (descenso, copa, derbis)</li>
              </ul>
            </div>
            <div class="card stack-sm">
              <strong>Riesgos a vigilar</strong>
              <p style="font-size:.82rem;line-height:1.55">${c.legs.length>=4?'Tiene 4 o más apuestas combinadas: paga mucho pero ganás pocas veces. Apostá poco (entre 1% y 2% de tu plata) y aceptá que vas a perder seguido — la ganancia llega cuando la pegás.':'Combinada equilibrada. Apostá un monto cómodo (3-5% de tu plata por jugada).'}</p>
            </div>
          </div>`;
        if (BSUI.openModal) BSUI.openModal(html, { large: true });
        else BSUI.toast({ title: 'Análisis', message: 'Probabilidad ' + conf + '% · Ventaja ' + (c.ev*100).toFixed(1) + '%', type: 'info' });
      }));
    });

    updateStatus();

    // v5.8 — cleanup al cambiar de tab: cancelar engine animation si el user
    // se va mientras el motor está corriendo, evitando setTimeout zombies
    // que rotan textos en un panel ya destruido.
    panel.__cleanup = () => {
      if (panel.__activeEngine && typeof panel.__activeEngine.fail === 'function') {
        try { panel.__activeEngine.fail(); } catch (_) {}
        panel.__activeEngine = null;
      }
    };
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('aigenerator', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('aigenerator', render));
  }
  doRegister();
  window.__bsAigeneratorRender = render;
})();
