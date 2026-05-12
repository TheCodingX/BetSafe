/* BetSafe — Builder tab: combinada manual con cálculo de mejor casa */
(function () {
  'use strict';

  async function render(panel) {
    const slip = BSStore.get(BSStore.KEYS.slip) || { legs: [], stake: 1000 };

    // Mostrar skeleton mientras llega el snapshot del backend
    panel.innerHTML = `<div class="card stack" style="min-height:240px"><div class="row between"><strong>Cargando partidos en vivo…</strong><span class="muted tiny" id="bdrSt">conectando con el scraper</span></div><div class="empty">Recibiendo datos de las casas argentinas legales.</div></div>`;

    // Esperar a que el backend nos entregue eventos reales
    let matches = await BSData.awaitLive({ timeoutMs: 12000 });

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
          <div id="bBestBook" class="card card-tinted card-pad-sm"></div>
          <div class="row gap-2">
            <button class="btn btn-outline btn-sm w-full" id="bClear">Limpiar</button>
            <button class="btn btn-primary btn-sm w-full mag" id="bShare">Compartir</button>
          </div>
        </div>
      </div>
    `;

    const leagueFilter = panel.querySelector('#bLeagueFilter');
    const leagues = ['all', ...new Set(matches.map(m => m.league))].slice(0, 8);
    leagueFilter.innerHTML = leagues.map((k, i) => {
      const lg = BSData.LEAGUES.find(l => l.key === k);
      const logo = (k !== 'all' && window.BSLogos?.leagueLogo) ? window.BSLogos.leagueLogo(k, { size: 16 }) : '';
      const label = k === 'all' ? 'Todas' : (lg?.name || k);
      return `<button class="league-chip ${i===0?'active':''}" data-lg="${k}">${logo}<span>${label}</span></button>`;
    }).join('');

    let activeLeague = 'all';
    let q = '';

    function renderMatches() {
      const filtered = matches
        .filter(m => activeLeague === 'all' || m.league === activeLeague)
        .filter(m => !q || (m.home.name + m.away.name + m.leagueName).toLowerCase().includes(q.toLowerCase()));
      panel.querySelector('#bMatches').innerHTML = filtered.map(m => matchCard(m)).join('') || '<div class="empty">Sin resultados</div>';
      panel.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
        const data = JSON.parse(b.dataset.add);
        addLeg(data);
      }));
    }

    function matchCard(m) {
      const books = Object.entries(m.markets.h2h);
      const bestH = books.reduce((a, [k, b]) => b.home > a.v ? { v: b.home, book: k } : a, { v: 0, book: '' });
      const bestD = books.reduce((a, [k, b]) => (b.draw || 0) > a.v ? { v: b.draw, book: k } : a, { v: 0, book: '' });
      const bestA = books.reduce((a, [k, b]) => b.away > a.v ? { v: b.away, book: k } : a, { v: 0, book: '' });
      const mkLeg = (label, odd) => JSON.stringify({ matchId: m.id, label, odd, home: m.home.name, away: m.away.name });
      const bookName = k => (BSData.ALL_BOOKS.find(b => b.key === k)?.name) || k;
      return `
        <div class="match">
          <div class="teams">
            <div class="cluster">${BSIcons.teamLogo(m.home, { size: 22 })}<strong class="name">${BSUI.esc(m.home.name)}</strong></div>
            <div class="cluster">${BSIcons.teamLogo(m.away, { size: 22 })}<strong class="name">${BSUI.esc(m.away.name)}</strong></div>
            <div class="muted tiny">${BSUI.esc(m.leagueName)} · ${BSUI.dt(m.start)}</div>
          </div>
          <button class="odd best" data-add='${mkLeg(m.home.name + ' gana', bestH.v)}'>
            <span class="odd-num num">${bestH.v.toFixed(2)}</span>
            <span class="odd-book">${window.BSLogos?BSLogos.bookLogo(bestH.book,{size:14}):''}<span class="small">${BSUI.esc(bookName(bestH.book))}</span></span>
          </button>
          ${bestD.v ? `<button class="odd" data-add='${mkLeg('Empate', bestD.v)}'>
            <span class="odd-num num">${bestD.v.toFixed(2)}</span>
            <span class="odd-book">${window.BSLogos?BSLogos.bookLogo(bestD.book,{size:14}):''}<span class="small">${BSUI.esc(bookName(bestD.book))}</span></span>
          </button>` : ''}
          <button class="odd" data-add='${mkLeg(m.away.name + ' gana', bestA.v)}'>
            <span class="odd-num num">${bestA.v.toFixed(2)}</span>
            <span class="odd-book">${window.BSLogos?BSLogos.bookLogo(bestA.book,{size:14}):''}<span class="small">${BSUI.esc(bookName(bestA.book))}</span></span>
          </button>
        </div>`;
    }

    function addLeg(leg) {
      slip.legs.push(leg);
      BSStore.set(BSStore.KEYS.slip, slip);
      renderSlip();
      BSDash.renderSlipBar();
      BSUI.toast({ title: 'Agregado', message: leg.label, type: 'success' });
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

      // Best book overall (sum of legs by book)
      const bestHost = panel.querySelector('#bBestBook');
      if (!slip.legs.length) { bestHost.innerHTML = '<span class="muted tiny">Mejor casa para tu combinada aparecerá acá.</span>'; return; }
      const bestBook = computeBestBookForCombo(matches, slip.legs);
      if (bestBook) {
        bestHost.innerHTML = `<div class="row between"><div><strong>Mejor casa</strong><div class="muted tiny">paga la combinada total</div></div><div class="cluster">${BSIcons.bookLogo(bestBook.book, { size: 22 })}<strong>${bestBook.book.name}</strong><span class="badge badge-success num">${bestBook.totalOdd.toFixed(2)}</span></div></div>`;
      } else {
        bestHost.innerHTML = '<span class="muted tiny">Las cuotas de tus legs son externas al comparador.</span>';
      }
    }

    function computeBestBookForCombo(matches, legs) {
      // For each book, compute product of odds for each leg if available
      const totals = {};
      BSData.BOOKS_AR.forEach(book => {
        let prod = 1, valid = true;
        for (const l of legs) {
          const m = matches.find(x => x.id === l.matchId);
          if (!m) { valid = false; break; }
          const o = m.markets.h2h[book.key];
          if (!o) { valid = false; break; }
          // Map label heuristically
          const odd = l.label.includes(m.home.name) ? o.home : (l.label.includes(m.away.name) ? o.away : (o.draw || o.home));
          prod *= odd;
        }
        if (valid) totals[book.key] = prod;
      });
      const entries = Object.entries(totals);
      if (!entries.length) return null;
      const [bk, totalOdd] = entries.reduce((a, b) => a[1] > b[1] ? a : b);
      return { book: BSData.BOOKS_AR.find(b => b.key === bk), totalOdd };
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
        // Magnitude-aware step: 100 below 5k, 500 below 50k, 1000 above
        const step = cur >= 50000 ? 1000 : cur >= 5000 ? 500 : 100;
        const next = Math.max(0, cur + sign * step);
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
    panel.querySelector('#bClear').addEventListener('click', () => { slip.legs = []; BSStore.set(BSStore.KEYS.slip, slip); renderSlip(); BSDash.renderSlipBar(); });
    panel.querySelector('#bShare').addEventListener('click', () => {
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
    window.addEventListener('bs:live-update', onUpdate);
    panel.__cleanup = () => window.removeEventListener('bs:live-update', onUpdate);
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
