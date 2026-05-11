/* BetSafe — AI Picks tab: 3 picks por partido (cons/equilibrado/agresivo) */
(function () {
  'use strict';

  function render(panel) {
    // Matches sintéticos como bootstrap. Async, después, intentamos upgrade
    // a matches REALES (API + engine) y re-renderizamos sin parpadeo.
    let matches = (BSData.enrichSyntheticMatches
      ? BSData.enrichSyntheticMatches()
      : BSData.makeMatches()).slice(0, 12);
    const isVip = BSAuth.isVip();
    const SPORTS = (BSData.SPORTS || []).slice(0, 6);
    const LEAGUES = BSData.LEAGUES || [];
    const MAX_COMBOS = isVip ? 99 : 2;

    panel.innerHTML = `
      <div class="row between mb-4">
        <div>
          <h2 class="h3">AI Picks · picks recomendados por la IA<a class="help-q" tabindex="0" data-tip="Por cada partido del día te damos 3 opciones para elegir según tu estilo: Conservador (cuota baja, alta chance de ganar), Equilibrado (riesgo y premio balanceados) y Agresivo (cuota alta, más riesgo). Cada pick incluye el análisis de la IA y te decimos qué casa argentina paga mejor ese mercado."></a></h2>
          <p class="muted">${isVip ? 'IA Pro VIP — picks ilimitados' : 'IA Estándar — 5 partidos por día (3 picks cada uno)'}</p>
        </div>
        <div class="cluster">
          <button class="btn btn-primary mag" id="aiAnalyze">${BSIcons.svg('bolt', { size: 16 })} Analizar mercado</button>
        </div>
      </div>

      <!-- Filtros: deporte + ligas -->
      <div class="card stack mb-3">
        <div class="row between">
          <strong>Filtrá por deporte y liga<a class="help-q" tabindex="0" data-tip="Elegí los deportes y ligas que querés analizar. Mientras más ligas elijas, más opciones encuentra la IA para generar combinadas del día."></a></strong>
          <span class="muted tiny" id="aiFilterCount">Todos los deportes · todas las ligas</span>
        </div>
        <div>
          <span class="muted tiny" style="display:block;margin-bottom:6px">Deporte</span>
          <div class="cluster" id="aiSportChips">
            <button class="league-chip active" data-sport="all">Todos</button>
            ${SPORTS.map(s => `<button class="league-chip" data-sport="${s.key}">${BSIcons.svg(s.icon || 'soccer', {size:14})}<span>${s.name}</span></button>`).join('')}
          </div>
        </div>
        <div>
          <span class="muted tiny" style="display:block;margin-bottom:6px;margin-top:4px">Ligas (multi-selección)</span>
          <div class="cluster" id="aiLeagueChips">
            <button class="league-chip active" data-lg="all">Todas</button>
            ${LEAGUES.slice(0, 12).map(l => {
              const logo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(l.key, { size: 16 }) : '';
              return `<button class="league-chip" data-lg="${l.key}">${logo}<span>${l.name}</span></button>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div id="aiPicks" class="grid grid-auto-lg"></div>
    `;

    let activeSport = 'all';
    let activeLeagues = new Set(['all']);

    function applyFilters() {
      let list = matches;
      if (activeSport !== 'all')         list = list.filter(m => m.sport === activeSport);
      if (!activeLeagues.has('all'))      list = list.filter(m => activeLeagues.has(m.league));
      return list;
    }

    function renderPicks() {
      const list = applyFilters();
      const limit = isVip ? 12 : 5;       // Standard = 5 matches × 3 = 15 picks
      const out = panel.querySelector('#aiPicks');
      out.innerHTML = list.slice(0, limit).map(m => pickCard(m)).join('') ||
        '<div class="empty card stack" style="text-align:center;padding:40px"><strong>Sin partidos para los filtros elegidos</strong><span class="muted tiny">Probá con otro deporte o más ligas.</span></div>';
      out.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        const data = JSON.parse(b.dataset.pick);
        BSDash.addToSlip(data);
      }));
      out.querySelectorAll('[data-justify]').forEach(b => b.addEventListener('click', () => openAnalysis(b.dataset.justify, JSON.parse(b.dataset.match))));
      // Update filter counter
      const sportTxt = activeSport === 'all' ? 'Todos los deportes' : (BSData.SPORTS.find(s=>s.key===activeSport)?.name || activeSport);
      const lgTxt    = activeLeagues.has('all') ? 'todas las ligas' : `${activeLeagues.size} liga${activeLeagues.size>1?'s':''}`;
      panel.querySelector('#aiFilterCount').textContent = `${sportTxt} · ${lgTxt} · ${list.length} partidos`;
    }

    // Resolve real per-book odd for a pick (uses match.markets[market][bookKey])
    function bookPriceFor(match, pick, bookKey) {
      const mk = pick.market;
      const m = match.markets[mk];
      if (!m || !m[bookKey]) return null;
      const ent = m[bookKey];
      switch (mk) {
        case 'h2h':     return pick.label.includes(match.home.name) ? ent.home : pick.label.includes('Empate') ? ent.draw : ent.away;
        case 'dc':      return pick.line === '1X' ? ent.home_or_draw : pick.line === 'X2' ? ent.draw_or_away : ent.home_or_away;
        case 'totals':  return pick.line.startsWith('Over') ? ent.over : ent.under;
        case 'btts':    return pick.line === 'sí' ? ent.yes : ent.no;
        case 'ah':      return pick.line.startsWith('-') ? ent.home_minus : ent.away_plus;
        case 'corners': return pick.line.startsWith('Over') ? ent.over : ent.under;
        case 'cards':   return pick.line.startsWith('Over') ? ent.over : ent.under;
        default: return null;
      }
    }

    // Top-3 books by REAL price for this pick — sorted best-to-worst,
    // filtered to those that support every market used.
    function top3BooksRanked(match, pick) {
      const ar = (BSData.BOOKS_AR || []);
      const cov = BSData.BOOK_MARKET_COVERAGE || {};
      const list = ar
        .filter(b => cov[b.key]?.[pick.market])
        .map(b => ({ book: b, price: bookPriceFor(match, pick, b.key) }))
        .filter(x => x.price && x.price > 0)
        .sort((a, b) => b.price - a.price);
      return list.slice(0, 3);
    }

    // Banner único: la casa que MÁS paga por este pick. Sin ranking,
    // sin "1°/2°/3°" — un solo card prominente que el usuario lee de un vistazo.
    function bookBestBanner(match, pick) {
      const ranked = top3BooksRanked(match, pick);
      if (ranked.length === 0) return '';
      const winner = ranked[0];
      const runnerUp = ranked[1];
      const { book, price } = winner;
      const logo = window.BSLogos ? BSLogos.bookLogo(book.key, { size: 36 }) : '';
      // Diferencia % vs la siguiente mejor (sirve como prueba "vale la pena ir a esta casa")
      const delta = runnerUp ? ((price / runnerUp.price - 1) * 100) : 0;
      const deltaTxt = (runnerUp && delta > 0.5)
        ? `<span class="ai-best-delta">+${delta.toFixed(1)}% vs ${BSUI.esc(runnerUp.book.name)}</span>`
        : '';
      return `
        <div class="ai-best-pay" data-key="${book.key}" title="${BSUI.esc(book.name)} es la casa que mejor paga este pick" aria-label="Mejor pago: ${BSUI.esc(book.name)} ${price.toFixed(2)}">
          <span class="ai-best-crown" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18l2-10 5 5 4-8 4 8 5-5 2 10H3z"/></svg>
          </span>
          <span class="ai-best-logo" aria-hidden="true">${logo}</span>
          <strong class="ai-best-price num">${price.toFixed(2)}</strong>
        </div>`;
    }
    // Alias retro-compat (otras partes del código pueden seguir llamando bookPodiumGroup)
    function bookPodiumGroup(match, pick) { return bookBestBanner(match, pick); }
    // Legacy chip kept (used in combinada generator output)
    function bookChip(b) {
      if (!b) return '';
      const logo = window.BSLogos ? BSLogos.bookLogo(b.key, { size: 12 }) : '';
      return `<span class="cmp-book-chip" style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;background:var(--surface);border:1px solid var(--border);border-radius:999px;font-size:.62rem;font-weight:700">${logo}<span>${BSUI.esc(b.name)}</span></span>`;
    }
    function top3Books(odd, marketsUsed = ['h2h']) {
      // Backwards-compat helper used by the combinada generator (no per-leg price)
      const ar = (BSData.BOOKS_AR || []);
      const cov = BSData.BOOK_MARKET_COVERAGE || {};
      const eligible = ar.filter(b => marketsUsed.every(m => cov[b.key]?.[m]));
      const pool = eligible.length >= 3 ? eligible : ar;
      const idx = Math.abs(Math.floor(odd * 100)) % Math.max(1, pool.length);
      const out = []; const used = new Set();
      for (let i = 0; i < pool.length && out.length < 3; i++) {
        const k = (idx + i * 3) % pool.length;
        if (!used.has(pool[k].key)) { used.add(pool[k].key); out.push(pool[k]); }
      }
      while (out.length < 3) out.push(pool[out.length] || ar[out.length]);
      return out;
    }

    // Build diverse picks per match — usa BSEngine.pickForMatch (real)
    // si el match tiene modelProbs; cae a heurística si no.
    function buildDiversePicks(m) {
      // Primary: engine quantitativo — selecciona el mejor EV por banda de riesgo
      if (global.BSEngine && m.modelProbs) {
        const markets = new Set(['h2h', 'dc', 'totals', 'btts']);
        const picks = BSEngine.pickForMatch(m, markets);
        const map = ['cons', 'eq', 'agg'];
        const out = map.map(r => {
          const p = picks[r];
          if (!p) return null;
          return {
            type: r,
            label: p.label,
            market: p.market,
            odd: p.odd,
            p: p.p,
            line: p.outcome,
            ev: p.ev
          };
        });
        // Si el engine produjo los 3, usar; si no, completar con heurística
        if (out.every(x => x)) return out;
      }
      // Fallback heurístico (mantiene compatibilidad con datos sintéticos sin engine)
      const o = m.markets.h2h.bplay || Object.values(m.markets.h2h)[0];
      const home = o.home, away = o.away, draw = o.draw;
      const isSoccer = m.sport === 'soccer';

      // CONSERVADOR — high probability via Doble oportunidad / Over 1.5 / favorita
      let cons;
      if (isSoccer && m.markets.dc) {
        const dcRef = m.markets.dc.bplay || Object.values(m.markets.dc)[0];
        cons = { type:'cons', label: `${m.home.name} o empate (1X)`, market:'dc', odd: dcRef.home_or_draw, p: 1/dcRef.home_or_draw, line:'1X' };
      } else {
        cons = { type:'cons', label: `${m.home.name} -1.5 hándicap`, market:'ah', odd: Math.max(1.4, home*0.55), p: 0.62, line:'-1.5' };
      }

      // EQUILIBRADO — value: BTTS / Over 2.5 / Hándicap asiático -0.5
      let eq;
      if (isSoccer && m.markets.btts) {
        const bttsRef = m.markets.btts.bplay || Object.values(m.markets.btts)[0];
        eq = { type:'eq', label:'Ambos equipos marcan (BTTS sí)', market:'btts', odd: bttsRef.yes, p: 1/bttsRef.yes, line:'sí' };
      } else if (m.markets.totals) {
        const ouRef = m.markets.totals.bplay || Object.values(m.markets.totals)[0];
        eq = { type:'eq', label: `Más de ${ouRef.line} ${isSoccer?'goles':'puntos'}`, market:'totals', odd: ouRef.over, p: 1/ouRef.over, line: 'Over '+ouRef.line };
      } else {
        eq = { type:'eq', label:'Empate', market:'h2h', odd: draw||3.0, p: 1/(draw||3.0), line:'X' };
      }

      // AGRESIVO — alta cuota: Combo / corners / tarjetas / longshot
      let agg;
      if (isSoccer && m.markets.corners) {
        const c = m.markets.corners.bplay || Object.values(m.markets.corners)[0];
        agg = { type:'agg', label: `Más de ${c.line} corners`, market:'corners', odd: c.over * 1.05, p: 1/(c.over*1.05), line:'Over '+c.line };
      } else if (m.markets.totals) {
        const ouRef = m.markets.totals.bplay || Object.values(m.markets.totals)[0];
        agg = { type:'agg', label: `Más de ${ouRef.line + (isSoccer?1:5)} ${isSoccer?'goles':'puntos'}`, market:'totals', odd: ouRef.over * 1.45, p: 1/(ouRef.over*1.45), line: `Over ${ouRef.line + (isSoccer?1:5)}` };
      } else {
        agg = { type:'agg', label: `${m.away.name} +0 hándicap`, market:'ah', odd: Math.max(1.5, away*0.75), p: 0.55, line:'+0' };
      }

      return [cons, eq, agg];
    }

    function pickCard(m) {
      const picks = buildDiversePicks(m);
      const MARKET_LABELS = { h2h:'1X2', dc:'Doble Oport.', totals:'Goles O/U', btts:'BTTS', ah:'Hándicap', corners:'Corners', cards:'Tarjetas' };
      const RISK_LABELS = ['Conservador', 'Equilibrado', 'Agresivo'];
      const RISK_CLASSES = ['low', 'mid', 'high'];
      const RISK_HINTS = ['Alta chance, cuota baja', 'Balance riesgo / premio', 'Alta cuota, mayor riesgo'];
      const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.home.id, { size: 30 }) : BSIcons.teamLogo(m.home, { size: 30 });
      const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.away.id, { size: 30 }) : BSIcons.teamLogo(m.away, { size: 30 });
      const leagueLogo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(m.league, { size: 16 }) : '';
      return `
        <article class="ai-match reveal">
          <header class="ai-match__head">
            <div class="ai-match__teams">
              <span class="ai-match__crest">${homeLogo}</span>
              <span class="ai-match__name">${BSUI.esc(m.home.name)}</span>
              <span class="ai-match__vs">vs</span>
              <span class="ai-match__name">${BSUI.esc(m.away.name)}</span>
              <span class="ai-match__crest">${awayLogo}</span>
            </div>
            <div class="ai-match__meta">
              <span class="ai-match__league">${leagueLogo}<span>${BSUI.esc(m.leagueName)}</span></span>
              <span class="ai-match__sep">·</span>
              <span class="ai-match__time">${BSUI.dt(m.start)}</span>
              <span class="ai-match__ia" title="Análisis generado por IA">${BSIcons.svg('bolt',{size:12})} IA</span>
            </div>
          </header>

          <div class="ai-match__picks">
            ${picks.map((p, i) => {
              const ev = p.p * (p.odd - 1) - (1 - p.p);
              const evPos = ev > 0;
              const market = MARKET_LABELS[p.market] || 'Mercado';
              return `
                <div class="ai-pick ai-pick--${RISK_CLASSES[i]}" style="--i:${i}">
                  <div class="ai-pick__rail" aria-hidden="true"></div>
                  <div class="ai-pick__head">
                    <span class="ai-pick__risk risk-pill ${RISK_CLASSES[i]}">${RISK_LABELS[i]}</span>
                    <span class="ai-pick__market">${market}</span>
                    <span class="ai-pick__risk-hint">${RISK_HINTS[i]}</span>
                  </div>
                  <div class="ai-pick__main">
                    <div class="ai-pick__label" title="${BSUI.esc(p.label)}">${BSUI.esc(p.label)}</div>
                    <div class="ai-pick__ev ${evPos ? 'is-pos' : 'is-neg'}">EV ${BSUI.pct(ev)}</div>
                  </div>
                  ${bookBestBanner(m, p)}
                  <div class="ai-pick__bottom">
                    <strong class="ai-pick__odd num">${p.odd.toFixed(2)}</strong>
                    <div class="ai-pick__actions">
                      <button class="btn btn-primary btn-sm" data-pick='${JSON.stringify({ matchId: m.id, label: p.label, odd: p.odd, market: p.market })}'>
                        ${BSIcons.svg('plus',{size:14})} Sumar a slip
                      </button>
                      <button class="btn btn-ghost btn-sm" data-justify='${p.label}' data-match='${JSON.stringify({ home: m.home.name, away: m.away.name, league: m.leagueName, odd: p.odd })}'>
                        ${BSIcons.svg('info',{size:14})} Análisis IA
                      </button>
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </article>`;
    }

    async function openAnalysis(pickLabel, m) {
      const isVip = BSAuth.isVip();
      const html = `
        <h3 class="h3 mb-2">Análisis IA · ${BSUI.esc(m.home)} vs ${BSUI.esc(m.away)}</h3>
        <p class="muted tiny">Pick: <strong>${BSUI.esc(pickLabel)}</strong> · Cuota ${m.odd.toFixed(2)} · Motor IA ${isVip ? 'Pro VIP' : 'Estándar'}</p>
        <div id="aiOut" class="card card-tinted mt-3" style="min-height:200px">
          <div class="shimmer" style="height:14px;border-radius:4px;background:var(--surface-2);margin-bottom:8px"></div>
          <div class="shimmer" style="height:14px;border-radius:4px;background:var(--surface-2);margin-bottom:8px;width:80%"></div>
          <div class="shimmer" style="height:14px;border-radius:4px;background:var(--surface-2);width:60%"></div>
        </div>
      `;
      const { modal } = BSUI.openModal(html, { large: true });
      const out = modal.querySelector('#aiOut');
      const { text } = await BSApi.aiAnalyze({
        system: 'Sos un analista cuantitativo de apuestas deportivas argentino. Respondé en español rioplatense, en exactamente 3 párrafos: (1) probabilístico con valor esperado y break-even, (2) contexto del partido y contexto táctico, (3) aviso de riesgo y stake sugerido (Kelly fraccional). Sin emojis, sin promesas.',
        prompt: `Partido: ${m.home} vs ${m.away} (${m.league}). Pick a analizar: "${pickLabel}" a cuota ${m.odd.toFixed(2)}.`,
        vip: isVip
      });
      out.innerHTML = mdRender(text);
    }

    function mdRender(s) {
      return BSUI.esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
    }

    // Sport chips — single-select toggle
    panel.querySelector('#aiSportChips').addEventListener('click', e => {
      const b = e.target.closest('button.league-chip'); if (!b) return;
      panel.querySelectorAll('#aiSportChips button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      activeSport = b.dataset.sport;
      renderPicks();
    });

    // League chips — multi-select; "Todas" toggles all/none
    panel.querySelector('#aiLeagueChips').addEventListener('click', e => {
      const b = e.target.closest('button.league-chip'); if (!b) return;
      const k = b.dataset.lg;
      if (k === 'all') {
        activeLeagues = new Set(['all']);
        panel.querySelectorAll('#aiLeagueChips button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      } else {
        activeLeagues.delete('all');
        panel.querySelector('#aiLeagueChips button[data-lg="all"]').classList.remove('active');
        if (activeLeagues.has(k)) { activeLeagues.delete(k); b.classList.remove('active'); }
        else                      { activeLeagues.add(k); b.classList.add('active'); }
        if (activeLeagues.size === 0) { activeLeagues.add('all'); panel.querySelector('#aiLeagueChips button[data-lg="all"]').classList.add('active'); }
      }
      renderPicks();
    });

    panel.querySelector('#aiAnalyze').addEventListener('click', async () => {
      const btn = panel.querySelector('#aiAnalyze');
      btn.classList.add('shimmer');
      try {
        // Re-fetch matches reales (rompe cache) cuando el usuario pide reanalizar
        if (BSData.loadEnrichedMatches) {
          const live = await BSData.loadEnrichedMatches({ fresh: true });
          if (live && live.length) matches = live.slice(0, 12);
        }
      } catch (e) { /* sigue con matches actuales */ }
      btn.classList.remove('shimmer');
      BSUI.toast({ title: 'Análisis actualizado', message: 'Reanalizamos el slate con datos frescos.', type: 'success' });
      renderPicks();
    });

    renderPicks();

    // Upgrade async: si hay API key + engine, traemos matches REALES y re-renderizamos
    (async () => {
      if (!BSData.loadEnrichedMatches) return;
      try {
        const live = await BSData.loadEnrichedMatches();
        if (live && live.length) {
          matches = live.slice(0, 12);
          renderPicks();
        }
      } catch (e) {
        console.warn('[ai] live matches upgrade failed:', e?.message);
      }
    })();
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('ai', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('ai', render));
  }
  doRegister();
  window.__bsAiRender = render;
})();
