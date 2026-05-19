/* BetSafe — Builder tab: combinada manual con cálculo de mejor casa */
(function () {
  'use strict';

  async function render(panel) {
    const slip = BSStore.get(BSStore.KEYS.slip) || { legs: [], stake: 1000 };

    // Mostrar skeleton mientras llega el snapshot del backend
    panel.innerHTML = `<div class="card stack" style="min-height:240px"><div class="row between"><strong>Cargando partidos en vivo…</strong><span class="muted tiny" id="bdrSt">conectando</span></div><div class="empty">Recibiendo datos de las casas argentinas legales.</div></div>`;

    // Esperar a que el backend nos entregue eventos reales.
    // Filtramos: requiere h2h con al menos 1 book; excluye esports por default
    // (las simulaciones de 4 min copan el feed); sport=soccer por default.
    let matches = (await BSData.awaitLive({ timeoutMs: 12000 }))
      .filter(m => m.markets?.h2h && Object.keys(m.markets.h2h).length >= 1)
      .filter(m => m.sport !== 'esports' && !(window.BSLive?.looksLikeEsports?.(m)));

    if (!matches.length) {
      panel.innerHTML = renderEmpty(BSLive?.state?.error);
      // Re-render cuando llegue el snapshot
      const onSnap = () => { if (BSData.liveReady()) { window.removeEventListener('bs:live-snapshot', onSnap); render(panel); } };
      window.addEventListener('bs:live-snapshot', onSnap, { once: true });
      return;
    }

    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Armá tu combinada<a class="help-q" tabindex="0" data-tip="Elegí los partidos y selecciones que querés combinar. A medida que sumás, te mostramos en tiempo real la cuota total, cuánto podrías ganar y la probabilidad estimada. Lo mejor: te decimos qué casa argentina paga MÁS por tu combinada completa."></a></h2>
          <p class="muted">Sumá partidos uno por uno. Te mostramos cuánto podés ganar y qué casa paga mejor.</p>
        </div>
        <div class="cluster">
          <div class="input-group" style="min-width:240px">
            <span class="icon">${BSIcons.svg('search', { size: 16 })}</span>
            <input class="input" placeholder="Buscar partido o equipo..." id="bSearch"/>
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns: 1.6fr 1fr; gap:16px">
        <div class="card stack">
          <div class="seg" id="bLeagueFilter"></div>
          <div id="bMatches" class="stack-sm" style="max-height:560px;overflow-y:auto"></div>
        </div>

        <div class="card stack">
          <strong>Mi combinada</strong>
          <div id="bLegs" class="stack-sm"></div>
          <div class="row between" style="border-top:1px solid var(--border);padding-top:10px">
            <span class="muted tiny">Cuota total</span>
            <strong class="num" id="bTotalOdd">—</strong>
          </div>
          <div class="row between">
            <span class="muted tiny">Cuánto apostás</span>
            <div class="num-stepper" data-stepper="stake">
              <button type="button" class="num-stepper-btn" data-step="-" aria-label="Disminuir stake">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>
              </button>
              <input id="bStake" class="num-stepper-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${slip.stake || 1000}" />
              <button type="button" class="num-stepper-btn" data-step="+" aria-label="Aumentar stake">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
          </div>
          <div class="row between">
            <span class="muted tiny">Si ganás, cobrás</span>
            <strong class="num text-brand" id="bPayout">—</strong>
          </div>
          <div class="row between">
            <span class="muted tiny">Chance de ganar</span>
            <span class="num" id="bImplied">—</span>
          </div>
          <div class="row between">
            <span class="muted tiny">Riesgo</span>
            <span id="bRisk" class="risk-pill mid">—</span>
          </div>
          <!-- ────────────────────────────────────────────────────────────
               FASE 4.2 — Panel de correlación: warning automático si las
               legs están estructuralmente correlacionadas (ej: home + over
               del mismo partido → la casa te paga menos en realidad).
               Se actualiza cada vez que cambia el slip. Usa /api/correlation
               (solo cálculo, NO consume IA).
               ──────────────────────────────────────────────────────────── -->
          <div id="bCorrelation" hidden></div>
          <div id="bBestBook" class="card card-tinted card-pad-sm"></div>
          <div class="row gap-2">
            <button class="btn btn-outline btn-sm" id="bAiAnalyze" disabled style="flex:1">${BSIcons.svg('bolt', { size: 14 })} Analizar con IA</button>
          </div>
          <div id="bAiAnalysis" style="display:none"></div>
          <div class="row gap-2">
            <button class="btn btn-outline btn-sm w-full" id="bClear">Limpiar</button>
            <button class="btn btn-primary btn-sm w-full mag" id="bShare">Compartir</button>
          </div>
        </div>
      </div>
    `;

    const leagueFilter = panel.querySelector('#bLeagueFilter');
    // Construir lista de ligas únicas con nombre legible (cuando key=null, usar leagueName).
    // Skip entries sin nombre — evitan el chip "null" en el filtro.
    const leagueMap = new Map();
    leagueMap.set('all', 'Todas');
    for (const m of matches) {
      const k = m.league;
      const name = m.leagueName || (BSData.LEAGUES.find(l => l.key === k)?.name);
      if (!name) continue;             // skip si no tenemos nombre
      const id = k || name.toLowerCase().replace(/\s+/g, '-');
      if (!leagueMap.has(id)) leagueMap.set(id, name);
    }
    const leagueEntries = [...leagueMap.entries()].slice(0, 8);
    leagueFilter.innerHTML = leagueEntries.map(([k, label], i) => {
      const logo = (k !== 'all' && window.BSLogos?.leagueLogo) ? window.BSLogos.leagueLogo(k === k.toLowerCase().replace(/\s+/g, '-') ? label : k, { size: 16 }) : '';
      return `<button class="league-chip ${i===0?'active':''}" data-lg="${k}">${logo}<span>${label}</span></button>`;
    }).join('');

    let activeLeague = 'all';
    let q = '';

    function renderMatches() {
      const filtered = matches
        .filter(m => {
          if (activeLeague === 'all') return true;
          if (m.league === activeLeague) return true;
          // Slugified fallback (cuando league key es null, usamos leagueName slug)
          const slug = (m.leagueName || '').toLowerCase().replace(/\s+/g, '-');
          return slug === activeLeague;
        })
        .filter(m => !q || (m.home.name + m.away.name + (m.leagueName || '')).toLowerCase().includes(q.toLowerCase()));
      panel.querySelector('#bMatches').innerHTML = filtered.map(m => matchCard(m)).join('') || '<div class="empty">Sin resultados</div>';
      panel.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
        const data = JSON.parse(b.dataset.add);
        addLeg(data);
      }));
    }

    function matchCard(m) {
      // Filtrar cuotas <= 1.01 (inválidas / no cargadas). Booklas con cuotas
      // 0.00 no aparecen como opciones — el user pidió: 'si no carga, no la pongas'.
      const books = Object.entries(m.markets.h2h || {})
        .filter(([_, b]) => Number(b?.home) > 1.01 || Number(b?.away) > 1.01);
      if (!books.length) return '';   // skip event sin cuotas válidas
      const validHome = books.filter(([_, b]) => Number(b?.home) > 1.01);
      const validDraw = books.filter(([_, b]) => Number(b?.draw) > 1.01);
      const validAway = books.filter(([_, b]) => Number(b?.away) > 1.01);
      const bestH = validHome.length ? validHome.reduce((a, [k, b]) => b.home > a.v ? { v: b.home, book: k } : a, { v: 0, book: '' }) : null;
      const bestD = validDraw.length ? validDraw.reduce((a, [k, b]) => b.draw > a.v ? { v: b.draw, book: k } : a, { v: 0, book: '' }) : null;
      const bestA = validAway.length ? validAway.reduce((a, [k, b]) => b.away > a.v ? { v: b.away, book: k } : a, { v: 0, book: '' }) : null;
      // Si no hay ni home ni away válidos, no mostramos card
      if (!bestH && !bestA) return '';
      const mkLeg = (label, odd, market, outcome, book) => JSON.stringify({
        matchId: m.id, eventId: m.id, label, odd,
        home: m.home.name, away: m.away.name,
        market: market || 'h2h', outcome, book
      });
      const bookName = k => (BSData.ALL_BOOKS.find(b => b.key === k)?.name) || k;
      const homeTeamLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.home.id, { size: 22, name: m.home.name, sport: m.sport }) : BSIcons.teamLogo(m.home, { size: 22, sport: m.sport });
      const awayTeamLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.away.id, { size: 22, name: m.away.name, sport: m.sport }) : BSIcons.teamLogo(m.away, { size: 22, sport: m.sport });
      return `
        <div class="match">
          <div class="teams">
            <div class="cluster">${homeTeamLogo}<strong class="name">${BSUI.esc(m.home.name)}</strong></div>
            <div class="cluster">${awayTeamLogo}<strong class="name">${BSUI.esc(m.away.name)}</strong></div>
            <div class="muted tiny">${BSUI.esc(m.leagueName || '')} · ${BSUI.dt(m.start)}</div>
          </div>
          ${bestH ? `<button class="odd best" data-add='${mkLeg(m.home.name + ' gana', bestH.v, 'h2h', 'home', bestH.book)}'>
            <span class="odd-num num">${bestH.v.toFixed(2)}</span>
            <span class="odd-book">${window.BSLogos?BSLogos.bookLogo(bestH.book,{size:14}):''}<span class="small">${BSUI.esc(bookName(bestH.book))}</span></span>
          </button>` : ''}
          ${bestD ? `<button class="odd" data-add='${mkLeg('Empate', bestD.v, 'h2h', 'draw', bestD.book)}'>
            <span class="odd-num num">${bestD.v.toFixed(2)}</span>
            <span class="odd-book">${window.BSLogos?BSLogos.bookLogo(bestD.book,{size:14}):''}<span class="small">${BSUI.esc(bookName(bestD.book))}</span></span>
          </button>` : ''}
          ${bestA ? `<button class="odd" data-add='${mkLeg(m.away.name + ' gana', bestA.v, 'h2h', 'away', bestA.book)}'>
            <span class="odd-num num">${bestA.v.toFixed(2)}</span>
            <span class="odd-book">${window.BSLogos?BSLogos.bookLogo(bestA.book,{size:14}):''}<span class="small">${BSUI.esc(bookName(bestA.book))}</span></span>
          </button>` : ''}
        </div>`;
    }

    function addLeg(leg) {
      slip.legs.push(leg);
      BSStore.set(BSStore.KEYS.slip, slip);
      renderSlip();
      BSDash.renderSlipBar();
      BSUI.toast({ title: 'Agregado', message: leg.label, type: 'success' });
    }

    // ─── FASE 4.2 — Validación de correlación automática ────────────────
    // Estado del último análisis (lo necesitamos para interceptar acciones
    // como "compartir" y mostrar confirm si la correlación es peligrosa).
    let lastCorr = null;
    let corrDebounce = null;

    async function analyzeCorrelation() {
      const host = panel.querySelector('#bCorrelation');
      if (!host) return;
      if (slip.legs.length < 2) { host.hidden = true; host.innerHTML = ''; lastCorr = null; return; }

      // Debounce 500ms para no spammar el endpoint mientras el user agrega legs rápido
      if (corrDebounce) clearTimeout(corrDebounce);
      corrDebounce = setTimeout(async () => {
        try {
          const res = await fetch((window.BS_API_BASE || '') + '/api/correlation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ legs: slip.legs.map(l => ({
              eventId: l.matchId || l.eventId,
              sport: l.sport, market: l.market, outcome: l.outcome, line: l.line
            })) })
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          lastCorr = data;
          renderCorrPanel(host, data);
        } catch (e) {
          // Falla silenciosa — no bloqueamos al user si la API está caída
          host.hidden = true;
          lastCorr = null;
        }
      }, 500);
    }

    function renderCorrPanel(host, data) {
      if (!data || !Array.isArray(data.pairs)) { host.hidden = true; return; }
      const maxPos = Number(data.maxPositiveCorrelation) || 0;
      const evAdj = Number(data.evAdjustment) || 0;
      const lvl = maxPos >= 0.7 ? 'danger' : maxPos >= 0.4 ? 'warn' : 'ok';
      const icon = lvl === 'danger' ? '🚨' : lvl === 'warn' ? '⚠️' : '✅';
      const title = lvl === 'danger' ? 'Legs muy correlacionadas — cuota engañosa'
                  : lvl === 'warn'   ? 'Correlación moderada — revisá'
                  :                    'Combinada independiente';
      const desc = lvl === 'danger' ? 'La casa te paga MENOS de lo que sugiere la cuota total. Las legs no son eventos independientes.'
                 : lvl === 'warn'   ? 'Algunas legs se influyen entre sí. El EV real es menor al aparente.'
                 :                    'Las legs son independientes. La cuota total refleja el riesgo real.';
      // Top 3 pares más correlacionados (que tengan corr ≠ 0)
      const topPairs = (data.pairs || [])
        .filter(p => Math.abs(p.corr || 0) >= 0.1)
        .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
        .slice(0, 3);

      host.hidden = false;
      host.className = `bsai-corr-panel is-${lvl}`;
      host.innerHTML = `
        <div class="bsai-corr-panel__head">
          <strong>${icon} ${title}</strong>
          <span class="muted tiny">${data.legs} legs · ${data.pairs.length} pares</span>
        </div>
        <p class="muted tiny" style="margin:0;line-height:1.4">${desc}</p>
        <div class="bsai-corr-panel__metric">
          <span>Correlación máxima entre pares</span>
          <strong class="${lvl === 'danger' ? 'text-danger' : lvl === 'warn' ? 'text-warning' : 'text-success'}">${(maxPos * 100).toFixed(0)}%</strong>
        </div>
        <div class="bsai-corr-panel__metric">
          <span>Ajuste de EV por correlación</span>
          <strong class="${evAdj < -0.1 ? 'text-danger' : evAdj < 0 ? 'text-warning' : 'text-success'}">${evAdj === 0 ? '0%' : `${(evAdj * 100).toFixed(1)}%`}</strong>
        </div>
        ${topPairs.length ? `
          <details>
            <summary style="cursor:pointer;font-size:.74rem;font-weight:600;color:var(--muted)">Ver ${topPairs.length} par${topPairs.length > 1 ? 'es' : ''} correlacionado${topPairs.length > 1 ? 's' : ''}</summary>
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
              ${topPairs.map(p => {
                const corrVal = Number(p.corr) || 0;
                const corrAbs = Math.abs(corrVal);
                const cls = corrVal < 0 ? 'is-neg' : corrAbs >= 0.7 ? 'is-high' : corrAbs >= 0.4 ? 'is-mid' : 'is-low';
                const legA = slip.legs[p.a];
                const legB = slip.legs[p.b];
                return `
                  <div class="bsai-corr-panel__pair">
                    <span class="tiny">
                      <strong>#${p.a+1}</strong> ${BSUI.esc(legA?.label || '?')}
                      <span class="dim">↔</span>
                      <strong>#${p.b+1}</strong> ${BSUI.esc(legB?.label || '?')}
                    </span>
                    <span class="bsai-corr-panel__pair-corr ${cls}" title="${p.reason || ''}">
                      ${corrVal > 0 ? '+' : ''}${(corrVal * 100).toFixed(0)}%
                    </span>
                  </div>
                `;
              }).join('')}
            </div>
          </details>
        ` : ''}
        ${Array.isArray(data.warnings) && data.warnings.length ? `
          <ul class="bsai-corr-panel__warnings">
            ${data.warnings.slice(0, 4).map(w => `<li>${BSUI.esc(String(w))}</li>`).join('')}
          </ul>
        ` : ''}
        ${lvl === 'danger' ? `
          <div style="padding:8px 10px;background:rgba(192,57,43,0.1);border-radius:6px;font-size:.76rem;margin-top:4px">
            💡 <strong>Sugerencia:</strong> reemplazá una de las legs correlacionadas por otra de un partido distinto para que la cuota total refleje el riesgo real.
          </div>
        ` : ''}
      `;
    }

    function renderSlip() {
      const total = slip.legs.reduce((a, b) => a * b.odd, 1);
      const stake = slip.stake = Number(panel.querySelector('#bStake').value || 0);
      const implied = total > 0 ? 1 / total : 0;
      panel.querySelector('#bLegs').innerHTML = slip.legs.length ? slip.legs.map((l, i) =>
        `<div class="row between" style="padding:8px;background:var(--surface-2);border-radius:8px"><span><strong>${BSUI.esc(l.label)}</strong></span><span class="cluster"><strong class="num">${l.odd.toFixed(2)}</strong><button class="btn-ghost btn-icon btn-sm" data-rm="${i}">×</button></span></div>`
      ).join('') : `<div class="empty" style="padding:18px">Tocá una cuota para empezar</div>`;
      panel.querySelector('#bTotalOdd').textContent = slip.legs.length ? total.toFixed(2) : '—';
      panel.querySelector('#bPayout').textContent = slip.legs.length ? BSUI.money(stake * total) : '—';
      panel.querySelector('#bImplied').textContent = slip.legs.length ? BSUI.pct(implied) : '—';
      const riskEl = panel.querySelector('#bRisk');
      const lvl = total < 2 ? 'low' : total < 6 ? 'mid' : 'high';
      riskEl.textContent = lvl === 'low' ? 'Bajo' : lvl === 'mid' ? 'Medio' : 'Alto';
      riskEl.className = `risk-pill ${lvl}`;
      panel.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { slip.legs.splice(Number(b.dataset.rm), 1); BSStore.set(BSStore.KEYS.slip, slip); renderSlip(); BSDash.renderSlipBar(); }));

      // Enable AI analysis button cuando hay 2+ legs
      const aiBtn = panel.querySelector('#bAiAnalyze');
      if (aiBtn) {
        aiBtn.disabled = slip.legs.length < 2;
        aiBtn.title = slip.legs.length < 2 ? 'Necesitás al menos 2 legs para analizar' : 'Análisis IA de la combinada';
      }

      // Best book overall: ranking REAL de las 6 casas argentinas que cubren TODAS las legs
      const bestHost = panel.querySelector('#bBestBook');
      if (!slip.legs.length) { bestHost.innerHTML = '<span class="muted tiny">Mejor casa para tu combinada aparecerá acá.</span>'; return; }
      const ranking = computeBestBookForCombo(matches, slip.legs);
      if (!ranking.length) {
        bestHost.innerHTML = '<span class="muted tiny">Ninguna casa argentina cubre todas las legs de esta combinada.</span>';
        return;
      }
      const winner = ranking[0];
      const winnerLogo = window.BSLogos?.bookLogo ? BSLogos.bookLogo(winner.book.key, { size: 26 }) : '';
      // Top 1 (winner) + hasta 2 más para comparar (Top 3)
      const others = ranking.slice(1, 3).map(r => {
        const lg = window.BSLogos?.bookLogo ? BSLogos.bookLogo(r.book.key, { size: 18 }) : '';
        const diff = winner.totalOdd - r.totalOdd;
        const diffPct = (diff / winner.totalOdd * 100);
        return `<div class="bb-row">
          <span class="cluster">${lg}<span>${BSUI.esc(r.book.name)}</span></span>
          <span class="cluster"><strong class="num">${r.totalOdd.toFixed(2)}</strong><span class="muted tiny">−${diffPct.toFixed(1)}%</span></span>
        </div>`;
      }).join('');
      bestHost.innerHTML = `
        <div class="bb-winner">
          <div class="bb-winner__head">
            <div>
              <span class="muted tiny">Mejor casa para esta combinada</span>
              <div class="bb-winner__name">${winnerLogo}<strong>${BSUI.esc(winner.book.name)}</strong></div>
            </div>
            <div class="bb-winner__odd">
              <span class="badge badge-success num">${winner.totalOdd.toFixed(2)}</span>
              <span class="muted tiny">${winner.coveredLegs}/${slip.legs.length} legs cubiertas</span>
            </div>
          </div>
          ${others ? `<div class="bb-others">${others}</div>` : ''}
        </div>`;

      // FASE 4.2 — Trigger correlation analysis (debounced 500ms, free de IA)
      analyzeCorrelation();
    }

    function computeBestBookForCombo(matches, legs) {
      // Para cada casa AR, multiplicamos las cuotas reales de cada leg en ESA casa.
      // Si la casa no cubre alguna leg (mercado no listado), contamos solo las cubiertas
      // y reportamos coveredLegs para que el usuario sepa la cobertura.
      const live = BSData.liveEvents({}) || [];
      const ranking = [];
      BSData.BOOKS_AR.forEach(book => {
        let prod = 1, coveredLegs = 0;
        for (const l of legs) {
          // Buscar el evento en el live feed (fuente de verdad)
          const ev = live.find(e => e.id === (l.matchId || l.eventId)) ||
                     matches.find(x => x.id === (l.matchId || l.eventId));
          if (!ev) continue;
          const market = l.market || 'h2h';
          const outcome = l.outcome || (l.label?.includes(ev.home?.name) ? 'home'
                                     : l.label?.includes(ev.away?.name) ? 'away'
                                     : l.label?.toLowerCase().includes('empate') ? 'draw' : null);
          const marketData = ev.markets?.[market];
          if (!marketData) continue;
          const bookOdds = marketData[book.key];
          if (!bookOdds) continue;
          const odd = outcome === 'home' ? bookOdds.home
                    : outcome === 'away' ? bookOdds.away
                    : outcome === 'draw' ? bookOdds.draw
                    : null;
          if (Number.isFinite(odd) && odd > 1.01) {
            prod *= odd;
            coveredLegs++;
          }
        }
        if (coveredLegs > 0) {
          ranking.push({ book, totalOdd: prod, coveredLegs });
        }
      });
      // Ordenar por cuota total DESC, priorizando los que cubren más legs
      ranking.sort((a, b) => {
        if (a.coveredLegs !== b.coveredLegs) return b.coveredLegs - a.coveredLegs;
        return b.totalOdd - a.totalOdd;
      });
      return ranking;
    }

    panel.querySelector('#bSearch').addEventListener('input', e => { q = e.target.value; renderMatches(); });
    leagueFilter.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      leagueFilter.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); activeLeague = b.dataset.lg; renderMatches();
    });
    panel.querySelector('#bStake').addEventListener('input', renderSlip);
    // Custom stake stepper buttons (+/-)
    const bStakeEl = panel.querySelector('#bStake');
    panel.querySelectorAll('[data-stepper="stake"] .num-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sign = btn.dataset.step === '+' ? 1 : -1;
        const cur = Number(String(bStakeEl.value).replace(/[^\d.-]/g, '')) || 0;
        // Magnitude-aware step suave: cuando vas a CRUZAR un threshold,
        // primero te dejamos LANDEAR en el threshold con el step viejo (sin
        // jump abrupto). Después el próximo click usa el step nuevo.
        //   Antes: 4900 + → 5000 (step 100) · siguiente click 5000 → 5500
        //          (jump visible de 100 a 500). Hoy: el primer click te lleva
        //          al threshold limpio; los siguientes usan el nuevo step.
        const stepFor = v => v >= 50000 ? 1000 : v >= 5000 ? 500 : 100;
        const step = stepFor(cur);
        let next = Math.max(0, cur + sign * step);
        // Si cruzamos un threshold hacia arriba, snap al threshold exacto
        // (5000 o 50000) en lugar de sobrepasarlo con un step de magnitud baja.
        if (sign > 0) {
          if (cur < 5000 && next > 5000) next = 5000;
          else if (cur < 50000 && next > 50000) next = 50000;
        }
        bStakeEl.value = String(next);
        bStakeEl.dispatchEvent(new Event('input', { bubbles: true }));
        // Tactile press animation
        btn.classList.remove('is-press');
        // eslint-disable-next-line no-unused-expressions
        btn.offsetWidth;
        btn.classList.add('is-press');
      });
    });
    // Sanitize: allow only digits in the custom stepper input
    bStakeEl.addEventListener('input', () => {
      const cleaned = String(bStakeEl.value).replace(/[^\d]/g, '');
      if (cleaned !== bStakeEl.value) bStakeEl.value = cleaned;
    });
    panel.querySelector('#bClear').addEventListener('click', () => {
      slip.legs = []; BSStore.set(BSStore.KEYS.slip, slip); renderSlip(); BSDash.renderSlipBar();
      const aiHost = panel.querySelector('#bAiAnalysis');
      if (aiHost) { aiHost.style.display = 'none'; aiHost.innerHTML = ''; }
    });

    /* AI Combo Analysis (Groq llama-3.3-70b vía /api/combo/analyze).
     * Pasa el slip completo al backend, recibe lectura cualitativa:
     * riesgo, leg débil, leg fuerte, correlación, sugerencia, narrativa. */
    panel.querySelector('#bAiAnalyze').addEventListener('click', async () => {
      if (slip.legs.length < 2) return;
      const btn = panel.querySelector('#bAiAnalyze');
      const aiHost = panel.querySelector('#bAiAnalysis');
      btn.disabled = true;
      btn.innerHTML = `${BSIcons.svg('bolt', { size: 14 })} <span class="shimmer-text">Analizando con IA...</span>`;
      aiHost.style.display = 'block';
      aiHost.innerHTML = `<div class="card card-tinted card-pad-sm" style="margin-top:8px"><div class="muted tiny">IA analizando tu combinada...</div><div style="height:3px;background:linear-gradient(90deg,var(--brand-500),transparent,var(--brand-500));background-size:200% 100%;animation:shimmer 1.2s infinite;margin-top:6px;border-radius:2px"></div></div>`;
      try {
        const stake = Number(panel.querySelector('#bStake').value) || 1000;
        const result = await BSLive.analyzeCombo(slip.legs, stake);
        renderAiAnalysis(aiHost, result);
      } catch (e) {
        aiHost.innerHTML = `<div class="card card-tinted card-pad-sm" style="margin-top:8px"><strong class="text-danger tiny">Error</strong><p class="muted tiny">${BSUI.esc(e?.message || 'IA no disponible')}</p></div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${BSIcons.svg('bolt', { size: 14 })} Analizar con IA`;
      }
    });

    function renderAiAnalysis(host, r) {
      if (!r) return;
      const riskColor = { low: 'success', mid: 'warning', high: 'danger', extreme: 'danger' }[r.riskAssessment] || 'warning';
      const riskLabel = { low: 'Bajo', mid: 'Medio', high: 'Alto', extreme: 'Extremo' }[r.riskAssessment] || 'Medio';
      const provider = r.provider === 'groq' ? '<span class="badge badge-success tiny" style="margin-left:6px">IA: groq</span>' : '<span class="badge tiny" style="margin-left:6px">offline</span>';
      const corrHtml = (r.correlationWarnings || []).length
        ? `<div class="cluster" style="flex-wrap:wrap;gap:4px;margin-top:6px">${r.correlationWarnings.map(w => `<span class="badge badge-warning tiny">⚠ ${BSUI.esc(w)}</span>`).join('')}</div>`
        : '';
      const weakest = r.weakestLeg && r.weakestLeg.index != null
        ? `<div class="row between tiny" style="margin-top:6px"><span class="muted">Leg más débil</span><span><strong>#${r.weakestLeg.index + 1}</strong> — ${BSUI.esc(r.weakestLeg.reason || '')}</span></div>`
        : '';
      const strongest = r.strongestLeg && r.strongestLeg.index != null
        ? `<div class="row between tiny"><span class="muted">Leg más sólida</span><span><strong>#${r.strongestLeg.index + 1}</strong> — ${BSUI.esc(r.strongestLeg.reason || '')}</span></div>`
        : '';
      host.innerHTML = `
        <div class="card card-tinted card-pad-sm" style="margin-top:8px;border-left:3px solid var(--brand-500)">
          <div class="row between" style="align-items:center">
            <strong class="tiny">Análisis IA${provider}</strong>
            <span class="badge badge-${riskColor} tiny">Riesgo ${riskLabel}</span>
          </div>
          <div class="row between tiny" style="margin-top:6px">
            <span class="muted">Prob. real estimada</span>
            <strong class="num">${r.probWinPct?.toFixed(1)}%</strong>
          </div>
          <div class="row between tiny">
            <span class="muted">Prob. ingenua (1/cuota)</span>
            <span class="num muted">${r.naiveProbWinPct?.toFixed(1)}%</span>
          </div>
          ${weakest}${strongest}${corrHtml}
          ${r.suggestion ? `<p class="muted tiny" style="margin-top:8px;line-height:1.45"><strong>Sugerencia:</strong> ${BSUI.esc(r.suggestion)}</p>` : ''}
          ${r.narrative ? `<p class="muted tiny" style="margin-top:6px;line-height:1.45;font-style:italic">${BSUI.esc(r.narrative)}</p>` : ''}
        </div>
      `;
    }
    panel.querySelector('#bShare').addEventListener('click', () => {
      // FASE 4.2 — Si la correlación es peligrosa, confirmar antes de compartir.
      // El usuario PUEDE seguir adelante (no bloqueamos), solo lo advertimos.
      const maxPos = Number(lastCorr?.maxPositiveCorrelation) || 0;
      if (maxPos >= 0.7) {
        const ok = confirm(
          `⚠️ Esta combinada tiene legs muy correlacionadas (${(maxPos * 100).toFixed(0)}%).\n\n` +
          `La cuota total que ves es ENGAÑOSA — la casa te está pagando menos de lo que sugiere por culpa de la correlación.\n\n` +
          `¿Compartir igual?`
        );
        if (!ok) return;
      }
      const url = location.origin + '/dashboard.html#builder?slip=' + encodeURIComponent(JSON.stringify(slip.legs));
      BSUI.share({ title: 'Mi combinada — BetSafe', url });
    });

    renderMatches();
    renderSlip();

    // Re-render cuando lleguen updates en vivo (cuotas movieron)
    const onUpdate = () => {
      const fresh = BSData.liveEvents({});
      // Mantener referencias en matches sin perder estado de UI
      matches.length = 0; Array.prototype.push.apply(matches, fresh);
      renderMatches(); renderSlip();
    };
    // Solo snapshot (~30s) — bs:live-update cada 1.2s genera flicker
    window.addEventListener('bs:live-snapshot', onUpdate);
    panel.__cleanup = () => window.removeEventListener('bs:live-snapshot', onUpdate);
  }

  function renderEmpty(err) {
    return `<div class="card stack" style="min-height:280px;align-items:center;text-align:center;padding:40px">
      <strong>Aún no hay datos en vivo</strong>
      <p class="muted">El backend está scrapeando las casas argentinas. Cuando llegue el primer snapshot, los partidos aparecen acá automáticamente.</p>
      ${err ? `<small class="muted tiny">Detalle técnico: ${BSUI.esc(err)}</small>` : ''}
      <span class="muted tiny">Último estado: ${BSData.liveFreshness()}</span>
    </div>`;
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('builder', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('builder', render));
  }
  doRegister();
  window.__bsBuilderRender = render;
})();
