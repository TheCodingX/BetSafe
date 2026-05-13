/* BetSafe — Tracker tab */
(function () {
  'use strict';

  function render(panel) {
    // SOLO operaciones reales del usuario. Si no apostó nunca, mostramos
    // empty state (no fabricamos historial fake).
    const hist = BSStore.get(BSStore.KEYS.history) || [];
    if (!hist.length) {
      panel.innerHTML = `
        <div class="card stack" style="padding:48px;text-align:center;align-items:center">
          <h2 class="h3">Tu tracker está vacío</h2>
          <p class="muted" style="max-width:520px">Cuando cargues tus primeras apuestas (manualmente desde el Builder o importando un CSV), acá vas a ver tu curva de banca, ROI, win rate, yield, racha actual y peor trade.</p>
          <div class="cluster" style="margin-top:8px">
            <button class="btn btn-primary" id="trGoBuilder">Cargar primera apuesta</button>
            <label class="btn btn-outline" style="cursor:pointer">
              <input type="file" id="trImportCsv" accept=".csv,text/csv" hidden>
              Importar CSV
            </label>
          </div>
          <span class="muted tiny" style="margin-top:14px">Formato CSV: fecha,deporte,evento,stake,cuota,resultado(W/L/P),profit</span>
        </div>`;
      panel.querySelector('#trGoBuilder')?.addEventListener('click', () => BSDash?.go?.('builder'));
      panel.querySelector('#trImportCsv')?.addEventListener('change', (e) => importCsv(e.target.files?.[0], () => render(panel)));
      return;
    }

    const wins = hist.filter(h => h.result === 'W').length;
    const losses = hist.filter(h => h.result === 'L').length;
    const total = wins + losses;
    const winrate = total ? wins / total : 0;
    const totalStaked = hist.reduce((a, h) => a + (h.stake || 0), 0);
    const profit = hist.reduce((a, h) => a + (h.profit || 0), 0);
    const roi = totalStaked ? profit / totalStaked : 0;
    const yieldPct = roi;
    const avgOddWin = avg(hist.filter(h => h.result === 'W').map(h => h.odd));
    const avgOddLose = avg(hist.filter(h => h.result === 'L').map(h => h.odd));
    const worst = hist.reduce((min, h) => (h.profit || 0) < (min.profit || 0) ? h : min, hist[0] || { profit: 0 });
    const best  = hist.reduce((max, h) => (h.profit || 0) > (max.profit || 0) ? h : max, hist[0] || { profit: 0 });

    // ── STREAK TRACKING: actual + máxima histórica ──
    const sorted = hist.slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    let currentStreak = 0, currentType = null;
    let maxWinStreak = 0, maxLoseStreak = 0;
    let winRun = 0, loseRun = 0;
    for (const h of sorted) {
      if (h.result === 'W') {
        winRun++; loseRun = 0;
        if (winRun > maxWinStreak) maxWinStreak = winRun;
      } else if (h.result === 'L') {
        loseRun++; winRun = 0;
        if (loseRun > maxLoseStreak) maxLoseStreak = loseRun;
      }
    }
    // Streak actual: cuenta hacia atrás desde el último W o L (saltea pendientes)
    for (let i = sorted.length - 1; i >= 0; i--) {
      const r = sorted[i].result;
      if (r === 'P') continue;
      if (currentType == null) currentType = r;
      if (r === currentType) currentStreak++;
      else break;
    }

    // ── CLV (Closing Line Value): comparar cuota apostada vs cuota cierre.
    // El user puede haberlo cargado en el campo opcional `closingOdd` del CSV
    // o desde el Builder. Si no, no se muestra.
    const withCLV = hist.filter(h => Number.isFinite(h.closingOdd) && h.closingOdd > 1);
    const clvAvg = withCLV.length ? avg(withCLV.map(h => ((h.odd - h.closingOdd) / h.closingOdd) * 100)) : null;

    panel.innerHTML = `
      <div class="row between mb-3">
        <h2 class="h3">Tracker · banca y performance<a class="help-q" tabindex="0" data-tip="Seguimiento serio de tu banca: curva de evolución día a día, win rate, ROI, yield, racha actual y récord histórico, mejor y peor pick, cuota promedio (que indica tu estilo), historial filtrable por fecha/deporte/resultado. Export a CSV. Es la herramienta que separa a un apostador serio de uno recreativo."></a></h2>
        <div class="cluster">
          <input class="input input-sm" id="trFrom" type="date" />
          <input class="input input-sm" id="trTo" type="date" />
          <select class="select input-sm" id="trSport"><option value="all">Todos</option>${BSData.SPORTS.map(s=>`<option value="${s.key}">${s.name}</option>`).join('')}</select>
          <select class="select input-sm" id="trRes"><option value="all">Todos</option><option value="W">Ganadas</option><option value="L">Perdidas</option><option value="P">Pendientes</option></select>
          <button class="btn btn-outline btn-sm" id="trExport">${BSIcons.svg('download',{size:14})} CSV</button>
        </div>
      </div>

      <div class="grid grid-4 reveal-stagger mb-4">
        <div class="kpi"><div class="kpi-label">Profit total</div><div class="kpi-value ${profit>=0?'text-success':'text-danger'}">${BSUI.money(profit)}</div></div>
        <div class="kpi"><div class="kpi-label">ROI</div><div class="kpi-value">${BSUI.pct(roi)}</div></div>
        <div class="kpi"><div class="kpi-label">Win rate</div><div class="kpi-value">${BSUI.pct(winrate)}</div><div class="muted tiny">${wins}W · ${losses}L</div></div>
        <div class="kpi"><div class="kpi-label">Yield</div><div class="kpi-value">${BSUI.pct(yieldPct)}</div></div>
      </div>

      <!-- ── BANKROLL EVOLUTION CHART ── -->
      <div class="card stack mb-4">
        <div class="row between">
          <strong>Evolución de banca</strong>
          <span class="muted tiny" id="trChartMeta">${hist.length} operaciones · ${BSUI.money(profit)} total</span>
        </div>
        <div class="bankroll-chart-wrap">
          <svg class="bankroll-chart" id="trBankrollChart" viewBox="0 0 600 200" preserveAspectRatio="none"></svg>
          <div class="bankroll-chart-axis" id="trChartAxis"></div>
        </div>
      </div>

      <!-- ── STREAK + INSIGHTS row ── -->
      <div class="grid grid-4 mb-4" style="gap:10px">
        <div class="kpi-mini kpi-mini--${currentType === 'W' ? 'success' : currentType === 'L' ? 'danger' : 'neutral'}">
          <span class="kpi-mini-label">Racha actual</span>
          <strong class="kpi-mini-value">${currentStreak > 0 ? `${currentStreak} ${currentType === 'W' ? 'W' : currentType === 'L' ? 'L' : ''}` : '—'}</strong>
        </div>
        <div class="kpi-mini">
          <span class="kpi-mini-label">Mejor racha</span>
          <strong class="kpi-mini-value text-success">${maxWinStreak}W</strong>
        </div>
        <div class="kpi-mini">
          <span class="kpi-mini-label">Peor racha</span>
          <strong class="kpi-mini-value text-danger">${maxLoseStreak}L</strong>
        </div>
        <div class="kpi-mini ${clvAvg != null && clvAvg > 0 ? 'kpi-mini--success' : ''}">
          <span class="kpi-mini-label" title="Closing Line Value: cuán mejor fue tu cuota vs la cuota de cierre del mercado. CLV positivo sostenido > rentabilidad a largo plazo.">CLV promedio</span>
          <strong class="kpi-mini-value">${clvAvg != null ? (clvAvg > 0 ? '+' : '') + clvAvg.toFixed(2) + '%' : '—'}</strong>
        </div>
      </div>

      <div class="grid grid-2 gap-4 mb-4">
        <div class="card stack">
          <strong>Distribución por deporte</strong>
          <div class="bar-chart" id="trBars"></div>
        </div>
        <div class="card stack">
          <strong>Cuotas promedio</strong>
          <div class="row between"><span>Ganadoras</span><strong class="num text-success">${avgOddWin.toFixed(2)}</strong></div>
          <div class="row between"><span>Perdedoras</span><strong class="num text-danger">${avgOddLose.toFixed(2)}</strong></div>
          <div class="row between"><span>Estilo</span><strong>${avgOddWin > 2.2 ? 'Cazador de longshots' : 'Cazador de favoritas'}</strong></div>
          <hr style="border:0;border-top:1px solid var(--border);margin:8px 0">
          <strong>Mejor y peor pick</strong>
          <div class="row between"><span>Mejor pick</span><strong class="num text-success">${BSUI.money(best.profit||0)}</strong></div>
          <div class="row between"><span>Peor pick</span><strong class="num ${worst.profit>0?'text-success':'text-danger'}">${BSUI.money(worst.profit||0)}</strong></div>
          <div class="muted tiny">${worst.profit > 0 ? 'Aún tu peor trade es positivo. Excelente disciplina.' : 'Revisá tu peor trade para identificar fugas.'}</div>
        </div>
      </div>

      <div class="card stack">
        <div class="row between">
          <strong>Historial de picks (${hist.length})</strong>
          <span class="muted tiny">Click para editar</span>
        </div>
        <div class="table-wrap table-cards">
          <table class="table">
            <thead><tr><th>Fecha</th><th>Deporte</th><th>Evento</th><th>Stake</th><th>Cuota</th><th>Resultado</th><th>Profit</th></tr></thead>
            <tbody id="trBody"></tbody>
          </table>
        </div>
      </div>
    `;

    function renderBody() {
      const fromV = panel.querySelector('#trFrom').value, toV = panel.querySelector('#trTo').value;
      const sp = panel.querySelector('#trSport').value, re = panel.querySelector('#trRes').value;
      const list = hist.filter(h =>
        (sp === 'all' || h.sport === sp) &&
        (re === 'all' || h.result === re) &&
        (!fromV || h.at >= new Date(fromV).getTime()) &&
        (!toV || h.at <= new Date(toV).getTime() + 86400000)
      );
      panel.querySelector('#trBody').innerHTML = list.slice(0, 50).map(h => `
        <tr>
          <td data-label="Fecha">${BSUI.dt(h.at)}</td>
          <td data-label="Deporte">${BSUI.esc(BSData.SPORTS.find(s=>s.key===h.sport)?.name || h.sport)}</td>
          <td data-label="Evento">${BSUI.esc(h.event)}</td>
          <td data-label="Stake" class="num">${BSUI.money(h.stake)}</td>
          <td data-label="Cuota" class="num">${h.odd.toFixed(2)}</td>
          <td data-label="Resultado"><span class="badge ${h.result==='W'?'badge-success':h.result==='L'?'badge-danger':'badge-info'}">${h.result}</span></td>
          <td data-label="Profit" class="num ${h.profit>=0?'text-success':'text-danger'}">${BSUI.money(h.profit||0)}</td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty">Sin resultados</div></td></tr>';
    }

    // Sport bars
    const groups = {};
    BSData.SPORTS.forEach(s => groups[s.key] = 0);
    hist.forEach(h => { groups[h.sport] = (groups[h.sport] || 0) + (h.profit || 0); });
    const max = Math.max(...Object.values(groups).map(Math.abs), 1);
    panel.querySelector('#trBars').innerHTML = Object.entries(groups).filter(([_,v])=>v).slice(0, 8).map(([k, v]) => `
      <div class="bar" data-tip="${BSData.SPORTS.find(s=>s.key===k)?.name}: ${BSUI.money(v)}" style="height:${(Math.abs(v)/max)*100}%; background: ${v>=0?'var(--brand-600)':'var(--danger)'}"></div>
    `).join('');

    panel.querySelectorAll('#trFrom,#trTo,#trSport,#trRes').forEach(i => i.addEventListener('input', renderBody));
    panel.querySelector('#trExport').addEventListener('click', () => {
      const rows = [['fecha','deporte','evento','stake','cuota','resultado','profit'].join(',')]
        .concat(hist.map(h => [new Date(h.at).toISOString(), h.sport, `"${h.event}"`, h.stake, h.odd, h.result, h.profit].join(',')));
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'betsafe-historial.csv'; a.click();
    });

    renderBody();
    renderBankrollChart(panel, hist);
    BSUI.bindTooltips(panel);
  }

  /* Renderiza un area chart SVG suave de la evolución de banca (cumulative profit
   * por fecha). Gradiente desde el color final hacia transparente. Ejes simples. */
  function renderBankrollChart(panel, hist) {
    const svg = panel.querySelector('#trBankrollChart');
    if (!svg) return;
    const sorted = hist.slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!sorted.length) return;
    // Cumulative profit array
    const points = [];
    let cum = 0;
    sorted.forEach((h, i) => {
      cum += h.profit || 0;
      points.push({ x: i, y: cum, at: h.at });
    });
    const n = points.length;
    if (n < 2) {
      svg.innerHTML = `<text x="300" y="100" text-anchor="middle" fill="currentColor" font-size="13" opacity="0.5">Cargá al menos 2 apuestas para ver la curva</text>`;
      return;
    }
    const W = 600, H = 200, P = 8;
    const ys = points.map(p => p.y);
    const yMin = Math.min(...ys, 0);
    const yMax = Math.max(...ys, 0);
    const yRange = yMax - yMin || 1;
    const xs = points.map(p => p.x);
    const xMax = Math.max(...xs);
    const sx = (x) => P + (x / Math.max(1, xMax)) * (W - 2 * P);
    const sy = (y) => H - P - ((y - yMin) / yRange) * (H - 2 * P);
    // Zero baseline
    const yZero = sy(0);
    const finalProfit = points[n - 1].y;
    const lineColor = finalProfit >= 0 ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)';
    // Smooth path (Catmull-Rom to cubic)
    let pathD = `M ${sx(points[0].x).toFixed(2)} ${sy(points[0].y).toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(n - 1, i + 2)];
      const cp1x = sx(p1.x) + (sx(p2.x) - sx(p0.x)) / 6;
      const cp1y = sy(p1.y) + (sy(p2.y) - sy(p0.y)) / 6;
      const cp2x = sx(p2.x) - (sx(p3.x) - sx(p1.x)) / 6;
      const cp2y = sy(p2.y) - (sy(p3.y) - sy(p1.y)) / 6;
      pathD += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${sx(p2.x).toFixed(2)} ${sy(p2.y).toFixed(2)}`;
    }
    const areaD = pathD + ` L ${sx(points[n-1].x).toFixed(2)} ${H - P} L ${sx(points[0].x).toFixed(2)} ${H - P} Z`;
    svg.innerHTML = `
      <defs>
        <linearGradient id="bankrollGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${yMin < 0 && yMax > 0 ? `<line x1="${P}" y1="${yZero.toFixed(2)}" x2="${W - P}" y2="${yZero.toFixed(2)}" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3" opacity="0.4"/>` : ''}
      <path d="${areaD}" fill="url(#bankrollGrad)"/>
      <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${sx(points[n-1].x).toFixed(2)}" cy="${sy(points[n-1].y).toFixed(2)}" r="4" fill="${lineColor}"/>
      <circle cx="${sx(points[n-1].x).toFixed(2)}" cy="${sy(points[n-1].y).toFixed(2)}" r="8" fill="${lineColor}" opacity="0.25">
        <animate attributeName="r" values="4;14;4" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.45;0;0.45" dur="2s" repeatCount="indefinite"/>
      </circle>
    `;
    // Axis labels
    const axis = panel.querySelector('#trChartAxis');
    if (axis) {
      const fmtMoney = v => BSUI.money(v);
      axis.innerHTML = `
        <span class="muted tiny">${new Date(points[0].at).toLocaleDateString('es-AR', { day:'numeric', month:'short' })}</span>
        <span class="muted tiny">${fmtMoney(0)}</span>
        <strong class="${finalProfit >= 0 ? 'text-success' : 'text-danger'}" style="font-variant-numeric:tabular-nums">${fmtMoney(finalProfit)}</strong>
        <span class="muted tiny">${new Date(points[n-1].at).toLocaleDateString('es-AR', { day:'numeric', month:'short' })}</span>
      `;
    }
  }

  function avg(a) { return a.length ? a.reduce((x,y)=>x+y,0) / a.length : 0; }

  /** Importa historial real del usuario desde CSV. Soporta el formato exportado
   *  por la propia app o cualquier CSV con headers compatibles. */
  function importCsv(file, onDone) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return BSUI.toast({ title: 'CSV vacío', type: 'error' });
      const headers = lines[0].split(',').map(s => s.trim().toLowerCase());
      const idx = (name) => headers.findIndex(h => h.includes(name));
      const iFecha = idx('fecha') >= 0 ? idx('fecha') : 0;
      const iDep   = idx('deport') >= 0 ? idx('deport') : 1;
      const iEv    = idx('evento') >= 0 ? idx('evento') : 2;
      const iSt    = idx('stake')  >= 0 ? idx('stake')  : 3;
      const iCu    = idx('cuota')  >= 0 ? idx('cuota')  : 4;
      const iRes   = idx('result') >= 0 ? idx('result') : 5;
      const iPr    = idx('profit') >= 0 ? idx('profit') : 6;
      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].match(/("([^"]|"")*"|[^,]+)/g)?.map(c => c.replace(/^"|"$/g,'').replace(/""/g,'"')) || [];
        if (cells.length < 5) continue;
        const at = Date.parse(cells[iFecha]) || Date.now();
        const stake = Number(cells[iSt]) || 0;
        const odd = Number(cells[iCu]) || 0;
        const result = (cells[iRes] || '').toUpperCase().charAt(0) || 'P';
        const profit = Number(cells[iPr]);
        out.push({
          at,
          sport: cells[iDep] || 'soccer',
          event: cells[iEv] || '',
          stake, odd, result,
          profit: Number.isFinite(profit) ? profit : (result === 'W' ? stake * (odd - 1) : result === 'L' ? -stake : 0)
        });
      }
      const cur = BSStore.get(BSStore.KEYS.history) || [];
      BSStore.set(BSStore.KEYS.history, out.concat(cur));
      BSUI.toast({ title: `Importadas ${out.length} apuestas`, type: 'success' });
      onDone?.();
    };
    reader.readAsText(file);
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('tracker', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('tracker', render));
  }
  doRegister();
  window.__bsTrackerRender = render;
})();
