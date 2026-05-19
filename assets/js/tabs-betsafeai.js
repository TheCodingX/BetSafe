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

  // SUGGESTIONS — SOLO botones que funcionan con markets reales que tenemos
  // (h2h, totals, btts, dc, ah, dnb) ampliamente disponibles en las 6 casas AR.
  //
  // FUERA del set:
  // - Mix córners + goles (corners-total solo 60 events en BetWarrior, poco fiable)
  // - Tarjetas (cards-total = 1 event total, no se puede armar combinada)
  // - Champions League (UCL no juega todos los días — botón intermitente)
  // - Goleadores, NBA puntos jugador, UFC método (analytical-only)
  //
  // Cada botón usa rangos de cuota REALISTAS para el pool típico AR y NO
  // restringe a ligas específicas que puedan no tener partidos (excepto LPF
  // y Premier que son los más comunes). Sin exactDate → flexible.
  const SUGGESTIONS = [
    {
      icon: '🛡️',
      label: 'Combinada segura',
      text: 'Combinada de 4 partidos con cuota total entre 2 y 4, conservadora, favoritos claros, para hoy o mañana'
    },
    {
      icon: '⚖️',
      label: 'Equilibrada',
      text: 'Combinada de 3 partidos equilibrada con cuota total entre 4 y 8, mezcla de h2h y totales, para hoy o mañana'
    },
    {
      icon: '⚡',
      label: 'Apuesta agresiva',
      text: 'Combinada agresiva de 5 partidos con cuota total entre 15 y 25, sin esports'
    },
    {
      icon: '🇦🇷',
      label: 'Liga Argentina',
      text: 'Combinada de 3 partidos de la Liga Profesional Argentina, conservadora, cuota total entre 2 y 5'
    },
    {
      icon: '⚽',
      label: 'Premier League',
      text: 'Combinada de 3 partidos de la Premier League con cuota total entre 3 y 6, para esta semana'
    },
    {
      icon: '🎾',
      label: 'Tenis ATP',
      text: 'Combinada de 3 partidos de tenis ATP con favoritos claros, cuota total entre 2 y 4'
    },
    {
      icon: '🏀',
      label: 'NBA totales',
      text: 'Combinada de 3 partidos NBA con totales (más/menos puntos), cuota total entre 3 y 6'
    }
    // DNB seguros REMOVIDO 2026-05-18: no tira combinada consistentemente.
    // Aunque DNB tiene 191 events en BetWarrior+Codere, parecía que el pool
    // queda chico tras single-book consolidation (las ligas con DNB no se
    // overlappean entre casas). Mantener removido hasta investigar.
  ];

  // Plantilla de cómo escribir el prompt — guía visible debajo del input
  const PROMPT_TEMPLATE_STEPS = [
    { icon: '①', label: 'CANTIDAD', desc: 'cuántos partidos: "3 partidos", "5 legs"' },
    { icon: '②', label: 'CUOTA', desc: 'rango o target: "entre 5 y 10", "cuota total cerca de 4"' },
    { icon: '③', label: 'CUÁNDO', desc: 'fecha o ventana: "hoy", "mañana", "el sábado", "esta semana"' },
    { icon: '④', label: 'INCLUIR', desc: 'liga/deporte: "Premier League", "Liga Argentina", "tenis ATP"' },
    { icon: '⑤', label: 'EXCLUIR', desc: 'qué NO querés: "sin esports", "no brasileirao", "no tenis"' },
    { icon: '⑥', label: 'MERCADOS', desc: 'opcional: "córners", "tarjetas", "DNB", "totales"' }
  ];

  function render(panel) {
    if (!BSAuth.isVip()) {
      panel.innerHTML = `
        <div class="card card-vip card-pad-lg stack bsai-locked">
          <span class="badge-vip">VIP exclusivo</span>
          <h2 class="h2">Coach IA</h2>
          <p class="lead">Pedile a la IA que te arme combinadas a medida en lenguaje natural.</p>
          <p class="muted">Ejemplo: <em>"haceme una combinada de 4 partidos de mañana de la Premier League, cuota entre 5 y 8, dentro de todo segura"</em>. La IA analiza tu pedido, encuentra los partidos que cumplen tus criterios, evalúa lesiones/alineaciones/factores, y elige la casa que más paga toda la combinada.</p>
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
              <!-- Coach IA logo = mismo sparkle (3 estrellas) que usa el sidebar.
                   Manteniendo el gradient bg para coherencia visual VIP. -->
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none">
                <defs>
                  <linearGradient id="bsaiG1" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#d4a017"/>
                    <stop offset="100%" stop-color="#7b5b0d"/>
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="24" height="24" rx="7" fill="url(#bsaiG1)"/>
                <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3zM19 14l.8 2.7L22 17.5l-2.2.8L19 21l-.8-2.7L16 17.5l2.2-.8L19 14zM5 14l.6 2L7 16.6l-1.4.4L5 19l-.6-2L3 16.6l1.4-.4L5 14z"
                      fill="#ffffff" stroke="#ffffff" stroke-width="0.6" stroke-linejoin="round"/>
              </svg>
            </span>
            <div>
              <h2 class="h2" style="margin:0">Coach IA <span class="badge-vip" style="vertical-align:middle">VIP</span></h2>
              <p class="muted tiny" style="margin:4px 0 0">Pedile combinadas a medida — la IA arma todo cumpliendo tus condiciones</p>
            </div>
          </div>
        </header>

        <section class="bsai-prompt-card">
          <!-- Selector de casino REMOVIDO 2026-05-17 a pedido del user: con el
               filtro activo el sistema no encontraba partidos en muchos casos
               y el dropdown quedaba pegado entre sesiones. Vuelve al modo
               "mejor cuota cross-book" como era originalmente. Si en el futuro
               se reintroduce, hacerlo opcional + bien testeado. -->

          <textarea id="bsaiPrompt" class="bsai-prompt-input" rows="3"
            placeholder="Ejemplo: haceme una combinada de 4 partidos de mañana de la Premier, no tan riesgosa, con una cuota de 5.5 o más, dentro de todo segura"
            maxlength="500"></textarea>
          <div class="bsai-prompt-actions">
            <span class="muted tiny" id="bsaiCharCount">0 / 500</span>
            <div class="bsai-prompt-btns">
              <button class="btn btn-outline btn-icon" id="bsaiVoice" title="Hablale a la IA (dictado por voz)" aria-label="Dictar por voz">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
              <!-- Botón History REMOVIDO (2026-05-18) a pedido del user -->

              <button class="btn btn-gold mag" id="bsaiBuild">
                <span class="bsai-build-label">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
                  Armar combinada
                </span>
              </button>
            </div>
          </div>
        </section>

        <!-- TEMPLATE DE COMO PEDIR — guía step-by-step para que el user
             escriba prompts completos y la IA pueda cumplir todo -->
        <section class="bsai-template" aria-label="Cómo armar tu pedido" style="margin:8px 0 16px;padding:14px 16px;background:rgba(196,154,26,0.06);border:1px solid rgba(196,154,26,0.18);border-radius:10px">
          <strong style="display:block;margin-bottom:10px;color:#c49a1a;font-size:.85rem">💡 Cómo armar tu pedido — paso a paso</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 14px;font-size:.82rem">
            ${PROMPT_TEMPLATE_STEPS.map(s => `
              <div style="display:flex;gap:8px;align-items:flex-start">
                <span style="font-weight:700;color:#c49a1a;font-size:1.1rem;line-height:1">${s.icon}</span>
                <div>
                  <strong style="display:block;font-size:.78rem;letter-spacing:.4px;text-transform:uppercase;color:#c49a1a">${s.label}</strong>
                  <span class="muted" style="font-size:.78rem">${s.desc}</span>
                </div>
              </div>
            `).join('')}
          </div>
          <p class="muted" style="margin:10px 0 0;font-size:.75rem;line-height:1.5">
            <strong>Ejemplo completo:</strong> <em>"Combinada de <strong>4 legs</strong>, cuota total <strong>entre 5 y 10</strong>, para <strong>hoy</strong>, en <strong>Premier League o Champions</strong>, <strong>sin esports ni brasileirao</strong>, mezclando <strong>córners y totales</strong>"</em>
          </p>
        </section>

        <!-- History drawer REMOVIDO (2026-05-18) a pedido del user -->

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

    // Cleanup defensive del localStorage del selector removido — por si
    // algún user tiene 'betano' o lo que sea guardado del bug previo.
    try { localStorage.removeItem('bsai_preferred_book'); } catch {}

    bindEvents(panel);
    renderOutput(panel);
  }

  function bindEvents(panel) {
    const promptEl = panel.querySelector('#bsaiPrompt');
    const charEl = panel.querySelector('#bsaiCharCount');
    const buildBtn = panel.querySelector('#bsaiBuild');
    const voiceBtn = panel.querySelector('#bsaiVoice');
    // historyBtn removido (2026-05-18)
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
      // Anti double-click + cooldown 3s para no martillar el cascade IA
      if (buildBtn.dataset.busy === '1') return;
      const lastRun = Number(buildBtn.dataset.lastRun || 0);
      if (Date.now() - lastRun < 3000) {
        BSUI.toast?.({ title: 'Esperá un segundo', message: 'Acabás de pedir una combinada. Esperá 3s para evitar duplicar el análisis.', type: 'info' });
        return;
      }
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
      buildBtn.dataset.busy = '1';
      try {
        await buildCombo(panel, prompt);
      } finally {
        buildBtn.dataset.busy = '0';
        buildBtn.dataset.lastRun = String(Date.now());
      }
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

    // ── HISTORY DRAWER REMOVIDO (2026-05-18) ─────────────────────────
    // El usuario pidió quitar el botón y el cuadro de "Tus pedidos anteriores".
    // El state.history se mantiene en localStorage por compatibilidad histórica
    // pero no se muestra UI.
  }

  async function buildCombo(panel, prompt, opts = {}) {
    state.loading = true;
    state.error = null;
    state.lastPrompt = prompt;
    renderOutput(panel);

    // forceInclude: array de eventIds para forzar la inclusión de partidos
    // que la IA marcó como riesgosos (toque del botón "Agregar igualmente").
    const forceInclude = Array.isArray(opts.forceInclude) ? opts.forceInclude : [];

    try {
      // 180s timeout — Gemini analiza 14-20 partidos + curador final
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 180000);
      const res = await fetch('/api/betsafe-ai/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, forceInclude }),
        signal: ctrl.signal
      });
      clearTimeout(timeoutId);
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
            <li><span class="bsai-tick"></span>Analizando cada partido con IA (lesiones, alineaciones, factores)</li>
            <li><span class="bsai-tick"></span>Buscando la casa que más paga TODA la combinada</li>
            <li><span class="bsai-tick"></span>Armando la combinada en una sola casa</li>
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
      // Empty state que ENSEÑA — en vez de un host vacío, mostramos los 4 pasos
      // que la IA va a ejecutar y un par de ejemplos para destrabar al usuario.
      host.innerHTML = `
        <div class="bs-empty-prem bsai-empty">
          <div class="bs-empty-prem__ico">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M19 14l.8 2.7L22 17.5l-2.2.8L19 21l-.8-2.7L16 17.5l2.2-.8L19 14z"/></svg>
          </div>
          <strong class="bs-empty-prem__title">Esperá tu primera combinada del Coach</strong>
          <p class="bs-empty-prem__hint">Decile en lenguaje natural qué querés (cantidad de partidos, liga, cuota target, riesgo). El motor entiende el pedido, busca partidos que lo cumplan, analiza cada uno con IA y elige la casa que más paga la combinada completa.</p>
          <div class="bsai-empty-steps">
            <span><strong>1</strong> Entiende tu pedido</span>
            <span><strong>2</strong> Encuentra partidos</span>
            <span><strong>3</strong> Analiza con IA</span>
            <span><strong>4</strong> Arma la combinada en una casa</span>
          </div>
        </div>`;
      return;
    }

    const r = state.result;
    if (!r.ok) {
      // Tipos de fallo:
      //   no-events: no había partidos en el rango
      //   no-single-book: no se pudo unificar la combinada en una sola casa
      //   filters-not-met: hay degradedAttempt con la combinada parcial + issues
      const reasonTitle = {
        'no-events': 'No encontramos partidos',
        'no-single-book': 'No se pudo armar single-book',
        'filters-not-met': 'No se respetaron todos los filtros'
      }[r.reason] || 'Pool insuficiente';

      let degradedHtml = '';
      if (r.degradedAttempt && Array.isArray(r.degradedAttempt.legs) && r.degradedAttempt.legs.length) {
        // Render la combinada parcial como degraded para que el user vea qué se intentó
        const fakeR = { ...r, ...r.degradedAttempt, ok: true, filtersFullyRespected: false };
        degradedHtml = `
          <div style="margin-top:16px;padding:12px;background:rgba(244,162,97,0.08);border-left:3px solid #f4a261;border-radius:8px">
            <strong style="display:block;margin-bottom:8px;color:#f4a261">⚠ Combinada parcial (NO respeta todos los filtros)</strong>
            <p class="muted tiny" style="margin:0 0 10px">Te muestro lo que pude armar — pero NO cumple todo lo que pediste. Mirá los avisos en rojo abajo.</p>
            ${renderCombo(fakeR)}
          </div>`;
      }

      host.innerHTML = `
        <div class="bsai-empty-card">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <strong>${BSUI.esc(reasonTitle)}</strong>
          <p class="muted">${BSUI.esc(r.message || 'Probá relajar los criterios.')}</p>
        </div>
        ${degradedHtml}`;
      if (degradedHtml) bindComboActions(host, { ...r, ...r.degradedAttempt, ok: true, filtersFullyRespected: false });
      return;
    }

    host.innerHTML = renderCombo(r);
    bindComboActions(host, r);
  }

  /* Render del panel "Tus partidos pedidos" — coherencia total entre el
   * pedido del usuario y la combinada armada (refactor 2026-05-19).
   *
   * Para cada partido que el user mencionó explícitamente en el prompt,
   * muestra status visual: ✓ incluido / ⚠ no apto (con botón "Agregar
   * igualmente") / ✗ no existe en catálogo / ✗ error analítico.
   *
   * Reemplaza el warning genérico viejo que decía "no se encontraron picks
   * con valor" mientras la combinada incluía OTROS partidos con esos teams. */
  function renderSpecificMatchesPanel(r) {
    if (!Array.isArray(r.specificMatchesStatus) || !r.specificMatchesStatus.length) return '';

    const included      = r.specificMatchesStatus.filter(s => s.status === 'included');
    const unfit         = r.specificMatchesStatus.filter(s => s.status === 'analyzed_unfit');
    const notInCatalog  = r.specificMatchesStatus.filter(s => s.status === 'not_in_catalog');
    const failed        = r.specificMatchesStatus.filter(s => s.status === 'analyzed_failed');

    const rows = r.specificMatchesStatus.map(s => {
      // Estilo visual por status
      const config = {
        'included':         { color: '#1f8a4c', bg: 'rgba(31,138,76,0.10)', icon: '✓', label: 'Incluido' },
        'analyzed_unfit':   { color: '#c49a1a', bg: 'rgba(196,154,26,0.10)', icon: '⚠', label: 'No apto' },
        'not_in_catalog':   { color: '#dc3545', bg: 'rgba(220,53,69,0.08)',  icon: '✗', label: 'No existe' },
        'analyzed_failed':  { color: '#6b7280', bg: 'rgba(107,114,128,0.10)',icon: '⚠', label: 'Sin data' }
      }[s.status] || { color: '#6b7280', bg: 'rgba(107,114,128,0.08)', icon: '?', label: '?' };

      // Header del row: status + teams (si conocemos) + meta
      let teamsHtml;
      if (s.home && s.away) {
        teamsHtml = `<strong>${BSUI.esc(s.home.name)}</strong> <span class="muted">vs</span> <strong>${BSUI.esc(s.away.name)}</strong>`;
      } else {
        teamsHtml = `<strong>${BSUI.esc(s.requested)}</strong>`;
      }
      const dateStr = s.start
        ? new Date(s.start).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '';

      // Para 'included': mostrar el mercado elegido
      const legInfo = s.status === 'included'
        ? `<div class="muted tiny" style="margin-top:4px"><strong style="color:${config.color}">${BSUI.esc(BSData.prettyMarket?.(s.legMarket) || s.legMarket || '')}:</strong> ${BSUI.esc(s.legLabel || '')} @ ${s.legOdd?.toFixed?.(2) || '—'}</div>`
        : '';

      // Para 'analyzed_unfit': mostrar análisis breve + botón
      const analysisInfo = s.status === 'analyzed_unfit' && s.analysis
        ? `<div class="muted tiny" style="margin-top:4px">Mejor pick análitico: <strong>${BSUI.esc(s.analysis.label || s.analysis.outcome || '')}</strong> @ ${s.analysis.odd?.toFixed?.(2) || '—'} · EV ${s.analysis.ev != null ? (s.analysis.ev > 0 ? '+' : '') + s.analysis.ev.toFixed(2) + '%' : '—'} · Confianza ${s.analysis.confidence != null ? Math.round(s.analysis.confidence * 100) + '%' : '—'}</div>`
        : '';

      const actionBtn = s.canForceInclude
        ? `<button class="btn btn-outline btn-sm" data-force-include-event="${BSUI.esc(s.eventId)}" style="margin-top:8px;font-size:.78rem;padding:6px 12px">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-2px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
             Agregar partido igualmente
           </button>
           <div class="muted tiny" style="margin-top:4px;font-size:.72rem">Podés agregar igualmente este partido entendiendo los riesgos detectados por la IA.</div>`
        : '';

      return `
        <div class="bsai-match-row" style="display:flex;gap:12px;padding:12px 14px;background:${config.bg};border-left:3px solid ${config.color};border-radius:8px;margin-bottom:8px;align-items:flex-start">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${config.color};color:#fff;font-weight:800;font-size:.86rem;flex-shrink:0">${config.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap">
              <div style="font-size:.94rem;line-height:1.35">${teamsHtml}</div>
              <span style="font-size:.66rem;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:${config.color};white-space:nowrap">${config.label}</span>
            </div>
            ${dateStr ? `<div class="muted tiny" style="margin-top:3px">${BSUI.esc(dateStr)}${s.leagueName ? ` · ${BSUI.esc(s.leagueName)}` : ''}</div>` : ''}
            ${legInfo}
            ${analysisInfo}
            <p class="muted tiny" style="margin:6px 0 0;line-height:1.5">${BSUI.esc(s.message)}</p>
            ${actionBtn}
          </div>
        </div>`;
    }).join('');

    // Resumen en header del panel
    const counts = [];
    if (included.length)     counts.push(`<span style="color:#1f8a4c"><strong>${included.length}</strong> incluido${included.length !== 1 ? 's' : ''}</span>`);
    if (unfit.length)        counts.push(`<span style="color:#c49a1a"><strong>${unfit.length}</strong> no apto${unfit.length !== 1 ? 's' : ''}</span>`);
    if (notInCatalog.length) counts.push(`<span style="color:#dc3545"><strong>${notInCatalog.length}</strong> no existe${notInCatalog.length !== 1 ? 'n' : ''}</span>`);
    if (failed.length)       counts.push(`<span style="color:#6b7280"><strong>${failed.length}</strong> sin data</span>`);

    return `
      <section class="bsai-specific-matches" style="margin:0 0 16px;padding:14px 16px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:12px">
        <header style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <strong style="font-size:.92rem;letter-spacing:-.008em">Partidos que pediste</strong>
          <span class="muted tiny" style="font-size:.74rem">${counts.join(' · ')}</span>
        </header>
        ${rows}
      </section>`;
  }

  function renderCombo(r) {
    const stake = 10000;
    const totalPayout = stake * r.totalOdd;
    const profit = totalPayout - stake;
    // SINGLE-BOOK MODE (2026-05-18): toda la combinada se juega en UNA casa.
    // El backend devuelve r.combinationBook = el book elegido.
    const winnerBookKey = r.combinationBook || (computeBookRanking(r.legs)[0]?.book) || null;
    const winnerBookName = winnerBookKey
      ? (BSData.ALL_BOOKS.find(b => b.key === winnerBookKey)?.name || winnerBookKey)
      : null;
    const winnerBookLogo = (winnerBookKey && window.BSLogos?.bookLogo)
      ? BSLogos.bookLogo(winnerBookKey, { size: 24 })
      : '';

    return `
      <article class="bsai-combo-card">
        <header class="bsai-combo-head">
          <div class="bsai-combo-headline">
            <span class="badge-vip">Coach IA</span>
            ${r.aiHealth === 'degraded'
              ? `<span class="badge badge-warning tiny" style="margin-left:6px" title="Te armé la combinada con análisis estadístico. Refrescá en 1 min.">⚠ Análisis sin IA</span>`
              : ''}
            ${winnerBookKey ? `
              <span class="bsai-combo-book" title="Toda la combinada se juega en ${BSUI.esc(winnerBookName)}" style="display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:4px 10px;background:rgba(31,138,76,0.10);border-radius:6px">
                ${winnerBookLogo}
                <strong style="font-size:.85rem">${BSUI.esc(winnerBookName)}</strong>
              </span>
            ` : ''}
            <h3 class="h3" style="margin:4px 0 0">${BSUI.esc(r.headline)}</h3>
          </div>
          <div class="bsai-combo-stats">
            <div class="bsai-stat">
              <span class="bsai-stat__label">Cuota total</span>
              <strong class="bsai-stat__value bsai-stat__value--gold">${r.totalOdd.toFixed(2)}</strong>
            </div>
            <div class="bsai-stat">
              <span class="bsai-stat__label">Confianza</span>
              <strong class="bsai-stat__value">${BSUI.pctInt(r.avgConfidence, 0)}</strong>
            </div>
            <div class="bsai-stat">
              <span class="bsai-stat__label">Legs</span>
              <strong class="bsai-stat__value">${r.legs.length}</strong>
            </div>
          </div>
        </header>

        ${renderSpecificMatchesPanel(r)}

        ${r.narrative ? `
          <div class="bsai-narrative">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            <p>${BSUI.esc(r.narrative)}</p>
          </div>
        ` : ''}

        ${Array.isArray(r.validationIssues) && r.validationIssues.length ? (() => {
          // Diferenciamos críticas (rojo) de warnings (amarillo).
          const critical = r.validationIssues.filter(v => v.critical);
          const warnings = r.validationIssues.filter(v => !v.critical);
          let html = '';
          if (critical.length) {
            html += `
              <div style="padding:12px 14px;background:rgba(220,53,69,0.12);border-left:4px solid #dc3545;border-radius:8px;margin:10px 0;font-size:.88rem">
                <strong style="color:#dc3545;display:block;margin-bottom:6px;font-size:.95rem">⚠ La combinada NO respeta lo que pediste</strong>
                <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;color:#e8a4ad">
                  ${critical.map(v => `<li>${BSUI.esc(v.message)}</li>`).join('')}
                </ul>
              </div>`;
          }
          if (warnings.length) {
            html += `
              <div style="padding:10px 14px;background:rgba(212,160,23,0.10);border-left:3px solid #c49a1a;border-radius:8px;margin:10px 0;font-size:.85rem">
                <strong style="color:#c49a1a;display:block;margin-bottom:6px">⚠ Avisos secundarios</strong>
                <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
                  ${warnings.map(v => `<li>${BSUI.esc(v.message)}</li>`).join('')}
                </ul>
              </div>`;
          }
          return html;
        })() : (r.filtersFullyRespected ? `
          <div style="padding:8px 12px;background:rgba(31,138,76,0.08);border-left:3px solid #1f8a4c;border-radius:6px;margin:10px 0;font-size:.78rem">
            <strong style="color:#1f8a4c">✓ Combinada armada respetando todos los filtros pedidos</strong>
          </div>
        ` : '')}

        <div class="bsai-legs">
          ${r.legs.map((l, i) => renderLeg(l, i)).join('')}
        </div>
        <!-- Footer "Mejor casa para esta combinada" removido (2026-05-18):
             la casa única ahora se muestra en el header como single-book mode. -->


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
    const homeLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(leg.home.id, { size: 36, name: leg.home.name, sport: leg.sport, league: leg.leagueName || leg.league }) : '';
    const awayLogo = window.BSLogos?.teamCrest ? BSLogos.teamCrest(leg.away.id, { size: 36, name: leg.away.name, sport: leg.sport, league: leg.leagueName || leg.league }) : '';
    const leagueLogo = window.BSLogos?.leagueLogo ? BSLogos.leagueLogo(leg.league || leg.leagueName, { size: 16 }) : '';

    // SINGLE-BOOK MODE (2026-05-18): NO mostramos logo de casa por leg.
    // La casa única se muestra UNA SOLA VEZ en el header de la combinada.
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
          </div>
        </div>
      </div>
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

    // ── BOTÓN "Agregar partido igualmente" — coherencia con partidos pedidos ──
    // Al tocarlo, re-llamamos al endpoint con forceInclude conteniendo el
    // eventId del partido riesgoso. El backend lo agrega a la combinada y
    // recalcula cuota total, EV, confianza y el resto de las legs.
    // Acumula con cualquier otro forceInclude que ya hayamos aplicado en
    // este resultado (para que el user pueda agregar varios sin perder los
    // anteriores).
    const panel = host.closest('.bsai-shell')?.parentElement || host.parentElement || host;
    host.querySelectorAll('[data-force-include-event]').forEach(btn => {
      btn.addEventListener('click', () => {
        const evId = btn.dataset.forceIncludeEvent;
        if (!evId) return;
        // Acumular forceIncludes ya aplicados (eco del backend)
        const prev = Array.isArray(r.forceIncludeApplied) ? r.forceIncludeApplied : [];
        const next = [...new Set([...prev, evId])];
        // Disable el botón inmediatamente para evitar doble click
        btn.disabled = true;
        btn.innerHTML = `<span class="muted">Recalculando combinada…</span>`;
        BSUI.toast?.({
          title: 'Agregando partido a la combinada',
          message: 'Recalculo cuota total, EV y resto de legs…',
          type: 'info'
        });
        buildCombo(panel, state.lastPrompt, { forceInclude: next });
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
