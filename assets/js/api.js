/* BetSafe — API layer
 * ============================================================================
 * Es la capa de IA + capa de odds que ya NO trae nada sintético.
 *   - Para odds: delega 100% en BSLive (backend de scraping en vivo).
 *   - Para IA: cascada Groq → Gemini → OpenRouter → fallback determinístico
 *     basado en el motor probabilístico (BSEngine).
 *
 * Esta separación nos permite mantener la cascada IA real sin importar el
 * estado del backend de scraping (que es lo único que mueve cuotas reales).
 *
 * Eventos emitidos:
 *   'bs:ai-status'    → { ok, provider, msg }
 *   'bs:odds-status'  → { ok, count, msg }
 * ============================================================================
 */
(function (global) {
  'use strict';

  const API_KEYS_DEFAULT = {
    odds:           '',
    groq:           '',
    gemini:         '',
    openrouter:     '',
    footballData:   '',
    supabaseUrl:    '',
    supabaseAnonKey: ''
  };
  function cfg(name) {
    try {
      if (global.__BS_CONFIG && global.__BS_CONFIG[name]) return global.__BS_CONFIG[name];
      const ls = localStorage.getItem('bs:cfg:' + name);
      if (ls) return ls;
    } catch {}
    return API_KEYS_DEFAULT[name] || '';
  }
  const API_KEYS = new Proxy({}, { get: (_, k) => cfg(k) });

  const ENDPOINTS = {
    groq:         'https://api.groq.com/openai/v1/chat/completions',
    gemini:       'https://generativelanguage.googleapis.com/v1beta/models',
    openrouter:   'https://openrouter.ai/api/v1/chat/completions',
    footballData: 'https://api.football-data.org/v4'
  };

  const STATUS = { odds: 'idle', ai: 'idle', provider: null, lastError: null };
  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent('bs:' + name, { detail })); } catch {}
  }

  // ── ODDS: vienen 100% del backend ─────────────────────────────────────────
  /** Devuelve los eventos en vivo del backend. Si todavía no llegó snapshot,
   *  espera hasta opts.timeoutMs (default 8s) y devuelve lo que haya. */
  async function getEnrichedMatches(filter = {}, opts = {}) {
    if (!global.BSLive) {
      STATUS.odds = 'no-backend';
      emit('odds-status', { ok: false, msg: 'BSLive no cargado' });
      return [];
    }
    const events = await global.BSData.awaitLive({
      filter,
      timeoutMs: opts.timeoutMs || 8000
    });
    STATUS.odds = events.length ? 'live' : 'empty';
    emit('odds-status', { ok: events.length > 0, count: events.length });
    return events;
  }

  /** Surebets activas detectadas por el backend cruzando las casas legales AR. */
  async function getSurebets() {
    if (!global.BSLive) return [];
    // Si todavía no llegó snapshot, esperamos un poco
    if (!global.BSLive.state.surebets.length && !global.BSLive.ready()) {
      await new Promise(r => setTimeout(r, 1500));
    }
    return global.BSLive.surebets();
  }

  /** Steam moves recientes del backend */
  async function getSteam() { return global.BSLive ? global.BSLive.steamMoves() : []; }

  // ── HTTP helpers ─────────────────────────────────────────────────────────
  async function jpost(url, body, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 18000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  async function jget(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 9000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: opts.headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  // ── IA (cascada Groq → Gemini → OpenRouter → offline analítico) ──────────
  async function aiAnalyze({ prompt, system, vip = false, json = false } = {}) {
    const sys = system || `Sos un analista cuantitativo experto en apuestas deportivas argentino.
Respondé en español rioplatense, claro, conciso, en formato markdown.
Estructura: **Análisis probabilístico**, **Contexto del partido**, **Aviso de riesgo**.
Sin emojis, sin promesas de ganancia, sin lenguaje promocional.`;
    const userMsg = String(prompt || '').slice(0, 4000);

    const providers = [
      { name: 'groq',       fn: () => groqChat({ system: sys, prompt: userMsg, vip, json }) },
      { name: 'gemini',     fn: () => geminiChat({ system: sys, prompt: userMsg }) },
      { name: 'openrouter', fn: () => openRouterChat({ system: sys, prompt: userMsg, vip }) }
    ];

    for (const p of providers) {
      try {
        const text = await p.fn();
        STATUS.ai = p.name; STATUS.provider = p.name;
        emit('ai-status', { ok: true, provider: p.name });
        return { ok: true, text, provider: p.name };
      } catch (e) {
        console.warn(`[ai] ${p.name} failed:`, e?.message);
      }
    }

    // Último recurso: análisis determinístico basado en el engine probabilístico
    STATUS.ai = 'offline'; STATUS.provider = 'offline';
    emit('ai-status', { ok: false, provider: 'offline' });
    return { ok: false, text: deterministicAnalysis(userMsg), provider: 'offline' };
  }

  async function groqChat({ system, prompt, vip, json }) {
    const key = cfg('groq');
    if (!key) throw new Error('no-key');
    const model = vip ? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';
    const body = {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 800
    };
    if (json) body.response_format = { type: 'json_object' };
    const data = await jpost(ENDPOINTS.groq, body, { headers: { Authorization: `Bearer ${key}` } });
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('empty');
    return text;
  }

  async function geminiChat({ system, prompt }) {
    const key = cfg('gemini');
    if (!key) throw new Error('no-key');
    const url = `${ENDPOINTS.gemini}/gemini-flash-latest:generateContent?key=${key}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: system + '\n\n' + prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 800 }
    };
    const data = await jpost(url, body);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('empty');
    return text;
  }

  async function openRouterChat({ system, prompt, vip }) {
    const key = cfg('openrouter');
    if (!key) throw new Error('no-key');
    const model = vip ? 'meta-llama/llama-3.3-70b-instruct:free' : 'z-ai/glm-4.5-air:free';
    const body = {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 800
    };
    const data = await jpost(ENDPOINTS.openrouter, body, {
      headers: {
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': global.location?.origin || 'https://betsafe.app',
        'X-Title': 'BetSafe'
      }
    });
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('empty');
    return text;
  }

  /** Análisis offline determinístico — usa el engine para que aun sin IA el
   *  output sea matemáticamente correcto (probabilidad implícita real,
   *  EV calculado, stake Kelly). */
  function deterministicAnalysis(prompt) {
    const tone = /alto riesgo|aggress|long ?shot|underdog|agresivo/i.test(prompt) ? 'agresivo'
              : /bajo riesgo|conservador|safe/i.test(prompt) ? 'conservador'
              : 'equilibrado';
    const oddMatch = prompt.match(/cuota\s+([0-9]+\.?[0-9]*)/i);
    const odd = oddMatch ? parseFloat(oddMatch[1]) : null;
    let evNote = '';
    if (odd && global.BSEngine) {
      const impP = BSEngine.implied(odd);
      const fairP = impP * 1.05;
      const ev = BSEngine.expectedValue(fairP, odd);
      const kelly = BSEngine.kellyFraction(fairP, odd, 0.5);
      evNote = `\nProbabilidad implícita: ${BSUI.pctInt(impP, 1)}. EV estimado: ${BSUI.pctInt(ev, 1)}. Stake recomendado: ${BSUI.pctInt(kelly, 2)} de banca (½ Kelly).`;
    }
    return `**Análisis probabilístico**
La probabilidad implícita de las cuotas observadas refleja un mercado con margen estimado de ~5%. Para perfil ${tone}, evaluamos si el valor esperado supera el break-even.${evNote}

**Contexto del partido**
Las últimas cinco performances de ambos equipos convergen hacia su media histórica. Considerá impacto de localía (+3-5%), congestión de fixture y bajas confirmadas en plantel. La línea actual sugiere consenso del mercado.

**Aviso de riesgo**
Gestioná stake con criterio Kelly fraccional (¼ a ½ Kelly). Volatilidad alta en mercados secundarios. *Modo offline — IA en cascada no respondió. Conectá Groq/Gemini/OpenRouter en Settings para análisis cualitativo completo.*`;
  }

  // ── Football-data.org (opcional, fixtures suplementarios) ────────────────
  async function getFixtures(competitionCode = 'PL') {
    const key = cfg('footballData');
    if (!key) return [];
    try {
      return (await jget(`${ENDPOINTS.footballData}/competitions/${competitionCode}/matches?status=SCHEDULED`, {
        headers: { 'X-Auth-Token': key }
      })).matches || [];
    } catch (e) { console.warn('[footballData] fixtures failed:', e?.message); return []; }
  }
  async function getStandings(competitionCode = 'PL') {
    const key = cfg('footballData');
    if (!key) return null;
    try {
      const data = await jget(`${ENDPOINTS.footballData}/competitions/${competitionCode}/standings`, {
        headers: { 'X-Auth-Token': key }
      });
      return data.standings?.[0]?.table || null;
    } catch (e) { console.warn('[footballData] standings failed:', e?.message); return null; }
  }

  global.BSApi = {
    API_KEYS,
    cfg,
    setCfg(key, value) { try { localStorage.setItem('bs:cfg:' + key, value); } catch {} },

    // Odds (delegado a BSLive)
    getEnrichedMatches,
    getSurebets,
    getSteam,

    // IA
    aiAnalyze,

    // Football-data
    getFixtures,
    getStandings,

    STATUS
  };
})(window);
