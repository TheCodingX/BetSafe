/* BetSafe — Comparator tab */
(function () {
  'use strict';

  async function render(panel) {
    // Mostrar skeleton, luego cargar eventos en vivo del backend
    panel.innerHTML = `<div class="card stack" style="min-height:280px"><div class="row between"><strong>Cargando cuotas en vivo…</strong><span class="muted tiny">conectando con el scraper</span></div><div class="empty">Recibiendo cuotas de las casas argentinas legales.</div></div>`;
    let matches = await BSData.awaitLive({ timeoutMs: 12000 });
    if (!matches.length) {
      panel.innerHTML = `<div class="card stack" style="min-height:280px;text-align:center;padding:40px"><strong>Sin cuotas todavía</strong><p class="muted">El primer ciclo del backend tarda unos segundos. Cuando termine, las cuotas reales aparecen acá.</p><span class="muted tiny">${BSData.liveFreshness()}</span></div>`;
      const onSnap = () => { if (BSData.liveReady()) { window.removeEventListener('bs:live-snapshot', onSnap); render(panel); } };
      window.addEventListener('bs:live-snapshot', onSnap, { once: true });
      return;
    }
    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Comparador en vivo · casas legales AR<a class="help-q" tabindex="0" data-tip="Mostramos las cuotas de las casas argentinas con licencia LOTBA/IPLyC en una sola vista. Resaltamos en verde la mejor cuota por outcome y calculamos la diferencia % entre la mejor y la peor — eso es valor que estás dejando si no comparás. Margen del libro = overround. Refresco cada 30s."></a></h2>
          <p class="muted">Resaltamos la mejor cuota por outcome. Diferencia % entre la mejor y la peor. Refresco cada 30 s.</p>
        </div>
        <div class="cluster">
          <select class="select" id="cSport"><option value="all">Todos los deportes</option>${BSData.SPORTS.map(s=>`<option value="${s.key}">${s.name}</option>`).join('')}</select>
          <select class="select" id="cLeague"><option value="all">Todas las ligas</option>${BSData.LEAGUES.map(l=>`<option value="${l.key}">${l.name}</option>`).join('')}</select>
          <button class="btn btn-outline btn-sm" id="cRefresh">${BSIcons.svg('refresh',{size:14})} Refrescar</button>
        </div>
      </div>

      <div class="card stack mb-3">
        <div class="risk-slider-block">
          <div class="risk-slider-head">
            <strong>Risk slider</strong>
            <span class="muted tiny">· filtra por banda de cuota</span>
          </div>
          <div class="risk-slider-row">
            <span class="risk-slider-edge">10%</span>
            <input type="range" class="slider slider-risk" id="cRisk" min="10" max="100" value="50" />
            <span class="risk-slider-edge">100%</span>
            <strong class="risk-slider-val num" id="cRiskVal">50%</strong>
          </div>
        </div>
        <div class="cluster" id="cBandPills"></div>
      </div>

      <div class="card stack">
        <div class="row between">
          <strong id="cCount">0 partidos</strong>
          <span class="muted tiny" id="cTimer">Próximo refresh en 30 s</span>
        </div>
        <div id="cBody" class="stack"></div>
      </div>

      <div id="arbBanner" class="card card-tinted mt-3" hidden>
        <div class="row between">
          <div><strong class="text-success">Surebet detectada</strong><div class="muted tiny" id="arbBannerText">—</div></div>
          <a href="#arbitrage" class="btn btn-primary btn-sm">Ver detalle</a>
        </div>
      </div>
    `;

    const bands = {
      10: [1.10, 1.30], 25: [1.30, 1.60], 50: [1.60, 2.30],
      75: [2.30, 3.50], 90: [3.50, 5.0], 100: [5.0, 99]
    };

    // Distribuir pills a lo largo del slider (cada una en su porcentaje umbral)
    const pillBox = panel.querySelector('#cBandPills');
    pillBox.classList.remove('cluster');
    pillBox.classList.add('risk-band-track');
    const bandLabels = [
      { label: 'Conservador',  range: '1.10-1.40', pct: 10,  cls: 'low'  },
      { label: 'Cauteloso',    range: '1.30-1.60', pct: 25,  cls: 'low'  },
      { label: 'Equilibrado',  range: '1.60-2.30', pct: 50,  cls: 'mid'  },
      { label: 'Moderado',     range: '2.30-3.50', pct: 75,  cls: 'mid'  },
      { label: 'Agresivo',     range: '3.50-5.00', pct: 90,  cls: 'high' },
      { label: 'Longshot',     range: '5.00+',     pct: 100, cls: 'high' }
    ];
    pillBox.innerHTML = bandLabels.map(b => `
      <span class="risk-band" data-pct="${b.pct}" style="--p:${b.pct}%">
        <span class="risk-band-pin ${b.cls}"></span>
        <span class="risk-band-pill ${b.cls}">${b.label}</span>
        <span class="risk-band-range">${b.range}</span>
      </span>`).join('');

    let activeSport = 'all', activeLeague = 'all', riskBand = 50;

    function refresh() {
      // Re-cargar siempre desde BSLive para que cada refresh use lo más fresco
      matches = BSData.liveEvents({});
      const list = matches.filter(m =>
        m.markets && m.markets.h2h && Object.keys(m.markets.h2h).length > 0 &&
        (activeSport === 'all' || m.sport === activeSport) &&
        (activeLeague === 'all' || m.league === activeLeague)
      );
      const tb = panel.querySelector('#cBody');
      tb.innerHTML = list.map(m => row(m)).join('');
      panel.querySelector('#cCount').textContent = list.length + ' partidos';

      // Detect arbitrage
      const arb = list.find(m => isArb(m));
      const banner = panel.querySelector('#arbBanner');
      if (arb) {
        banner.hidden = false;
        const arbInfo = arbDetails(arb);
        panel.querySelector('#arbBannerText').textContent = `${arb.home.name} vs ${arb.away.name} · ROI ${arbInfo.roi.toFixed(2)}%`;
      } else { banner.hidden = true; }

      tb.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => BSDash.addToSlip(JSON.parse(b.dataset.add))));
      tb.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => openDetail(matches.find(m=>m.id===b.dataset.detail))));
    }

    /* Top-3 ranking helper: para cada outcome del 1X2, devuelve las 3 casas
       que mejor pagan, ordenadas. Mismo mercado entre casas distintas. */
    function top3(books, key) {
      return books
        .map(([k, b]) => ({ book: k, price: b[key] || 0 }))
        .filter(x => x.price > 1)
        .sort((a, b) => b.price - a.price)
        .slice(0, 3);
    }

    function row(m) {
      const books = Object.entries(m.markets.h2h);
      const bestH = books.reduce((a, [k, b]) => b.home > a.v ? { v: b.home, book: k } : a, { v: 0, book: '' });
      const bestD = books.reduce((a, [k, b]) => (b.draw || 0) > a.v ? { v: b.draw, book: k } : a, { v: 0, book: '' });
      const bestA = books.reduce((a, [k, b]) => b.away > a.v ? { v: b.away, book: k } : a, { v: 0, book: '' });
      const minH = Math.min(...books.map(([_, b]) => b.home).filter(Boolean));
      const margin = BSMath.overround([bestH.v, bestD.v || 99, bestA.v]) * 100;
      const delta = bestH.v / minH * 100 - 100;
      const bn = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;

      const top3H = top3(books, 'home');
      const top3D = top3(books, 'draw');
      const top3A = top3(books, 'away');

      const renderCol = (label, code, list, m, side) => {
        if (!list.length) return `<div class="cmp3-col"><div class="cmp3-col-head"><span class="label">${label}</span><span class="outcome">${code}</span></div><div class="muted tiny" style="padding:8px 10px">Sin cuota disponible</div></div>`;
        return `
          <div class="cmp3-col">
            <div class="cmp3-col-head">
              <span class="label">${label}</span>
              <span class="outcome">${code}</span>
            </div>
            ${list.map((it, i) => {
              const addPayload = JSON.stringify({ matchId: m.id, label, odd: it.price, book: it.book });
              return `<button class="cmp3-row${i===0?' is-best':''}" data-add='${addPayload}' aria-label="${BSUI.esc(bn(it.book))} paga ${it.price.toFixed(2)}">
                <span class="rank">${i+1}</span>
                <span class="book">${window.BSLogos ? BSLogos.bookLogo(it.book, { size: 22 }) : ''}<span style="margin-left:6px">${BSUI.esc(bn(it.book))}</span></span>
                <span class="price">${it.price.toFixed(2)}</span>
              </button>`;
            }).join('')}
          </div>`;
      };

      const homeLbl = `Gana ${BSUI.esc(m.home.name)}`;
      const awayLbl = `Gana ${BSUI.esc(m.away.name)}`;
      const drawLbl = 'Empate';

      return `
        <article class="card cmp-match" style="display:flex;flex-direction:column;gap:14px">
          <header class="row between" style="flex-wrap:wrap;gap:12px">
            <div class="cluster">
              ${BSIcons.teamLogo(m.home,{size:24,sport:m.sport})}
              <strong>${BSUI.esc(m.home.name)}</strong>
              <span class="dim">vs</span>
              <strong>${BSUI.esc(m.away.name)}</strong>
              ${BSIcons.teamLogo(m.away,{size:24,sport:m.sport})}
            </div>
            <div class="cluster" style="gap:8px;flex-wrap:wrap">
              <span class="muted tiny">${BSUI.esc(m.leagueName)} · ${BSUI.dt(m.start)}</span>
              <span class="badge badge-success">+${delta.toFixed(2)}% Δ</span>
              <span class="badge" style="background:rgba(212,160,23,0.10);color:var(--gold-700);border-color:rgba(212,160,23,0.30)">Margen ${margin.toFixed(2)}%</span>
              <button class="btn-ghost btn-icon btn-sm" data-detail="${m.id}" aria-label="Ver todas las casas">${BSIcons.svg('eye',{size:16})}</button>
            </div>
          </header>

          <div class="cmp3" style="${bestD.v ? '' : 'grid-template-columns:repeat(2,minmax(0,1fr))'}">
            ${renderCol(homeLbl, '1', top3H, m, 'home')}
            ${bestD.v ? renderCol(drawLbl, 'X', top3D, m, 'draw') : ''}
            ${renderCol(awayLbl, '2', top3A, m, 'away')}
          </div>
        </article>`;
    }

    function isArb(m) {
      const books = Object.values(m.markets.h2h);
      const bestH = Math.max(...books.map(b=>b.home));
      const bestA = Math.max(...books.map(b=>b.away));
      const bestD = Math.max(...books.map(b=>b.draw||0));
      const odds = bestD ? [bestH, bestD, bestA] : [bestH, bestA];
      return BSMath.surebet(odds).isSure;
    }
    function arbDetails(m) {
      const books = Object.values(m.markets.h2h);
      const bestH = Math.max(...books.map(b=>b.home));
      const bestA = Math.max(...books.map(b=>b.away));
      const bestD = Math.max(...books.map(b=>b.draw||0));
      const odds = bestD ? [bestH, bestD, bestA] : [bestH, bestA];
      return BSMath.surebet(odds);
    }

    function openDetail(m) {
      const html = `
        <h3 class="h3 mb-2">${BSUI.esc(m.home.name)} vs ${BSUI.esc(m.away.name)}</h3>
        <p class="muted tiny mb-3">${BSUI.esc(m.leagueName)} · ${BSUI.dt(m.start)}</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Casa</th><th>1</th><th>X</th><th>2</th></tr></thead>
            <tbody>
              ${Object.entries(m.markets.h2h).map(([k, o]) => {
                const b = BSData.ALL_BOOKS.find(x => x.key === k);
                return `<tr><td><div class="cluster">${BSIcons.bookLogo(b||{name:k,color:'#666'},{size:18})} ${BSUI.esc(b?.name || k)} ${b?.license?'<span class="badge badge-success">'+b.license+'</span>':''}</div></td><td class="num">${o.home.toFixed(2)}</td><td class="num">${o.draw?o.draw.toFixed(2):'—'}</td><td class="num">${o.away.toFixed(2)}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary btn-sm" id="cmpAiAnalyzeBtn">${BSIcons.svg('bolt', { size: 14 })} Análisis IA profundo del partido</button>
          <div id="cmpAiAnalysisModal" style="margin-top:12px"></div>
        </div>`;
      BSUI.openModal(html, { large: true });

      // AI deep-analysis del partido (Groq → factores + Poisson + Elo + LLM)
      setTimeout(() => {
        const btn = document.getElementById('cmpAiAnalyzeBtn');
        const host = document.getElementById('cmpAiAnalysisModal');
        if (!btn || !host) return;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.innerHTML = `${BSIcons.svg('bolt', { size: 14 })} <span class="shimmer-text">Analizando con Groq...</span>`;
          host.innerHTML = `<div class="card card-tinted card-pad-sm"><span class="muted tiny">llama-3.3-70b procesando clima + lesiones + sharp money + modelos quant...</span><div style="height:3px;background:linear-gradient(90deg,var(--brand-500),transparent,var(--brand-500));background-size:200% 100%;animation:shimmer 1.2s infinite;margin-top:6px;border-radius:2px"></div></div>`;
          try {
            const r = await BSLive.deepAnalysis(m.id);
            renderMatchDeepAnalysis(host, r);
            btn.style.display = 'none';
          } catch (e) {
            host.innerHTML = `<div class="card card-pad-sm card-tinted"><strong class="text-danger tiny">Error</strong><p class="muted tiny">${BSUI.esc(e?.message || 'no disponible')}</p></div>`;
            btn.disabled = false;
            btn.innerHTML = `${BSIcons.svg('bolt', { size: 14 })} Reintentar`;
          }
        });
      }, 80);
    }

    function renderMatchDeepAnalysis(host, r) {
      if (!r) return;
      const f = r.factors || {};
      const sel = (r.selections || []).slice(0, 3);
      const providerBadge = r.llmProvider !== 'offline'
        ? `<span class="badge badge-success tiny">IA: ${r.llmProvider}</span>`
        : `<span class="badge tiny">quant only</span>`;
      const factorChips = [];
      if (f.weather && !f.weather.unavailable) factorChips.push(`<span class="badge tiny">🌡 ${f.weather.tempC?.toFixed?.(0)}°C${f.weather.rainMm > 1 ? ' · ☔ ' + f.weather.rainMm.toFixed(1) + 'mm' : ''}${f.weather.windKmh > 0 ? ' · 💨 ' + f.weather.windKmh + 'km/h' : ''}</span>`);
      if (f.injuries && (f.injuries.severityScore?.home > 0 || f.injuries.severityScore?.away > 0)) factorChips.push(`<span class="badge badge-warning tiny">🩹 Bajas H:${(f.injuries.severityScore?.home*100|0)}% A:${(f.injuries.severityScore?.away*100|0)}%</span>`);
      if (f.sharp && f.sharp.score > 0) factorChips.push(`<span class="badge tiny">💰 Sharp ${(f.sharp.score*100|0)}%</span>`);
      if (f.poisson) factorChips.push(`<span class="badge tiny">λ ${f.poisson.lambdaHome?.toFixed?.(2)} / ${f.poisson.lambdaAway?.toFixed?.(2)}</span>`);
      host.innerHTML = `
        <div class="card card-tinted card-pad-sm" style="border-left:3px solid var(--brand-500)">
          <div class="row between" style="align-items:center"><strong>Análisis IA profundo</strong>${providerBadge}</div>
          ${factorChips.length ? `<div class="cluster" style="margin-top:8px;gap:4px;flex-wrap:wrap">${factorChips.join('')}</div>` : ''}
          ${r.llmKeyFactor ? `<p class="tiny" style="margin-top:10px;padding:8px;background:rgba(var(--brand-500-rgb,30,75,200),0.06);border-radius:6px"><strong>Factor clave:</strong> ${BSUI.esc(r.llmKeyFactor)}</p>` : ''}
          ${r.llmSynthesis ? `<p class="muted tiny" style="margin-top:8px;line-height:1.5">${BSUI.esc(r.llmSynthesis)}</p>` : ''}
          ${sel.length ? `<div style="margin-top:10px">
            <strong class="tiny">Picks recomendados</strong>
            <div class="stack-sm" style="margin-top:6px">
              ${sel.map(s => `
                <div class="card card-pad-sm" style="background:var(--surface-2)">
                  <div class="row between"><strong>${BSUI.esc(s.label || s.outcome || '')}</strong><span class="num">${s.odd?.toFixed?.(2) || '—'}</span></div>
                  ${s.rationale ? `<p class="muted tiny" style="margin-top:4px;line-height:1.45">${BSUI.esc(s.rationale)}</p>` : ''}
                  ${s.tacticalNotes ? `<p class="tiny" style="margin-top:4px;line-height:1.45;font-style:italic">${BSUI.esc(s.tacticalNotes)}</p>` : ''}
                  ${(s.warnings || []).length ? `<div class="cluster" style="gap:4px;flex-wrap:wrap;margin-top:4px">${s.warnings.map(w => `<span class="badge badge-warning tiny">⚠ ${BSUI.esc(w)}</span>`).join('')}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>` : ''}
        </div>`;
    }

    panel.querySelector('#cSport').addEventListener('change', e => { activeSport = e.target.value; refresh(); });
    panel.querySelector('#cLeague').addEventListener('change', e => { activeLeague = e.target.value; refresh(); });
    panel.querySelector('#cRefresh').addEventListener('click', () => { refresh(); BSUI.toast({ title:'Cuotas actualizadas', type:'success' }); });
    panel.querySelector('#cRisk').addEventListener('input', e => { riskBand = +e.target.value; panel.querySelector('#cRiskVal').textContent = riskBand+'%'; });

    refresh();

    // Auto-refresh: cada vez que el backend pushea, actualizamos al toque
    const onLive = () => refresh();
    window.addEventListener('bs:live-update', onLive);
    window.addEventListener('bs:live-snapshot', onLive);

    // Tick visual para el timer
    let timer = 30, tickerEl = panel.querySelector('#cTimer');
    const interval = setInterval(() => {
      timer--;
      if (timer <= 0) timer = 30;
      const ms = BSLive?.timeSinceUpdate?.();
      tickerEl.textContent = ms != null
        ? `Última actualización ${BSData.liveFreshness()} · conectado`
        : `Próximo refresh en ${timer} s`;
    }, 1000);
    panel.__cleanup = () => {
      clearInterval(interval);
      window.removeEventListener('bs:live-update', onLive);
      window.removeEventListener('bs:live-snapshot', onLive);
    };
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('comparator', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('comparator', render));
  }
  doRegister();
  window.__bsComparatorRender = render;
})();
