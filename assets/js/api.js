/* BetSafe — API layer (real integrations + engine pipeline)
 * ============================================================================
 * Cascada de proveedores reales:
 *   Odds:   The Odds API (multi-mercado)  → mock determinístico (no random)
 *   AI:     Groq → Gemini → OpenRouter → offline (fallback templated)
 *
 * Configuración de keys (en orden de precedencia):
 *   1) window.__BS_CONFIG.<key>     (inyectado al deploy)
 *   2) localStorage 'bs:cfg:<key>'   (manual desde Settings)
 *   3) API_KEYS_DEFAULT (incluidos en este archivo — ROTAR DESPUÉS DEL DEPLOY)
 *
 * SECURITY NOTE: las keys hardcodeadas están expuestas en el cliente. Después
 * de deployar a producción, rotalas y servilas via `window.__BS_CONFIG` desde
 * un build step que las inyecte desde variables de entorno de Render.
 *
 * Cache: in-memory con TTL configurable + persistencia en localStorage para
 * sobrevivir page reloads y reducir llamadas a la API.
 *
 * Pipeline:
 *   getEnrichedMatches() → fetch odds → engine.modelMatch() → matches con
 *   modelProbs, marketProbs, EV, picks listos para consumo por la UI.
 * ============================================================================
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIG (env / localStorage / defaults)
  // ─────────────────────────────────────────────────────────────────────────
  // Keys vacías por default. Las reales se inyectan via window.__BS_CONFIG
  // (Render env vars) o se setean manualmente en localStorage desde Settings.
  // NUNCA hardcodees keys acá — quedan en git history.
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
  // Compatibilidad con código existente
  const API_KEYS = new Proxy({}, { get: (_, k) => cfg(k) });

  const ENDPOINTS = {
    odds:       'https://api.the-odds-api.com/v4',
    groq:       'https://api.groq.com/openai/v1/chat/completions',
    gemini:     'https://generativelanguage.googleapis.com/v1beta/models',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    footballData: 'https://api.football-data.org/v4'
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CACHE + RATE LIMITING
  // ─────────────────────────────────────────────────────────────────────────
  const memCache = new Map();
  const DEFAULT_TTL = 60 * 1000;       // 60s en memoria
  const PERSIST_TTL = 5 * 60 * 1000;   // 5 min en localStorage

  function ckey(...parts) { return parts.join('|'); }
  function getCached(k) {
    const mem = memCache.get(k);
    if (mem && Date.now() - mem.t < DEFAULT_TTL) return mem.v;
    try {
      const ls = localStorage.getItem('bs:cache:' + k);
      if (ls) {
        const { t, v } = JSON.parse(ls);
        if (Date.now() - t < PERSIST_TTL) {
          memCache.set(k, { t, v });
          return v;
        }
      }
    } catch {}
    return null;
  }
  function setCached(k, v) {
    const t = Date.now();
    memCache.set(k, { t, v });
    try { localStorage.setItem('bs:cache:' + k, JSON.stringify({ t, v })); } catch {}
  }

  // Tracker de rate limit por proveedor
  const rateLimit = {
    odds: { remaining: null, used: null, lastUpdate: 0 },
    groq: { remaining: null, lastUpdate: 0 },
    footballData: { remaining: null, lastUpdate: 0 }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS BUS (para que la UI muestre indicadores live/fallback)
  // ─────────────────────────────────────────────────────────────────────────
  const STATUS = { odds: 'idle', ai: 'idle', provider: null, lastError: null };
  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent('bs:' + name, { detail })); } catch {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HTTP HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  async function jget(url, opts = {}) {
    const k = ckey('GET', url);
    const cached = getCached(k);
    if (cached) return cached;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 9000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: opts.headers });
      // Capturar headers de rate limit (The Odds API)
      const remaining = res.headers.get('x-requests-remaining');
      const used = res.headers.get('x-requests-used');
      if (remaining) {
        rateLimit.odds = { remaining: Number(remaining), used: used ? Number(used) : null, lastUpdate: Date.now() };
        emit('odds-quota', rateLimit.odds);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const v = await res.json();
      setCached(k, v);
      return v;
    } finally { clearTimeout(timer); }
  }

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

  // ─────────────────────────────────────────────────────────────────────────
  // ODDS API: lista de deportes + odds multi-mercado
  // ─────────────────────────────────────────────────────────────────────────
  async function getSports() {
    const key = cfg('odds');
    if (!key) {
      STATUS.odds = 'no-key';
      emit('odds-status', { ok: false, reason: 'no-key' });
      return BSData.SPORTS.map(s => ({ key: s.key, title: s.name, group: 'mock' }));
    }
    try {
      STATUS.odds = 'live';
      const v = await jget(`${ENDPOINTS.odds}/sports?apiKey=${key}`);
      emit('odds-status', { ok: true });
      return v;
    } catch (e) {
      STATUS.odds = 'fallback';
      STATUS.lastError = e?.message;
      emit('odds-status', { ok: false, msg: e?.message });
      return BSData.SPORTS.map(s => ({ key: s.key, title: s.name, group: 'mock' }));
    }
  }

  /** Soportados por The Odds API en plan free: h2h, spreads, totals, outrights.
   *  Mercados extra (btts, draw_no_bet, alternate spreads) requieren plan paid. */
  const ODDS_MARKETS_FREE = ['h2h', 'spreads', 'totals'];
  const ODDS_MARKETS_PAID = ['h2h', 'spreads', 'totals', 'btts', 'draw_no_bet',
                              'alternate_spreads', 'alternate_totals'];

  async function getOddsMulti(sportKey = 'soccer_epl', opts = {}) {
    const key = cfg('odds');
    const region  = opts.region || 'us,eu,uk';
    const markets = (opts.markets || ODDS_MARKETS_FREE).join(',');
    if (!key) {
      STATUS.odds = 'no-key';
      emit('odds-status', { ok: false, reason: 'no-key' });
      return getMockOdds();
    }
    try {
      const url = `${ENDPOINTS.odds}/sports/${encodeURIComponent(sportKey)}/odds/?apiKey=${key}`
                + `&regions=${region}&markets=${markets}&oddsFormat=decimal&dateFormat=iso`;
      const data = await jget(url);
      if (Array.isArray(data) && data.length > 0) {
        STATUS.odds = 'live';
        emit('odds-status', { ok: true, count: data.length });
        return data.map(normalizeEvent);
      }
      return getMockOdds();
    } catch (e) {
      STATUS.odds = 'fallback';
      STATUS.lastError = e?.message;
      emit('odds-status', { ok: false, msg: e?.message });
      return getMockOdds();
    }
  }

  /** Compatibilidad con el signature original */
  async function getOdds(sportKey = 'soccer_epl', region = 'us,eu,uk') {
    return getOddsMulti(sportKey, { region });
  }

  /** Normaliza un evento de The Odds API a nuestro schema interno */
  function normalizeEvent(ev) {
    const home = ev.home_team;
    const away = ev.away_team;
    const markets = { h2h: {}, totals: {}, spreads: {}, btts: {} };

    (ev.bookmakers || []).forEach(b => {
      const bookKey = b.key;
      (b.markets || []).forEach(m => {
        const outcomes = m.outcomes || [];
        if (m.key === 'h2h') {
          // outcomes pueden ser 2 (no empate) o 3
          const oHome = outcomes.find(o => o.name === home);
          const oAway = outcomes.find(o => o.name === away);
          const oDraw = outcomes.find(o => o.name === 'Draw' || /empate/i.test(o.name));
          markets.h2h[bookKey] = {
            home: oHome?.price || null,
            draw: oDraw?.price || null,
            away: oAway?.price || null
          };
        } else if (m.key === 'totals') {
          // Agrupar por línea (point)
          outcomes.forEach(o => {
            const line = o.point;
            if (line == null) return;
            if (!markets.totals[bookKey]) markets.totals[bookKey] = {};
            if (!markets.totals[bookKey][line]) markets.totals[bookKey][line] = {};
            if (/over/i.test(o.name)) markets.totals[bookKey][line].over = o.price;
            if (/under/i.test(o.name)) markets.totals[bookKey][line].under = o.price;
          });
        } else if (m.key === 'spreads') {
          outcomes.forEach(o => {
            const point = o.point;
            if (!markets.spreads[bookKey]) markets.spreads[bookKey] = {};
            const sideKey = o.name === home ? 'home' : 'away';
            markets.spreads[bookKey][sideKey] = { price: o.price, point };
          });
        } else if (m.key === 'btts') {
          outcomes.forEach(o => {
            if (!markets.btts[bookKey]) markets.btts[bookKey] = {};
            if (/yes|sí/i.test(o.name)) markets.btts[bookKey].yes = o.price;
            if (/no/i.test(o.name)) markets.btts[bookKey].no = o.price;
          });
        }
      });
    });

    // Tomar mejor cuota por outcome (across books) — esto es lo que la UI usa
    const best = {
      h2h: bestMarket(markets.h2h, ['home', 'draw', 'away']),
      btts: bestMarket(markets.btts, ['yes', 'no']),
      totals: bestTotals(markets.totals)
    };

    return {
      id: ev.id,
      sport: ev.sport_key,
      sportTitle: ev.sport_title,
      league: ev.sport_key,
      leagueName: ev.sport_title,
      home: { id: slug(home), name: home, color: '#1f2937' },
      away: { id: slug(away), name: away, color: '#1f2937' },
      start: new Date(ev.commence_time).getTime(),
      // markets organizados por casa (para comparador)
      markets,
      // mejor cuota por outcome (para picks/builder)
      bestOdds: best,
      // shape compatible con código existente que espera odds.h2h.home etc.
      odds: best
    };
  }

  function bestMarket(byBook, outcomes) {
    const out = {};
    outcomes.forEach(o => {
      let best = 0;
      Object.values(byBook).forEach(b => {
        if (b[o] && b[o] > best) best = b[o];
      });
      if (best > 0) out[o] = best;
    });
    return Object.keys(out).length ? out : null;
  }
  function bestTotals(byBook) {
    // Para cada línea, mejor over y mejor under
    const lines = {};
    Object.values(byBook).forEach(book => {
      Object.entries(book).forEach(([line, sides]) => {
        if (!lines[line]) lines[line] = { over: 0, under: 0 };
        if (sides.over > lines[line].over) lines[line].over = sides.over;
        if (sides.under > lines[line].under) lines[line].under = sides.under;
      });
    });
    return Object.keys(lines).length ? lines : null;
  }

  function slug(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function getMockOdds() {
    return (BSData && BSData.makeMatches) ? BSData.makeMatches() : [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENRICHED MATCHES: fetch + engine.modelMatch
  // ─────────────────────────────────────────────────────────────────────────

  /** Fetcher principal usado por la UI. Devuelve matches con modelProbs/EV
   *  ya pre-computados por el engine cuántico. */
  async function getEnrichedMatches(sportKey, opts = {}) {
    const raw = await getOddsMulti(sportKey, opts);
    if (!global.BSEngine) {
      console.warn('[api] BSEngine no cargado — devolviendo matches sin enriquecer');
      return raw;
    }
    return raw.map(m => {
      // Estimar λ (goles esperados) desde el mercado de totales si está disponible
      let lambdaH = 1.4, lambdaA = 1.1;
      if (m.bestOdds && m.bestOdds.totals) {
        const lines = Object.keys(m.bestOdds.totals).map(Number).sort();
        const mainLine = lines.find(l => Math.abs(l - 2.5) < 0.6) || lines[Math.floor(lines.length/2)];
        if (mainLine) {
          const [pOver] = BSEngine.removeMarginShin([
            m.bestOdds.totals[mainLine].over,
            m.bestOdds.totals[mainLine].under
          ].filter(Boolean));
          // pOver para la línea X → estimar total esperado (μ_total)
          // Inversión Poisson grossera: pOver(2.5) ≈ 50% → μ ≈ 2.6
          const muTotal = solveLambdaForOver(mainLine, pOver) || (mainLine + 0.1);
          // Distribuir entre local/visitante usando 1X2 implícito como proxy de fuerza
          if (m.bestOdds.h2h) {
            const [pH, pD, pA] = BSEngine.removeMarginShin([
              m.bestOdds.h2h.home,
              m.bestOdds.h2h.draw,
              m.bestOdds.h2h.away
            ].filter(Boolean));
            const ratio = (pH + pD * 0.5) / Math.max(0.05, pH + pD + pA);
            lambdaH = muTotal * Math.max(0.35, Math.min(0.75, ratio));
            lambdaA = muTotal - lambdaH;
          }
        }
      }
      return BSEngine.modelMatch({ ...m, lambdaH, lambdaA });
    });
  }

  /** Inversión numérica: encuentra λ_total tal que P(X > line) = pOver */
  function solveLambdaForOver(line, pOver) {
    if (pOver <= 0 || pOver >= 1) return null;
    // Búsqueda binaria sobre λ ∈ [0.5, 6]
    let lo = 0.5, hi = 6;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const p = 1 - BSEngine.poissonCDF(Math.floor(line), mid);
      if (p < pOver) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Detecta surebets en vivo a partir de múltiples casas para un mercado */
  async function getSurebets(sportKey, opts = {}) {
    const matches = await getOddsMulti(sportKey, opts);
    if (!global.BSEngine) return [];
    const surebets = [];
    matches.forEach(m => {
      if (!m.markets || !m.markets.h2h) return;
      const books = Object.entries(m.markets.h2h);
      if (books.length < 2) return;
      const outcomes = books[0][1].draw != null ? ['home', 'draw', 'away'] : ['home', 'away'];
      const booksOdds = books.map(([book, prices]) => ({
        book,
        odds: outcomes.map(o => prices[o]).filter(Boolean)
      })).filter(b => b.odds.length === outcomes.length);
      const sb = BSEngine.findBestSurebet(booksOdds);
      if (sb) {
        surebets.push({ match: m, market: 'h2h', outcomes, ...sb });
      }
    });
    surebets.sort((a, b) => b.roi - a.roi);
    return surebets;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI (Groq → Gemini → OpenRouter → offline)
  // ─────────────────────────────────────────────────────────────────────────

  async function aiAnalyze({ prompt, system, vip = false, json = false } = {}) {
    const sys = system || `Sos un analista cuantitativo experto en apuestas deportivas argentino.
Respondé en español rioplatense, claro, conciso, en formato markdown.
Estructura: **Análisis probabilístico**, **Contexto del partido**, **Aviso de riesgo**.
Sin emojis, sin promesas de ganancia, sin lenguaje promocional.`;
    const userMsg = String(prompt || '').slice(0, 4000);

    const providers = [
      { name: 'groq', fn: () => groqChat({ system: sys, prompt: userMsg, vip, json }) },
      { name: 'gemini', fn: () => geminiChat({ system: sys, prompt: userMsg }) },
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

    // Free tier fallback en OpenRouter
    if (vip) {
      try {
        const text = await openRouterChat({ system: sys, prompt: userMsg, vip: false });
        STATUS.ai = 'openrouter-free'; STATUS.provider = 'openrouter';
        emit('ai-status', { ok: true, provider: 'openrouter' });
        return { ok: true, text, provider: 'openrouter' };
      } catch (e) { /* sigue */ }
    }

    // Último recurso: análisis offline templated
    STATUS.ai = 'offline'; STATUS.provider = 'offline';
    emit('ai-status', { ok: false, provider: 'offline' });
    return { ok: false, text: fallbackAnalysis(userMsg), provider: 'offline' };
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
    const data = await jpost(ENDPOINTS.groq, body, {
      headers: { Authorization: `Bearer ${key}` }
    });
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

  /** Análisis offline determinístico — usa el engine si está disponible */
  function fallbackAnalysis(prompt) {
    const tone = /alto riesgo|aggress|long ?shot|underdog|agresivo/i.test(prompt) ? 'agresivo'
              : /bajo riesgo|conservador|safe/i.test(prompt) ? 'conservador'
              : 'equilibrado';
    // Extraer cuota si está en el prompt
    const oddMatch = prompt.match(/cuota\s+([0-9]+\.?[0-9]*)/i);
    const odd = oddMatch ? parseFloat(oddMatch[1]) : null;
    let evNote = '';
    if (odd && global.BSEngine) {
      const impP = BSEngine.implied(odd);
      const fairP = impP * 1.05; // asumir 5% margen
      const ev = BSEngine.expectedValue(fairP, odd);
      const kelly = BSEngine.kellyFraction(fairP, odd, 0.5);
      evNote = `\nProbabilidad implícita: ${(impP * 100).toFixed(1)}%. EV estimado: ${(ev * 100).toFixed(1)}%. Stake recomendado: ${(kelly * 100).toFixed(2)}% de banca (½ Kelly).`;
    }
    return `**Análisis probabilístico**
La probabilidad implícita de las cuotas observadas refleja un mercado con margen estimado de ~5%. Para perfil ${tone}, evaluamos si el valor esperado supera el break-even.${evNote}

**Contexto del partido**
Las últimas cinco performances de ambos equipos convergen hacia su media histórica. Considerá impacto de localía (+3-5%), congestión de fixture y bajas confirmadas en plantel. La línea actual sugiere consenso del mercado.

**Aviso de riesgo**
Gestioná stake con criterio Kelly fraccional (¼ a ½ Kelly). Volatilidad alta en mercados secundarios. *Modo offline — IA no disponible. Conectá Groq/Gemini/OpenRouter en Settings para análisis cualitativo completo.*`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FOOTBALL-DATA.ORG (opcional, free 10 req/min) — fixtures + standings
  // ─────────────────────────────────────────────────────────────────────────
  async function getFixtures(competitionCode = 'PL') {
    const key = cfg('footballData');
    if (!key) return [];
    try {
      const data = await jget(`${ENDPOINTS.footballData}/competitions/${competitionCode}/matches?status=SCHEDULED`, {
        headers: { 'X-Auth-Token': key }
      });
      return data.matches || [];
    } catch (e) {
      console.warn('[footballData] fixtures failed:', e?.message);
      return [];
    }
  }
  async function getStandings(competitionCode = 'PL') {
    const key = cfg('footballData');
    if (!key) return null;
    try {
      const data = await jget(`${ENDPOINTS.footballData}/competitions/${competitionCode}/standings`, {
        headers: { 'X-Auth-Token': key }
      });
      return data.standings?.[0]?.table || null;
    } catch (e) {
      console.warn('[footballData] standings failed:', e?.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPORT
  // ─────────────────────────────────────────────────────────────────────────
  global.BSApi = {
    // Config (read-only proxy de keys)
    API_KEYS,
    cfg,
    setCfg(key, value) {
      try { localStorage.setItem('bs:cfg:' + key, value); } catch {}
    },
    // Odds
    getSports,
    getOdds,
    getOddsMulti,
    getEnrichedMatches,
    getSurebets,
    getMockOdds,
    // Football data
    getFixtures,
    getStandings,
    // AI
    aiAnalyze,
    // Status
    STATUS,
    rateLimit,
    // Cache control
    clearCache() {
      memCache.clear();
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('bs:cache:')) localStorage.removeItem(k);
        });
      } catch {}
    },
    // Constants
    ODDS_MARKETS_FREE,
    ODDS_MARKETS_PAID
  };
})(window);
