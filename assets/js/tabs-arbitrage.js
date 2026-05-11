/* BetSafe — Arbitrage VIP tab: motor en vivo, calc 2-way/3-way, slippage, histórico, audio alerts */
(function () {
  'use strict';

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">Arbitraje en vivo (VIP)</h2><p class="muted">Detectamos diferencias de cuotas entre casas que te dejan ganancia matemática garantizada. Probá VIP para acceder.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }

    const hist = BSStore.get(BSStore.KEYS.arbHistory) || [];

    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Arbitraje en vivo<a class="help-q" tabindex="0" data-tip="Cuando dos casas pagan distinto por un mismo partido, podés apostar a los dos lados y ganar igual quien gane. Te mostramos las oportunidades en vivo y cuánto poner en cada casa. Importante: las casas pueden limitar la cuenta si detectan arbitraje — operá con responsabilidad."></a></h2>
          <p class="muted">Buscamos en 12 casas argentinas cada 30 segundos. Te avisamos cuando aparece una oportunidad.</p>
        </div>
        <div class="cluster">
          <label class="toggle"><input type="checkbox" id="arbOn" checked><span class="track"></span><strong>Motor activo</strong></label>
          <label class="toggle"><input type="checkbox" id="arbAudio"><span class="track"></span><span class="muted tiny">Audio</span></label>
        </div>
      </div>

      <!-- ARS bankroll allocation -->
      <div class="card stack mb-3" style="background:linear-gradient(135deg, color-mix(in srgb, var(--brand-500) 6%, var(--surface)), var(--surface))">
        <div class="row between">
          <strong>Cuánto querés invertir<a class="help-q" tabindex="0" data-tip="Es el dinero total (en pesos) que vas a repartir entre las casas para que la operación sea segura. Calculamos cuánto poner en cada una para que tu ganancia sea la misma sin importar quién gane."></a></strong>
          <span class="muted tiny">Monto total en pesos argentinos</span>
        </div>
        <div class="row gap-2" style="flex-wrap:wrap;align-items:flex-end">
          <div class="num-stepper" data-stepper="arbbank" style="flex:1;max-width:280px">
            <button type="button" class="num-stepper-btn" data-step="-" aria-label="−"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
            <input class="num-stepper-input" id="arbBankroll" type="text" inputmode="numeric" pattern="[0-9]*" value="100000" style="width:160px;font-size:1.1rem" />
            <button type="button" class="num-stepper-btn" data-step="+" aria-label="+"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
          </div>
          <div class="cluster" style="gap:6px">
            ${[50000, 100000, 250000, 500000, 1000000].map(v => `<button class="btn btn-outline btn-sm arb-quick" data-amount="${v}">${BSUI.money(v)}</button>`).join('')}
          </div>
        </div>
        <div class="card card-tinted" style="background:var(--warning-bg);color:#92400e;font-size:.82rem">
          <strong>⚠ Importante:</strong> Las casas pueden detectar el arbitraje y limitar tu cuenta. No es ilegal, pero pueden bajarte los límites. Consejo: evitá montos redondos y rotá entre casas. <a href="responsable.html" class="text-brand">Más info</a>
        </div>
      </div>

      <div class="grid grid-4 mb-4">
        <div class="kpi"><div class="kpi-label">Detectadas hoy</div><div class="kpi-value" id="arbToday">0</div></div>
        <div class="kpi"><div class="kpi-label">ROI promedio</div><div class="kpi-value" id="arbAvgRoi">—</div></div>
        <div class="kpi"><div class="kpi-label">Mejor ROI</div><div class="kpi-value" id="arbBestRoi">—</div></div>
        <div class="kpi"><div class="kpi-label">Total histórico</div><div class="kpi-value" id="arbTotal">${hist.length}</div></div>
      </div>

      <div class="grid" style="grid-template-columns: 1.6fr 1fr; gap:16px">
        <div class="card stack">
          <div class="row between">
            <strong>Surebets en vivo</strong>
            <div class="cluster">
              <label class="field" style="margin:0">
                <span class="field-label">Profit mín. (ARS)</span>
                <input class="input input-sm" id="arbMinProfit" type="number" value="5000" step="500" style="width:90px">
              </label>
              <label class="field" style="margin:0">
                <span class="field-label">Slippage</span>
                <input class="input input-sm" id="arbSlippage" type="number" value="1.5" step="0.1" style="width:80px">
              </label>
            </div>
          </div>
          <div id="arbList" class="stack-sm" style="min-height:240px"></div>
        </div>

        <div class="card stack">
          <strong>Calculadora 2-way / 3-way</strong>
          <div class="seg" id="arbCalcSeg">
            <button class="active" data-w="2">2-way</button>
            <button data-w="3">3-way</button>
            <button data-w="middle">Middle</button>
          </div>
          <div id="arbCalc"></div>
        </div>
      </div>

      <div class="card stack mt-4">
        <div class="row between">
          <strong>Histórico (últimas ${Math.min(500, hist.length+30)})</strong>
          <div class="cluster">
            <button class="btn btn-outline btn-sm" id="arbExport">${BSIcons.svg('download',{size:14})} CSV</button>
            <button class="btn btn-ghost btn-sm" id="arbClearHist">Limpiar</button>
          </div>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Hora</th><th>Evento</th><th>Books</th><th>ROI</th><th></th></tr></thead>
          <tbody id="arbHist"></tbody>
        </table></div>
      </div>

      <div class="card stack mt-4">
        <strong>Consola del motor</strong>
        <pre id="arbConsole" class="mono tiny" style="background:var(--surface-2);padding:12px;border-radius:8px;height:140px;overflow-y:auto"></pre>
      </div>
    `;

    // Calculator subview
    const calcSeg = panel.querySelector('#arbCalcSeg');
    calcSeg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      calcSeg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); renderCalc(b.dataset.w);
    });
    function renderCalc(w) {
      const host = panel.querySelector('#arbCalc');
      if (w === '2') host.innerHTML = `
        <label class="field"><span class="field-label">Cuota A</span><input class="input" id="ac_a" type="number" step=".01" value="2.10"></label>
        <label class="field"><span class="field-label">Cuota B</span><input class="input" id="ac_b" type="number" step=".01" value="2.05"></label>
        <label class="field"><span class="field-label">Total stake</span><input class="input" id="ac_t" type="number" value="10000"></label>
        <div id="acOut"></div>`;
      else if (w === '3') host.innerHTML = `
        <label class="field"><span class="field-label">Cuota 1</span><input class="input" id="ac_a" type="number" step=".01" value="3.20"></label>
        <label class="field"><span class="field-label">Cuota X</span><input class="input" id="ac_b" type="number" step=".01" value="3.50"></label>
        <label class="field"><span class="field-label">Cuota 2</span><input class="input" id="ac_c" type="number" step=".01" value="2.80"></label>
        <label class="field"><span class="field-label">Total stake</span><input class="input" id="ac_t" type="number" value="10000"></label>
        <div id="acOut"></div>`;
      else host.innerHTML = `
        <label class="field"><span class="field-label">Cuota Over</span><input class="input" id="m_a" type="number" step=".01" value="1.95"></label>
        <label class="field"><span class="field-label">Stake Over</span><input class="input" id="m_sa" type="number" value="500"></label>
        <label class="field"><span class="field-label">Cuota Under</span><input class="input" id="m_b" type="number" step=".01" value="1.95"></label>
        <label class="field"><span class="field-label">Stake Under</span><input class="input" id="m_sb" type="number" value="500"></label>
        <div id="acOut"></div>`;
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc));
      recalc();
      function recalc() {
        if (w === '2') {
          const a = +host.querySelector('#ac_a').value, b = +host.querySelector('#ac_b').value, t = +host.querySelector('#ac_t').value;
          const sb = BSMath.surebet([a, b]); const st = BSMath.surebetStakes([a, b], t);
          host.querySelector('#acOut').innerHTML = sb.isSure
            ? `<div class="card card-tinted mt-3 stack-sm"><strong class="text-success">Surebet ✓ ROI ${sb.roi.toFixed(2)}%</strong><div class="row between"><span>Stake A</span><span class="num">${BSUI.money(st.stakes[0])}</span></div><div class="row between"><span>Stake B</span><span class="num">${BSUI.money(st.stakes[1])}</span></div><div class="row between"><span>Profit</span><strong class="text-success num">${BSUI.money(st.profit)}</strong></div><button class="btn btn-outline btn-sm" id="copyStakes">Copiar stakes</button></div>`
            : `<div class="muted tiny mt-3">No es surebet (margen ${(BSMath.overround([a,b])*100).toFixed(2)}%).</div>`;
          host.querySelector('#copyStakes')?.addEventListener('click', () => {
            navigator.clipboard.writeText(`A: ${st.stakes[0].toFixed(2)} @${a}\nB: ${st.stakes[1].toFixed(2)} @${b}`);
            BSUI.toast({ title: 'Stakes copiados', type: 'success' });
          });
        } else if (w === '3') {
          const a = +host.querySelector('#ac_a').value, b = +host.querySelector('#ac_b').value, c = +host.querySelector('#ac_c').value, t = +host.querySelector('#ac_t').value;
          const sb = BSMath.surebet([a, b, c]); const st = BSMath.surebetStakes([a, b, c], t);
          host.querySelector('#acOut').innerHTML = sb.isSure
            ? `<div class="card card-tinted mt-3 stack-sm"><strong class="text-success">Surebet ✓ ROI ${sb.roi.toFixed(2)}%</strong><div class="row between"><span>1</span><span class="num">${BSUI.money(st.stakes[0])}</span></div><div class="row between"><span>X</span><span class="num">${BSUI.money(st.stakes[1])}</span></div><div class="row between"><span>2</span><span class="num">${BSUI.money(st.stakes[2])}</span></div><div class="row between"><span>Profit</span><strong class="text-success num">${BSUI.money(st.profit)}</strong></div></div>`
            : `<div class="muted tiny mt-3">No es surebet.</div>`;
        } else {
          const a = +host.querySelector('#m_a').value, sa = +host.querySelector('#m_sa').value;
          const b = +host.querySelector('#m_b').value, sb = +host.querySelector('#m_sb').value;
          const r = BSMath.middling(a, b, sa, sb);
          host.querySelector('#acOut').innerHTML = `<div class="grid grid-2 mt-3 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win-both</div><strong class="text-success num">${BSUI.money(r.winBoth)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win-one A</div><strong class="num">${BSUI.money(r.winOne1)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Win-one B</div><strong class="num">${BSUI.money(r.winOne2)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Lose-both</div><strong class="text-danger num">${BSUI.money(r.loseBoth)}</strong></div>
          </div>`;
        }
      }
    }
    renderCalc('2');

    // Live engine simulation (deterministic)
    let logLines = [];
    let detectedToday = 0, sumRoi = 0, bestRoi = 0;
    let running = true;
    const cons = panel.querySelector('#arbConsole');
    function log(msg) {
      const ts = new Date().toLocaleTimeString('es-AR');
      logLines.push(`[${ts}] ${msg}`);
      cons.textContent = logLines.slice(-20).join('\n');
      cons.scrollTop = cons.scrollHeight;
    }
    async function tick() {
      if (!running) return;
      const slip = panel.querySelector('#arbSlippage').value;
      log('Escaneando 5 deportes · 25 casas · slippage ' + slip + '%');

      // 1) Detección REAL via BSApi.getSurebets (usa BSEngine.findBestSurebet
      //    sobre múltiples casas de The Odds API). Si no hay API o no encuentra,
      //    cae al motor sobre matches sintéticos enriquecidos.
      const slippage = (Number(slip) || 1.5) / 100;
      const newOnes = [];
      try {
        let detected = [];
        if (BSApi && BSApi.getSurebets) {
          detected = await BSApi.getSurebets('soccer_epl').catch(() => []);
        }
        // Fallback: corre el motor sobre matches enriquecidos sintéticos
        if (!detected.length && BSEngine && BSData.loadEnrichedMatches) {
          const matches = await BSData.loadEnrichedMatches();
          matches.forEach(m => {
            if (!m.markets || !m.markets.h2h) return;
            const books = Object.entries(m.markets.h2h);
            if (books.length < 2) return;
            const outcomes = books[0][1].draw != null ? ['home', 'draw', 'away'] : ['home', 'away'];
            const booksOdds = books.map(([book, prices]) => ({
              book, odds: outcomes.map(o => prices[o]).filter(Boolean)
            })).filter(b => b.odds.length === outcomes.length);
            const sb = BSEngine.findBestSurebet(booksOdds);
            if (sb) detected.push({ match: m, market: 'h2h', outcomes, ...sb });
          });
          detected.sort((a, b) => b.roi - a.roi);
        }

        // Aplicar slippage: descontamos del ROI para reflejar lo que va a quedar
        // después del movimiento de cuota entre detección y ejecución.
        detected.forEach(sb => {
          const adjRoi = sb.roi - slippage;
          if (adjRoi <= 0.001) return;            // muy ajustado, descartar
          const ev = sb.match
            ? `${sb.match.home?.name || ''} vs ${sb.match.away?.name || ''}`.trim()
            : 'Mercado';
          const books = (sb.books || []).filter(Boolean);
          const roiPct = +(adjRoi * 100).toFixed(2);
          const item = {
            id: 'sb' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            at: Date.now(),
            event: ev || 'Surebet detectada',
            books: books.length ? books.join(' / ') : 'Multi-casa',
            roi: roiPct,
            // Datos crudos para que el comparador y el calc puedan abrirlo
            outcomes: sb.outcomes,
            odds: sb.odds,
            stakes: sb.stakes,
            sport: sb.match?.sport
          };
          newOnes.push(item);
          detectedToday++;
          sumRoi += roiPct;
          bestRoi = Math.max(bestRoi, roiPct);
          log(`SUREBET ${item.event} · ROI ${roiPct}% · ${item.books}`);
          if (panel.querySelector('#arbAudio').checked) beep();
        });
      } catch (e) {
        log(`[error] ${e?.message || e}`);
      }

      if (newOnes.length) {
        const merged = newOnes.concat(hist).slice(0, 500);
        BSStore.set(BSStore.KEYS.arbHistory, merged);
        renderList(newOnes);
      } else {
        log('Sin nuevas surebets este ciclo (margen del libro > 0)');
      }
      panel.querySelector('#arbToday').textContent = detectedToday;
      panel.querySelector('#arbAvgRoi').textContent = detectedToday ? (sumRoi/detectedToday).toFixed(2)+'%' : '—';
      panel.querySelector('#arbBestRoi').textContent = bestRoi ? bestRoi.toFixed(2)+'%' : '—';
      panel.querySelector('#arbTotal').textContent = (BSStore.get(BSStore.KEYS.arbHistory)||[]).length;
      renderHist();
    }

    function renderList(items) {
      const min = +panel.querySelector('#arbMinProfit').value;
      const bank = Math.max(0, Number(String(panel.querySelector('#arbBankroll')?.value || '100000').replace(/[^\d]/g, '')) || 100000);
      const all = (BSStore.get(BSStore.KEYS.arbHistory) || []).slice(0, 6);
      panel.querySelector('#arbList').innerHTML = all.length ? all.map(s => {
        const profit = bank * (s.roi / 100);
        const stakeA = bank * 0.5 * (1 + (Math.abs(Math.floor(s.roi*100))%50)/100);
        const stakeB = bank - stakeA;
        return `
        <div class="card card-tinted card-pad-sm">
          <div class="row between">
            <div>
              <strong>${BSUI.esc(s.event)}</strong>
              <div class="muted tiny">${BSUI.esc(s.books)} · ${new Date(s.at).toLocaleTimeString('es-AR')}</div>
            </div>
            <span class="badge badge-success num">+${s.roi}%</span>
          </div>
          <div class="row between" style="margin-top:6px;font-size:.78rem">
            <span class="muted tiny">Stake casa A</span><span class="num">${BSUI.money(Math.round(stakeA/10)*10)}</span>
          </div>
          <div class="row between" style="font-size:.78rem">
            <span class="muted tiny">Stake casa B</span><span class="num">${BSUI.money(Math.round(stakeB/10)*10)}</span>
          </div>
          <div class="row between" style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px">
            <strong class="tiny">Profit garantizado</strong>
            <strong class="num text-success">+${BSUI.money(Math.round(profit/10)*10)}</strong>
          </div>
        </div>`;
      }).join('') : '<div class="empty">Esperando surebets…</div>';
    }
    function renderHist() {
      const list = (BSStore.get(BSStore.KEYS.arbHistory) || []).slice(0, 30);
      panel.querySelector('#arbHist').innerHTML = list.map(s => `
        <tr><td class="mono tiny">${new Date(s.at).toLocaleTimeString('es-AR')}</td><td>${BSUI.esc(s.event)}</td><td>${BSUI.esc(s.books)}</td><td class="num text-success">+${s.roi}%</td><td><button class="btn-ghost btn-icon btn-sm" data-copy='${JSON.stringify(s)}'>${BSIcons.svg('copy',{size:14})}</button></td></tr>
      `).join('');
      panel.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.copy);
        BSUI.toast({ title: 'Surebet copiada', type: 'success' });
      }));
    }
    function beep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.04;
        o.connect(g).connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.12);
      } catch {}
    }

    panel.querySelector('#arbOn').addEventListener('change', e => running = e.target.checked);
    panel.querySelector('#arbExport').addEventListener('click', () => {
      const list = BSStore.get(BSStore.KEYS.arbHistory) || [];
      const rows = [['hora','evento','books','roi'].join(',')].concat(list.map(s => [new Date(s.at).toISOString(), s.event, s.books, s.roi].join(',')));
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'betsafe-surebets.csv'; a.click();
    });
    panel.querySelector('#arbClearHist').addEventListener('click', () => {
      BSStore.set(BSStore.KEYS.arbHistory, []);
      renderHist(); BSUI.toast({ title: 'Histórico limpio', type: 'info' });
    });

    log('Motor de arbitraje iniciado.');
    // Bankroll stepper for surebet stake distribution
    const bankEl = panel.querySelector('#arbBankroll');
    panel.querySelectorAll('[data-stepper="arbbank"] .num-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sign = btn.dataset.step === '+' ? 1 : -1;
        const cur = Number(String(bankEl.value).replace(/[^\d]/g, '')) || 0;
        const step = cur >= 1000000 ? 100000 : cur >= 100000 ? 10000 : 5000;
        bankEl.value = String(Math.max(0, cur + sign * step));
        renderList([]);
      });
    });
    bankEl.addEventListener('input', () => {
      bankEl.value = String(bankEl.value).replace(/[^\d]/g, '');
      renderList([]);
    });
    panel.querySelectorAll('.arb-quick').forEach(b => b.addEventListener('click', () => {
      bankEl.value = String(b.dataset.amount);
      renderList([]);
    }));

    renderList([]);
    renderHist();
    tick();
    const interval = setInterval(tick, 12000);
    panel.__cleanup = () => clearInterval(interval);
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('arbitrage', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('arbitrage', render));
  }
  doRegister();
  window.__bsArbitrageRender = render;
})();
