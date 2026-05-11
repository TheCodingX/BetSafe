/* BetSafe — Mundial 2026 hub */
(function () {
  'use strict';

  const KICKOFF = new Date('2026-06-11T20:00:00-06:00').getTime();

  function render(panel) {
    panel.innerHTML = `
      <section class="wc-banner reveal" style="margin-block:0">
        <div class="row between" style="flex-wrap:wrap;gap:24px;align-items:flex-start">
          <div class="stack" style="flex:1;min-width:280px">
            <div class="cluster" style="gap:14px;align-items:center">
              <div class="wc-dash-logos" aria-hidden="true">
                <div class="wc-dash-logo wc-dash-logo--wc">
                  <img src="assets/img/wc2026-logo.jpg" alt="" loading="eager" />
                </div>
                <div class="wc-dash-logo wc-dash-logo--fifa">
                  <img src="assets/img/fifa-logo-blue.png" alt="" loading="eager" />
                </div>
              </div>
              <span class="wc-eyebrow">
                <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>
                Mundial 2026 · USA · México · Canadá
              </span>
            </div>
            <h1 class="wc-title" style="margin-block:14px 4px">Canadá · México · <em>EE.UU.</em></h1>
            <p class="wc-sub">48 selecciones · 16 sedes · 104 partidos. Apertura: 11/06/2026, Estadio Azteca.</p>
            <div class="wc-cta-row">
              <a href="#wcGroups" class="btn btn-gold">Ver selecciones</a>
              <a href="#wcVenues" class="btn btn-ghost-gold">Ver sedes</a>
            </div>
            <div class="wc-flag-chips" aria-hidden="true">
              <span class="wc-flag-chip"><span class="flag" style="background:linear-gradient(180deg,#bf0a30 33%,#fff 33%,#fff 66%,#002868 66%)"></span>USA</span>
              <span class="wc-flag-chip"><span class="flag" style="background:linear-gradient(90deg,#006847 33%,#fff 33%,#fff 66%,#ce1126 66%)"></span>México</span>
              <span class="wc-flag-chip"><span class="flag" style="background:linear-gradient(90deg,#d80027 25%,#fff 25%,#fff 75%,#d80027 75%)"></span>Canadá</span>
              <span class="wc-flag-chip"><span class="flag" style="background:linear-gradient(180deg,#74acdf 33%,#fff 33%,#fff 66%,#74acdf 66%)"></span>Argentina</span>
              <span class="wc-flag-chip">+44 más</span>
            </div>
          </div>
          <div class="countdown" id="wcCount" aria-live="polite"></div>
        </div>
      </section>

      <section class="grid grid-2 mt-4 reveal">
        <div class="card stack">
          <strong>Top 7 favoritos al título</strong>
          <div id="wcFav" class="stack-sm"></div>
        </div>
        <div class="card stack">
          <strong>Top scorers · Botín de Oro</strong>
          <div id="wcSco" class="stack-sm"></div>
        </div>
      </section>

      <section id="wcGroups" class="card stack mt-4 reveal">
        <div class="row between">
          <strong>48 selecciones por confederación</strong>
          <span class="muted tiny">Total clasificados confirmados / proyectados</span>
        </div>
        <div class="seg" id="wcConfSeg">
          ${BSData.CONFEDERATIONS.map((c, i) => `<button class="${i===0?'active':''}" data-conf="${c.key}">${window.BSLogos ? BSLogos.confedLogo(c.key,{size:18}) : ''}<span style="margin-left:6px">${c.name} (${c.slots})</span></button>`).join('')}
          <button data-conf="ALL">Todas</button>
        </div>
        <div id="wcNations" class="grid grid-auto"></div>
      </section>

      <section id="wcVenues" class="card stack mt-4 reveal">
        <strong>16 sedes oficiales</strong>
        <div class="grid grid-auto-lg" id="wcVList"></div>
      </section>

      <section class="grid grid-2 mt-4 reveal">
        <div class="card stack">
          <strong>Hot / Cold trends</strong>
          <div id="wcTrends" class="stack-sm"></div>
        </div>
        <div class="card stack">
          <strong>Eventos clave 2026</strong>
          <div id="wcTimeline" class="stack-sm"></div>
        </div>
      </section>

      <!-- WC-only AI Picks + Generador -->
      <section class="grid grid-2 mt-4 reveal" style="gap:16px">
        <div class="card stack" style="position:relative;overflow:hidden">
          <div class="row between">
            <strong>Picks de IA del Mundial<a class="help-q" tabindex="0" data-tip="Picks pensados solo para los partidos del Mundial 2026 (grupos, octavos, cuartos, semis y final). 3 opciones por partido: Conservador, Equilibrado y Agresivo. Con análisis específico del torneo: forma reciente, lesiones, contexto del grupo y motivación."></a></strong>
            <span class="badge badge-brand">Solo WC26</span>
          </div>
          <div id="wcAiPicks" class="stack-sm"></div>
        </div>

        <div class="card stack">
          <div class="row between">
            <strong>Generador de combinadas del Mundial<a class="help-q" tabindex="0" data-tip="Armamos combinadas con partidos del Mundial. Útil para las fechas con varios partidos en simultáneo (fase de grupos) o para combinar la eliminatoria buscando cuotas más altas."></a></strong>
            <span class="muted tiny" id="wcGenStatus">3 legs · equilibrado</span>
          </div>
          <div class="row gap-2" style="flex-wrap:wrap">
            <select class="select" id="wcGenLegs">
              <option value="2">2 legs</option>
              <option value="3" selected>3 legs</option>
              <option value="4">4 legs</option>
            </select>
            <select class="select" id="wcGenRisk">
              <option value="cons">Conservador</option>
              <option value="eq" selected>Equilibrado</option>
              <option value="agg">Agresivo</option>
            </select>
            <button class="btn btn-primary mag" id="wcGenBtn">${BSIcons.svg('bolt',{size:14})} Generar</button>
          </div>
          <div id="wcGenOut"></div>
        </div>
      </section>

      <!-- Tabla de grupos en vivo -->
      <section class="card stack mt-4 reveal">
        <div class="row between">
          <strong>Tabla de grupos<a class="help-q" tabindex="0" data-tip="Posiciones actualizadas de los 12 grupos del Mundial 2026: puntos, partidos jugados, goles a favor/en contra y diferencia. Clasifican los 2 mejores de cada grupo más los 8 mejores terceros (el Mundial 2026 trae 48 selecciones)."></a></strong>
          <span class="muted tiny">12 grupos · clasifican los 2 mejores + los 8 mejores terceros</span>
        </div>
        <div class="grid" id="wcGroups" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px"></div>
      </section>

      <section class="card stack mt-4 reveal">
        <div class="row between">
          <strong>Carousel de noticias</strong>
          <span class="muted tiny">scroll-snap</span>
        </div>
        <div id="wcNews" style="display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px"></div>
      </section>
    `;

    // Countdown
    function tick() {
      const ms = KICKOFF - Date.now();
      const t = BSUI.dur(ms);
      panel.querySelector('#wcCount').innerHTML = `
        <div class="cu cu-p"><span class="cu-p__val">${t.d}</span><span class="cu-p__lbl">días</span></div>
        <div class="cu cu-p"><span class="cu-p__val">${String(t.h).padStart(2,'0')}</span><span class="cu-p__lbl">horas</span></div>
        <div class="cu cu-p"><span class="cu-p__val">${String(t.m).padStart(2,'0')}</span><span class="cu-p__lbl">min</span></div>
        <div class="cu cu-p"><span class="cu-p__val">${String(t.s).padStart(2,'0')}</span><span class="cu-p__lbl">seg</span></div>`;
    }
    tick(); const ci = setInterval(tick, 1000);
    panel.__cleanup = () => clearInterval(ci);

    // Favorites
    panel.querySelector('#wcFav').innerHTML = BSData.WC_FAVORITES.map(f => {
      const n = BSData.NATIONS.find(x => x.code === f.code);
      return `<div class="row between"><div class="cluster">${BSIcons.flagSvg(f.code,{size:24})} <strong>${BSUI.esc(n?.name || f.code)}</strong></div><span class="badge badge-brand num">${f.odds.toFixed(2)}</span></div>`;
    }).join('');

    // Top scorers
    panel.querySelector('#wcSco').innerHTML = BSData.TOP_SCORERS.map(s =>
      `<div class="row between"><div class="cluster">${BSIcons.flagSvg(s.country,{size:18})}<div><strong>${BSUI.esc(s.name)}</strong><div class="muted tiny">${BSUI.esc(s.team)}</div></div></div><span class="badge badge-success num">${s.odds.toFixed(2)}</span></div>`
    ).join('');

    // Nations by confederation
    let activeConf = BSData.CONFEDERATIONS[0].key;
    function renderNations() {
      const list = activeConf === 'ALL' ? BSData.NATIONS : BSData.NATIONS.filter(n => n.conf === activeConf);
      panel.querySelector('#wcNations').innerHTML = list.map(n => `
        <div class="card card-tinted card-pad-sm">
          <div class="cluster">${BSIcons.flagSvg(n.code,{size:28})} <strong>${BSUI.esc(n.name)}</strong></div>
          <div class="muted tiny">${n.conf}${n.host ? ' · 🏠 anfitrión' : ''}</div>
        </div>`).join('');
    }
    panel.querySelectorAll('#wcConfSeg button').forEach(b => b.addEventListener('click', () => {
      panel.querySelectorAll('#wcConfSeg button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); activeConf = b.dataset.conf; renderNations();
    }));
    renderNations();

    // Venues
    panel.querySelector('#wcVList').innerHTML = BSData.VENUES.map(v => `
      <div class="card card-tinted card-pad-sm">
        <div class="row between">
          <div>
            <strong>${BSUI.esc(v.stadium)}</strong>
            <div class="muted tiny">${BSUI.esc(v.city)} · ${v.country}</div>
          </div>
          ${BSIcons.flagSvg(v.country, { size: 22 })}
        </div>
        <div class="muted tiny mt-2">Capacidad: <span class="num">${v.cap.toLocaleString('es-AR')}</span></div>
      </div>`).join('');

    // Trends
    const trends = [
      { team: 'Argentina', code: 'AR', trend: 'up', val: '5/5 invictos en eliminatorias' },
      { team: 'Francia', code: 'FR', trend: 'up', val: 'Mbappé en forma · 4 goles últimos 3 partidos' },
      { team: 'Brasil', code: 'BR', trend: 'down', val: 'Dudas defensivas · cambios en el técnico' },
      { team: 'Italia', code: 'IT', trend: 'down', val: 'Necesita repechaje (UEFA)' },
      { team: 'Marruecos', code: 'MA', trend: 'up', val: 'Sólido en CAF · base del 4° puesto Qatar 2022' }
    ];
    panel.querySelector('#wcTrends').innerHTML = trends.map(t => `
      <div class="row between">
        <div class="cluster">${BSIcons.flagSvg(t.code, {size:22})}<strong>${BSUI.esc(t.team)}</strong></div>
        <div class="cluster"><span class="${t.trend==='up'?'text-success':'text-danger'} fw-700">${t.trend==='up'?'▲ Hot':'▼ Cold'}</span><span class="muted tiny">${BSUI.esc(t.val)}</span></div>
      </div>`).join('');

    // Timeline
    panel.querySelector('#wcTimeline').innerHTML = BSData.TIMELINE.map(t => `
      <div class="row between">
        <div><strong>${BSUI.esc(t.name)}</strong><div class="muted tiny">${BSUI.esc(t.loc)}</div></div>
        <span class="badge">${BSUI.esc(t.tag)}</span>
      </div>`).join('');

    // News carousel
    const news = [
      { t: 'Sorteo de grupos', d: 'En diciembre 2025 — Las Vegas.' },
      { t: 'Lista de 26', d: 'Cada selección entrega plantilla días antes del torneo.' },
      { t: 'Estadio Azteca', d: 'Apertura confirmada · 11/06/2026.' },
      { t: 'Final', d: 'MetLife (Nueva York) · 19/07/2026.' },
      { t: 'Repechaje intercontinental', d: '6 selecciones competirán por 2 lugares finales.' }
    ];
    panel.querySelector('#wcNews').innerHTML = news.map(n => `
      <div class="card card-tinted" style="min-width:280px;scroll-snap-align:start">
        <span class="badge badge-brand">News</span>
        <h4 class="h4 mt-2">${BSUI.esc(n.t)}</h4>
        <p class="muted tiny">${BSUI.esc(n.d)}</p>
      </div>`).join('');

    // ───────── WC AI Picks (5 partidos sintéticos del torneo) ─────────
    const WC_MATCHES = [
      { home:{code:'AR',name:'Argentina'}, away:{code:'BR',name:'Brasil'}, stage:'Cuartos de final', odds:{1:2.05, X:3.30, 2:3.40} },
      { home:{code:'FR',name:'Francia'},   away:{code:'ES',name:'España'}, stage:'Octavos',          odds:{1:2.30, X:3.20, 2:2.95} },
      { home:{code:'EN',name:'Inglaterra'},away:{code:'PT',name:'Portugal'},stage:'Cuartos de final',odds:{1:2.40, X:3.20, 2:2.85} },
      { home:{code:'DE',name:'Alemania'},  away:{code:'NL',name:'Países Bajos'}, stage:'Octavos',     odds:{1:2.20, X:3.30, 2:3.10} },
      { home:{code:'BE',name:'Bélgica'},   away:{code:'CR',name:'Croacia'},stage:'Octavos',          odds:{1:2.05, X:3.30, 2:3.55} }
    ];
    function flagOf(code) { return BSIcons.flagSvg(code, { size: 22 }); }
    panel.querySelector('#wcAiPicks').innerHTML = WC_MATCHES.slice(0, 4).map((m, i) => {
      const o = m.odds;
      const cons = { lbl: m.home.name + ' o empate (1X)', odd: 1/((1/o[1])+(1/o.X)) };
      const eq   = { lbl: 'Empate o ' + m.away.name + ' (X2)', odd: 1/((1/o.X)+(1/o[2])) };
      const agg  = { lbl: m.away.name + ' +1 hándicap', odd: Math.max(1.6, o[2]*0.7) };
      return `
        <div class="card card-tinted card-pad-sm" style="--i:${i}">
          <div class="row between">
            <div class="cluster" style="gap:6px">${flagOf(m.home.code)}<strong>${BSUI.esc(m.home.name)}</strong><span class="dim">vs</span><strong>${BSUI.esc(m.away.name)}</strong>${flagOf(m.away.code)}</div>
            <span class="badge badge-info">${BSUI.esc(m.stage)}</span>
          </div>
          <div class="row gap-2 mt-2" style="flex-wrap:wrap">
            <span class="risk-pill low">Cons. ${cons.odd.toFixed(2)} · ${BSUI.esc(cons.lbl)}</span>
            <span class="risk-pill mid">Equil. ${eq.odd.toFixed(2)} · ${BSUI.esc(eq.lbl)}</span>
            <span class="risk-pill high">Agres. ${agg.odd.toFixed(2)} · ${BSUI.esc(agg.lbl)}</span>
          </div>
        </div>`;
    }).join('');

    // ───────── WC Generador ─────────
    panel.querySelector('#wcGenBtn').addEventListener('click', () => {
      const n    = Number(panel.querySelector('#wcGenLegs').value);
      const risk = panel.querySelector('#wcGenRisk').value;
      const pool = WC_MATCHES.slice(0, n);
      const legs = pool.map(m => {
        const o = m.odds;
        if (risk === 'cons') return { match: m, label: m.home.name + ' o empate', odd: 1/((1/o[1])+(1/o.X)) };
        if (risk === 'agg')  return { match: m, label: m.away.name + ' +1 hándicap', odd: Math.max(1.6, o[2]*0.7) };
        return { match: m, label: 'Empate o ' + m.away.name, odd: 1/((1/o.X)+(1/o[2])) };
      });
      const total = legs.reduce((a, b) => a * b.odd, 1);
      panel.querySelector('#wcGenStatus').textContent = `${n} legs · ${risk}`;
      panel.querySelector('#wcGenOut').innerHTML = `
        <div class="card card-tinted stack-sm mt-3">
          <strong>Combinada Mundial · ${n} legs</strong>
          ${legs.map(l => `<div class="row between" style="font-size:.86rem"><span><strong>${BSUI.esc(l.match.home.name)}</strong> vs <strong>${BSUI.esc(l.match.away.name)}</strong><div class="muted tiny">${BSUI.esc(l.label)}</div></span><span class="num">${l.odd.toFixed(2)}</span></div>`).join('')}
          <div class="row between" style="border-top:1px solid var(--border);padding-top:8px"><span>Cuota total</span><strong class="num text-brand" style="font-size:1.1rem">${total.toFixed(2)}</strong></div>
          <div class="row between"><span class="muted tiny">Stake $10.000 ARS pagaría</span><strong class="num">${BSUI.money(10000 * total)}</strong></div>
        </div>`;
    });

    // ───────── Tabla de grupos en vivo (12 grupos × 4 países) ─────────
    const ALL_NATION_CODES = (BSData.NATIONS || []).map(n => n.code);
    const GROUP_NATION_NAMES = {
      AR: 'Argentina', BR: 'Brasil',  FR: 'Francia', ES: 'España',  DE: 'Alemania',
      EN: 'Inglaterra', IT: 'Italia', PT: 'Portugal', NL: 'Países Bajos', BE: 'Bélgica',
      HR: 'Croacia', UY: 'Uruguay', JP: 'Japón',  KR: 'Corea del Sur', AU: 'Australia',
      MX: 'México',  CA: 'Canadá', US: 'Estados Unidos', SN: 'Senegal', MA: 'Marruecos',
      EG: 'Egipto', NG: 'Nigeria', CM: 'Camerún', CO: 'Colombia', PE: 'Perú', EC: 'Ecuador',
      CH: 'Suiza',  PL: 'Polonia', AT: 'Austria', DK: 'Dinamarca', NO: 'Noruega',
      TR: 'Turquía', SA: 'Arabia Saudita', IR: 'Irán', QA: 'Qatar', PY: 'Paraguay',
      CL: 'Chile', NZ: 'Nueva Zelanda', GH: 'Ghana', CI: 'Costa de Marfil', UZ: 'Uzbekistán',
      JO: 'Jordania', RS: 'Serbia', SK: 'Eslovaquia', SC: 'Escocia', WL: 'Gales', UA: 'Ucrania', PA: 'Panamá'
    };
    // Build 12 groups of 4 from a deterministic order
    const codes = Object.keys(GROUP_NATION_NAMES);
    const groups = [];
    const groupNames = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    for (let g = 0; g < 12; g++) {
      const teams = codes.slice(g * 4, g * 4 + 4).map((c, i) => {
        // deterministic stats
        const seed = (g * 7 + i * 13) % 100;
        const w = Math.max(0, Math.min(3, Math.round((seed % 4))));
        const d = Math.max(0, 3 - w - ((seed * 3) % 3));
        const l = 3 - w - d;
        const gf = w * 2 + d + (seed % 4);
        const ga = l * 2 + (seed % 3);
        return {
          code: c, name: GROUP_NATION_NAMES[c] || c,
          pj: w + d + l, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d
        };
      });
      teams.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      groups.push({ name: groupNames[g], teams });
    }
    panel.querySelector('#wcGroups').innerHTML = groups.map(g => `
      <div class="card card-tinted card-pad-sm">
        <div class="row between" style="margin-bottom:6px">
          <strong>Grupo ${g.name}</strong>
          <span class="muted tiny">PJ · PG · PE · PP · DG · Pts</span>
        </div>
        ${g.teams.map((t, i) => `
          <div class="row between" style="padding:4px 0;border-bottom:${i<3?'1px dashed var(--border)':'0'};font-size:.84rem">
            <div class="cluster" style="gap:6px;min-width:0;flex:1">
              <span style="display:inline-block;width:14px;text-align:center;font-family:var(--font-mono);font-weight:800;color:${i<2?'var(--brand-700)':i===2?'var(--accent-700)':'var(--text-tertiary)'}">${i+1}</span>
              ${flagOf(t.code)}
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600">${BSUI.esc(t.name)}</span>
            </div>
            <span class="num" style="font-family:var(--font-mono);font-size:.78rem">
              ${t.pj} · ${t.w} · ${t.d} · ${t.l} · ${t.gd>=0?'+':''}${t.gd} · <strong>${t.pts}</strong>
            </span>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

    function doRegister() {
    if (typeof window.BSDash !== 'undefined') BSDash.register('worldcup', render);
    else document.addEventListener('DOMContentLoaded', () => BSDash.register('worldcup', render));
  }
  doRegister();
  window.__bsWorldcupRender = render;
})();
