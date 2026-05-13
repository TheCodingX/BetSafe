/* BetSafe — Cliente live (REST + WebSocket) hacia el backend de scraping
 * ============================================================================
 * Es la ÚNICA fuente de datos del frontend para cuotas, eventos, surebets y
 * steam moves. No hay generación sintética.
 *
 * Endpoints consumidos:
 *   GET  ${API_BASE}/api/snapshot     → estado completo (al cargar)
 *   GET  ${API_BASE}/api/odds?sport   → eventos filtrados
 *   GET  ${API_BASE}/api/surebets     → últimas surebets detectadas
 *   GET  ${API_BASE}/api/steam        → últimos steam moves
 *   GET  ${API_BASE}/api/books        → estado por casa (ok / error)
 *   GET  ${API_BASE}/api/health       → uptime y ciclos
 *   WS   ${API_BASE}/api/live         → push de cambios en vivo
 *
 * Auto-detect: si la página fue servida por el mismo origen que el backend,
 * usa el mismo origin. Caso contrario, lee window.__BS_CONFIG.apiBase o
 * localStorage 'bs:cfg:apiBase'. Si nada está definido y el host es localhost,
 * cae a http://localhost:8787.
 *
 * Estado:
 *   BSLive.state.events    → array de eventos con bestOdds calculados
 *   BSLive.state.surebets  → array de surebets activas
 *   BSLive.state.steam     → array de steam moves recientes
 *   BSLive.state.books     → objeto bookKey → { ok, lastError, lastOk }
 *   BSLive.state.connected → boolean (WS)
 *   BSLive.state.lastUpdate→ ms epoch del último update
 *
 * Eventos emitidos:
 *   'bs:live-snapshot'     detail: { events, surebets, steam, books }
 *   'bs:live-update'       detail: { events }
 *   'bs:live-surebet'      detail: { ...surebet }
 *   'bs:live-steam'        detail: { ...steamMove }
 *   'bs:live-status'       detail: { connected, lastUpdate, cycles }
 * ============================================================================
 */
