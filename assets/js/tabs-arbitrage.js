/* BetSafe — Arbitrage VIP (motor hiper-preciso)
 * ============================================================================
 * Conecta con el motor de arbitraje del backend que:
 *   - Corre cada 5s sobre el snapshot de las casas legales
 *   - Detecta multi-mercado: 1X2 (2-way y 3-way), totals (cada línea),
 *     BTTS, AH, y cross-market (1+X2, 2+1X)
 *   - Cada surebet trae: confidence, slippage real por casa, stakes óptimos,
 *     profit garantizado en ARS, latency order, account limits check
 *
 * Filtros funcionales:
 *   - ROI mínimo
 *   - Confidence mínimo
 *   - Deporte
 *   - Tipo de mercado (h2h / totals / btts / cross)
 *   - Bankroll fit (descartar surebets con stakes que superan tu cuenta)
 *
 * El usuario ve TODO en vivo via WebSocket — cuando aparece una surebet en el
 * backend, el frontend la agrega en milisegundos.
 * ============================================================================
 */
(function () {
  'use strict';

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">Arbitraje en vivo (VIP)</h2><p class="muted">Motor de arbitraje hiper-preciso: multi-casa, multi-mercado, cross-market, confidence score, scan cada 5 segundos.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }

    const hist = BSStore.get(BSStore.KEYS.arbHistory) || [];

    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Arbitraje en vivo · motor hiper-preciso<a class="help-q" tabindex="0" data-tip="Motor dedicado que escanea las casas argentinas cada 5 segundos. Detecta surebets en 1X2 (2-way y 3-way), totals (cada línea), BTTS, AH y cross-market. Cada surebet trae confidence score basado en margen + time-to-event + slippage histórico por casa."></a></h2>
          <p class="muted">Scan cada 5s · 1X2 + totals + BTTS + AH + cross-market · stake óptimo con slippage real · 100% datos en vivo</p>
        </div>
        <div class="cluster">
          <label class="toggle"><input type="checkbox" id="arbOn" checked><span class="track"></span><strong>Motor activo</strong></label>
          <label class="toggle"><input type="checkbox" id="arbAudio"><span class="track"></span><span class="muted tiny">Audio</span></label>
        </div>
      </div>

      <!-- Bankroll -->
      <div class="card stack mb-3" style="background:linear-gradient(135deg, color-mix(in srgb, var(--brand-500) 6%, var(--surface)), var(--surface))">
        <div class="row between">
          <strong>Cuánto querés invertir<a class="help-q" tabindex="0" data-tip="El motor calcula stakes óptimos por casa para garantizar profit sin importar el resultado. Si los stakes superan los límites típicos de tu cuenta, marcamos la surebet con ⚠."></a></strong>
          <span class="muted tiny">Monto total en ARS</span>
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
      </div>

      <!-- Filtros REALES -->
      <div class="card stack mb-3">
        <div class="row between"><strong>Filtros profesionales</strong><span class="muted tiny" id="arbFilterCount">—</span></div>
        <div class="row gap-2" style="flex-wrap:wrap;align-items:center">
          <label class="field" style="margin:0;min-width:160px">
            <span class="field-label">ROI mín %</span>
            <input class="input input-sm" id="arbMinRoi" type="number" step="0.1" min="0" value="0.5">
          </label>
          <label class="field" style="margin:0;min-width:160px">
            <span class="field-label">Confidence mín %</span>
            <input class="input input-sm" id="arbMinConf" type="number" step="5" min="0" max="100" value="50">
          </label>
          <label class="field" style="margin:0;min-width:160px">
            <span class="field-label">Deporte</span>
            <select class="select input-sm" id="arbSport"><option value="">Todos</option>${BSData.SPORTS.map(s=>`<option value="${s.key}">${s.name}</option>`).join('')}</select>
          </label>
          <label class="field" style="margin:0;min-width:160px">
            <span class="field-label">Mercado</span>
            <select class="select input-sm" id="arbMarket">
              <option value="all">Todos</option>
              <option value="h2h">Ganador del partido</option>
              <option value="totals">Más / Menos goles</option>
              <option value="btts">Ambos marcan</option>
              <option value="ah">Hándicap asiático</option>
              <option value="cross">Doble vía (combinaciones de outcome)</option>
            </select>
          </label>
          <label class="cluster" style="cursor:pointer;margin:0">
            <input type="checkbox" id="arbBankrollFit" checked>
            <span class="tiny">Solo si entra en mi cuenta</span>
            <a class="help-q" tabindex="0" data-tip="Descarta surebets donde los stakes calculados superan los límites históricos típicos de la cuenta en alguna de las casas."></a>
          </label>
        </div>
      </div>

      <!-- KPIs motor -->
      <div class="grid grid-4 mb-4">
        <div class="kpi"><div class="kpi-label">Activas</div><div class="kpi-value" id="arbActive">0</div></div>
        <div class="kpi"><div class="kpi-label">Mejor ROI net</div><div class="kpi-value" id="arbBestRoi">—</div></div>
        <div class="kpi"><div class="kpi-label">Avg confidence</div><div class="kpi-value" id="arbAvgConf">—</div></div>
        <div class="kpi"><div class="kpi-label">Ciclos backend</div><div class="kpi-value" id="arbCycles">0</div></div>
      </div>

      <div class="grid" style="grid-template-columns: 1.6fr 1fr; gap:16px">
        <div class="card stack">
          <div class="row between">
            <strong>Surebets en vivo</strong>
            <span class="muted tiny" id="arbLastUpd">—</span>
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
          <thead><tr><th>Hora</th><th>Evento</th><th>Mercado</th><th>Books</th><th>ROI</th><th>Conf</th><th></th></tr></thead>
          <tbody id="arbHist"></tbody>
        </table></div>
      </div>

      <div class="card stack mt-4">
        <strong>Consola del motor</strong>
        <pre id="arbConsole" class="mono tiny" style="background:var(--surface-2);padding:12px;border-radius:8px;height:140px;overflow-y:auto"></pre>
      </div>
    `;

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
            ? `<div class="card card-tinted mt-3 stack-sm"><strong class="text-success">Surebet ✓ ROI ${sb.roi.toFixed(2)}%</strong><div class="row between"><span>Stake A</span><span class="num">${BSUI.money(st.stakes[0])}</span></div><div class="row between"><span>Stake B</span><span class="num">${BSUI.money(st.stakes[1])}</span></div><div class="row between"><span>Profit</span><strong class="text-success num">${BSUI.money(st.profit)}</strong></div></div>`
            : `<div class="muted tiny mt-3">No es surebet (margen ${(BSMath.overround([a,b])*100).toFixed(2)}%).</div>`;
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

    // ── Estado y bindings ──────────────────────────────────────────────
    let running = true;
    let logLines = [];
    const cons = panel.querySelector('#arbConsole');
    function log(msg) {
      const ts = new Date().toLocaleTimeString('es-AR');
      logLines.push(`[${ts}] ${msg}`);
      cons.textContent = logLines.slice(-20).join('\n');
      cons.scrollTop = cons.scrollHeight;
    }

    function getFilters() {
      return {
        minRoi:        Number(panel.querySelector('#arbMinRoi').value) || 0,
        minConfidence: (Number(panel.querySelector('#arbMinConf').value) || 0) / 100,
        sport:         panel.querySelector('#arbSport').value || '',
        market:        panel.querySelector('#arbMarket').value || 'all',
        bankrollFit:   panel.querySelector('#arbBankrollFit').checked,
        bankroll:      Number(String(panel.querySelector('#arbBankroll').value).replace(/[^\d]/g, '')) || 100000
      };
    }

    function matchesFilters(sb, f) {
      if (sb.sport && f.sport && sb.sport !== f.sport) return false;
      if (f.market !== 'all') {
        if (f.market === 'h2h' && !sb.market.startsWith('h2h')) return false;
        if (f.market === 'totals' && !sb.market.startsWith('totals')) return false;
        if (f.market === 'btts' && sb.market !== 'btts') return false;
        if (f.market === 'ah' && !sb.market.startsWith('ah')) return false;
        if (f.market === 'cross' && !sb.market.startsWith('cross')) return false;
      }
      if (f.bankrollFit && sb.bankrollFit === false) return false;
      return true;
    }

    async function refresh() {
      if (!running) return;
      const f = getFilters();
      try {
        const r = await BSLive.getArbitrageSnapshot({
          minRoi: f.minRoi,
          sport: f.sport,
          minConfidence: f.minConfidence
        });
        const all = (r.surebets || []).filter(sb => matchesFilters(sb, f));
        renderSurebets(all, f);

        // KPIs
        panel.querySelector('#arbActive').textContent = all.length;
        if (all.length) {
          panel.querySelector('#arbBestRoi').textContent = (Math.max(...all.map(s => s.netRoi || 0)) * 100).toFixed(2) + '%';
          panel.querySelector('#arbAvgConf').textContent = ((all.reduce((s, x) => s + (x.confidence||0), 0) / all.length) * 100).toFixed(0) + '%';
        } else {
          panel.querySelector('#arbBestRoi').textContent = '—';
          panel.querySelector('#arbAvgConf').textContent = '—';
        }
        panel.querySelector('#arbCycles').textContent = r.meta?.cycles || 0;
        panel.querySelector('#arbLastUpd').textContent = `Backend ciclo cada ${(r.meta?.interval||5000)/1000}s · ${all.length}/${(r.surebets||[]).length} pasaron filtros`;
        panel.querySelector('#arbFilterCount').textContent = `${all.length} surebets vigentes`;
      } catch (e) {
        log(`[error] ${e?.message}`);
      }
    }

    function renderSurebets(list, f) {
      const host = panel.querySelector('#arbList');
      if (!list.length) {
        host.innerHTML = `<div class="empty" style="padding:30px;text-align:center"><strong>Sin surebets vigentes</strong><p class="muted tiny">El motor escanea cada 5s. Las surebets aparecen acá apenas se detectan y se cierran cuando una casa mueve la cuota.</p></div>`;
        return;
      }
      host.innerHTML = list.slice(0, 10).map(sb => surebetCard(sb, f)).join('');

      // Bindings click
      host.querySelectorAll('[data-copy-sb]').forEach(b => b.addEventListener('click', () => {
        const sb = list.find(s => s.key === b.dataset.copySb);
        if (sb) copyPlaybook(sb, f);
      }));

      // AI explanation per surebet
      host.querySelectorAll('[data-explain-sb]').forEach(b => b.addEventListener('click', async () => {
        const key = b.dataset.explainSb;
        const target = host.querySelector(`[data-explain-host="${CSS.escape(key)}"]`);
        if (!target) return;
        if (target.dataset.loaded === '1') {
          // toggle visible
          target.style.display = target.style.display === 'none' ? '' : 'none';
          return;
        }
        target.style.display = '';
        target.innerHTML = `<div class="card card-pad-sm card-tinted"><span class="shimmer-text muted tiny">IA analizando la surebet…</span></div>`;
        b.disabled = true;
        try {
          const r = await BSLive.explainSurebet(key);
          target.dataset.loaded = '1';
          const decisionColor = r.shouldExecute ? 'success' : 'danger';
          const decisionLabel = r.shouldExecute ? 'Ejecutar' : 'Pasar';
          const riskHtml = (r.risks || []).map(x => `<li class="tiny muted">⚠ ${BSUI.esc(x)}</li>`).join('');
          const orderHtml = (r.executionOrder || []).map((x, i) => `<li class="tiny"><strong>${i+1}.</strong> ${BSUI.esc(x)}</li>`).join('');
          target.innerHTML = `
            <div class="card card-tinted card-pad-sm" style="border-left:3px solid var(--brand-500)">
              <div class="row between" style="align-items:center">
                <strong class="tiny">Análisis IA <span class="badge badge-success tiny" style="margin-left:6px">groq</span></strong>
                <span class="badge badge-${decisionColor} tiny">${decisionLabel}</span>
              </div>
              ${r.whyExists ? `<p class="tiny" style="margin-top:6px;line-height:1.5"><strong>Por qué existe:</strong> ${BSUI.esc(r.whyExists)}</p>` : ''}
              ${orderHtml ? `<div style="margin-top:6px"><strong class="tiny">Orden óptimo de ejecución</strong><ol style="margin:4px 0 0 18px;padding:0">${orderHtml}</ol></div>` : ''}
              ${riskHtml ? `<div style="margin-top:6px"><strong class="tiny">Riesgos</strong><ul style="margin:4px 0 0 18px;padding:0;list-style:none">${riskHtml}</ul></div>` : ''}
              ${r.shouldExecuteReason ? `<p class="tiny muted" style="margin-top:6px;font-style:italic">${BSUI.esc(r.shouldExecuteReason)}</p>` : ''}
            </div>`;
        } catch (e) {
          target.innerHTML = `<div class="card card-pad-sm card-tinted"><span class="text-danger tiny">IA no disponible: ${BSUI.esc(e?.message || 'error')}</span></div>`;
        } finally {
          b.disabled = false;
        }
      }));
    }

    function surebetCard(sb, f) {
      const conf = sb.confidence || 0;
      const confCls = conf > 0.7 ? 'success' : conf > 0.4 ? 'warning' : 'danger';
      const profitARS = Math.round((f.bankroll * (sb.netRoi || 0)) / 10) * 10;
      const minutesToEvent = sb.timeToEvent != null ? Math.floor(sb.timeToEvent / 60000) : null;
      const minLabel = minutesToEvent != null ? (minutesToEvent < 60 ? `${minutesToEvent}m` : minutesToEvent < 24*60 ? `${Math.floor(minutesToEvent/60)}h` : `${Math.floor(minutesToEvent/1440)}d`) : '—';

      const bookName = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
      const stakesByLeg = sb.latencyOrder || sb.books.map((b, i) => ({ book: b, outcome: sb.outcomes[i], odd: sb.odds[i], stake: sb.stakes?.[i] || 0 }));

      const marketLabel = ({
        'h2h-3way':  'Ganador (1X2)',
        'h2h-2way':  'Ganador (sin empate)',
        'btts':      'Ambos marcan',
        'cross-1+X2':'Local + Empate/Visitante',
        'cross-2+1X':'Visitante + Local/Empate',
        'cross-X+12':'Empate + Local/Visitante'
      })[sb.market] || (sb.market.startsWith('totals-') ? `Over/Under ${sb.market.replace('totals-', '')}`
                                                       : sb.market.startsWith('ah-') ? `Hándicap ${sb.market.replace('ah-', '')}`
                                                       : sb.market.startsWith('cross-') ? sb.market.replace('cross-', 'Cross-market ').replace(/\+/g, ' + ')
                                                       : sb.market);

      const warnFit = sb.bankrollFit === false;

      return `
        <div class="card card-tinted card-pad-sm arb-card">
          <div class="row between">
            <div>
              <div class="cluster">
                <strong>${BSUI.esc(sb.event)}</strong>
                <span class="badge badge-${confCls} tiny">Conf ${(conf*100).toFixed(0)}%</span>
                ${warnFit ? '<span class="badge badge-warning tiny">⚠ stake &gt; límite cuenta</span>' : ''}
              </div>
              <div class="muted tiny">${BSUI.esc(marketLabel)} · kickoff en ${minLabel}</div>
            </div>
            <div class="text-right">
              <strong class="badge badge-success num">+${(sb.netRoi*100).toFixed(2)}% net</strong>
              <div class="muted tiny">(bruto +${(sb.grossRoi*100).toFixed(2)}% · slip ${(sb.slippage*100).toFixed(2)}%)</div>
            </div>
          </div>
          <div class="arb-legs">
            ${stakesByLeg.map(leg => {
              const logo = window.BSLogos ? BSLogos.bookLogo(leg.book, { size: 14 }) : '';
              return `<div class="arb-leg">
                <div class="cluster" style="gap:6px">${logo}<strong class="tiny">${BSUI.esc(bookName(leg.book))}</strong></div>
                <div class="muted tiny">${BSUI.esc(leg.outcome)}</div>
                <div><span class="num">${leg.odd.toFixed(2)}</span></div>
                <div><strong class="num text-brand">${BSUI.money(leg.stake)}</strong></div>
              </div>`;
            }).join('')}
          </div>
          <div class="row between" style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px">
            <div class="muted tiny">Profit garantizado @ ${BSUI.money(f.bankroll)}</div>
            <strong class="num text-success">+${BSUI.money(profitARS)}</strong>
          </div>
          <div class="row between" style="margin-top:4px">
            <div class="cluster" style="gap:4px">
              <button class="btn btn-ghost btn-sm" data-copy-sb="${sb.key}">📋 Copiar playbook</button>
              <button class="btn btn-ghost btn-sm" data-explain-sb="${sb.key}" title="Análisis IA: por qué existe esta surebet + ejecución óptima">${BSIcons.svg('bolt', { size: 12 })} Explicar IA</button>
            </div>
            <span class="muted tiny">Empezar por: ${BSUI.esc(bookName(stakesByLeg[0]?.book))}</span>
          </div>
          <div class="ai-explain" data-explain-host="${sb.key}" style="display:none;margin-top:8px"></div>
        </div>
      `;
    }

    function copyPlaybook(sb, f) {
      const bookName = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
      const lines = [
        `SUREBET — ${sb.event} (${sb.market})`,
        `ROI neto: ${(sb.netRoi*100).toFixed(2)}% · Confidence: ${(sb.confidence*100).toFixed(0)}%`,
        `Bankroll: ${BSUI.money(f.bankroll)} → Profit garantizado: ${BSUI.money(Math.round(f.bankroll * sb.netRoi / 10) * 10)}`,
        `Orden de ejecución (por latencia descendente):`,
        ...(sb.latencyOrder || []).map((leg, i) => `  ${i+1}. ${bookName(leg.book)} · ${leg.outcome} @ ${leg.odd.toFixed(2)} · stake ${BSUI.money(leg.stake)}`),
        'NB: ejecutá rápido — las cuotas se cierran en segundos.'
      ];
      navigator.clipboard.writeText(lines.join('\n'));
      BSUI.toast({ title: 'Playbook copiado', message: 'Pegalo donde lo necesites para ejecutar.', type: 'success' });
      // Guardar en histórico
      const hist = BSStore.get(BSStore.KEYS.arbHistory) || [];
      const histItem = {
        id: 'sb' + Date.now(),
        at: Date.now(),
        event: sb.event,
        market: sb.market,
        books: sb.books.map(bookName).join(' / '),
        roi: +(sb.netRoi * 100).toFixed(2),
        conf: sb.confidence
      };
      const merged = [histItem, ...hist].slice(0, 500);
      BSStore.set(BSStore.KEYS.arbHistory, merged);
      renderHist();
    }

    function renderHist() {
      const list = (BSStore.get(BSStore.KEYS.arbHistory) || []).slice(0, 30);
      panel.querySelector('#arbHist').innerHTML = list.map(s => `
        <tr><td class="mono tiny">${new Date(s.at).toLocaleTimeString('es-AR')}</td><td>${BSUI.esc(s.event)}</td><td class="tiny">${BSUI.esc(s.market || '—')}</td><td>${BSUI.esc(s.books)}</td><td class="num text-success">+${s.roi}%</td><td class="num">${s.conf ? (s.conf*100).toFixed(0)+'%' : '—'}</td><td></td></tr>
      `).join('');
    }

    // ── Push en vivo via WebSocket ─────────────────────────────────────
    const onSurebet = (e) => {
      log(`SUREBET ${e.detail?.event || ''} · ${e.detail?.market || ''} · +${((e.detail?.netRoi||0)*100).toFixed(2)}% · conf ${((e.detail?.confidence||0)*100).toFixed(0)}%`);
      if (panel.querySelector('#arbAudio').checked) beep();
      refresh();
    };
    const onClosed = (e) => {
      const ids = e.detail || [];
      if (ids.length) log(`Cerradas ${ids.length} surebet(s) (cuota movió)`);
      refresh();
    };
    const onCycle = (e) => {
      // Re-render KPIs cada ciclo del motor
      panel.querySelector('#arbCycles').textContent = e.detail?.n || 0;
    };
    window.addEventListener('bs:live-surebet', onSurebet);
    window.addEventListener('bs:live-surebets-closed', onClosed);
    window.addEventListener('bs:live-arb-cycle', onCycle);

    panel.querySelector('#arbOn').addEventListener('change', e => { running = e.target.checked; });
    ['#arbMinRoi', '#arbMinConf', '#arbSport', '#arbMarket', '#arbBankrollFit'].forEach(sel => {
      panel.querySelector(sel)?.addEventListener('input', refresh);
      panel.querySelector(sel)?.addEventListener('change', refresh);
    });

    function beep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.04;
        o.connect(g).connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.12);
      } catch {}
    }

    panel.querySelector('#arbExport').addEventListener('click', () => {
      const list = BSStore.get(BSStore.KEYS.arbHistory) || [];
      const rows = [['hora','evento','mercado','books','roi','conf'].join(',')].concat(list.map(s => [new Date(s.at).toISOString(), s.event, s.market || '', s.books, s.roi, s.conf || ''].join(',')));
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'betsafe-surebets.csv'; a.click();
    });
    panel.querySelector('#arbClearHist').addEventListener('click', () => {
      BSStore.set(BSStore.KEYS.arbHistory, []);
      renderHist(); BSUI.toast({ title: 'Histórico limpio', type: 'info' });
    });

    // Bankroll stepper
    const bankEl = panel.querySelector('#arbBankroll');
    panel.querySelectorAll('[data-stepper="arbbank"] .num-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sign = btn.dataset.step === '+' ? 1 : -1;
        const cur = Number(String(bankEl.value).replace(/[^\d]/g, '')) || 0;
        const step = cur >= 1000000 ? 100000 : cur >= 100000 ? 10000 : 5000;
        bankEl.value = String(Math.max(0, cur + sign * step));
        refresh();
      });
    });
    bankEl.addEventListener('input', () => {
      bankEl.value = String(bankEl.value).replace(/[^\d]/g, '');
      refresh();
    });
    panel.querySelectorAll('.arb-quick').forEach(b => b.addEventListener('click', () => {
      bankEl.value = String(b.dataset.amount);
      refresh();
    }));

    log('Conectado al motor de arbitraje del backend · escaneando cada 5s · casas legales AR');
    refresh();
    renderHist();

    panel.__cleanup = () => {
      window.removeEventListener('bs:live-surebet', onSurebet);
      window.removeEventListener('bs:live-surebets-closed', onClosed);
      window.removeEventListener('bs:live-arb-cycle', onCycle);
    };
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('arbitrage', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('arbitrage', render));
  }
  doRegister();
  window.__bsArbitrageRender = render;
})();
