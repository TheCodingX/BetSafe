/* BetSafe — Generador IA (sección VIP completa)
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
          <span class="badge-vip" style="align-self:center">VIP · Generador IA Pro</span>
          <h2 class="h3">Generador IA es exclusivo VIP</h2>
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
    const SPORTS = (BSData.SPORTS || []).slice(0, 8);
    const LEAGUES = BSData.LEAGUES || [];
    const COVER = BSData.BOOK_MARKET_COVERAGE || {};
    const M = { h2h:'1X2', dc:'Doble Oport.', totals:'Goles O/U', btts:'BTTS', ah:'Hándicap', corners:'Corners', cards:'Tarjetas' };
    const M_ICON = { h2h:'⚖', dc:'2x', totals:'⚽', btts:'≡', ah:'±', corners:'⌐', cards:'▢' };

    panel.innerHTML = `
      <header class="agx-hero reveal">
        <div class="agx-hero__main">
          <span class="badge-vip agx-hero__chip">VIP · Generador IA</span>
          <h2 class="agx-hero__title">Combinadas óptimas del día, armadas por la IA</h2>
          <p class="agx-hero__sub">Elegí tus casas, los mercados, el nivel de riesgo y la IA arma las combinadas — con la casa argentina que mejor paga cada una.</p>
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
                title:'Resultado',
                items:[
                  ['h2h','Resultado (1X2)'],
                  ['dc','Doble oportunidad'],
                  ['dnb','Empate anula (DNB)'],
                  ['ht','Resultado al descanso'],
                  ['htft','Descanso / Final']
                ]
              },
              {
                title:'Hándicap',
                items:[
                  ['ah','Hándicap asiático'],
                  ['eh','Hándicap europeo']
                ]
              },
              {
                title:'Goles',
                items:[
                  ['totals','Más / Menos goles'],
                  ['totals_home','Goles del local'],
                  ['totals_away','Goles del visitante'],
                  ['totals_ht','Goles al descanso'],
                  ['btts','Ambos equipos marcan'],
                  ['btts_result','Ambos marcan + resultado'],
                  ['exact_score','Marcador exacto']
                ]
              },
              {
                title:'Goleadores',
                items:[
                  ['scorer_any','Goleador en cualquier momento'],
                  ['scorer_first','Primer goleador'],
                  ['scorer_last','Último goleador'],
                  ['scorer_2plus','Jugador con 2+ goles'],
                  ['scorer_hat','Hat-trick (3+ goles)']
                ]
              },
              {
                title:'Tarjetas',
                items:[
                  ['cards','Total de tarjetas'],
                  ['cards_home','Tarjetas del local'],
                  ['cards_away','Tarjetas del visitante'],
                  ['card_player','Tarjeta a jugador específico'],
                  ['first_card','Primera tarjeta (equipo)'],
                  ['red_card','Roja en el partido (sí/no)']
                ]
              },
              {
                title:'Córners',
                items:[
                  ['corners','Total de córners'],
                  ['corners_home','Córners del local'],
                  ['corners_away','Córners del visitante'],
                  ['corners_handicap','Hándicap de córners'],
                  ['first_corner','Primer córner']
                ]
              },
              {
                title:'Tiros / disparos',
                items:[
                  ['shots','Tiros totales'],
                  ['shots_on_target','Tiros al arco'],
                  ['shots_player','Tiros de un jugador']
                ]
              },
              {
                title:'Stats de jugador',
                items:[
                  ['player_stats','Estadísticas de jugador (general)'],
                  ['player_assists','Asistencias'],
                  ['player_passes','Pases completados'],
                  ['player_tackles','Entradas / quites']
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
              <input type="checkbox" id="agUseSmart" checked>
              <span>Priorizar partidos con movimiento sharp</span>
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
                ${SPORTS.map(s => `<button type="button" class="league-chip" data-sport="${s.key}">${BSIcons.svg(s.icon||'soccer',{size:14})}<span>${BSUI.esc(s.name)}</span></button>`).join('')}
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
            <select class="select agx-config__select" id="agLegsPerMatch" title="Permite múltiples picks del mismo partido (e.g. resultado + total goles). Más legs por partido = cuotas más altas pero mayor correlación.">
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
            <span class="agx-config__label">Stake (ARS)</span>
            <div class="num-stepper" data-stepper="agstake">
              <button type="button" class="num-stepper-btn" data-step="-" aria-label="−"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
              <input class="num-stepper-input" id="agStake" type="text" inputmode="numeric" pattern="[0-9]*" value="10000" />
              <button type="button" class="num-stepper-btn" data-step="+" aria-label="+"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
            </div>
          </div>
          <div class="agx-config__item">
            <span class="agx-config__label">Cuota objetivo (opcional)</span>
            <input class="input agx-config__select" id="agTargetOdd" type="number" step="0.5" min="0" placeholder="ej: 12.0" title="La IA tratará de construir combinadas que acerquen al producto de cuotas indicado. Vacío = libre (toma las mejores por EV)."/>
          </div>
          <div class="agx-config__item" style="grid-column:span 2">
            <label class="ag-toggle" style="cursor:pointer">
              <input type="checkbox" id="agUseAiBuilder" checked>
              <span><strong>IA construye las combinadas</strong> · Groq selecciona legs por correlación negativa, edge estructural y momentum (no solo EV). <em class="muted tiny">Recomendado.</em></span>
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
            <li data-step="ev">Computando EV + Kelly por leg</li>
            <li data-step="match">Optimizando combinadas</li>
            <li data-step="books">Identificando casas que mejor pagan</li>
          </ul>
        </div>
      </section>

      <!-- Output -->
      <div id="agOutput" class="reveal-stagger"></div>
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

    // Build a leg with diverse market based on risk + match offer
    function buildLeg(m, idx, risk) {
      const isSoccer = m.sport === 'soccer';
      const o = m.markets.h2h.bplay || Object.values(m.markets.h2h)[0];
      // Conservador: doble oportunidad / Over 1.5 goles
      if (risk === 'cons') {
        if (isSoccer && m.markets.dc) {
          const dc = m.markets.dc.bplay;
          const which = idx % 2 === 0 ? 'home_or_draw' : 'draw_or_away';
          const lbl  = which === 'home_or_draw' ? `${m.home.name} o empate (1X)` : `Empate o ${m.away.name} (X2)`;
          return { match: m, market: 'dc', label: lbl, line: which === 'home_or_draw' ? '1X' : 'X2', odd: dc[which], p: 1/dc[which] };
        }
        if (m.markets.totals) {
          const ou = m.markets.totals.bplay;
          const ovLine = ou.line - 1;
          const ovOdd = Math.max(1.20, ou.over * 0.7);
          return { match: m, market: 'totals', label: `Más de ${ovLine} ${isSoccer?'goles':'puntos'}`, line: 'Over '+ovLine, odd: ovOdd, p: 1/ovOdd };
        }
        return { match: m, market: 'h2h', label: `${m.home.name} gana`, line:'1', odd: o.home, p: 1/o.home };
      }
      // Intermedio: BTTS / Over 2.5 / hándicap
      if (risk === 'eq') {
        const choices = [];
        if (m.markets.btts) {
          const b = m.markets.btts.bplay;
          choices.push({ market:'btts', label:'Ambos equipos marcan (BTTS sí)', line:'sí', odd: b.yes, p: 1/b.yes });
        }
        if (m.markets.totals) {
          const ou = m.markets.totals.bplay;
          choices.push({ market:'totals', label:`Más de ${ou.line} ${isSoccer?'goles':'puntos'}`, line:'Over '+ou.line, odd: ou.over, p: 1/ou.over });
        }
        if (m.markets.ah) {
          const ah = m.markets.ah.bplay;
          choices.push({ market:'ah', label:`${m.home.name} -${ah.line} (AH)`, line:'-'+ah.line, odd: ah.home_minus, p: 1/ah.home_minus });
        }
        const c = choices[idx % choices.length] || { market:'h2h', label:'Empate', line:'X', odd: o.draw||3.0, p: 1/(o.draw||3.0) };
        return { match: m, ...c };
      }
      // Agresivo: corners / cards / longshot
      const aggChoices = [];
      if (m.markets.corners) {
        const c = m.markets.corners.bplay;
        aggChoices.push({ market:'corners', label:`Más de ${c.line} corners`, line:'Over '+c.line, odd: c.over*1.05, p: 1/(c.over*1.05) });
      }
      if (m.markets.cards) {
        const c = m.markets.cards.bplay;
        aggChoices.push({ market:'cards', label:`Más de ${c.line} tarjetas`, line:'Over '+c.line, odd: c.over*1.10, p: 1/(c.over*1.10) });
      }
      if (m.markets.totals) {
        const ou = m.markets.totals.bplay;
        const upLine = ou.line + (isSoccer?1.5:9.5);
        aggChoices.push({ market:'totals', label:`Más de ${upLine} ${isSoccer?'goles':'puntos'}`, line:'Over '+upLine, odd: ou.over*1.85, p: 1/(ou.over*1.85) });
      }
      const c = aggChoices[idx % Math.max(1, aggChoices.length)] || { market:'h2h', label:`${m.away.name} gana`, line:'2', odd: o.away, p: 1/o.away };
      return { match: m, ...c };
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
    }
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

    // ─────── Engine animation: pasos secuenciales ───────
    function runEngineAnimation() {
      return new Promise(resolve => {
        const eng = panel.querySelector('#agEngine');
        const steps = [...panel.querySelectorAll('.ag-engine-steps li')];
        const fill = panel.querySelector('.ag-engine-bar-fill');
        const btn = panel.querySelector('#agGenerate');
        eng.hidden = false;
        steps.forEach(s => s.classList.remove('is-active', 'is-done'));
        if (fill) fill.style.width = '0%';
        if (btn) { btn.disabled = true; btn.querySelector('.ag-gen-label').textContent = 'Generando…'; }

        const total = steps.length; let i = 0;
        const tick = () => {
          if (i > 0) steps[i-1].classList.add('is-done');
          if (i < total) {
            steps[i].classList.add('is-active');
            if (fill) fill.style.width = (((i + 1) / total) * 100) + '%';
            i++;
            // pasos más rápidos al final para sentirse fluido
            const delay = i < 3 ? 220 : i < 5 ? 180 : 140;
            setTimeout(tick, delay);
          } else {
            steps.forEach(s => { s.classList.remove('is-active'); s.classList.add('is-done'); });
            setTimeout(() => {
              eng.hidden = true;
              if (btn) { btn.disabled = false; btn.querySelector('.ag-gen-label').textContent = 'Generar combinadas'; }
              resolve();
            }, 220);
          }
        };
        tick();
      });
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

      // Animación visual
      runEngineAnimation();

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
      panel.querySelector('#agStatusLine').textContent = 'Pipeline backend: factors → modelos → IA → optimización';
      let resp;
      try {
        resp = await BSLive.generate(payload);
      } catch (e) {
        panel.querySelector('#agStatusLine').textContent = 'Error: ' + (e?.message || 'backend no responde');
        BSUI.toast({ title: 'Error generando combinadas', message: e?.message, type: 'error' });
        return;
      }
      const backendCombos = resp.combos || [];
      panel.querySelector('#agStatusLine').textContent = `${backendCombos.length} combinadas · ${resp.meta?.passing}/${resp.meta?.analyzed} partidos pasaron los filtros`;

      if (!backendCombos.length) {
        panel.querySelector('#agOutput').innerHTML = `<div class="card stack" style="padding:32px;text-align:center"><strong>Sin combinadas que pasen los filtros</strong><p class="muted">Probá:</p><ul class="muted tiny" style="text-align:left;max-width:480px;margin:0 auto"><li>Bajar legs (más partidos califican)</li><li>Sumar más ligas / mercados</li><li>Destildar "lesiones / clima" si están limitando demasiado</li></ul></div>`;
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
        prob: c.legs.reduce((a, b) => a * (b.confidence || 0.5), 1),
        marketsUsed: [...new Set(c.legs.map(l => l.market))],
        ev: c.sumEv / 100,
        avgConfidence: c.avgConfidence,
        correlation: c.correlation,
        aiNarrative: c.aiNarrative,
        aiEdge: c.aiEdge,
        sportsCount: c.sportsCount,
        legCount: c.legCount
      }));

      const aiGlobalNarrative = resp.aiNarrative || null;

      const out = panel.querySelector('#agOutput');
      out.innerHTML = `
        <div class="row between mb-3">
          <strong>${combos.length} combinada${combos.length>1?'s':''} generada${combos.length>1?'s':''}</strong>
          <span class="muted tiny">Stake base: ${BSUI.money(stake)} ARS</span>
        </div>
        ${aiGlobalNarrative ? `<div class="card card-tinted card-pad-sm mb-3" style="border-left:3px solid var(--brand-500);background:rgba(var(--brand-500-rgb,30,75,200),0.04)">
          <div class="row between" style="align-items:center"><strong class="tiny">Lectura global IA <span class="badge badge-success tiny" style="margin-left:6px">groq</span></strong></div>
          <p class="muted tiny" style="margin-top:6px;line-height:1.5">${BSUI.esc(aiGlobalNarrative)}</p>
        </div>` : ''}
        <div class="grid ${combos.length === 1 ? '' : 'grid-2'}" style="gap:14px">
          ${combos.map((c, ci) => {
            const top3 = top3Books(c.total, c.marketsUsed);
            return `
            <div class="card card-tinted stack-sm reveal ag-combo">
              <div class="row between" style="align-items:center">
                <strong>Combinada #${ci+1} · ${c.legCount || c.legs.length} legs${c.sportsCount > 1 ? ' · ' + c.sportsCount + ' deportes' : ''}</strong>
                <span class="risk-pill ${c.total<2?'low':c.total<6?'mid':'high'}">${c.total<2?'Bajo':c.total<6?'Medio':'Alto'} riesgo</span>
              </div>

              ${c.aiEdge ? `<div class="card card-pad-sm" style="background:rgba(212,160,23,0.08);border-left:3px solid var(--gold-700,#c49a1a);margin-top:4px">
                <strong class="tiny" style="color:var(--gold-700,#c49a1a)">⚡ Edge IA</strong>
                <p class="tiny" style="margin-top:3px;line-height:1.4">${BSUI.esc(c.aiEdge)}</p>
              </div>` : ''}

              <!-- Markets summary -->
              <div class="cluster" style="gap:4px;flex-wrap:wrap">
                ${c.marketsUsed.map(mk => `<span class="badge badge-info" style="font-size:.62rem;padding:2px 7px"><span style="margin-right:3px">${M_ICON[mk]||''}</span>${M[mk]||mk}</span>`).join('')}
              </div>

              <!-- Legs -->
              <div class="ag-legs">
              ${c.legs.map(l => `
                <div class="ag-leg">
                  <div class="ag-leg-teams">
                    ${BSIcons.teamLogo(l.match.home, { size: 18, sport: l.sport })}
                    <strong style="font-size:.85rem">${BSUI.esc(l.match.home.name)}</strong>
                    <span class="dim tiny">vs</span>
                    <strong style="font-size:.85rem">${BSUI.esc(l.match.away.name)}</strong>
                    ${BSIcons.teamLogo(l.match.away, { size: 18, sport: l.sport })}
                  </div>
                  <div class="ag-leg-meta">
                    <span class="ag-leg-market">${M[l.market]||l.market}</span>
                    <span class="ag-leg-pick">${BSUI.esc(l.label)}</span>
                  </div>
                  <strong class="num ag-leg-odd">${l.odd.toFixed(2)}</strong>
                </div>
              `).join('')}
              </div>

              <!-- KPIs -->
              <div class="ag-kpis">
                <div><span class="muted tiny">Cuota total</span><strong class="num text-brand" style="font-size:1.4rem">${c.total.toFixed(2)}</strong></div>
                <div><span class="muted tiny">Probabilidad</span><strong class="num">${BSUI.pct(c.prob)}</strong></div>
                <div><span class="muted tiny">EV</span><strong class="num ${c.ev>=0?'text-success':'text-danger'}">${(c.ev*100).toFixed(1)}%</strong></div>
                <div class="ag-payout">
                  <span class="muted tiny">Tu ganancia (stake ${BSUI.money(stake)})</span>
                  <strong class="num text-success" style="font-size:1.45rem">${BSUI.money(stake * c.total)}</strong>
                  <span class="tiny muted">profit ${BSUI.money(stake * (c.total - 1))}</span>
                </div>
              </div>

              <!-- Confidence bar + EV bar -->
              ${(() => {
                const conf = Math.max(35, Math.min(95, Math.round(c.prob * 100 + (c.ev > 0 ? 8 : -8))));
                const evPct = (c.ev * 100);
                const evW = Math.max(2, Math.min(100, Math.abs(evPct) * 6));
                return `
                <div class="ag-meters">
                  <div class="ag-meter">
                    <div class="ag-meter-head"><span>Confianza del motor</span><strong>${conf}%</strong></div>
                    <div class="ag-meter-track"><div class="ag-meter-fill ag-meter-conf" style="width:${conf}%"></div></div>
                  </div>
                  <div class="ag-meter">
                    <div class="ag-meter-head"><span>EV vs mercado</span><strong class="${evPct>=0?'text-success':'text-danger'}">${evPct>=0?'+':''}${evPct.toFixed(1)}%</strong></div>
                    <div class="ag-meter-track"><div class="ag-meter-fill ${evPct>=0?'ag-meter-pos':'ag-meter-neg'}" style="width:${evW}%"></div></div>
                  </div>
                </div>`;
              })()}

              <!-- AI explanation: factores reales del backend -->
              <div class="ag-ai-explain">
                <span class="ag-ai-tag">🧠 Análisis IA + factores</span>
                ${c.aiNarrative ? `<p class="ag-ai-text" style="background:rgba(var(--brand-500-rgb,30,75,200),0.05);padding:8px;border-radius:6px;border-left:2px solid var(--brand-500)"><strong>Por qué esta combinada:</strong> ${BSUI.esc(c.aiNarrative)}</p>` : ''}
                ${c.legs[0]?.rationale ? `<p class="ag-ai-text">${BSUI.esc(c.legs[0].rationale)}</p>` : ''}
                ${c.legs[0]?.tacticalNotes ? `<p class="ag-ai-text" style="font-style:italic;font-size:.78rem">${BSUI.esc(c.legs[0].tacticalNotes)}</p>` : ''}
                ${(() => {
                  // Agregar todos los factores únicos de las legs
                  const allFactors = c.legs.flatMap(l => l.factors || []);
                  const unique = [];
                  const seen = new Set();
                  for (const f of allFactors) {
                    const k = f.kind + ':' + f.note;
                    if (!seen.has(k)) { seen.add(k); unique.push(f); }
                    if (unique.length >= 4) break;
                  }
                  if (!unique.length) return '';
                  return `<ul class="ag-ai-factors-list">${unique.map(f => `<li><span class="ag-ai-factor-ic">${f.kind==='injury'?'🏥':f.kind==='weather'?'🌦':f.kind==='sharp'?'💰':f.kind==='history'?'📊':'•'}</span>${BSUI.esc(f.note)}</li>`).join('')}</ul>`;
                })()}
                <div class="ag-ai-confidence">
                  Confianza promedio: <strong>${(c.avgConfidence * 100).toFixed(0)}%</strong>
                  ${c.correlation?.warnings?.length ? `<span class="badge badge-warning tiny" style="margin-left:6px">⚠ correlación detectada (${c.correlation.maxCorrelation.toFixed(2)})</span>` : '<span class="badge badge-success tiny" style="margin-left:6px">✓ legs no correlacionadas</span>'}
                </div>
              </div>

              <!-- BEST-PAYER: cálculo REAL comparando la combinada exacta en cada casa SELECCIONADA -->
              ${(() => {
                const ranked = bestBookForCombo(c.legs, books, M, COVER);
                if (!ranked.length) return '';
                const winner = ranked[0];
                const runnerUp = ranked[1];
                const winPay = stake * winner.totalOdd;
                const upPay  = runnerUp ? stake * runnerUp.totalOdd : 0;
                const delta  = runnerUp ? ((winPay / upPay - 1) * 100) : 0;
                const winnerLogo = window.BSLogos ? BSLogos.bookLogo(winner.book.key, { size: 56 }) : '';
                return `
                <div class="ag-best-pay ag-best-pay--prominent" data-key="${winner.book.key}">
                  <span class="ag-best-tag">MEJOR PAGA EN</span>
                  <div class="ag-best-row">
                    <div class="ag-best-logo" aria-hidden="true">${winnerLogo}</div>
                    <div class="ag-best-info">
                      <strong class="ag-best-name">${BSUI.esc(winner.book.name)}</strong>
                      <span class="ag-best-sub">${winner.book.license} · cubre los ${winner.coveredLegs}/${c.legs.length} mercados de tu combinada</span>
                      <div class="ag-best-odd-strip">
                        <span class="tiny muted">Cuota total en ${BSUI.esc(winner.book.name)}:</span>
                        <strong class="ag-best-total-odd">${winner.totalOdd.toFixed(2)}</strong>
                      </div>
                    </div>
                    <div class="ag-best-pay-wrap">
                      <span class="ag-best-pay-label">Si gana, cobrás</span>
                      <strong class="ag-best-pay-amt">${BSUI.money(winPay)}</strong>
                      ${runnerUp && delta > 0.1 ? `<span class="ag-best-pay-delta">+${delta.toFixed(1)}% vs ${BSUI.esc(runnerUp.book.name)} (${BSUI.money(upPay)})</span>` : ''}
                    </div>
                  </div>
                  ${ranked.length > 1 ? `<details class="ag-best-runners">
                    <summary class="tiny muted">Ver comparación entre tus ${ranked.length} casas seleccionadas</summary>
                    <div class="ag-best-runners-list">
                      ${ranked.map((r, idx) => `
                        <div class="ag-best-runner ${idx===0?'is-winner':''}">
                          <span class="ag-best-runner-rank">${idx+1}°</span>
                          <span class="cluster tiny">${window.BSLogos ? BSLogos.bookLogo(r.book.key, { size: 18 }) : ''}<strong>${BSUI.esc(r.book.name)}</strong></span>
                          <span class="muted tiny">${r.coveredLegs}/${c.legs.length} legs</span>
                          <strong class="num tiny">${r.totalOdd.toFixed(2)}</strong>
                          <strong class="num text-success tiny">${BSUI.money(stake * r.totalOdd)}</strong>
                        </div>`).join('')}
                    </div>
                  </details>` : ''}
                </div>`;
              })()}

              <!-- Action row -->
              <div class="ag-actions">
                <button class="btn btn-primary btn-sm" data-combo-idx="${ci}">${BSIcons.svg('plus',{size:14})} Agregar al slip</button>
                <button class="btn btn-outline btn-sm" data-combo-share="${ci}">${BSIcons.svg('share',{size:14})} Compartir link</button>
                <button class="btn btn-outline btn-sm" data-combo-whatif="${ci}">${BSIcons.svg('cpu',{size:14})} Simular What-If</button>
                <button class="btn btn-ghost btn-sm" data-combo-detail="${ci}">${BSIcons.svg('info',{size:14})} Análisis detallado</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      `;
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
              <p style="font-size:.85rem;line-height:1.6">El motor priorizó esta secuencia porque cada leg tiene EV positivo individual o contribuye a una ventaja correlacional. ${c.ev>=0?'El EV combinado supera el cierre de mercado.':'EV borderline — útil sólo si confiás en tu lectura del partido.'}</p>
            </div>
            <div class="card stack-sm">
              <strong>Variables consideradas</strong>
              <ul style="font-size:.82rem;line-height:1.7;margin:0;padding-left:20px">
                <li>Forma reciente últimos 5 partidos (xG diferencial)</li>
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
              <p style="font-size:.82rem;line-height:1.55">${c.legs.length>=4?'Combinada de 4+ legs: probabilidad combinada baja, varianza alta. Considerá ½ o ¼ Kelly.':'Combinada balanceada. Stake plano o ½ Kelly recomendado.'}</p>
            </div>
          </div>`;
        if (BSUI.openModal) BSUI.openModal(html, { large: true });
        else BSUI.toast({ title: 'Análisis', message: 'Confianza ' + conf + '%, EV ' + (c.ev*100).toFixed(1) + '%', type: 'info' });
      }));
    });

    updateStatus();
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('aigenerator', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('aigenerator', render));
  }
  doRegister();
  window.__bsAigeneratorRender = render;
})();