(function (global) {
  'use strict';

  function detectApiBase() {
    try {
      if (global.__BS_CONFIG?.apiBase) return String(global.__BS_CONFIG.apiBase).replace(/\/+$/, '');
      const ls = localStorage.getItem('bs:cfg:apiBase');
      if (ls) return ls.replace(/\/+$/, '');
    } catch {}
    const o = global.location?.origin || '';
    if (/localhost|127\.0\.0\.1/.test(o)) return 'http://localhost:8787';
    return o; // single deploy: el backend sirve también el frontend
  }

  const API_BASE = detectApiBase();
  const WS_URL = (() => {
    const u = new URL(API_BASE + '/api/live');
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString();
  })();

  const state = {
    events: [],
    surebets: [],
    steam: [],
    books: {},
    connected: false,
    lastUpdate: 0,
    cycles: 0,
    error: null
  };

  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent('bs:live-' + name, { detail })); } catch {}
  }

  // ── REST ────────────────────────────────────────────────────────────────
  async function jget(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(API_BASE + path, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    } finally { clearTimeout(t); }
  }

  async function fetchSnapshot() {
    try {
      const snap = await jget('/api/snapshot');
      applySnapshot(snap);
      state.error = null;
      return snap;
    } catch (e) {
      state.error = e?.message || String(e);
      emit('status', { connected: state.connected, lastUpdate: state.lastUpdate, error: state.error });
      return null;
    }
  }

  function applySnapshot(snap) {
    if (Array.isArray(snap.events))    state.events   = snap.events;
    if (Array.isArray(snap.surebets))  state.surebets = snap.surebets;
    if (Array.isArray(snap.steam))     state.steam    = snap.steam;
    if (snap.bookStatus)               state.books    = snap.bookStatus;
    if (snap.health?.cycles)           state.cycles   = snap.health.cycles;
    state.lastUpdate = snap.ts || Date.now();
    emit('snapshot', { events: state.events, surebets: state.surebets, steam: state.steam, books: state.books });
    emit('status', { connected: state.connected, lastUpdate: state.lastUpdate, cycles: state.cycles });
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  let ws = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;

  function connectWs() {
    if (!('WebSocket' in global)) return;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => {
      state.connected = true;
      reconnectDelay = 1000;
      emit('status', { connected: true, lastUpdate: state.lastUpdate, cycles: state.cycles });
    });
    ws.addEventListener('message', (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg?.type) return;
      switch (msg.type) {
        case 'snapshot':
          applySnapshot(msg.data || {});
          break;
        case 'odds-update':
          if (Array.isArray(msg.data?.events)) state.events = msg.data.events;
          state.lastUpdate = msg.ts || Date.now();
          emit('update', { events: state.events });
          emit('status', { connected: true, lastUpdate: state.lastUpdate, cycles: state.cycles });
          break;
        case 'surebet':
          if (msg.data) {
            state.surebets = [msg.data].concat(state.surebets).slice(0, 200);
            emit('surebet', msg.data);
          }
          break;
        case 'steam':
          if (msg.data) {
            state.steam = [msg.data].concat(state.steam).slice(0, 200);
            emit('steam', msg.data);
          }
          break;
        case 'book-status':
          if (msg.data?.book) state.books[msg.data.book] = msg.data;
          emit('book-status', msg.data);
          break;
        case 'cycle':
          state.cycles = msg.data?.n || state.cycles;
          emit('status', { connected: true, lastUpdate: state.lastUpdate, cycles: state.cycles });
          break;
      }
    });
    ws.addEventListener('close', () => {
      state.connected = false;
      emit('status', { connected: false, lastUpdate: state.lastUpdate, cycles: state.cycles });
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch {}
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 1.6, 30000);
      connectWs();
    }, reconnectDelay);
  }

  // ── API pública ─────────────────────────────────────────────────────────

  /* Whitelist de ligas relevantes para nuestra audiencia AR.
   * Sin este filtro la UI se inunda con LMB mexicano, CIBACOPA, semipro
   * australiano, etc. — partidos irrelevantes para usuarios AR.
   * Para mostrar TODO el catálogo (debug / power user) → events({ all: true }). */
  const RELEVANT_LEAGUE_PATTERNS = [
    // Argentina + Sudamérica
    /argentin|primera|liga profes/i,
    /libertadores|sudamericana|recopa/i,
    /chile|paraguay|uruguay|colombia|peru|ecuador|bolivia|venezuela/i,
    /brasileir|brazil|copa do brasil/i,
    /copa america|copa mundial|world cup/i,
    // Top europeas
    /premier league|fa cup|championship|english/i,
    /la ?liga|spain|copa del rey/i,
    /serie a|coppa italia|italy/i,
    /bundesliga|germany/i,
    /ligue 1|france/i,
    /champions league|europa league|conference league/i,
    /eredivisie|netherlands|portugal|primeira liga/i,
    /turkey|super lig|belgium|jupiler/i,
    /eurocopa|euro\b/i,
    // USA majors
    /\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bmls\b/i,
    /college football|ncaa/i,
    // Otros relevantes
    /\batp\b|\bwta\b|grand slam|wimbledon|us open|australian open|french open/i,
    /\bufc\b|\bmma\b|boxing|boxeo|world boxing/i,
    /euroleague|eurocup|acb\b/i,
    /liga nacional/i,    // basket AR
    /mexico.*liga mx|mexico.*primera/i,   // sólo liga MX top tier
    // eSports — torneos top
    /\b(csgo|cs2|cs:go|counter-?strike|iem|esl|blast|epl|major)\b/i,
    /\b(league of legends|\blol\b|worlds|lec|lck|lcs|lpl|lla|lja)\b/i,
    /\b(dota|the international|dpc)\b/i,
    /\b(valorant|vct|vlr)\b/i,
    /\b(esports?|e-sports?)\b/i,
    /\b(efootball|fifa esports|king of glory)\b/i
  ];

  /* Patrones para detectar esports por NOMBRE de liga — usado para forzar
   * la categoría 'esports' incluso si el scraper la clasificó mal como 'other'
   * o 'soccer'. Sin esto, cuando user filtra Fútbol aparecen partidos como
   * "M80 vs Team Liquid · IEM Atlanta" porque IEM Atlanta tiene `sport=other`. */
  const ESPORTS_LEAGUE_PATTERNS = [
    /\b(esports?|e-sports?|gaming)\b/i,
    /\b(csgo|cs2|cs:go|counter-?strike)\b/i,
    /\b(league of legends|\blol\b|worlds|lec|lck|lcs|lpl|lla|lja)\b/i,
    /\b(dota ?2?|the international|dpc)\b/i,
    /\b(valorant|vct|vlr)\b/i,
    /\b(rocket league|rlcs)\b/i,
    /\b(efootball|e-football|e-fútbol|efutbol|ebasket|fifa esports)\b/i,
    /\b(overwatch|owl|ow2)\b/i,
    /\b(call of duty|\bcod\b|cdl)\b/i,
    /\b(starcraft|sc2)\b/i,
    /\b(rainbow six|r6)\b/i,
    /\b(king of glory|honor of kings)\b/i,
    /\b(iem|esl|blast|epl|major)\b/i
  ];

  function isRelevantLeague(leagueName) {
    if (!leagueName) return false;
    return RELEVANT_LEAGUE_PATTERNS.some(re => re.test(leagueName));
  }

  function looksLikeEsports(leagueName) {
    if (!leagueName) return false;
    return ESPORTS_LEAGUE_PATTERNS.some(re => re.test(leagueName));
  }

  /* Devuelve el sport "efectivo" — si la liga grita esports, devuelve 'esports'
   * sin importar lo que dijera el scraper. Garantiza que cuando user filtra
   * 'soccer', nunca aparecen partidos con liga estilo "IEM Atlanta". */
  function effectiveSport(ev) {
    if (ev.sport !== 'esports' && looksLikeEsports(ev.leagueName)) return 'esports';
    return ev.sport;
  }

  /** Devuelve los eventos cacheados, opcionalmente filtrados. NO genera nada
   *  sintético: si no hay datos del backend, devuelve [].
   *
   *  Por DEFAULT filtra ligas obscuras (LMB mexicano, semipro, etc.) para que
   *  la UI muestre solo partidos relevantes para usuarios AR. Pasar
   *  `{ all: true }` para bypass del filtro (debug / power user).
   *
   *  Filtro por sport es ESTRICTO: si user pide 'soccer' nunca devuelve
   *  eventos con liga estilo "IEM Atlanta" aunque el scraper haya clasificado
   *  mal el evento. */
  function events(filter = {}) {
    const { sport, league, leagues, all } = filter;
    const filterLeague = !all;
    return state.events.filter(ev => {
      const evSport = effectiveSport(ev);
      return (!sport || sport === 'all' || evSport === sport);
    }).filter(ev =>
      (!league || ev.league === league) &&
      (!Array.isArray(leagues) || leagues.includes(ev.league)) &&
      (!filterLeague || isRelevantLeague(ev.leagueName))
    );
  }

  /** Devuelve ABSOLUTAMENTE TODOS los eventos sin filtrar — para vistas
   *  debug, settings, o donde el power user quiera el catálogo crudo. */
  function eventsAll(filter = {}) {
    return events({ ...filter, all: true });
  }

  /** Busca un evento por id estable */
  function findEvent(id) { return state.events.find(e => e.id === id) || null; }

  function surebets(opts = {}) {
    let arr = state.surebets.slice();
    if (!opts.all) {
      // Filtrar surebets de ligas obscuras + dedup por evento+market (paranoia
      // extra por si el backend duplicó).
      const seen = new Set();
      arr = arr.filter(sb => {
        if (!isRelevantLeague(sb.leagueName || sb.league)) return false;
        const k = `${sb.eventId}|${sb.market}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return arr;
  }
  function steamMoves() { return state.steam.slice(); }
  function books() { return Object.assign({}, state.books); }

  /** True si tenemos al menos N eventos del backend, false si está vacío.
   *  La UI usa esto para mostrar empty states honestos. */
  function ready(minEvents = 1) {
    return state.events.length >= minEvents;
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────
  let started = false;
  function start() {
    if (started) return;
    started = true;
    fetchSnapshot();
    connectWs();
    // refresh REST de seguridad cada 60s por si el WS se cae sin que nos enteremos
    setInterval(() => {
      if (!state.connected) fetchSnapshot();
    }, 60000);
  }

  // Auto-start si esto se carga en una página
  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ── Helpers para la UI ─────────────────────────────────────────────────

  function timeSinceUpdate() {
    if (!state.lastUpdate) return null;
    return Date.now() - state.lastUpdate;
  }

  // ── API extendida para AI Picks / Generator / Arbitrage / Factors ──────
  async function getPicks(opts = {}) {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.sport && opts.sport !== 'all') q.set('sport', opts.sport);
    if (opts.league) q.set('league', opts.league);
    if (opts.minSharp) q.set('minSharp', String(opts.minSharp));
    if (opts.skipInjured) q.set('skipInjured', 'true');
    if (opts.skipBadWeather) q.set('skipBadWeather', 'true');
    return await jget('/api/picks?' + q.toString());
  }

  async function getPicksForMatch(matchId) {
    return await jget('/api/picks/' + encodeURIComponent(matchId));
  }

  async function getFactors(matchId) {
    return await jget('/api/factors/' + encodeURIComponent(matchId));
  }

  async function getArbitrageSnapshot(opts = {}) {
    const q = new URLSearchParams();
    if (opts.minRoi)         q.set('minRoi', String(opts.minRoi));
    if (opts.sport)          q.set('sport', opts.sport);
    if (opts.minConfidence)  q.set('minConfidence', String(opts.minConfidence));
    return await jget('/api/surebets?' + q.toString());
  }

  async function generate(opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);   // generator puede tardar 30-50s con LLM
    try {
      const res = await fetch(API_BASE + '/api/generator', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function checkCorrelation(legs) {
    const res = await fetch(API_BASE + '/api/correlation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  /* AI analysis del backend (Groq llama-3.3-70b-versatile).
   * Cada uno cachea 5min server-side para no quemar quota. */
  async function analyzeCombo(legs, stake) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(API_BASE + '/api/combo/analyze', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legs, stake })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function explainSurebet(key) {
    return await jget(`/api/surebet/${encodeURIComponent(key)}/explain`);
  }

  async function deepAnalysis(matchId) {
    return await jget(`/api/match/${encodeURIComponent(matchId)}/deep`);
  }

  function freshnessLabel() {
    const ms = timeSinceUpdate();
    if (ms == null) return 'cargando…';
    if (ms < 5000) return 'ahora';
    if (ms < 60000) return `hace ${Math.round(ms / 1000)}s`;
    return `hace ${Math.round(ms / 60000)} min`;
  }

  global.BSLive = {
    API_BASE, WS_URL,
    state,
    start,
    fetchSnapshot,
    events, eventsAll, findEvent, surebets, steamMoves, books, ready,
    isRelevantLeague,
    timeSinceUpdate, freshnessLabel,
    // API extendida
    getPicks, getPicksForMatch, getFactors,
    getArbitrageSnapshot,
    generate,
    checkCorrelation,
    analyzeCombo, explainSurebet, deepAnalysis
  };
})(window);
