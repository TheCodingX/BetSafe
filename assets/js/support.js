/* BetSafe — Soporte IA flotante 24/7
 * ============================================================================
 * Botón flotante premium (navy + gold) que abre un chat con IA contextual.
 * Carga global desde shell.js → se inyecta en todas las páginas.
 * Backend: POST /api/support/ask  → { answer, suggestions? }
 * ============================================================================ */
(function () {
  'use strict';

  if (window.__BS_SUPPORT_MOUNTED) return;
  window.__BS_SUPPORT_MOUNTED = true;

  const LS_KEY = 'bs:support:history:v1';
  const MAX_HISTORY = 16;

  const SUGGESTIONS_DEFAULT = [
    '¿Qué es Quant IA?',
    '¿Cómo funciona el comparador?',
    '¿Qué es el EV (valor esperado)?',
    '¿Cómo me suscribo?'
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Map de páginas/secciones internas → nombre amigable que ve el usuario.
  // El href del link sigue apuntando al .html real; solo cambia el texto visible.
  const PAGE_LABELS = {
    'index.html': 'Inicio',
    'dashboard.html': 'Dashboard',
    'dashboard.html#overview': 'Dashboard',
    'dashboard.html#comparator': 'Comparador',
    'dashboard.html#ai': 'Quant IA',
    'dashboard.html#aigenerator': 'Coach IA',
    'dashboard.html#arbitrage': 'Arbitraje',
    'dashboard.html#builder': 'Builder',
    'dashboard.html#calcpro': 'Calculadora Pro',
    'dashboard.html#tracker': 'Tracker',
    'dashboard.html#worldcup': 'Mundial 2026',
    'dashboard.html#settings': 'Configuración',
    'pricing.html': 'Precios',
    'contacto.html': 'Contacto',
    'features.html': 'Funciones',
    'tools.html': 'Herramientas',
    'learn.html': 'Academia',
    'bonos.html': 'Bonos',
    'responsable.html': 'Juego Responsable',
    'terminos.html': 'Términos',
    'privacidad.html': 'Privacidad',
    'cookies.html': 'Cookies',
    'login.html': 'Ingresar',
    'signup.html': 'Crear cuenta',
    'about.html': 'Nosotros'
  };

  function labelFor(href) {
    const key = href.toLowerCase();
    return PAGE_LABELS[key] || href.replace(/\.html(#.+)?$/, '');
  }

  // Markdown mínimo: **bold**, `code`, líneas → <br>, enlaces .html relativos
  // con nombre amigable (Precios, Contacto, Quant IA…) en lugar del filename.
  function fmt(text) {
    let s = esc(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Capturamos el .html (con hash opcional) y reemplazamos por <a> con label
    s = s.replace(/\b([a-z0-9_-]+\.html(?:#[a-z0-9_-]+)?)\b/gi, (_, href) => {
      return `<a href="${href}">${esc(labelFor(href))}</a>`;
    });
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(-MAX_HISTORY) : [];
    } catch { return []; }
  }

  function saveHistory(hist) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(hist.slice(-MAX_HISTORY))); } catch {}
  }

  // SVG inline — headset minimalista premium (gold)
  const ICON_HEADSET = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 14v-2a9 9 0 0 1 18 0v2"/>
      <path d="M21 14v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2z"/>
      <path d="M3 14v3a2 2 0 0 0 2 2h1v-7H5a2 2 0 0 0-2 2z"/>
      <path d="M18 19v.5a2.5 2.5 0 0 1-2.5 2.5H13"/>
      <circle cx="12" cy="22" r="0.6" fill="currentColor"/>
    </svg>`;

  const ICON_CLOSE = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18"/>
    </svg>`;

  const ICON_SEND = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12l14-7-5 18-3-7-6-4z"/>
    </svg>`;

  const ICON_SPARK = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M19 5l-2.5 2.5M7.5 16.5L5 19"/>
    </svg>`;

  function build() {
    const wrap = document.createElement('div');
    wrap.className = 'bs-support';
    wrap.innerHTML = `
      <button class="bs-support__fab" type="button" aria-label="Abrir soporte BetSafe IA" data-fab>
        <span class="bs-support__fab-pulse" aria-hidden="true"></span>
        <span class="bs-support__fab-glow" aria-hidden="true"></span>
        <span class="bs-support__fab-icon">${ICON_HEADSET}</span>
        <span class="bs-support__fab-spark" aria-hidden="true">${ICON_SPARK}</span>
      </button>

      <div class="bs-support__panel" role="dialog" aria-modal="false" aria-labelledby="bsSupportTitle" hidden>
        <header class="bs-support__head">
          <div class="bs-support__head-id">
            <span class="bs-support__avatar" aria-hidden="true">${ICON_HEADSET}</span>
            <div class="bs-support__head-meta">
              <strong id="bsSupportTitle">BetSafe Assistant</strong>
              <span class="bs-support__status"><span class="bs-support__dot"></span>IA Online · 24/7</span>
            </div>
          </div>
          <div class="bs-support__head-actions">
            <button class="bs-support__icon-btn" type="button" data-clear aria-label="Limpiar conversación" title="Limpiar conversación">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>
              </svg>
            </button>
            <button class="bs-support__icon-btn" type="button" data-close aria-label="Cerrar">${ICON_CLOSE}</button>
          </div>
        </header>

        <div class="bs-support__body" data-body>
          <div class="bs-support__welcome" data-welcome>
            <div class="bs-support__welcome-glow" aria-hidden="true"></div>
            <h4>Hola, soy <span class="bs-support__brand">BetSafe AI</span></h4>
            <p>Preguntame lo que quieras sobre <strong>Quant IA</strong>, <strong>Coach IA</strong>, el comparador de cuotas, EV, riesgos, bonos, casinos o cómo funciona la plataforma.</p>
          </div>
          <ul class="bs-support__messages" data-messages></ul>
        </div>

        <div class="bs-support__suggestions" data-suggestions></div>

        <form class="bs-support__form" data-form autocomplete="off">
          <div class="bs-support__input-wrap">
            <textarea
              class="bs-support__input"
              data-input
              rows="1"
              placeholder="Escribí tu pregunta…"
              maxlength="600"
              aria-label="Escribí tu pregunta"></textarea>
            <button class="bs-support__send" type="submit" data-send aria-label="Enviar" disabled>
              ${ICON_SEND}
            </button>
          </div>
          <div class="bs-support__legal">
            Respuestas generadas por IA · pueden contener errores · +18
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
  }

  function render(state) {
    const { panel, body, messagesEl, suggestionsEl, welcomeEl, inputEl, sendBtn } = state.dom;

    // Mensajes
    messagesEl.innerHTML = state.history.map(m => {
      const cls = m.role === 'user' ? 'bs-support__msg bs-support__msg--user' : 'bs-support__msg bs-support__msg--bot';
      const inner = m.role === 'user' ? esc(m.text) : fmt(m.text);
      return `<li class="${cls}"><div class="bs-support__bubble">${inner}</div></li>`;
    }).join('');

    // Welcome solo si no hay historial
    welcomeEl.style.display = state.history.length ? 'none' : '';

    // Typing
    if (state.typing) {
      messagesEl.insertAdjacentHTML('beforeend', `
        <li class="bs-support__msg bs-support__msg--bot bs-support__msg--typing">
          <div class="bs-support__bubble">
            <span class="bs-support__typing"><span></span><span></span><span></span></span>
          </div>
        </li>
      `);
    }

    // Sugerencias (solo si no hay historial o como follow-up)
    const sug = state.suggestions && state.suggestions.length
      ? state.suggestions
      : (state.history.length === 0 ? SUGGESTIONS_DEFAULT : []);
    suggestionsEl.innerHTML = sug.map(s =>
      `<button type="button" class="bs-support__chip" data-suggest="${esc(s)}">${esc(s)}</button>`
    ).join('');
    suggestionsEl.style.display = sug.length ? '' : 'none';

    // Send button state
    sendBtn.disabled = !inputEl.value.trim() || state.typing;

    // Scroll al final
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  }

  async function ask(question, history) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch('/api/support/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history: history.slice(-8) }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        if (r.status === 429) {
          return { answer: 'Estoy recibiendo muchas consultas ahora mismo. Esperá unos segundos y volvé a preguntar.', suggestions: [] };
        }
        throw new Error(`HTTP ${r.status}: ${txt.slice(0, 120)}`);
      }
      const data = await r.json();
      return {
        answer: String(data.answer || '').trim() || 'No pude generar una respuesta. Probá reformular la pregunta.',
        suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 4) : []
      };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        return { answer: 'La consulta tardó demasiado. Intentá de nuevo en un momento.', suggestions: [] };
      }
      return { answer: 'No pude contactar al servicio en este momento. Si el problema persiste, escribinos desde la página de contacto.', suggestions: [] };
    }
  }

  function mount() {
    const root = build();
    const state = {
      open: false,
      typing: false,
      suggestions: [],
      history: loadHistory(),
      dom: {
        root,
        fab: root.querySelector('[data-fab]'),
        panel: root.querySelector('.bs-support__panel'),
        body: root.querySelector('[data-body]'),
        messagesEl: root.querySelector('[data-messages]'),
        suggestionsEl: root.querySelector('[data-suggestions]'),
        welcomeEl: root.querySelector('[data-welcome]'),
        inputEl: root.querySelector('[data-input]'),
        sendBtn: root.querySelector('[data-send]'),
        formEl: root.querySelector('[data-form]'),
        closeBtn: root.querySelector('[data-close]'),
        clearBtn: root.querySelector('[data-clear]')
      }
    };

    const { fab, panel, inputEl, formEl, closeBtn, clearBtn, suggestionsEl } = state.dom;

    function setOpen(open) {
      state.open = open;
      if (open) {
        panel.hidden = false;
        // permitir que aplique display antes de animar
        requestAnimationFrame(() => panel.classList.add('is-open'));
        root.classList.add('is-open');
        // Idle pulse off al abrir
        fab.classList.add('is-active');
        // Focus al input
        setTimeout(() => inputEl.focus(), 220);
        // Marcar visto (apaga el dot rojo si lo hubiera)
        fab.classList.remove('has-badge');
      } else {
        panel.classList.remove('is-open');
        root.classList.remove('is-open');
        fab.classList.remove('is-active');
        setTimeout(() => { if (!state.open) panel.hidden = true; }, 260);
      }
    }

    function autoresize() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
    }

    async function submit(text) {
      const q = String(text || inputEl.value || '').trim();
      if (!q || state.typing) return;
      state.history.push({ role: 'user', text: q });
      saveHistory(state.history);
      inputEl.value = '';
      autoresize();
      state.typing = true;
      state.suggestions = [];
      render(state);

      const res = await ask(q, state.history);
      state.history.push({ role: 'assistant', text: res.answer });
      saveHistory(state.history);
      state.typing = false;
      state.suggestions = res.suggestions || [];
      render(state);
    }

    // ── Events ──
    fab.addEventListener('click', () => setOpen(!state.open));
    closeBtn.addEventListener('click', () => setOpen(false));

    clearBtn.addEventListener('click', () => {
      if (!state.history.length) return;
      if (!confirm('¿Borrar toda la conversación?')) return;
      state.history = [];
      state.suggestions = [];
      saveHistory(state.history);
      render(state);
    });

    formEl.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

    inputEl.addEventListener('input', () => { autoresize(); render(state); });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });

    suggestionsEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-suggest]');
      if (!b) return;
      submit(b.getAttribute('data-suggest'));
    });

    // Esc cierra
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) setOpen(false);
    });

    // Render inicial
    render(state);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
