/* BetSafe — Arbitraje VIP (motor hiper-preciso)
 * ============================================================================
 *  - Motor en backend escanea cuotas de casas legales argentinas cada 5s
 *  - Detecta surebets en 1X2 (2 y 3 vías), Más/Menos goles, Ambos marcan,
 *    Hándicap asiático y Doble Vía (1X2 × Doble Oportunidad)
 *  - Cada surebet trae: confianza, deslizamiento real por casa, montos
 *    óptimos, ganancia asegurada en ARS, orden de ejecución, chequeo de
 *    topes de cuenta
 *  - El frontend recibe surebets nuevas en vivo vía WebSocket y los
 *    montos/ganancias se RECALCULAN al toque cuando movés el banco — sin
 *    refrescar, sin parpadeos, sin valores fantasma.
 * ============================================================================
 */
(function () {
  'use strict';

  // ── Traducción de mercados y resultados ────────────────────────────────────
  const MARKET_ES = {
    'h2h-3way':  'Ganador del partido (1 · X · 2)',
    'h2h-2way':  'Ganador del partido (sin empate)',
    'btts':      'Ambos equipos marcan',
    'cross-1+X2':'Doble vía: Local + Empate o Visitante',
    'cross-2+1X':'Doble vía: Visitante + Local o Empate',
    'cross-X+12':'Doble vía: Empate + Local o Visitante'
  };

  function marketLabel(market) {
    if (!market) return '—';
    if (MARKET_ES[market]) return MARKET_ES[market];
    let m;
    if ((m = String(market).match(/^totals-([\d.]+)$/i))) return `Más / Menos de ${m[1]} goles`;
    if ((m = String(market).match(/^ah-(-?[\d.]+)$/i))) return `Hándicap asiático ${m[1]}`;
    if ((m = String(market).match(/^cross-(.+)$/i))) return `Doble vía ${m[1].replace(/\+/g, ' + ')}`;
    return market;
  }

  function outcomeLabel(out) {
    if (!out) return '—';
    const key = String(out).toLowerCase();
    const direct = {
      'home': 'Gana local',
      'away': 'Gana visitante',
      'draw': 'Empate',
      'home_or_away': 'Local o visitante',
      'home_or_draw': 'Local o empate',
      'draw_or_away': 'Empate o visitante',
      'yes': 'Sí',
      'no': 'No',
      'over': 'Más goles',
      'under': 'Menos goles',
      'home_minus': 'Local (con hándicap)',
      'away_plus': 'Visitante (con hándicap)'
    };
    if (direct[key]) return direct[key];
    let m;
    if ((m = key.match(/^over\s*([\d.]+)$/))) return `Más de ${m[1]} goles`;
    if ((m = key.match(/^under\s*([\d.]+)$/))) return `Menos de ${m[1]} goles`;
    return out;
  }

  function timeToEventLabel(ms) {
    if (ms == null) return '—';
    const min = Math.floor(ms / 60000);
    if (min <= 0) return 'arranca ya';
    if (min < 60) return `empieza en ${min}m`;
    if (min < 24 * 60) return `empieza en ${Math.floor(min / 60)}h`;
    return `empieza en ${Math.floor(min / 1440)}d`;
  }

  function freshnessLabel(ts) {
    if (!ts) return '—';
    const ageSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (ageSec < 1) return 'recién actualizado';
    if (ageSec < 60) return `actualizado hace ${ageSec}s`;
    const min = Math.floor(ageSec / 60);
    return `actualizado hace ${min}m`;
  }

  // Decide qué timestamp usar para una surebet.
  // PRIORIDAD:
  //   1) sb.oddsAge: edad real de las CUOTAS subyacentes (calculada por el
  //      motor a partir de `event.lastUpdate`). Es la frescura más correcta.
  //   2) snapAt: timestamp del snapshot recibido del backend. Si la surebet
  //      está en la respuesta, está VIVA aunque sus odds tengan algo de edad.
  //   3) Date.now(): fallback seguro. NUNCA caemos a sb.lastSeenAt (puede ser
  //      stale si la surebet persiste varios ciclos) ni a 0 (descarta todo).
  function bestTimestamp(sb, snapAt) {
    if (typeof sb?.oddsAge === 'number' && Number.isFinite(sb.oddsAge)) {
      return Date.now() - sb.oddsAge;
    }
    return snapAt || Date.now();
  }

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `<div class="card card-vip card-pad-lg stack"><span class="badge-vip">VIP</span><h2 class="h3">Arbitraje en vivo (VIP)</h2><p class="muted">Motor de arbitraje hiper-preciso: multi-casa, multi-mercado, doble vía, score de confianza y escaneo cada 5 segundos.</p><a href="pricing.html" class="btn btn-gold">Ver planes</a></div>`;
      return;
    }

    panel.innerHTML = `
      <div class="row between mb-3">
        <div>
          <h2 class="h3">Ganancia segura · escaneo en vivo<a class="help-q" tabindex="0" data-tip="Encontramos partidos donde distintas casas tienen cuotas tan diferentes que podés apostar a TODOS los resultados posibles y ganar plata sí o sí, gane quien gane. Revisamos las 6 casas argentinas cada 5 segundos. El único riesgo es que la cuota cambie antes de que termines de apostar — por eso te marcamos cuán frescas están."></a></h2>
          <p class="muted">Escaneo cada 5s · Ganador + Más/Menos + Ambos marcan + Hándicap + Doble Vía · monto óptimo con deslizamiento real · 100% datos en vivo</p>
        </div>
        <div class="cluster">
          <label class="toggle"><input type="checkbox" id="arbOn" checked><span class="track"></span><strong>Motor activo</strong></label>
          <label class="toggle"><input type="checkbox" id="arbAudio"><span class="track"></span><span class="muted tiny">Audio</span></label>
        </div>
      </div>

      <!-- Banco -->
      <div class="card stack mb-3" style="background:linear-gradient(135deg, color-mix(in srgb, var(--brand-500) 6%, var(--surface)), var(--surface))">
        <div class="row between">
          <strong>Cuánto querés invertir<a class="help-q" tabindex="0" data-tip="El motor reparte tu plata entre las casas para garantizar ganancia sin importar el resultado. Si los montos superan los topes típicos de tu cuenta, te avisamos con ⚠. Cambiá el banco y todo se recalcula al toque, sin necesidad de refrescar."></a></strong>
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
        <div class="muted tiny" id="arbBankHint">Cambiá el monto y todos los valores se recalculan al instante.</div>
      </div>

      <!-- Filtros REALES -->
      <div class="card stack mb-3">
        <div class="row between"><strong>Filtros profesionales</strong><span class="muted tiny" id="arbFilterCount">—</span></div>
        <div class="row gap-2" style="flex-wrap:wrap;align-items:center">
          <label class="field" style="margin:0;min-width:160px">
            <span class="field-label">Ganancia mín. %</span>
            <input class="input input-sm" id="arbMinRoi" type="number" step="0.1" min="0" value="0.5" title="Mínimo % de ganancia para mostrar la oportunidad. 0.5% sobre $100.000 = $500 ganados sin riesgo.">
          </label>
          <!-- "Confianza" eliminado: el arbitraje bien calculado es matemáticamente
               seguro. En su lugar, filtramos por frescura de la cuota — surebets
               con datos viejos pueden cerrarse antes de poder ejecutarlas. -->
          <label class="field" style="margin:0;min-width:160px">
            <span class="field-label">Frescura máx. (segundos)</span>
            <input class="input input-sm" id="arbMaxAge" type="number" step="30" min="30" max="600" value="300">
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
              <option value="totals">Más / Menos de goles</option>
              <option value="btts">Ambos equipos marcan</option>
              <option value="ah">Hándicap asiático</option>
              <option value="cross">Doble vía</option>
            </select>
          </label>
          <label class="cluster" style="cursor:pointer;margin:0">
            <input type="checkbox" id="arbBankrollFit" checked>
            <span class="tiny">Solo las que se pueden apostar de verdad</span>
            <a class="help-q" tabindex="0" data-tip="Descarta las apuestas donde el monto sugerido es demasiado alto y la casa probablemente te lo va a limitar."></a>
          </label>
        </div>
      </div>

      <!-- KPIs motor (sin "Confianza" porque arbitraje matemáticamente seguro
           tiene riesgo 0; reemplazamos por métricas de actividad del motor) -->
      <div class="grid grid-4 mb-4">
        <div class="kpi"><div class="kpi-label">Surebets activas</div><div class="kpi-value" id="arbActive">0</div></div>
        <div class="kpi"><div class="kpi-label">Mejor rentabilidad neta</div><div class="kpi-value" id="arbBestRoi">—</div></div>
        <div class="kpi"><div class="kpi-label">Ganancia mín. asegurada</div><div class="kpi-value" id="arbMinGuaranteed">—</div></div>
        <div class="kpi"><div class="kpi-label">Ciclos de análisis</div><div class="kpi-value" id="arbCycles">0</div></div>
      </div>

      <div class="grid" style="grid-template-columns: 1.6fr 1fr; gap:16px">
        <div class="card stack">
          <div class="row between">
            <strong>Surebets en vivo</strong>
            <span class="muted tiny" id="arbLastUpd">—</span>
          </div>
          <div id="arbList" class="stack-sm" style="min-height:240px"></div>
          <!-- Paginación: cuando hay más de PAGE_SIZE surebets, este botón
               carga las siguientes en batches para que la UI no se trabe. -->
          <div id="arbLoadMoreWrap" class="row" style="justify-content:center;display:none;margin-top:8px">
            <button class="btn btn-outline btn-sm" id="arbLoadMore">
              <span id="arbLoadMoreLabel">Mostrar más surebets</span>
            </button>
          </div>
        </div>

        <div class="card stack">
          <strong>Calculadora rápida</strong>
          <div class="seg" id="arbCalcSeg">
            <button class="active" data-w="2">2 vías</button>
            <button data-w="3">3 vías</button>
            <button data-w="middle">Middle</button>
          </div>
          <div id="arbCalc"></div>
        </div>
      </div>

      <!-- Consola del motor (debug profesional) -->
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
        <label class="field"><span class="field-label">Monto total a invertir</span><input class="input" id="ac_t" type="number" value="10000"></label>
        <div id="acOut"></div>`;
      else if (w === '3') host.innerHTML = `
        <label class="field"><span class="field-label">Cuota Local (1)</span><input class="input" id="ac_a" type="number" step=".01" value="3.20"></label>
        <label class="field"><span class="field-label">Cuota Empate (X)</span><input class="input" id="ac_b" type="number" step=".01" value="3.50"></label>
        <label class="field"><span class="field-label">Cuota Visitante (2)</span><input class="input" id="ac_c" type="number" step=".01" value="2.80"></label>
        <label class="field"><span class="field-label">Monto total a invertir</span><input class="input" id="ac_t" type="number" value="10000"></label>
        <div id="acOut"></div>`;
      else host.innerHTML = `
        <label class="field"><span class="field-label">Cuota Más goles</span><input class="input" id="m_a" type="number" step=".01" value="1.95"></label>
        <label class="field"><span class="field-label">Monto en Más goles</span><input class="input" id="m_sa" type="number" value="500"></label>
        <label class="field"><span class="field-label">Cuota Menos goles</span><input class="input" id="m_b" type="number" step=".01" value="1.95"></label>
        <label class="field"><span class="field-label">Monto en Menos goles</span><input class="input" id="m_sb" type="number" value="500"></label>
        <div id="acOut"></div>`;
      host.querySelectorAll('input').forEach(i => i.addEventListener('input', recalc));
      recalc();
      function recalc() {
        if (w === '2') {
          const a = +host.querySelector('#ac_a').value, b = +host.querySelector('#ac_b').value, t = +host.querySelector('#ac_t').value;
          const sb = BSMath.surebet([a, b]); const st = BSMath.surebetStakes([a, b], t);
          host.querySelector('#acOut').innerHTML = sb.isSure
            ? `<div class="card card-tinted mt-3 stack-sm"><strong class="text-success">Surebet ✓ rentabilidad ${sb.roi.toFixed(2)}%</strong><div class="row between"><span>Monto en A</span><span class="num">${BSUI.money(st.stakes[0])}</span></div><div class="row between"><span>Monto en B</span><span class="num">${BSUI.money(st.stakes[1])}</span></div><div class="row between"><span>Ganancia asegurada</span><strong class="text-success num">${BSUI.money(st.profit)}</strong></div></div>`
            : `<div class="muted tiny mt-3">No es ganancia segura (la combinación de cuotas no garantiza retorno: ${(BSMath.overround([a,b])*100).toFixed(2)}% de margen a favor de la casa).</div>`;
        } else if (w === '3') {
          const a = +host.querySelector('#ac_a').value, b = +host.querySelector('#ac_b').value, c = +host.querySelector('#ac_c').value, t = +host.querySelector('#ac_t').value;
          const sb = BSMath.surebet([a, b, c]); const st = BSMath.surebetStakes([a, b, c], t);
          host.querySelector('#acOut').innerHTML = sb.isSure
            ? `<div class="card card-tinted mt-3 stack-sm"><strong class="text-success">Surebet ✓ rentabilidad ${sb.roi.toFixed(2)}%</strong><div class="row between"><span>Monto Local (1)</span><span class="num">${BSUI.money(st.stakes[0])}</span></div><div class="row between"><span>Monto Empate (X)</span><span class="num">${BSUI.money(st.stakes[1])}</span></div><div class="row between"><span>Monto Visitante (2)</span><span class="num">${BSUI.money(st.stakes[2])}</span></div><div class="row between"><span>Ganancia asegurada</span><strong class="text-success num">${BSUI.money(st.profit)}</strong></div></div>`
            : `<div class="muted tiny mt-3">No es surebet.</div>`;
        } else {
          const a = +host.querySelector('#m_a').value, sa = +host.querySelector('#m_sa').value;
          const b = +host.querySelector('#m_b').value, sb = +host.querySelector('#m_sb').value;
          const r = BSMath.middling(a, b, sa, sb);
          host.querySelector('#acOut').innerHTML = `<div class="grid grid-2 mt-3 gap-2">
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Ganan los dos lados</div><strong class="text-success num">${BSUI.money(r.winBoth)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Gana solo Más goles</div><strong class="num">${BSUI.money(r.winOne1)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Gana solo Menos goles</div><strong class="num">${BSUI.money(r.winOne2)}</strong></div>
            <div class="card card-tinted card-pad-sm"><div class="muted tiny">Pierden los dos</div><strong class="text-danger num">${BSUI.money(r.loseBoth)}</strong></div>
          </div>`;
        }
      }
    }
    renderCalc('2');

    // ── Estado y bindings ──────────────────────────────────────────────
    let running = true;
    let logLines = [];
    let lastList = [];        // surebets que pasaron filtros (cache para recálculo local)
    let lastMeta = null;      // meta del snapshot
    let lastSnapshotAt = 0;   // timestamp del último snapshot recibido
    const cons = panel.querySelector('#arbConsole');
    function log(msg) {
      const ts = new Date().toLocaleTimeString('es-AR');
      logLines.push(`[${ts}] ${msg}`);
      cons.textContent = logLines.slice(-20).join('\n');
      cons.scrollTop = cons.scrollHeight;
    }

    // ── Paginación ──
    // Mostrar PAGE_SIZE surebets por defecto y botón "Mostrar más" para
    // cargar siguientes batches. Evita render de 467 items de golpe.
    const PAGE_SIZE = 12;
    let visibleCount = PAGE_SIZE;

    function getFilters() {
      return {
        minRoi:        Number(panel.querySelector('#arbMinRoi').value) || 0,
        maxAgeSec:     Number(panel.querySelector('#arbMaxAge').value) || 300,
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
      // Filtro de frescura: descartar surebets con cuotas más viejas que maxAgeSec
      const sbTs = bestTimestamp(sb, lastSnapshotAt);
      const ageSec = (Date.now() - sbTs) / 1000;
      if (f.maxAgeSec && ageSec > f.maxAgeSec) return false;
      return true;
    }

    // Recompone los montos óptimos para el banco actual usando las cuotas reales.
    // Esto garantiza que cuando el usuario cambia el banco, los stakes/ganancias
    // se actualizan AL TOQUE sin tocar el backend.
    function computeStakesFor(sb, bankroll) {
      const odds = sb.odds && sb.odds.length ? sb.odds : (sb.latencyOrder || []).map(l => l.odd);
      if (!odds.length || !bankroll || bankroll <= 0) return null;
      const inv = odds.map(o => 1 / o);
      const sumInv = inv.reduce((s, x) => s + x, 0);
      const stakes = inv.map(x => Math.round((x / sumInv) * bankroll / 10) * 10);
      const netRoi = sb.netRoi || ((1 / sumInv) - 1);
      const profit = Math.round(bankroll * netRoi / 10) * 10;
      return { stakes, profit, netRoi };
    }

    async function refresh() {
      if (!running) return;
      const f = getFilters();
      try {
        const r = await BSLive.getArbitrageSnapshot({
          minRoi: f.minRoi,
          sport: f.sport
        });
        const all = (r.surebets || []).filter(sb => matchesFilters(sb, f));
        lastList = all;
        lastMeta = r.meta || {};
        lastSnapshotAt = Date.now();
        localRender(f);
      } catch (e) {
        log(`[error] ${e?.message}`);
      }
    }

    // localRender: re-renderiza usando lastList sin tocar el backend.
    // Se llama cuando cambia el banco, cuando el ticker de frescura corre,
    // y al final de cada refresh().
    function localRender(f) {
      if (!f) f = getFilters();
      const list = lastList.filter(sb => matchesFilters(sb, f));

      renderSurebets(list, f);

      // KPIs (con banco actual) — "Confianza promedio" reemplazado por
      // "Ganancia mín. asegurada" porque en arbitraje el riesgo es 0 por
      // definición; lo que importa es cuánto ganás como mínimo.
      panel.querySelector('#arbActive').textContent = list.length;
      if (list.length) {
        const best = Math.max(...list.map(s => s.netRoi || 0));
        // Ganancia mínima asegurada = el peor de los mejores ROI × banco
        const worstOfTop = list.slice(0, Math.min(10, list.length))
          .reduce((m, s) => Math.min(m, s.netRoi || Infinity), Infinity);
        const minGuaranteed = Number.isFinite(worstOfTop)
          ? Math.round(f.bankroll * worstOfTop / 10) * 10
          : 0;
        panel.querySelector('#arbBestRoi').textContent = BSUI.pctInt(best, 2);
        panel.querySelector('#arbMinGuaranteed').textContent = '+' + BSUI.money(minGuaranteed);
      } else {
        panel.querySelector('#arbBestRoi').textContent = '—';
        panel.querySelector('#arbMinGuaranteed').textContent = '—';
      }
      panel.querySelector('#arbCycles').textContent = lastMeta?.cycles || 0;
      const intervalS = ((lastMeta?.interval || 5000) / 1000);
      const showing = Math.min(visibleCount, list.length);
      panel.querySelector('#arbLastUpd').textContent = `El motor analiza cada ${intervalS}s · mostrando ${showing}/${list.length} · ${freshnessLabel(lastSnapshotAt)}`;
      panel.querySelector('#arbFilterCount').textContent = `${list.length} surebets vigentes`;

      // Botón "Mostrar más" — visible si hay más para cargar
      const wrap = panel.querySelector('#arbLoadMoreWrap');
      const label = panel.querySelector('#arbLoadMoreLabel');
      if (wrap && label) {
        if (list.length > visibleCount) {
          wrap.style.display = '';
          const remaining = list.length - visibleCount;
          const next = Math.min(PAGE_SIZE, remaining);
          label.textContent = `Mostrar ${next} más (quedan ${remaining})`;
        } else {
          wrap.style.display = 'none';
        }
      }
    }

    function renderSurebets(list, f) {
      const host = panel.querySelector('#arbList');
      if (!list.length) {
        host.innerHTML = `
        <div class="bs-empty-prem">
          <div class="bs-empty-prem__ico">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          </div>
          <strong class="bs-empty-prem__title">Buscando oportunidades de ganancia segura</strong>
          <p class="bs-empty-prem__hint">Las ganancias seguras aparecen cuando dos casas tienen cuotas diferentes para el mismo partido. Las apuestas se cierran cuando las casas se igualan. Revisamos las 6 casas legales argentinas cada 5 segundos.</p>
          <div class="cluster" style="gap:6px;flex-wrap:wrap;justify-content:center;margin-top:6px">
            <button class="btn btn-outline btn-sm" data-arb-lower-roi>Mostrar también ganancias chicas (desde 0.1%)</button>
            <button class="btn btn-outline btn-sm" data-arb-relax-age>Incluir cuotas más viejas (10 min)</button>
            <button class="btn btn-ghost btn-sm" data-arb-clear-fit>Sin límite de monto</button>
          </div>
        </div>`;
        // Bindings de los CTAs del empty state — ayudan al usuario a aflojar
        // filtros sin que tenga que buscar dónde está cada control.
        host.querySelector('[data-arb-lower-roi]')?.addEventListener('click', () => {
          const el = panel.querySelector('#arbMinRoi'); if (!el) return;
          el.value = '0.1'; refresh();
        });
        host.querySelector('[data-arb-relax-age]')?.addEventListener('click', () => {
          const el = panel.querySelector('#arbMaxAge'); if (!el) return;
          el.value = '600'; refresh();
        });
        host.querySelector('[data-arb-clear-fit]')?.addEventListener('click', () => {
          const el = panel.querySelector('#arbBankrollFit'); if (!el) return;
          el.checked = false; refresh();
        });
        return;
      }
      // Paginación: solo renderizamos las primeras `visibleCount` para que la UI
      // no se trabe con 400+ items. El botón "Mostrar más" amplía visibleCount.
      host.innerHTML = list.slice(0, visibleCount).map(sb => surebetCard(sb, f)).join('');

      // Bindings click
      host.querySelectorAll('[data-copy-sb]').forEach(b => b.addEventListener('click', () => {
        const sb = list.find(s => s.key === b.dataset.copySb);
        if (sb) copyPlaybook(sb, f);
      }));

      // Análisis IA por surebet
      host.querySelectorAll('[data-explain-sb]').forEach(b => b.addEventListener('click', async () => {
        const key = b.dataset.explainSb;
        const target = host.querySelector(`[data-explain-host="${CSS.escape(key)}"]`);
        if (!target) return;
        if (target.dataset.loaded === '1') {
          target.style.display = target.style.display === 'none' ? '' : 'none';
          return;
        }
        target.style.display = '';
        target.innerHTML = `<div class="card card-pad-sm card-tinted"><span class="shimmer-text muted tiny">La IA está analizando esta surebet…</span></div>`;
        b.disabled = true;
        try {
          const r = await BSLive.explainSurebet(key);
          target.dataset.loaded = '1';
          const decisionColor = r.shouldExecute ? 'success' : 'danger';
          const decisionLabel = r.shouldExecute ? 'Conviene ejecutar' : 'Mejor pasar';
          const riskHtml = (r.risks || []).map(x => `<li class="tiny muted">⚠ ${BSUI.esc(x)}</li>`).join('');
          const orderHtml = (r.executionOrder || []).map((x, i) => `<li class="tiny"><strong>${i+1}.</strong> ${BSUI.esc(x)}</li>`).join('');
          target.innerHTML = `
            <div class="card card-tinted card-pad-sm" style="border-left:3px solid var(--brand-500)">
              <div class="row between" style="align-items:center">
                <strong class="tiny">Análisis con IA</strong>
                <span class="badge badge-${decisionColor} tiny">${decisionLabel}</span>
              </div>
              ${r.whyExists ? `<p class="tiny" style="margin-top:6px;line-height:1.5"><strong>Por qué existe:</strong> ${BSUI.esc(r.whyExists)}</p>` : ''}
              ${orderHtml ? `<div style="margin-top:6px"><strong class="tiny">Orden óptimo de ejecución</strong><ol style="margin:4px 0 0 18px;padding:0">${orderHtml}</ol></div>` : ''}
              ${riskHtml ? `<div style="margin-top:6px"><strong class="tiny">Riesgos</strong><ul style="margin:4px 0 0 18px;padding:0;list-style:none">${riskHtml}</ul></div>` : ''}
              ${r.shouldExecuteReason ? `<p class="tiny muted" style="margin-top:6px;font-style:italic">${BSUI.esc(r.shouldExecuteReason)}</p>` : ''}
            </div>`;
        } catch (e) {
          target.innerHTML = `<div class="card card-pad-sm card-tinted"><span class="text-danger tiny">IA no disponible en este momento: ${BSUI.esc(e?.message || 'error')}</span></div>`;
        } finally {
          b.disabled = false;
        }
      }));
    }

    function surebetCard(sb, f) {
      // Recalcular montos/ganancia para el banco actual del usuario
      const computed = computeStakesFor(sb, f.bankroll) || {};
      const profitARS = computed.profit ?? Math.round((f.bankroll * (sb.netRoi || 0)) / 10) * 10;

      const minLabel = timeToEventLabel(sb.timeToEvent);

      const bookName = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;

      // Construir filas por leg: usar latencyOrder si vino del backend, sino books
      const baseLegs = sb.latencyOrder && sb.latencyOrder.length
        ? sb.latencyOrder
        : (sb.books || []).map((b, i) => ({ book: b, outcome: sb.outcomes?.[i], odd: sb.odds?.[i], stake: sb.stakes?.[i] || 0 }));

      // Re-mapear stakes al banco actual usando la misma proporción de cuotas
      const stakesByLeg = baseLegs.map((leg, i) => {
        const idxInOdds = sb.odds ? sb.odds.findIndex((o, j) => o === leg.odd && sb.books[j] === leg.book) : i;
        const newStake = computed.stakes ? (computed.stakes[idxInOdds] ?? leg.stake) : leg.stake;
        return { ...leg, stake: newStake };
      });

      const mktLabel = marketLabel(sb.market);
      const warnFit = sb.bankrollFit === false;

      // Frescura por surebet: usar timestamp del backend (lastSeenAt) si vino,
      // sino el snapshot global. En arbitraje no hay "riesgo del análisis" porque
      // es matemáticamente seguro — el único riesgo real es que la cuota cambie
      // antes de ejecutar. Por eso reemplazamos "Confianza X%" por:
      //   - "Verificada" si está fresca (< 15s)
      //   - "Margen actualizado · hace Xs" si tiene <30s
      //   - "⚠ cuotas pueden haber cambiado" si > 30s
      const sbTs = bestTimestamp(sb, lastSnapshotAt);
      const ageSec = Math.max(0, Math.round((Date.now() - sbTs) / 1000));
      const stale = ageSec > 30;
      const veryFresh = ageSec <= 15;

      // Indicador profesional de estado (reemplaza "Confianza X%"):
      const statusBadge = veryFresh
        ? `<span class="badge badge-success tiny" title="Las cuotas están actualizadas hace menos de 15 segundos. Andá a apostar ya antes que cambien."><svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="margin-right:3px;vertical-align:-1px"><path d="M13.854 3.146a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 9.793l6.646-6.647a.5.5 0 01.708 0z"/></svg>Lista para apostar</span>`
        : stale
          ? `<span class="badge badge-warning tiny" title="Las cuotas tienen más de 30 segundos. Verificá en la casa que sigan disponibles antes de apostar.">⚠ Confirmá cuotas en la casa</span>`
          : `<span class="badge badge-info tiny" title="Cuotas confirmadas hace ${ageSec} segundos.">Cuotas frescas · hace ${ageSec}s</span>`;

      // Pct distribución por casa
      const totalStake = stakesByLeg.reduce((s, l) => s + (l.stake || 0), 0) || 1;

      const netRoiPct = (computed.netRoi ?? sb.netRoi) * 100;

      return `
        <article class="bs-prem arb-card" data-sb-key="${sb.key}">
          <header class="bs-prem__head">
            <strong class="bs-prem__title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10l-3-3M17 17H7l3 3M3 12h18"/></svg>
              ${BSUI.esc(sb.event)}
            </strong>
            <div class="bs-prem__chips">
              ${statusBadge}
              ${warnFit ? '<span class="badge badge-warning tiny" title="Los montos sugeridos pueden ser muy altos para una cuenta nueva. La casa podría limitarte la apuesta.">⚠ monto alto para cuenta estándar</span>' : ''}
            </div>
          </header>

          <div class="bs-prem__hero">
            <div class="bs-prem__hero-cell">
              <span class="bs-prem__hero-label" title="Cuánto ganás sí o sí — sin importar el resultado del partido. Ya descontamos el margen de seguridad por si la cuota cambia mientras apostás.">Ganancia segura</span>
              <span class="bs-prem__edge" style="font-size:1.6rem">+${netRoiPct.toFixed(2)}%</span>
              <span class="bs-prem__edge-explain">antes de descuentos: +${BSUI.pctInt(sb.grossRoi, 2)}</span>
            </div>
            <div class="bs-prem__hero-cell">
              <span class="bs-prem__hero-label">Ganancia asegurada con ${BSUI.money(f.bankroll)}</span>
              <span class="bs-prem__pay">+${BSUI.money(profitARS)}</span>
              <span class="bs-prem__pay-sub">${BSUI.esc(mktLabel)} · ${minLabel}</span>
            </div>
            <div class="bs-prem__hero-cell bs-prem__edge-cell">
              <span class="bs-prem__hero-label">Empezá por (book más lento)</span>
              <span style="display:flex;align-items:center;gap:8px;margin-top:4px">
                ${window.BSLogos ? BSLogos.bookLogo(stakesByLeg[0]?.book, { size: 28 }) : ''}
                <strong style="font-size:1.05rem">${BSUI.esc(bookName(stakesByLeg[0]?.book))}</strong>
              </span>
            </div>
          </div>

          <!-- Plan de ejecución: tabla limpia por casa con stake destacado -->
          <div class="bs-prem__legs arb-plan">
            ${stakesByLeg.map((leg, i) => {
              const logo = window.BSLogos ? BSLogos.bookLogo(leg.book, { size: 24 }) : '';
              const pct = totalStake ? Math.round((leg.stake / totalStake) * 100) : 0;
              return `<div class="bs-prem__leg arb-plan__row">
                <div class="bs-prem__leg-info">
                  <div class="bs-prem__leg-teams">
                    <span class="arb-plan__rank">${i+1}</span>
                    ${logo}
                    <strong>${BSUI.esc(bookName(leg.book))}</strong>
                  </div>
                  <div class="bs-prem__leg-meta">
                    <span class="bs-prem__leg-mkt">${BSUI.esc(outcomeLabel(leg.outcome))}</span>
                    <span>cuota <strong class="num">${(leg.odd || 0).toFixed(2)}</strong></span>
                    <span class="muted tiny">${pct}% del banco</span>
                  </div>
                </div>
                <strong class="bs-prem__leg-odd" style="color:var(--brand-700)">${BSUI.money(leg.stake)}</strong>
              </div>`;
            }).join('')}
          </div>

          <footer class="bs-prem__actions">
            <button class="btn btn-primary" data-copy-sb="${sb.key}" title="Copia un plan paso a paso listo para apostar">${BSIcons.svg('copy', { size: 14 })} Copiar plan de apuesta</button>
            <button class="btn btn-outline btn-sm" data-explain-sb="${sb.key}" title="Análisis con IA: por qué existe esta surebet + orden óptimo de ejecución">${BSIcons.svg('bolt', { size: 14 })} Analizar con IA</button>
            <span class="muted tiny" data-freshness="${sb.key}" data-ts="${sbTs}" style="margin-left:auto;align-self:center">${freshnessLabel(sbTs)}</span>
          </footer>
          <div class="ai-explain" data-explain-host="${sb.key}"></div>
        </article>
      `;
    }

    function copyPlaybook(sb, f) {
      const bookName = (k) => BSData.ALL_BOOKS.find(b => b.key === k)?.name || k;
      const computed = computeStakesFor(sb, f.bankroll) || {};
      const profit = computed.profit ?? Math.round(f.bankroll * (sb.netRoi || 0) / 10) * 10;
      const baseLegs = sb.latencyOrder && sb.latencyOrder.length
        ? sb.latencyOrder
        : (sb.books || []).map((b, i) => ({ book: b, outcome: sb.outcomes?.[i], odd: sb.odds?.[i], stake: sb.stakes?.[i] || 0 }));
      const lines = [
        `SUREBET — ${sb.event} (${marketLabel(sb.market)})`,
        `Rentabilidad neta: ${((computed.netRoi ?? sb.netRoi)*100).toFixed(2)}% · Confianza: ${BSUI.pctInt(sb.confidence, 0)}`,
        `Banco invertido: ${BSUI.money(f.bankroll)} → Ganancia asegurada: ${BSUI.money(profit)}`,
        `Orden de ejecución (por riesgo de cierre, primero la más rápida):`,
        ...baseLegs.map((leg, i) => {
          const idxInOdds = sb.odds ? sb.odds.findIndex((o, j) => o === leg.odd && sb.books[j] === leg.book) : i;
          const newStake = computed.stakes ? (computed.stakes[idxInOdds] ?? leg.stake) : leg.stake;
          return `  ${i+1}. ${bookName(leg.book)} · ${outcomeLabel(leg.outcome)} @ ${leg.odd.toFixed(2)} · monto ${BSUI.money(newStake)}`;
        }),
        'IMPORTANTE: ejecutá rápido — las cuotas se cierran en segundos.'
      ];
      navigator.clipboard.writeText(lines.join('\n'));
      BSUI.toast({ title: 'Instrucciones copiadas', message: 'Pegalas donde las necesites para apostar.', type: 'success' });
    }

    // ── Push en vivo via WebSocket ─────────────────────────────────────
    const onSurebet = (e) => {
      const ev = e.detail || {};
      log(`SUREBET ${ev.event || ''} · ${marketLabel(ev.market || '')} · +${((ev.netRoi||0)*100).toFixed(2)}% neto`);
      if (panel.querySelector('#arbAudio').checked) beep();
      refresh();
    };
    const onClosed = (e) => {
      const ids = e.detail || [];
      if (ids.length) log(`Se cerraron ${ids.length} surebet(s) (una casa movió la cuota)`);
      refresh();
    };
    const onCycle = (e) => {
      panel.querySelector('#arbCycles').textContent = e.detail?.n || 0;
    };
    window.addEventListener('bs:live-surebet', onSurebet);
    window.addEventListener('bs:live-surebets-closed', onClosed);
    window.addEventListener('bs:live-arb-cycle', onCycle);

    panel.querySelector('#arbOn').addEventListener('change', e => { running = e.target.checked; });

    // Filtros: cuando cambian, reseteamos paginación a la primera página.
    // Los filtros NO refetchean (el snapshot ya está cacheado).
    ['#arbMinRoi', '#arbMaxAge', '#arbSport', '#arbMarket', '#arbBankrollFit'].forEach(sel => {
      panel.querySelector(sel)?.addEventListener('input', () => {
        visibleCount = PAGE_SIZE;
        localRender(getFilters());
      });
      panel.querySelector(sel)?.addEventListener('change', () => {
        visibleCount = PAGE_SIZE;
        localRender(getFilters());
      });
    });

    // Botón "Mostrar más" — carga la siguiente tanda de surebets
    panel.querySelector('#arbLoadMore')?.addEventListener('click', () => {
      visibleCount += PAGE_SIZE;
      localRender(getFilters());
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

    // ── Bankroll: recálculo LOCAL al instante (sin refetch, sin flicker) ──
    const bankEl = panel.querySelector('#arbBankroll');

    // Format con separador de miles para legibilidad mientras se escribe
    function formatBankInput() {
      const raw = String(bankEl.value).replace(/[^\d]/g, '');
      const num = Number(raw) || 0;
      // No formatear mientras el usuario está activamente tipeando si tiene foco,
      // para no romper la posición del cursor — usar valor crudo.
      bankEl.value = raw;
      return num;
    }

    panel.querySelectorAll('[data-stepper="arbbank"] .num-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sign = btn.dataset.step === '+' ? 1 : -1;
        const cur = Number(String(bankEl.value).replace(/[^\d]/g, '')) || 0;
        const step = cur >= 1000000 ? 100000 : cur >= 100000 ? 10000 : 5000;
        bankEl.value = String(Math.max(0, cur + sign * step));
        localRender(getFilters());           // recálculo al instante
      });
    });
    bankEl.addEventListener('input', () => {
      formatBankInput();
      localRender(getFilters());             // recálculo al instante mientras se tipea
    });
    panel.querySelectorAll('.arb-quick').forEach(b => b.addEventListener('click', () => {
      bankEl.value = String(b.dataset.amount);
      localRender(getFilters());             // recálculo al instante
    }));

    // ── Ticker de frescura: cada 1s actualiza "actualizado hace Xs"
    // y, si los datos quedan stale (>30s), agrega warning visual. Cada 5s
    // hace un refetch sintético si el motor sigue activo y no hubo eventos.
    let freshTimer = null;
    let pollTimer = null;
    function tickFreshness() {
      panel.querySelectorAll('[data-freshness]').forEach(el => {
        const sbKey = el.getAttribute('data-freshness');
        const ts = Number(el.getAttribute('data-ts')) || lastSnapshotAt;
        const card = panel.querySelector(`[data-sb-key="${CSS.escape(sbKey)}"]`);
        const startBook = card?.querySelector('.arb-leg .tiny')?.textContent || '';
        const label = freshnessLabel(ts);
        el.textContent = startBook ? `${label} · arrancá por ${startBook}` : label;
      });
      // Stale badge: forzar re-render compacto si pasa el umbral
      const ageSec = Math.max(0, Math.round((Date.now() - lastSnapshotAt) / 1000));
      if (ageSec > 30 && lastList.length) {
        // marcar badge stale sin redibujar todo
        panel.querySelectorAll('.arb-card').forEach(card => {
          if (!card.querySelector('[data-stale="1"]')) {
            const head = card.querySelector('.row.between .cluster');
            if (head) head.insertAdjacentHTML('beforeend', '<span class="badge badge-warning tiny" data-stale="1" title="Datos con más de 30s. Confirmá la cuota antes de apostar.">⚠ cuotas pueden haber cambiado</span>');
          }
        });
      }
      const upd = panel.querySelector('#arbLastUpd');
      if (upd && lastMeta) {
        const intervalS = ((lastMeta?.interval || 5000) / 1000);
        const visible = panel.querySelectorAll('.arb-card').length;
        upd.textContent = `El motor analiza cada ${intervalS}s · ${visible}/${lastList.length} visibles · ${freshnessLabel(lastSnapshotAt)}`;
      }
    }
    freshTimer = setInterval(tickFreshness, 1000);

    // Polling de respaldo: si el WS está caído por alguna razón, igual
    // tenemos snapshot fresco cada 8s. Cuando llega un evento WS,
    // refresh() se invoca y el age se resetea.
    pollTimer = setInterval(() => {
      if (!running) return;
      // Si el último snapshot tiene más de 8s, pedir uno nuevo
      if (Date.now() - lastSnapshotAt > 8000) refresh();
    }, 8000);

    log('Motor de arbitraje conectado · escaneando casas legales AR cada 5s');
    refresh();

    panel.__cleanup = () => {
      window.removeEventListener('bs:live-surebet', onSurebet);
      window.removeEventListener('bs:live-surebets-closed', onClosed);
      window.removeEventListener('bs:live-arb-cycle', onCycle);
      if (freshTimer) clearInterval(freshTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
  }

  function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('arbitrage', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('arbitrage', render));
  }
  doRegister();
  window.__bsArbitrageRender = render;
})();
