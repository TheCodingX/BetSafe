/* BetSafe — Comparador de cuotas (v2 — útil de verdad)
 * ============================================================================
 * Objetivo: mostrar al user DÓNDE hay valor real comparando cuotas entre las
 * 6 casas argentinas legales. Solo eventos con 2+ casas (donde la comparación
 * tiene sentido). Ranking por OUTCOME, badge de "value gap" solo cuando es
 * material (>1.5%), surebet detection inline.
 * ============================================================================
 */
(function () {
  'use strict';

  async function render(panel) {
    // Skeleton
    panel.innerHTML = `<div class="card stack" style="min-height:280px"><div class="row between"><strong>Cargando cuotas en vivo…</strong><span class="muted tiny">conectando</span></div><div class="empty">Recibiendo cuotas de las casas argentinas legales.</div></div>`;
    let matches = await BSData.awaitLive({ timeoutMs: 12000 });
    if (!matches.length) {
      panel.innerHTML = `<div class="card stack" style="min-height:280px;text-align:center;padding:40px"><strong>Sin cuotas todavía</strong><p class="muted">Estamos recibiendo cuotas en este momento — tarda unos segundos. Cuando termine, las cuotas reales aparecen acá.</p><span class="muted tiny">${BSData.liveFreshness()}</span></div>`;
      const onSnap = () => { if (BSData.liveReady()) { window.removeEventListener('bs:live-snapshot', onSnap); render(panel); } };
      window.addEventListener('bs:live-snapshot', onSnap, { once: true });
      return;
    }

    panel.innerHTML = `
      <div class="row between mb-3" style="flex-wrap:wrap;gap:14px">
        <div>
          <h2 class="h3">Comparador en vivo · casas legales AR</h2>
          <p class="muted">Mostramos las casas que mejor pagan cada resultado. Solo eventos con 2+ casas comparables — para que el ranking sirva.</p>
        </div>
        <div class="cluster" style="gap:6px">
          <select class="select" id="cSport"><option value="all">Todos los deportes</option>${BSData.SPORTS.map(s=>`<option value="${s.key}">${BSUI.esc(s.name)}</option>`).join('')}</select>
          <select class="select" id="cValue">
            <option value="all">Cualquier valor</option>
            <option value="material">Con valor real (≥2% gap)</option>
            <option value="surebet">Solo surebets</option>
          </select>
          <button class="btn btn-outline btn-sm" id="cRefresh">${BSIcons.svg('refresh',{size:14})} Refrescar</button>
        </div>
      </div>

      <div class="cmp-stats card stack mb-3">
        <div class="cmp-stats-grid">
          <div class="cmp-stat">
            <span class="cmp-stat-label">Partidos comparables</span>
            <strong class="cmp-stat-value" id="cStatCount">—</strong>
          </div>
          <div class="cmp-stat">
            <span class="cmp-stat-label">Casas activas</span>
            <strong class="cmp-stat-value" id="cStatBooks">—</strong>
          </div>
          <div class="cmp-stat">
            <span class="cmp-stat-label">Surebets ahora</span>
            <strong class="cmp-stat-value cmp-stat-value--success" id="cStatArb">—</strong>
          </div>
          <div class="cmp-stat">
            <span class="cmp-stat-label">Mejor gap detectado</span>
            <strong class="cmp-stat-value" id="cStatGap">—</strong>
          </div>
        </div>
      </div>

      <div class="card stack">
        <div class="row between">
          <strong id="cCount">0 partidos</strong>
          <span class="muted tiny" id="cTimer">Última actualización ${BSData.liveFreshness()}</span>
        </div>
        <div id="cBody" class="stack"></div>
      </div>
    `;

    let activeSport = 'all';
    let activeValueFilter = 'all';

    function computeMatchValue(m) {
      // Solo valoramos events con 2+ casas en h2h (sino no hay comparación real).
      const books = Object.entries(m.markets?.h2h || {}).filter(([_, b]) =>
        Number(b?.home) > 1.01 || Number(b?.away) > 1.01
      );
      if (books.length < 2) return null;

      // Para cada outcome (home/draw/away) calculamos mejor + peor cuota
      const computeOutcome = (key) => {
        const vals = books.map(([k, b]) => ({ book: k, price: Number(b?.[key]) }))
          .filter(x => Number.isFinite(x.price) && x.price > 1.01);
        if (vals.length < 2) return null;
        vals.sort((a, b) => b.price - a.price);
        const best = vals[0], worst = vals[vals.length - 1];
        const gapPct = ((best.price - worst.price) / worst.price) * 100;
        return { best, worst, vals, gapPct };
      };

      const outH = computeOutcome('home');
      const outD = computeOutcome('draw');
      const outA = computeOutcome('away');
      if (!outH && !outA) return null;

      // Surebet check: 1/best_home + 1/best_away (+ 1/best_draw si hay) < 1
      const oddsForArb = [outH?.best.price, outD?.best.price, outA?.best.price].filter(Boolean);
      const arbCheck = oddsForArb.length >= 2 ? BSMath.surebet(oddsForArb) : { isSure: false, roi: 0 };

      // Mejor gap entre los 3 outcomes para el badge principal
      const gaps = [outH?.gapPct, outD?.gapPct, outA?.gapPct].filter(Number.isFinite);
      const maxGap = gaps.length ? Math.max(...gaps) : 0;

      // Overround del libro (margen casa)
      const margin = oddsForArb.length >= 2 ? (BSMath.overround(oddsForArb) - 1) * 100 : 0;

      return { match: m, outH, outD, outA, maxGap, margin, arbCheck };
    }

    function refresh() {
      matches = BSData.liveEvents({});
      const scored = matches
        .map(computeMatchValue)
        .filter(Boolean);

      let filtered = scored.filter(x => activeSport === 'all' || x.match.sport === activeSport);
      if (activeValueFilter === 'material') filtered = filtered.filter(x => x.maxGap >= 2);
      if (activeValueFilter === 'surebet')  filtered = filtered.filter(x => x.arbCheck.isSure);

      // Ordenar: surebets primero, luego mayor gap, luego más casas
      filtered.sort((a, b) => {
        if (a.arbCheck.isSure !== b.arbCheck.isSure) return a.arbCheck.isSure ? -1 : 1;
        if (Math.abs(a.maxGap - b.maxGap) > 0.2) return b.maxGap - a.maxGap;
        return (b.outH?.vals.length || 0) - (a.outH?.vals.length || 0);
      });

      // Stats
      const totalArb = scored.filter(x => x.arbCheck.isSure).length;
      const uniqueBooks = new Set();
      scored.forEach(x => x.outH?.vals.forEach(v => uniqueBooks.add(v.book)));
      const maxGapEver = scored.reduce((max, x) => Math.max(max, x.maxGap || 0), 0);
      panel.querySelector('#cStatCount').textContent = scored.length;
      panel.querySelector('#cStatBooks').textContent = uniqueBooks.size;
      panel.querySelector('#cStatArb').textContent = totalArb;
      panel.querySelector('#cStatGap').textContent = maxGapEver > 0 ? `+${maxGapEver.toFixed(1)}%` : '—';

      // Body
      const tb = panel.querySelector('#cBody');
      if (!filtered.length) {
        tb.innerHTML = `<div class="empty" style="padding:32px;text-align:center">
          <strong>Sin partidos que cumplan el filtro</strong>
          <p class="muted tiny">${activeValueFilter === 'surebet' ? 'No hay surebets ahora. Cambian rápido — quedate mirando.' : activeValueFilter === 'material' ? 'Probá relajar el filtro de valor.' : 'Aguardando partidos con 2+ casas comparables.'}</p>
        </div>`;
      } else {
        tb.innerHTML = filtered.slice(0, 30).map(row).join('');
      }
      panel.querySelector('#cCount').textContent = `${filtered.length} partidos`;
      panel.querySelector('#cTimer').textContent = `Última actualización ${BSData.liveFreshness()}`;

      tb.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => BSDash.addToSlip(JSON.parse(b.dataset.add))));
      tb.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => openDetail(matches.find(m=>m.id===b.dataset.detail))));
    }

    function row(scored) {
      const m = scored.match;
      const bn = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
      const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.home.id, { size: 26, name: m.home.name, sport: m.sport }) : BSIcons.teamLogo(m.home, { size: 26, sport: m.sport });
      const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(m.away.id, { size: 26, name: m.away.name, sport: m.sport }) : BSIcons.teamLogo(m.away, { size: 26, sport: m.sport });

      const renderCol = (label, code, out, sideKey) => {
        if (!out) return `<div class="cmp3-col"><div class="cmp3-col-head"><span class="label">${label}</span><span class="outcome">${code}</span></div><div class="muted tiny" style="padding:8px 10px">Sin cuota comparable</div></div>`;
        const top3 = out.vals.slice(0, 3);
        return `
          <div class="cmp3-col">
            <div class="cmp3-col-head">
              <span class="label">${label}</span>
              <span class="outcome">${code}</span>
              ${out.gapPct >= 1.5 ? `<span class="cmp-gap-pill">+${out.gapPct.toFixed(1)}% gap</span>` : ''}
            </div>
            ${top3.map((it, i) => {
              const addPayload = JSON.stringify({ matchId: m.id, eventId: m.id, label, odd: it.price, book: it.book, market: 'h2h', outcome: sideKey });
              // Logo del casino — antes el span quedaba VACÍO (yellow placeholder).
              // Ahora se inyecta el bookLogo real desde BSLogos.
              const bookLogoHtml = window.BSLogos?.bookLogo
                ? BSLogos.bookLogo(it.book, { size: 24 })
                : '';
              return `<button class="cmp3-row${i===0?' is-best':''}" data-add='${addPayload}' aria-label="${BSUI.esc(bn(it.book))} paga ${it.price.toFixed(2)}">
                <span class="rank rank-book" data-book="${it.book}">${bookLogoHtml}</span>
                <span class="book">${BSUI.esc(bn(it.book))}</span>
                <span class="price">${it.price.toFixed(2)}</span>
              </button>`;
            }).join('')}
          </div>`;
      };

      // Badges contextual: surebet en oro, gap material en verde, sin badge si no hay valor
      const badges = [];
      if (scored.arbCheck.isSure) {
        badges.push(`<span class="badge badge-gold" title="Sumando cuotas máximas, total < 100% — ganancia garantizada">★ Surebet · ROI ${scored.arbCheck.roi.toFixed(2)}%</span>`);
      } else if (scored.maxGap >= 2) {
        badges.push(`<span class="badge badge-success">Mejor gap +${scored.maxGap.toFixed(1)}%</span>`);
      }
      if (scored.margin > 0 && scored.margin < 20) {
        badges.push(`<span class="badge cmp-margin-badge">Margen casa ${scored.margin.toFixed(1)}%</span>`);
      }

      // Antes: "Gana NombreLargo" se cortaba en celdas estrechas (mismo bug
      // que el comparador del landing). Ahora pasamos solo el nombre — el
      // outcome (1/X/2) al lado ya indica que es "ganar". Las CSS .cmp3-col-head
      // truncan con ellipsis si el nombre no entra en 1 línea.
      const homeLbl = BSUI.esc(m.home.name);
      const awayLbl = BSUI.esc(m.away.name);
      const hasDraw = !!scored.outD;

      const html = `
        <article class="card cmp-match" style="display:flex;flex-direction:column;gap:12px">
          <header class="row between" style="flex-wrap:wrap;gap:10px">
            <div class="cluster">
              ${homeLogo}
              <strong>${BSUI.esc(m.home.name)}</strong>
              <span class="dim">vs</span>
              <strong>${BSUI.esc(m.away.name)}</strong>
              ${awayLogo}
            </div>
            <div class="cluster" style="gap:6px;flex-wrap:wrap">
              <span class="muted tiny">${BSUI.esc(m.leagueName || '')} · ${BSUI.dt(m.start)}</span>
              ${badges.join('')}
              <button class="btn-ghost btn-icon btn-sm" data-detail="${m.id}" aria-label="Ver todas las casas">${BSIcons.svg('eye',{size:16})}</button>
            </div>
          </header>

          <div class="cmp3" style="${hasDraw ? '' : 'grid-template-columns:repeat(2,minmax(0,1fr))'}">
            ${renderCol(homeLbl, '1', scored.outH, 'home')}
            ${hasDraw ? renderCol('Empate', 'X', scored.outD, 'draw') : ''}
            ${renderCol(awayLbl, '2', scored.outA, 'away')}
          </div>
        </article>`;
      return html;
    }

    function openDetail(m) {
      if (!m) return;
      const books = Object.entries(m.markets?.h2h || {}).filter(([_, b]) =>
        Number(b?.home) > 1.01 || Number(b?.away) > 1.01
      );
      const bn = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
      const html = `
        <h3 class="h3 mb-2">${BSUI.esc(m.home.name)} vs ${BSUI.esc(m.away.name)}</h3>
        <p class="muted tiny mb-3">${BSUI.esc(m.leagueName || '')} · ${BSUI.dt(m.start)}</p>
        <div class="cmp-detail-grid">
          <div class="cmp-detail-head">Casa</div>
          <div class="cmp-detail-head">${BSUI.esc(m.home.name)}</div>
          ${books.some(([_, b]) => b.draw) ? '<div class="cmp-detail-head">Empate</div>' : ''}
          <div class="cmp-detail-head">${BSUI.esc(m.away.name)}</div>
          ${books.map(([k, b]) => `
            <div class="cmp-detail-cell"><span class="cluster">${window.BSLogos?.bookLogo?.(k, {size:20}) || ''}<span>${BSUI.esc(bn(k))}</span></span></div>
            <div class="cmp-detail-cell num">${Number.isFinite(b.home) && b.home > 1.01 ? b.home.toFixed(2) : '—'}</div>
            ${books.some(([_, bb]) => bb.draw) ? `<div class="cmp-detail-cell num">${Number.isFinite(b.draw) && b.draw > 1.01 ? b.draw.toFixed(2) : '—'}</div>` : ''}
            <div class="cmp-detail-cell num">${Number.isFinite(b.away) && b.away > 1.01 ? b.away.toFixed(2) : '—'}</div>
          `).join('')}
        </div>`;
      BSUI.openModal(html, { large: true });
    }

    panel.querySelector('#cSport').addEventListener('change', e => { activeSport = e.target.value; refresh(); });
    panel.querySelector('#cValue').addEventListener('change', e => { activeValueFilter = e.target.value; refresh(); });
    panel.querySelector('#cRefresh').addEventListener('click', () => { refresh(); BSUI.toast?.({ title: 'Cuotas actualizadas', type: 'success' }); });

    refresh();

    // Auto-refresh solo en snapshot (~30s). No bs:live-update (1.2s = flicker).
    const onLive = () => refresh();
    window.addEventListener('bs:live-snapshot', onLive);
    panel.__cleanup = () => {
      window.removeEventListener('bs:live-snapshot', onLive);
    };
  }

  function doRegister() {
    if (window.BSDash?.register) BSDash.register('comparator', render);
    else setTimeout(doRegister, 50);
  }
  doRegister();
})();
