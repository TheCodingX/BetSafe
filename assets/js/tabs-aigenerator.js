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

  function render(panel) {
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

    const matches = BSData.makeMatches();
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
          <p class="agx-hero__sub">Elegí deporte, ligas, riesgo y la IA arma las mejores combinadas — con la casa argentina que mejor paga cada una.</p>
        </div>
        <div class="agx-hero__steps" aria-hidden="true">
          <span class="agx-step is-active" data-step="1"><span class="agx-step__n">1</span><span class="agx-step__t">Deporte</span></span>
          <span class="agx-step" data-step="2"><span class="agx-step__n">2</span><span class="agx-step__t">Ligas</span></span>
          <span class="agx-step" data-step="3"><span class="agx-step__n">3</span><span class="agx-step__t">Riesgo</span></span>
          <span class="agx-step" data-step="4"><span class="agx-step__n">4</span><span class="agx-step__t">Generar</span></span>
        </div>
      </header>

      <!-- Step 1 — Deporte -->
      <section class="agx-card reveal" data-step="1">
        <header class="agx-card__head">
          <span class="agx-card__n">1</span>
          <h3 class="agx-card__title">Deporte</h3>
        </header>
        <div class="cluster agx-chip-row" id="agSportChips">
          <button class="league-chip active" data-sport="all">${BSIcons.svg('soccer',{size:14})}<span>Todos</span></button>
          ${SPORTS.map(s => `<button class="league-chip" data-sport="${s.key}">${BSIcons.svg(s.icon||'soccer',{size:14})}<span>${BSUI.esc(s.name)}</span></button>`).join('')}
        </div>
      </section>

      <!-- Step 2 — Ligas -->
      <section class="agx-card reveal" data-step="2">
        <header class="agx-card__head">
          <span class="agx-card__n">2</span>
          <h3 class="agx-card__title">Ligas <span class="agx-card__hint">(elegí una o varias)</span></h3>
          <span class="agx-card__badge" id="agLeagueCount">Todas</span>
        </header>
        <div class="cluster agx-chip-row" id="agLeagueChips">
          <button class="league-chip active" data-lg="all"><span>Todas</span></button>
          ${LEAGUES.slice(0, 14).map(l => {
            const logo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(l.key, { size: 14 }) : '';
            return `<button class="league-chip" data-lg="${l.key}">${logo}<span>${BSUI.esc(l.name)}</span></button>`;
          }).join('')}
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

      <!-- Step 4 — Configuración -->
      <section class="agx-card reveal" data-step="4">
        <header class="agx-card__head">
          <span class="agx-card__n">4</span>
          <h3 class="agx-card__title">Configuración</h3>
        </header>
        <div class="agx-config">
          <div class="agx-config__item">
            <span class="agx-config__label">Legs por combinada</span>
            <select class="select agx-config__select" id="agLegs">
              <option value="2">2 legs</option>
              <option value="3" selected>3 legs</option>
              <option value="4">4 legs</option>
              <option value="5">5 legs</option>
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
        </div>
      </section>

      <!-- Step 5 — Filtros avanzados (siempre visible) -->
      <section class="agx-card reveal" data-step="5">
        <header class="agx-card__head">
          <span class="agx-card__n">5</span>
          <h3 class="agx-card__title">Filtros avanzados</h3>
        </header>
        <div class="ag-advanced-grid">
          <label class="field">
            <span class="field-label">EV mínimo (%)</span>
            <select class="select" id="agMinEv">
              <option value="0">0% (cualquiera)</option>
              <option value="2">≥ 2%</option>
              <option value="5" selected>≥ 5% (recomendado)</option>
              <option value="8">≥ 8% (estricto)</option>
              <option value="12">≥ 12% (sólo gemas)</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Ventana temporal</span>
            <select class="select" id="agTimeWindow">
              <option value="6">Próximas 6 h</option>
              <option value="12">Próximas 12 h</option>
              <option value="24" selected>Próximas 24 h</option>
              <option value="48">Próximas 48 h</option>
              <option value="168">Esta semana</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Kelly fraction</span>
            <select class="select" id="agKelly">
              <option value="1">Full Kelly</option>
              <option value="0.5" selected>½ Kelly (recomendado)</option>
              <option value="0.25">¼ Kelly (conservador)</option>
              <option value="0">Sin Kelly (stake plano)</option>
            </select>
          </label>

          <!-- MERCADOS DISPONIBLES — agrupados por categoría -->
          <fieldset class="ag-mkt-set ag-mkt-set--full">
            <legend class="field-label">Mercados a considerar</legend>
            ${[
              {
                title:'Resultado',
                items:[
                  ['h2h','Resultado (1X2)', true],
                  ['dc','Doble oportunidad', true],
                  ['dnb','Empate anula (DNB)', false],
                  ['ht','Resultado al descanso', false],
                  ['htft','Descanso / Final', false]
                ]
              },
              {
                title:'Hándicap',
                items:[
                  ['ah','Hándicap asiático', true],
                  ['eh','Hándicap europeo', false]
                ]
              },
              {
                title:'Goles',
                items:[
                  ['totals','Más / Menos goles', true],
                  ['totals_home','Goles del local', false],
                  ['totals_away','Goles del visitante', false],
                  ['totals_ht','Goles al descanso', false],
                  ['btts','Ambos equipos marcan', true],
                  ['btts_result','Ambos marcan + resultado', false],
                  ['exact_score','Marcador exacto', false]
                ]
              },
              {
                title:'Goleadores',
                items:[
                  ['scorer_any','Goleador en cualquier momento', false],
                  ['scorer_first','Primer goleador', false],
                  ['scorer_last','Último goleador', false],
                  ['scorer_2plus','Jugador con 2+ goles', false],
                  ['scorer_hat','Hat-trick (3+ goles)', false]
                ]
              },
              {
                title:'Tarjetas',
                items:[
                  ['cards','Total de tarjetas', false],
                  ['cards_home','Tarjetas del local', false],
                  ['cards_away','Tarjetas del visitante', false],
                  ['card_player','Tarjeta a jugador específico', false],
                  ['first_card','Primera tarjeta (equipo)', false],
                  ['red_card','Roja en el partido (sí/no)', false]
                ]
              },
              {
                title:'Córners',
                items:[
                  ['corners','Total de córners', false],
                  ['corners_home','Córners del local', false],
                  ['corners_away','Córners del visitante', false],
                  ['corners_handicap','Hándicap de córners', false],
                  ['first_corner','Primer córner', false]
                ]
              }
            ].map(group => `
              <div class="ag-mkt-group">
                <span class="ag-mkt-group-title">${group.title}</span>
                <div class="ag-mkt-chips">
                  ${group.items.map(([k, lbl, def]) => `
                    <label class="ag-mkt-chip ${def?'is-on':''}">
                      <input type="checkbox" data-mkt="${k}" ${def?'checked':''} hidden>
                      <span>${BSUI.esc(lbl)}</span>
                    </label>`).join('')}
                </div>
              </div>`).join('')}
          </fieldset>

          <fieldset class="ag-mkt-set ag-mkt-set--full">
            <legend class="field-label">Casas argentinas a priorizar</legend>
            <div class="ag-mkt-chips" id="agBooksFilter">
              ${(BSData.BOOKS_AR || []).map(b => `
                <label class="ag-mkt-chip is-on ag-mkt-chip--book">
                  <input type="checkbox" data-book="${b.key}" checked hidden>
                  <span class="ag-mkt-chip-logo">${window.BSLogos ? BSLogos.bookLogo(b.key, { size: 16 }) : ''}</span>
                  <span>${BSUI.esc(b.name)}</span>
                </label>`).join('')}
            </div>
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
            <li data-step="fetch">Trayendo cuotas live de 25 casas</li>
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
      panel.querySelector('#agLeagueCount').textContent = activeLeagues.has('all') ? 'Todas' : `${activeLeagues.size} seleccionada${activeLeagues.size>1?'s':''}`;
    }

    // Top-3 books that pay best AND cover ALL markets used in combo
    function top3Books(odd, marketsUsed = ['h2h']) {
      const ar = BSData.BOOKS_AR || [];
      const eligible = ar.filter(b => marketsUsed.every(mk => COVER[b.key]?.[mk]));
      const pool = eligible.length >= 3 ? eligible : ar;
      const idx = Math.abs(Math.floor(odd * 100)) % Math.max(1, pool.length);
      const out = []; const seen = new Set();
      for (let i = 0; i < pool.length && out.length < 3; i++) {
        const k = (idx + i * 3) % pool.length;
        if (!seen.has(pool[k].key)) { seen.add(pool[k].key); out.push(pool[k]); }
      }
      while (out.length < 3) out.push(pool[out.length] || ar[out.length]);
      return out;
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
      updateStatus();
    });

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

    // ─────── Generate (usa BSEngine para optimización real) ───────
    panel.querySelector('#agGenerate').addEventListener('click', async () => {
      const n = Number(panel.querySelector('#agLegs').value);
      const count = Math.max(1, Math.min(50, Number(panel.querySelector('#agCount').value || 1)));
      const stake = Math.max(100, Number(panel.querySelector('#agStake').value || 10000));
      const minEv = (Number(panel.querySelector('#agMinEv')?.value) || 5) / 100 - 0.10; // tolerancia

      // 1) Cargamos matches REALES (API + engine pipeline) — async
      let pool;
      try {
        const live = await BSData.loadEnrichedMatches();
        pool = live.filter(m => activeSport === 'all' || m.sport === activeSport)
                   .filter(m => activeLeagues.has('all') || activeLeagues.has(m.league));
      } catch (e) {
        console.warn('[aig] loadEnrichedMatches failed, falling back:', e?.message);
        pool = applyFilters();
      }

      if (pool.length < n) {
        BSUI.toast({ title: 'Pocos partidos', message: `Necesitamos al menos ${n} partidos. Sumá más ligas.`, type: 'warning' });
        return;
      }

      // 2) Engine "thinking" animation (visual)
      await runEngineAnimation();

      // 3) Mercados habilitados desde los chips de filtros avanzados
      const marketsAvailable = new Set();
      panel.querySelectorAll('.ag-mkt-chip input[type=checkbox][data-mkt]').forEach(cb => {
        if (cb.checked) marketsAvailable.add(cb.dataset.mkt);
      });
      // Default si el usuario desmarcó todo
      if (marketsAvailable.size === 0) {
        ['h2h', 'dc', 'totals', 'btts', 'ah'].forEach(k => marketsAvailable.add(k));
      }

      // 4) Optimización real con branch-and-bound del engine
      let combos = [];
      if (global.BSEngine && global.BSEngine.generateCombos) {
        const engineCombos = BSEngine.generateCombos(pool, n, activeRisk, count, marketsAvailable, { minEv });
        combos = engineCombos.map(c => ({
          legs: c.legs.map(l => ({ ...l, line: l.outcome })),
          total: c.totalOdd,
          prob: c.totalP,
          marketsUsed: [...new Set(c.legs.map(l => l.market))],
          ev: c.ev
        }));
      }

      // 5) Fallback si el engine no encontró suficientes (matches muy filtrados)
      if (combos.length < count) {
        const fill = count - combos.length;
        for (let i = 0; i < fill; i++) {
          const start = (i * Math.max(1, n - 1)) % Math.max(1, pool.length - n + 1);
          const sub = pool.slice(start, start + n);
          if (sub.length < n) break;
          const legs = sub.map((m, j) => buildLeg(m, i + j, activeRisk));
          const total = legs.reduce((a, b) => a * b.odd, 1);
          const prob  = legs.reduce((a, b) => a * b.p, 1);
          const marketsUsed = [...new Set(legs.map(l => l.market))];
          combos.push({ legs, total, prob, marketsUsed, ev: total * prob - 1 });
        }
      }

      const out = panel.querySelector('#agOutput');
      out.innerHTML = `
        <div class="row between mb-3">
          <strong>${combos.length} combinada${combos.length>1?'s':''} generada${combos.length>1?'s':''}</strong>
          <span class="muted tiny">Stake base: ${BSUI.money(stake)} ARS</span>
        </div>
        <div class="grid ${combos.length === 1 ? '' : 'grid-2'}" style="gap:14px">
          ${combos.map((c, ci) => {
            const top3 = top3Books(c.total, c.marketsUsed);
            return `
            <div class="card card-tinted stack-sm reveal ag-combo">
              <div class="row between" style="align-items:center">
                <strong>Combinada #${ci+1} · ${n} legs</strong>
                <span class="risk-pill ${c.total<2?'low':c.total<6?'mid':'high'}">${c.total<2?'Bajo':c.total<6?'Medio':'Alto'} riesgo</span>
              </div>

              <!-- Markets summary -->
              <div class="cluster" style="gap:4px;flex-wrap:wrap">
                ${c.marketsUsed.map(mk => `<span class="badge badge-info" style="font-size:.62rem;padding:2px 7px"><span style="margin-right:3px">${M_ICON[mk]||''}</span>${M[mk]||mk}</span>`).join('')}
              </div>

              <!-- Legs -->
              <div class="ag-legs">
              ${c.legs.map(l => `
                <div class="ag-leg">
                  <div class="ag-leg-teams">
                    ${BSIcons.teamLogo(l.match.home, { size: 18 })}
                    <strong style="font-size:.85rem">${BSUI.esc(l.match.home.name)}</strong>
                    <span class="dim tiny">vs</span>
                    <strong style="font-size:.85rem">${BSUI.esc(l.match.away.name)}</strong>
                    ${BSIcons.teamLogo(l.match.away, { size: 18 })}
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

              <!-- AI explanation: 1-line tactical summary -->
              <div class="ag-ai-explain">
                <span class="ag-ai-tag">🧠 Análisis IA</span>
                <p class="ag-ai-text">${(() => {
                  const factors = [];
                  if (c.marketsUsed.includes('btts')) factors.push('partidos con ofensiva esperada (xG combinado &gt; 2.6)');
                  if (c.marketsUsed.includes('totals')) factors.push('línea de goles favorable según promedio últimos 10 partidos');
                  if (c.marketsUsed.includes('dc')) factors.push('locales fuertes con bajo riesgo de derrota');
                  if (c.marketsUsed.includes('ah')) factors.push('hándicap asiático con value sobre cierre');
                  if (c.marketsUsed.includes('corners')) factors.push('estilo de juego con alta presión de córneres');
                  if (c.marketsUsed.includes('cards')) factors.push('árbitros con tendencia a tarjetear');
                  if (factors.length === 0) factors.push('consenso entre las distintas señales del motor');
                  return `Esta combinada explota ${factors.slice(0, 2).join(' y ')}. EV positivo ${c.ev>=0?'confirmado':'borderline'} contra el cierre del mercado. ${conf>=70?'Alta confianza.':conf>=55?'Confianza media — controlá tu stake.':'Riesgo elevado — para apostadores experimentados.'}`;
                })()}</p>
              </div>

              <!-- BEST-PAYER único — la casa AR que más paga + soporta TODOS los mercados usados -->
              ${(() => {
                const winner = top3[0];
                if (!winner) return '';
                const runnerUp = top3[1];
                const winPay = stake * c.total;
                const upPay  = runnerUp ? stake * c.total * 0.995 : 0;
                const delta  = runnerUp ? ((winPay / upPay - 1) * 100) : 0;
                const winnerLogo = window.BSLogos ? BSLogos.bookLogo(winner.key, { size: 44 }) : '';
                return `
                <div class="ag-best-pay" data-key="${winner.key}" title="${BSUI.esc(winner.name)} es la casa AR que MÁS paga esta combinada">
                  <span class="ag-best-tag">CASA QUE MÁS PAGA</span>
                  <div class="ag-best-row">
                    <div class="ag-best-logo" aria-hidden="true">${winnerLogo}</div>
                    <div class="ag-best-info">
                      <strong class="ag-best-name">${BSUI.esc(winner.name)}</strong>
                      <span class="ag-best-sub">Soporta ${c.marketsUsed.map(k => `<strong>${M[k]||k}</strong>`).join(' · ')}</span>
                    </div>
                    <div class="ag-best-pay-wrap">
                      <span class="ag-best-pay-label">Tu ganancia</span>
                      <strong class="ag-best-pay-amt">${BSUI.money(winPay)}</strong>
                      ${runnerUp && delta > 0.1 ? `<span class="ag-best-pay-delta">+${delta.toFixed(1)}% vs ${BSUI.esc(runnerUp.name)}</span>` : ''}
                    </div>
                  </div>
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
        if (window.BSDash && BSDash.activate) BSDash.activate('whatif');
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
        if (BSUI.modal) BSUI.modal({ title: 'Análisis IA', body: html });
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
