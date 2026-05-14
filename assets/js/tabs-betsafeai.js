/* BetSafe — Coach IA tab (VIP flagship)
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
      icon: '🚩',
      label: 'Mix córners + goles',
      text: 'Armá una combinada de 4 legs mezclando más de 9.5 córners y más de 2.5 goles en partidos de hoy'
    },
    {
      icon: '🟨',
      label: 'Tarjetas premier',
      text: 'Combinada de 3 partidos con más de 4.5 tarjetas, foco en Liga Argentina o Premier League'
    },
    {
      icon: '⚽',
      label: 'Goleadores',
      text: 'Quiero 3 picks de goleadores anytime en partidos de hoy con favoritos claros'
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
      label: 'NBA puntos jugador',
      text: 'Combinada NBA: 3 picks de puntos de jugador para los partidos de esta noche'
    },
    {
      icon: '🏀',
      label: 'NBA totales',
      text: 'Combiná 3 juegos NBA de hoy con totales (más/menos puntos), cuota total alrededor de 4'
    },
    {
      icon: '⚾',
      label: 'MLB carreras',
      text: 'Combinada MLB de 3 juegos con total de carreras y 1ra entrada (YRFI), cuota entre 4 y 8'
    },
    {
      icon: '🥊',
      label: 'UFC método',
      text: '2 picks de UFC de esta noche: método de victoria y rounds totales'
    }
  ];

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `
        <div class="card card-vip card-pad-lg stack bsai-locked">
          <span class="badge-vip">VIP exclusivo</span>
          <h2 class="h2">Coach IA</h2>
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
      <header class="bs-ai-tab-header bs-ai-tab-header--coach" role="banner">
        <div class="bs-ai-tab-header__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </div>
        <div class="bs-ai-tab-header__text">
          <span class="bs-ai-tab-header__eyebrow">Motor IA · lenguaje natural</span>
          <h2 class="bs-ai-tab-header__title">Coach IA <span class="badge-vip" style="vertical-align:middle;margin-left:6px">VIP</span></h2>
          <p class="bs-ai-tab-header__desc">Pedile la combinada que querés en castellano — "4 partidos de Premier, cuota total 5x, segura". La IA entiende, busca, analiza y arma todo.</p>
        </div>
        <div class="bs-ai-tab-header__alts">
          <a href="#ai" class="bs-ai-tab-header__alt" title="¿Querés combos automáticos del día? Probá AI Picks">⚡ AI Picks</a>
          <a href="#aigenerator" class="bs-ai-tab-header__alt" title="¿Preferís configurar con checkboxes? Probá Constructor Quant">⚙ Constructor Quant</a>
        </div>
      </header>
      <div class="bsai-shell">

        <section class="bsai-prompt-card">
          <textarea id="bsaiPrompt" class="bsai-prompt-input" rows="3"
            placeholder="Ejemplo: haceme una combinada de 4 partidos de mañana de la Premier, no tan riesgosa, con una cuota de 5.5 o más, dentro de todo segura"
            maxlength="500"></textarea>
          <div class="bsai-prompt-actions">
            <span class="muted tiny" id="bsaiCharCount">0 / 500</span>
            <div class="bsai-prompt-btns">
              <button class="btn btn-outline btn-icon" id="bsaiVoice" title="Hablale a la IA (dictado por voz)" aria-label="Dictar por voz">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
              <button class="btn btn-outline btn-icon" id="bsaiHistory" title="Ver mis pedidos anteriores" aria-label="Historial">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>
              </button>
              <button class="btn btn-gold mag" id="bsaiBuild">
                <span class="bsai-build-label">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                  Armar combinada
                </span>
              </button>
            </div>
          </div>
        </section>

        <!-- History drawer (oculto por default) -->
        <section class="bsai-history-drawer" id="bsaiHistoryDrawer" hidden>
          <div class="bsai-history-head">
            <strong>Tus pedidos anteriores</strong>
            <button class="btn-ghost btn-icon btn-sm" id="bsaiHistoryClose" aria-label="Cerrar">×</button>
          </div>
          <div id="bsaiHistoryList" class="bsai-history-list"></div>
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

    // v5.8 — cleanup al cambiar de tab: cancelar el `_bsaiTimer` interval del
    // loading state (rotación de pasos visuales) si el user se va mientras
    // el motor procesa el pedido, evitando setInterval zombie.
    panel.__cleanup = () => {
      const host = panel.querySelector('#bsaiOutput');
      if (host && host._bsaiTimer) {
        try { clearInterval(host._bsaiTimer); } catch (_) {}
        host._bsaiTimer = null;
      }
    };
  }

  function bindEvents(panel) {
    const promptEl = panel.querySelector('#bsaiPrompt');
    const charEl = panel.querySelector('#bsaiCharCount');
    const buildBtn = panel.querySelector('#bsaiBuild');
    const voiceBtn = panel.querySelector('#bsaiVoice');
    const historyBtn = panel.querySelector('#bsaiHistory');
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

    // ── VOICE INPUT (Web Speech API) ─────────────────────────────────
    voiceBtn?.addEventListener('click', () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        BSUI.toast?.({
          title: 'Tu navegador no soporta dictado',
          message: 'Usá Chrome o Safari recientes para dictar por voz.',
          type: 'info'
        });
        return;
      }
      if (voiceBtn.classList.contains('is-listening')) {
        // Si ya está escuchando, detener
        voiceBtn._recognition?.stop?.();
        return;
      }
      const rec = new SpeechRecognition();
      rec.lang = 'es-AR';
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      voiceBtn._recognition = rec;
      voiceBtn.classList.add('is-listening');
      const originalIcon = voiceBtn.innerHTML;
      voiceBtn.innerHTML = `<span class="bsai-voice-pulse"></span>`;
      promptEl.placeholder = 'Te estoy escuchando…';
      let finalText = promptEl.value ? promptEl.value + ' ' : '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t + ' ';
          else interim += t;
        }
        promptEl.value = (finalText + interim).trim();
        charEl.textContent = `${promptEl.value.length} / 500`;
      };
      rec.onend = () => {
        voiceBtn.classList.remove('is-listening');
        voiceBtn.innerHTML = originalIcon;
        promptEl.placeholder = 'Ejemplo: haceme una combinada de 4 partidos de mañana de la Premier, no tan riesgosa, con una cuota de 5.5 o más, dentro de todo segura';
      };
      rec.onerror = (e) => {
        voiceBtn.classList.remove('is-listening');
        voiceBtn.innerHTML = originalIcon;
        promptEl.placeholder = 'Ejemplo: haceme una combinada de 4 partidos de mañana de la Premier, no tan riesgosa, con una cuota de 5.5 o más, dentro de todo segura';
        if (e.error === 'not-allowed') {
          BSUI.toast?.({ title: 'Permiso de micrófono denegado', message: 'Habilitá el micrófono en tu navegador para usar el dictado.', type: 'error' });
        } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
          BSUI.toast?.({ title: 'Error en el dictado', message: e.error, type: 'error' });
        }
      };
      rec.start();
    });

    // ── HISTORY DRAWER ────────────────────────────────────────────────
    historyBtn?.addEventListener('click', () => {
      const drawer = panel.querySelector('#bsaiHistoryDrawer');
      if (!drawer) return;
      const list = panel.querySelector('#bsaiHistoryList');
      if (!state.history.length) {
        list.innerHTML = `<div class="empty" style="padding:24px;text-align:center"><p class="muted">Tu primer pedido va a quedar guardado acá.</p></div>`;
      } else {
        list.innerHTML = state.history.map((h, i) => `
          <button class="bsai-history-item" data-history-idx="${i}">
            <div class="bsai-history-item__text">${BSUI.esc(h.prompt)}</div>
            <div class="bsai-history-item__meta">
              <span>${h.legs || '?'} legs</span>
              <span>·</span>
              <span class="num">${(h.totalOdd || 0).toFixed(2)}</span>
              <span>·</span>
              <span class="muted">${BSUI.dt ? BSUI.dt(h.ts) : new Date(h.ts).toLocaleString('es-AR')}</span>
            </div>
          </button>
        `).join('') + `
          <button class="btn btn-outline btn-sm" id="bsaiHistoryClear" style="align-self:flex-start;margin-top:6px">Vaciar historial</button>
        `;
        list.querySelectorAll('[data-history-idx]').forEach(b => b.addEventListener('click', () => {
          const idx = Number(b.dataset.historyIdx);
          const h = state.history[idx];
          if (!h) return;
          promptEl.value = h.prompt;
          charEl.textContent = `${h.prompt.length} / 500`;
          drawer.hidden = true;
          promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          promptEl.focus();
        }));
        list.querySelector('#bsaiHistoryClear')?.addEventListener('click', () => {
          if (confirm('¿Borrar todos los pedidos guardados?')) {
            state.history = [];
            localStorage.setItem('bs:betsafe-ai:history', '[]');
            drawer.hidden = true;
          }
        });
      }
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    panel.querySelector('#bsaiHistoryClose')?.addEventListener('click', () => {
      panel.querySelector('#bsaiHistoryDrawer').hidden = true;
    });
  }

  async function buildCombo(panel, prompt) {
    state.loading = true;
    state.error = null;
    state.aiHealth = null;
    state.aiReason = null;
    state.aiHint = null;
    state.lastPrompt = prompt;
    renderOutput(panel);

    try {
      // 180s timeout — Gemini analiza 14-20 partidos + curador final
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 180000);
      const res = await fetch('/api/betsafe-ai/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: ctrl.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      // v5.8: Coach IA = "IA real o nada". El backend ahora devuelve 503 con
      // {error, aiHealth, aiReason, hint} cuando la IA falla en cualquiera de
      // sus etapas (parser, análisis por partido, narrativa final). En vez de
      // tirar Error genérico, preservamos la metadata para mostrar el banner
      // uniforme con la razón concreta + hint accionable.
      if (!res.ok || data.error || !data.ok) {
        state.error = data.error || `HTTP ${res.status}`;
        state.aiHealth = data.aiHealth || 'degraded';
        state.aiReason = data.aiReason || null;
        state.aiHint = data.hint || null;
        state.loading = false;
        state.result = null;
        renderOutput(panel);
        return;
      }
      state.result = data;
      state.loading = false;
      // Guardar en history (max 10)
      state.history = [{ prompt, ts: Date.now(), totalOdd: data.totalOdd, legs: data.legs?.length }, ...state.history].slice(0, 10);
      localStorage.setItem('bs:betsafe-ai:history', JSON.stringify(state.history));
    } catch (e) {
      state.error = e?.message || 'Error inesperado';
      state.aiHealth = e?.name === 'AbortError' ? 'degraded' : null;
      state.aiReason = e?.name === 'AbortError' ? 'El motor IA tardó más de 180s. Probablemente está bajo carga.' : null;
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
      // v5.8: si el error es de IA (aiHealth degraded/no-keys), mostramos el
      // banner uniforme con razón concreta + hint accionable, en lugar de
      // mensaje genérico.
      const isAiError = state.aiHealth && state.aiHealth !== 'ok';
      const aiBannerHtml = isAiError
        ? BSUI.aiHealthBanner({
            health: state.aiHealth,
            provider: null,
            reason: state.aiReason || state.error,
            onRetry: 'bsaiRetryAi',
            context: 'Coach IA'
          })
        : '';
      host.innerHTML = `
        ${aiBannerHtml}
        <div class="bsai-error-card">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--danger)"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <strong>${isAiError ? 'La IA no pudo entender tu pedido' : 'No pudimos armar la combinada'}</strong>
          <p class="muted tiny">${BSUI.esc(state.error)}</p>
          ${state.aiHint ? `<p class="muted tiny" style="margin-top:6px;font-style:italic">💡 ${BSUI.esc(state.aiHint)}</p>` : ''}
          <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" id="bsaiRetry" type="button">Reintentar mismo pedido</button>
            ${isAiError ? `<button class="btn btn-ghost btn-sm" id="bsaiReformulate" type="button">Reformular pedido</button>` : ''}
          </div>
        </div>`;
      host.querySelector('#bsaiRetry')?.addEventListener('click', () => {
        buildCombo(panel, state.lastPrompt);
      });
      host.querySelector('#bsaiRetryAi')?.addEventListener('click', () => {
        buildCombo(panel, state.lastPrompt);
      });
      // "Reformular" → llevar el cursor al textarea con el prompt cargado
      host.querySelector('#bsaiReformulate')?.addEventListener('click', () => {
        const ta = panel.querySelector('#bsaiPrompt');
        if (ta) {
          ta.value = state.lastPrompt || '';
          ta.focus();
          ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      return;
    }

    if (!state.result) {
      // Empty state que ENSEÑA — en vez de un host vacío, mostramos los 4 pasos
      // que la IA va a ejecutar y un par de ejemplos para destrabar al usuario.
      host.innerHTML = `
        <div class="bs-empty-prem bsai-empty">
          <div class="bs-empty-prem__ico">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M19 14l.8 2.7L22 17.5l-2.2.8L19 21l-.8-2.7L16 17.5l2.2-.8L19 14z"/></svg>
          </div>
          <strong class="bs-empty-prem__title">Esperá tu primera combinada del Coach</strong>
          <p class="bs-empty-prem__hint">Decile en lenguaje natural qué querés (cantidad de partidos, liga, cuota target, riesgo). El motor entiende el pedido, busca partidos que lo cumplan, analiza cada uno con IA y encuentra la mejor casa por leg.</p>
          <div class="bsai-empty-steps">
            <span><strong>1</strong> Entiende tu pedido</span>
            <span><strong>2</strong> Encuentra partidos</span>
            <span><strong>3</strong> Analiza con IA</span>
            <span><strong>4</strong> Arma la combinada</span>
          </div>
        </div>`;
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
    // Retry del banner IA cuando aiHealth !== 'ok' — re-pedir la última combinada
    host.querySelector('#bsaiHealthRetry')?.addEventListener('click', () => {
      if (state.lastPrompt) buildCombo(panel, state.lastPrompt);
    });
  }

  function renderCombo(r) {
    const stake = 10000;
    const totalPayout = stake * r.totalOdd;
    const profit = totalPayout - stake;
    const bookOrder = computeBookRanking(r.legs);
    const winnerBook = bookOrder[0] || null;

    // Banner uniforme arriba de la combinada cuando IA no está OK
    const aiBannerHtml = (r.aiHealth && r.aiHealth !== 'ok')
      ? BSUI.aiHealthBanner({
          health: r.aiHealth,
          provider: r.aiProvider,
          reason: r.aiReason,
          onRetry: 'bsaiHealthRetry',
          context: 'Coach IA'
        })
      : '';

    // v5.10 — Eliminado el banner parserPartialAI: con la cascada 100% LLM
    // (Gemini → Claude → Groq → OpenRouter), si algún proveedor responde con
    // JSON válido entonces TODOS los filtros vienen del LLM. Si todos fallan,
    // el backend devuelve 503 y se muestra el banner aiHealth=degraded arriba.

    return `
      ${aiBannerHtml}
      <article class="bsai-combo-card">
        <header class="bsai-combo-head">
          <div class="bsai-combo-headline">
            <span class="badge-vip">Coach IA</span>
            ${r.aiProvider
              ? `<span class="badge badge-success tiny" style="margin-left:6px" title="Análisis generado con ${BSUI.esc(r.aiProvider)}">IA · ${BSUI.esc(r.aiProvider)}</span>`
              : ''}
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
            <button class="btn btn-outline btn-sm" id="bsaiSave" title="Guardar combinada en favoritos">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              Guardar
            </button>
            <button class="btn btn-outline btn-sm" id="bsaiShare" title="Compartir combinada (link/imagen)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Compartir
            </button>
            <button class="btn btn-outline btn-sm" id="bsaiCopy">Copiar texto</button>
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
      ).join('\n')}\n\n${r.narrative || ''}\n\n— Generado por Coach IA · betsafe.bet`;
      navigator.clipboard?.writeText(txt).then(() => {
        BSUI.toast?.({ title: 'Combinada copiada', message: 'Ya podés pegarla donde quieras.', type: 'success' });
      });
    });
    // ── SAVE favorite (localStorage) ─────────────────────────────────
    host.querySelector('#bsaiSave')?.addEventListener('click', () => {
      const favs = JSON.parse(localStorage.getItem('bs:betsafe-ai:favorites') || '[]');
      const fav = {
        id: 'fav_' + Date.now(),
        prompt: state.lastPrompt,
        headline: r.headline,
        narrative: r.narrative,
        totalOdd: r.totalOdd,
        legs: r.legs,
        avgConfidence: r.avgConfidence,
        ts: Date.now()
      };
      favs.unshift(fav);
      localStorage.setItem('bs:betsafe-ai:favorites', JSON.stringify(favs.slice(0, 50)));
      BSUI.toast?.({ title: '¡Guardada en favoritos!', message: 'Podés volver a ella desde tu historial.', type: 'success' });
    });
    // ── SHARE: prefer Web Share API; fallback a clipboard link ──────
    host.querySelector('#bsaiShare')?.addEventListener('click', async () => {
      const shareData = {
        title: 'Combinada Coach IA',
        text: `${r.headline}\nCuota: ${r.totalOdd.toFixed(2)} · ${r.legs.length} legs\n\n${r.legs.map((l, i) =>
          `${i+1}. ${l.home.name} vs ${l.away.name} — ${l.label} @ ${l.odd.toFixed(2)}`
        ).join('\n')}\n\nGenerada por Coach IA · betsafe.bet`,
        url: location.href
      };
      try {
        if (navigator.share && navigator.canShare?.(shareData)) {
          await navigator.share(shareData);
        } else {
          await navigator.clipboard.writeText(shareData.text + '\n\n' + shareData.url);
          BSUI.toast?.({ title: 'Combinada copiada para compartir', message: 'Pegala en cualquier red social o chat.', type: 'success' });
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          BSUI.toast?.({ title: 'No se pudo compartir', message: e.message, type: 'error' });
        }
      }
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

  // Registrar tab cuando BSDash esté disponible (puede cargarse antes que dashboard.js)
  function doRegister() {
    if (window.BSDash?.register) window.BSDash.register('betsafeai', render);
    else setTimeout(doRegister, 30);
  }
  doRegister();
})();
