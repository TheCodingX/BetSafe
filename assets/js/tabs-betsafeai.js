/* BetSafe — BetSafe AI tab (VIP flagship)
 * ============================================================================
 * Conversación natural → combinada armada por IA.
 *
 * Usuario escribe pedido en lenguaje natural:
 *   "haceme una combinada de 4 partidos de mañana de la Premier, no tan
 *    riesgosa, con una cuota de 5.5 o más, dentro de todo segura"
 *
 * Frontend:
 *  - Input grande tipo chat con prompts sugeridos
 *  - Loading state animado (radar + barras de progreso)
 *  - Resultado: cards con logos de equipos, mejor casa por leg, total odds
 *  - Render super estético: gradiente gold, glassmorphism, micro-animations
 *
 * Backend: /api/betsafe-ai/build (POST) — parser LLM + matching + analysis.
 * ============================================================================
 */
(function () {
  'use strict';
  if (!window.BSDash || !window.BSAuth) return;

  let state = {
    loading: false,
    result: null,
    error: null,
    lastPrompt: '',
    history: JSON.parse(localStorage.getItem('bs:betsafe-ai:history') || '[]')
  };

  const SUGGESTIONS = [
    {
      icon: '⚽',
      label: 'Premier League seguro',
      text: 'Haceme una combinada de 4 partidos de la Premier League, no tan riesgosa, con cuota entre 4 y 8'
    },
    {
      icon: '🏆',
      label: 'Champions League',
      text: 'Armá una combinada de 3 partidos de Champions League con cuota total de 5 o más, balance entre riesgo y premio'
    },
    {
      icon: '🇦🇷',
      label: 'Liga Argentina',
      text: 'Combinada de 5 partidos de la Liga Profesional Argentina, conservadora, cuota total cerca de 4'
    },
    {
      icon: '⚡',
      label: 'Agresiva alta cuota',
      text: 'Quiero una combinada agresiva de 4 partidos top de Europa, con cuota total mayor a 15'
    },
    {
      icon: '🎾',
      label: 'Tenis ATP',
      text: 'Combinada de 3 partidos de tenis ATP de hoy, favoritos claros, cuota entre 2 y 4'
    },
    {
      icon: '🏀',
      label: 'NBA mix',
      text: 'Combiná 3 juegos NBA de hoy con favoritos sólidos, cuota total alrededor de 3.5'
    }
  ];

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `
        <div class="card card-vip card-pad-lg stack bsai-locked">
          <span class="badge-vip">VIP exclusivo</span>
          <h2 class="h2">BetSafe AI</h2>
          <p class="lead">Pedile a la IA que te arme combinadas a medida en lenguaje natural.</p>
          <p class="muted">Ejemplo: <em>"haceme una combinada de 4 partidos de mañana de la Premier League, cuota entre 5 y 8, dentro de todo segura"</em>. La IA analiza tu pedido, encuentra los partidos que cumplen tus criterios, busca la mejor casa por cada leg, y te arma la combinada óptima.</p>
          <ul class="bsai-locked-feats">
            <li>✓ Lenguaje natural — escribí como hablás</li>
            <li>✓ Cuotas reales verificadas en las 6 casas argentinas</li>
            <li>✓ Mejor casa por cada apuesta (ROI optimizado)</li>
            <li>✓ Análisis profundo de cada selección</li>
          </ul>
          <a href="pricing.html" class="btn btn-gold btn-lg mag" style="align-self:flex-start">Pasar a VIP →</a>
        </div>`;
      return;
    }

    panel.innerHTML = `
      <div class="bsai-shell">
        <header class="bsai-header">
          <div class="bsai-header__title">
            <span class="bsai-logo" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="34" height="34" fill="none">
                <defs>
                  <linearGradient id="bsaiG1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#d4a017"/>
                    <stop offset="100%" stop-color="#7b5b0d"/>
                  </linearGradient>
                </defs>
                <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#bsaiG1)"/>
                <path d="M11 11 L16 23 L21 11 M13 17 L19 17" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="24" cy="9" r="2" fill="#fff"/>
              </svg>
            </span>
            <div>
              <h2 class="h2" style="margin:0">BetSafe AI <span class="badge-vip" style="vertical-align:middle">VIP</span></h2>
              <p class="muted tiny" style="margin:4px 0 0">Pedile combinadas a medida — la IA arma todo cumpliendo tus condiciones</p>
            </div>
          </div>
        </header>

        <section class="bsai-prompt-card">
          <textarea id="bsaiPrompt" class="bsai-prompt-input" rows="3"
            placeholder="Ejemplo: haceme una combinada de 4 partidos de mañana de la Premier, no tan riesgosa, con una cuota de 5.5 o más, dentro de todo segura"
            maxlength="500"></textarea>
          <div class="bsai-prompt-actions">
            <span class="muted tiny" id="bsaiCharCount">0 / 500</span>
            <button class="btn btn-gold mag" id="bsaiBuild">
              <span class="bsai-build-label">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                Armar combinada
              </span>
            </button>
          </div>
        </section>

        <section class="bsai-suggestions" id="bsaiSuggestions" aria-label="Ejemplos rápidos">
          <span class="muted tiny" style="display:block;margin-bottom:6px">O probá uno de estos:</span>
          <div class="bsai-chip-row">
            ${SUGGESTIONS.map((s, i) => `
              <button class="bsai-chip" data-suggestion="${i}">
                <span class="bsai-chip__icon">${s.icon}</span>
                <span class="bsai-chip__label">${s.label}</span>
              </button>
            `).join('')}
          </div>
        </section>

        <section id="bsaiOutput" class="bsai-output"></section>
      </div>
    `;

    bindEvents(panel);
    renderOutput(panel);
  }

  function bindEvents(panel) {
    const promptEl = panel.querySelector('#bsaiPrompt');
    const charEl = panel.querySelector('#bsaiCharCount');
    const buildBtn = panel.querySelector('#bsaiBuild');
    const suggestionsHost = panel.querySelector('#bsaiSuggestions');

    promptEl.addEventListener('input', () => {
      charEl.textContent = `${promptEl.value.length} / 500`;
    });

    suggestionsHost.querySelectorAll('[data-suggestion]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.suggestion);
        const s = SUGGESTIONS[idx];
        if (!s) return;
        promptEl.value = s.text;
        charEl.textContent = `${s.text.length} / 500`;
        promptEl.focus();
        // Scroll suave al prompt si está fuera de vista
        promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    buildBtn.addEventListener('click', async () => {
      const prompt = promptEl.value.trim();
      if (!prompt) {
        BSUI.toast?.({ title: 'Escribí qué combinada querés', type: 'info' });
        promptEl.focus();
        return;
      }
      if (prompt.length < 10) {
        BSUI.toast?.({ title: 'Contanos un poco más', message: 'Más detalle = mejor combinada.', type: 'info' });
        return;
      }
      await buildCombo(panel, prompt);
    });

    // Submit con Cmd/Ctrl + Enter
    promptEl.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        buildBtn.click();
      }
    });
  }

  async function buildCombo(panel, prompt) {
    state.loading = true;
    state.error = null;
    state.lastPrompt = prompt;
    renderOutput(panel);

    try {
      const res = await fetch('/api/betsafe-ai/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      state.result = data;
      state.loading = false;
      // Guardar en history (max 10)
      state.history = [{ prompt, ts: Date.now(), totalOdd: data.totalOdd, legs: data.legs?.length }, ...state.history].slice(0, 10);
      localStorage.setItem('bs:betsafe-ai:history', JSON.stringify(state.history));
    } catch (e) {
      state.error = e?.message || 'Error inesperado';
      state.loading = false;
      state.result = null;
    }
    renderOutput(panel);
  }

  function renderOutput(panel) {
    const host = panel.querySelector('#bsaiOutput');
    if (!host) return;

    if (state.loading) {
      host.innerHTML = `
        <div class="bsai-loading">
          <div class="bsai-radar">
            <span class="bsai-radar__sweep"></span>
            <span class="bsai-radar__dot" style="--x:30%;--y:40%"></span>
            <span class="bsai-radar__dot" style="--x:65%;--y:55%"></span>
            <span class="bsai-radar__dot" style="--x:45%;--y:70%"></span>
            <span class="bsai-radar__dot" style="--x:55%;--y:30%"></span>
          </div>
          <strong class="bsai-loading__title">Construyendo tu combinada</strong>
          <ul class="bsai-loading__steps">
            <li class="is-active"><span class="bsai-tick"></span>Entendiendo tu pedido</li>
            <li><span class="bsai-tick"></span>Buscando partidos que cumplan los criterios</li>
            <li><span class="bsai-tick"></span>Analizando cada partido con IA</li>
            <li><span class="bsai-tick"></span>Encontrando la mejor casa por cada leg</li>
            <li><span class="bsai-tick"></span>Armando la combinada óptima</li>
          </ul>
        </div>`;
      // Activar paso por paso (simulación visual mientras el backend trabaja)
      const steps = host.querySelectorAll('.bsai-loading__steps li');
      let cur = 0;
      const stepTimer = setInterval(() => {
        if (cur < steps.length - 1) {
          steps[cur].classList.remove('is-active');
          steps[cur].classList.add('is-done');
          cur++;
          steps[cur].classList.add('is-active');
        } else {
          clearInterval(stepTimer);
        }
      }, 1500);
      host._bsaiTimer = stepTimer;
      return;
    }
    if (host._bsaiTimer) { clearInterval(host._bsaiTimer); host._bsaiTimer = null; }

    if (state.error) {
      host.innerHTML = `
        <div class="bsai-error-card">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--danger)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <strong>No pudimos armar la combinada</strong>
          <p class="muted tiny">${BSUI.esc(state.error)}</p>
          <button class="btn btn-outline btn-sm" id="bsaiRetry">Reintentar</button>
        </div>`;
      host.querySelector('#bsaiRetry')?.addEventListener('click', () => {
        buildCombo(panel, state.lastPrompt);
      });
      return;
    }

    if (!state.result) {
      host.innerHTML = '';
      return;
    }

    const r = state.result;
    if (!r.ok) {
      host.innerHTML = `
        <div class="bsai-empty-card">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <strong>${BSUI.esc(r.reason === 'no-events' ? 'No encontramos partidos' : 'Pool insuficiente')}</strong>
          <p class="muted">${BSUI.esc(r.message || 'Probá relajar los criterios.')}</p>
        </div>`;
      return;
    }

    host.innerHTML = renderCombo(r);
    bindComboActions(host, r);
  }

  function renderCombo(r) {
    const stake = 10000;
    const totalPayout = stake * r.totalOdd;
    const profit = totalPayout - stake;
    const bookOrder = computeBookRanking(r.legs);
    const winnerBook = bookOrder[0] || null;

    return `
      <article class="bsai-combo-card">
        <header class="bsai-combo-head">
          <div class="bsai-combo-headline">
            <span class="badge-vip">BetSafe AI</span>
            <h3 class="h3" style="margin:4px 0 0">${BSUI.esc(r.headline)}</h3>
          </div>
          <div class="bsai-combo-stats">
            <div class="bsai-stat">
              <span class="bsai-stat__label">Cuota total</span>
              <strong class="bsai-stat__value bsai-stat__value--gold">${r.totalOdd.toFixed(2)}</strong>
            </div>
            <div class="bsai-stat">
              <span class="bsai-stat__label">Confianza</span>
              <strong class="bsai-stat__value">${(r.avgConfidence * 100).toFixed(0)}%</strong>
            </div>
            <div class="bsai-stat">
              <span class="bsai-stat__label">Legs</span>
              <strong class="bsai-stat__value">${r.legs.length}</strong>
            </div>
          </div>
        </header>

        ${r.narrative ? `
          <div class="bsai-narrative">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            <p>${BSUI.esc(r.narrative)}</p>
          </div>
        ` : ''}

        <div class="bsai-legs">
          ${r.legs.map((l, i) => renderLeg(l, i)).join('')}
        </div>

        ${winnerBook ? `
          <div class="bsai-bestbook">
            <div class="bsai-bestbook__head">
              <span class="muted tiny">Mejor casa para esta combinada</span>
              <div class="bsai-bestbook__name">
                ${window.BSLogos?.bookLogo ? BSLogos.bookLogo(winnerBook.book, { size: 28 }) : ''}
                <strong>${BSUI.esc(BSData.ALL_BOOKS.find(b => b.key === winnerBook.book)?.name || winnerBook.book)}</strong>
              </div>
            </div>
            <div class="bsai-bestbook__odd">
              <span class="badge badge-success num">${winnerBook.totalOdd.toFixed(2)}</span>
              <span class="muted tiny">${winnerBook.coveredLegs}/${r.legs.length} legs cubiertas</span>
            </div>
          </div>
        ` : ''}

        <footer class="bsai-combo-footer">
          <div class="bsai-payout">
            <span class="muted tiny">Si apostás $${stake.toLocaleString('es-AR')} podés ganar</span>
            <strong class="num">$${Math.round(totalPayout).toLocaleString('es-AR')}</strong>
            <span class="muted tiny">(+$${Math.round(profit).toLocaleString('es-AR')} ganancia neta)</span>
          </div>
          <div class="bsai-actions">
            <button class="btn btn-outline btn-sm" id="bsaiCopy">Copiar combinada</button>
            <button class="btn btn-primary btn-sm" id="bsaiAddToBuilder">Agregar al Builder</button>
          </div>
        </footer>
      </article>
    `;
  }

  function renderLeg(leg, idx) {
    const t = leg.start ? new Date(leg.start) : null;
    const dateStr = t ? `${t.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${t.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : '';
    const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(leg.home.id, { size: 36, name: leg.home.name, sport: leg.sport }) : '';
    const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(leg.away.id, { size: 36, name: leg.away.name, sport: leg.sport }) : '';
    const leagueLogo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(leg.league || leg.leagueName, { size: 16 }) : '';
    const bookLogo = window.BSLogos?.bookLogo ? BSLogos.bookLogo(leg.book, { size: 18 }) : '';
    const bookName = BSData.ALL_BOOKS.find(b => b.key === leg.book)?.name || leg.book;
    const altCount = leg.bookAlternatives?.length || 0;

    return `
      <div class="bsai-leg" style="--leg-i:${idx}">
        <div class="bsai-leg__num">${idx + 1}</div>
        <div class="bsai-leg__main">
          <div class="bsai-leg__league">
            ${leagueLogo}<span class="muted tiny">${BSUI.esc(leg.leagueName || '')}</span>
            ${dateStr ? `<span class="muted tiny">· ${dateStr}</span>` : ''}
          </div>
          <div class="bsai-leg__teams">
            <div class="bsai-leg__team">${homeLogo}<strong>${BSUI.esc(leg.home.name)}</strong></div>
            <span class="bsai-leg__vs">vs</span>
            <div class="bsai-leg__team">${awayLogo}<strong>${BSUI.esc(leg.away.name)}</strong></div>
          </div>
          <div class="bsai-leg__pick">
            <span class="bsai-leg__market-label">${BSUI.esc(BSData.prettyMarket(leg.market))}</span>
            <strong class="bsai-leg__label">${BSUI.esc(leg.label || BSData.prettyOutcome(leg.outcome, { home: leg.home.name, away: leg.away.name }))}</strong>
          </div>
          ${leg.llmKeyFactor ? `<p class="bsai-leg__factor"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${BSUI.esc(leg.llmKeyFactor)}</p>` : ''}
        </div>
        <div class="bsai-leg__odds">
          <div class="bsai-leg__odd-main">
            <strong class="num">${leg.odd.toFixed(2)}</strong>
            <span class="bsai-leg__book">${bookLogo}<span>${BSUI.esc(bookName)}</span></span>
          </div>
          ${altCount > 1 ? `<button class="bsai-leg__alt-toggle" data-toggle-alts="${idx}" aria-label="Ver alternativas">+${altCount - 1} casas</button>` : ''}
        </div>
      </div>
      ${altCount > 1 ? `
        <div class="bsai-leg-alts" id="bsaiLegAlts-${idx}" hidden>
          <span class="muted tiny">Otras casas para esta apuesta:</span>
          ${leg.bookAlternatives.slice(1).map(a => {
            const altLogo = window.BSLogos?.bookLogo ? BSLogos.bookLogo(a.book, { size: 14 }) : '';
            const altName = BSData.ALL_BOOKS.find(b => b.key === a.book)?.name || a.book;
            const diff = ((leg.odd - a.odd) / leg.odd * 100).toFixed(1);
            return `<span class="bsai-alt-chip">${altLogo}<span>${BSUI.esc(altName)}</span><strong class="num">${a.odd.toFixed(2)}</strong><span class="muted tiny">−${diff}%</span></span>`;
          }).join('')}
        </div>
      ` : ''}
    `;
  }

  function computeBookRanking(legs) {
    // Para cada casa AR, multiplicar las cuotas que ofrece en cada leg
    const ar = BSData.BOOKS_AR || [];
    const ranking = [];
    ar.forEach(b => {
      let prod = 1, covered = 0;
      for (const l of legs) {
        const alt = l.bookAlternatives?.find(a => a.book === b.key);
        if (alt) { prod *= alt.odd; covered++; continue; }
        if (l.book === b.key) { prod *= l.odd; covered++; }
      }
      if (covered > 0) ranking.push({ book: b.key, totalOdd: prod, coveredLegs: covered });
    });
    ranking.sort((a, b) => {
      if (a.coveredLegs !== b.coveredLegs) return b.coveredLegs - a.coveredLegs;
      return b.totalOdd - a.totalOdd;
    });
    return ranking;
  }

  function bindComboActions(host, r) {
    // Toggle alternatives per leg
    host.querySelectorAll('[data-toggle-alts]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.toggleAlts;
        const alts = host.querySelector(`#bsaiLegAlts-${idx}`);
        if (!alts) return;
        alts.hidden = !alts.hidden;
        btn.classList.toggle('is-open', !alts.hidden);
      });
    });
    // Copy combo as text
    host.querySelector('#bsaiCopy')?.addEventListener('click', () => {
      const txt = `${r.headline}\n\nCuota total: ${r.totalOdd.toFixed(2)}\n\n${r.legs.map((l, i) =>
        `${i+1}. ${l.home.name} vs ${l.away.name} — ${l.label} @ ${l.odd.toFixed(2)} (${BSData.ALL_BOOKS.find(b => b.key === l.book)?.name || l.book})`
      ).join('\n')}\n\n${r.narrative || ''}\n\n— Generado por BetSafe AI`;
      navigator.clipboard?.writeText(txt).then(() => {
        BSUI.toast?.({ title: 'Combinada copiada', message: 'Ya podés pegarla donde quieras.', type: 'success' });
      });
    });
    // Add to Builder
    host.querySelector('#bsaiAddToBuilder')?.addEventListener('click', () => {
      const slip = BSStore.get(BSStore.KEYS.slip) || { legs: [], stake: 10000 };
      r.legs.forEach(l => {
        slip.legs.push({
          matchId: l.eventId, eventId: l.eventId,
          label: l.label || BSData.prettyOutcome(l.outcome, { home: l.home.name, away: l.away.name }),
          odd: l.odd, book: l.book, market: l.market, outcome: l.outcome,
          home: l.home.name, away: l.away.name
        });
      });
      BSStore.set(BSStore.KEYS.slip, slip);
      BSDash.renderSlipBar?.();
      BSUI.toast?.({ title: 'Agregado al Builder', message: `${r.legs.length} legs cargadas.`, type: 'success' });
      // Switch tab a Builder
      window.location.hash = '#builder';
    });
  }

  // Registrar tab
  BSDash.register?.('betsafeai', render) || (window.BSDash.TAB_RENDERERS = Object.assign(window.BSDash.TAB_RENDERERS || {}, { betsafeai: render }));
})();
