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
  async function jget(path, opts = {}) {
    const ctrl = new AbortController();
    // Endpoints AI necesitan timeout largo (analizan N partidos con IA, 60-120s).
    // El resto sigue con 12s (snapshot, sources, etc).
    const isAiEndpoint = /\/api\/(picks|betsafe-ai|combo|daily-report|surebet\/.+\/explain|generator)/.test(path);
    const timeoutMs = opts.timeoutMs || (isAiEndpoint ? 120000 : 12000);
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
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
    const wasReady = state.events && state.events.length > 0;
    if (Array.isArray(snap.events))    state.events   = snap.events;
    if (Array.isArray(snap.surebets))  state.surebets = snap.surebets;
    if (Array.isArray(snap.steam))     state.steam    = snap.steam;
    if (snap.bookStatus)               state.books    = snap.bookStatus;
    if (snap.health?.cycles)           state.cycles   = snap.health.cycles;
    state.lastUpdate = snap.ts || Date.now();
    emit('snapshot', { events: state.events, surebets: state.surebets, steam: state.steam, books: state.books });
    emit('status', { connected: state.connected, lastUpdate: state.lastUpdate, cycles: state.cycles });
    // PRIMER snapshot listo → disparar bs:live-ready para el preloader inicial
    if (!wasReady && state.events && state.events.length > 0) {
      emit('ready', { events: state.events.length, lastUpdate: state.lastUpdate });
    }
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

  /* Whitelist STRICT — espejo del backend.
   * Argentina + Sudam + Top 5 europeas + UEFA + USA majors + Tenis Grand Slam
   * + MMA top + eSports top. Cualquier liga obscura (Egipto, Ucrania, Saudi,
   * Israel, A-League AUS, J-League, etc.) está BLOQUEADA explícitamente. */
  const RELEVANT_LEAGUE_PATTERNS = [
    /\b(liga profesional|primera nacional|primera division)\b/i,
    /\b(libertadores|sudamericana|recopa)\b/i,
    /\b(brasileir.o|copa do brasil|serie b.*brasil)\b/i,
    /\b(copa argentina|liga profesional argentina)\b/i,
    /\b(liga betplay|liga ?pro|liga ?1|categoria primera)\b/i,
    /\b(copa america|copa mundial|world cup|mundial 2026)\b/i,
    /\b(premier league|championship|fa cup|carabao cup|efl)\b/i,
    /\b(la ?liga|primera division|copa del rey)\b/i,
    /\b(serie a|serie b|coppa italia)\b/i,
    /\b(bundesliga|dfb pokal|dfb-pokal)\b/i,
    /\b(ligue 1|ligue 2|coupe de france)\b/i,
    /\b(primeira liga|liga portuguesa|primeira divisao)\b/i,
    /\b(eredivisie|netherlands|holanda)\b/i,
    /\b(champions league|uefa champions|europa league|uefa europa|conference league|uefa nations)\b/i,
    /\b(eurocopa|euro 2024|euro 2028|euro qualif|world cup qualif)\b/i,
    /\b(\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bmls\b|major league soccer)\b/i,
    /\b(\batp\b|\bwta\b|grand slam|wimbledon|us open|australian open|french open|roland garros)\b/i,
    /\b(\bufc\b|\bmma\b|\bpfl\b|bellator|world boxing|wba|wbc|wbo|ibf)\b/i,
    /\b(euroleague|eurocup)\b/i,
    /\b(liga nacional.*basket|argentina.*basket|liga nacional argentina)\b/i,
    /\b(mexico liga mx|liga mx\b|primera division.*mex)\b/i,
    /\b(csgo|cs2|cs:go|counter-?strike|iem|esl pro|blast premier|epl s\d|major)\b/i,
    /\b(league of legends|\blol\b|worlds|lec|lck|lcs|lpl|lla|lja|msi)\b/i,
    /\b(dota ?2?|the international|dpc)\b/i,
    /\b(valorant|vct|vlr)\b/i,
    /\b(esports?|e-sports?)\b/i,
    /\b(efootball pro|fifa esports|king of glory)\b/i
  ];

  const BLOCKED_LEAGUE_PATTERNS = [
    /\b(egipto|egypt|egyptian|egyptien)\b/i,
    /\b(ucrani[ao]|ukrain[eai])\b/i,
    /\b(arabia|saudi|saudi arabia|saudita)\b/i,
    /\b(israel|israel[ií]|israeli)\b/i,
    /\b(australia[no]?|a-league|aleague|a[-\s]?league)\b/i,
    /\b(canberra|canad[áa]|canadian|canadien|canadiense|cpl)\b/i,
    /\b(quebec)\b/i,
    /\b(japan|jap[óo]n|j-?league|j1|j2|j3)\b/i,
    /\b(china|chinese|csl|cba)\b/i,
    /\b(korea|south korea|coreano|coreana|k-?league)\b/i,
    /\b(india|indian|\bisl\b)\b/i,
    /\b(thailand|thai|\bt1\b)\b/i,
    /\b(iran|iranian|persian)\b/i,
    /\b(uae|emirate|qatar|qatari|kuwait|bahrain|oman|om[áa]n|omani)\b/i,
    /\b(africa cup|caf|tunisia|tunis|tunisian|tunecino|morocco|moroccan|algeria|algerian|nigeria|south africa|kenia|kenya|kenyan|ghana|ghanaian)\b/i,
    /\b(scandinav|finland|finnish|sweden|swedish|norway|norweg|denmark|danish|iceland|icelandic)\b/i,
    /\b(poland|polish|polski|czech|romanian|hungar|bulgar|serbia|serbian|croatia|croatian|slovak|bosnia|bosnian)\b/i,
    /\b(belarus|bielo|kazakh|moldov|georgia|georgian|armenian|azerb)\b/i,
    /\b(greece|greek|cyprus|cypriot|stoiximan|super league.*gre|turkey|turkish|super lig\b)\b/i,
    /\b(belgium|belgian|jupiler|swiss|switzerland|austria|austrian|bundesliga.*aut)\b/i,
    /\b(scotland|scottish|spfl|spl|premiership.*scot|cymru|welsh|northern ireland)\b/i,
    /\b(eire|ireland|irish|league of ireland)\b/i,
    /\b(reserve|reserves|youth|sub-?\d+|under-?\d+|primavera|u\d+|juvenil|cadete)\b/i,
    /\b(cibacopa|lnbp|mexicano basket)\b/i,
    /\b(lmb|liga mexicana de beisbol|mexican baseball)\b/i,
    // Teams específicos
    /\b(maccabi|hapoel|\bhapo[a-z]+\b)\b/i,
    /\b(zed|ghazl|ismaili|el gouna|al-?ahly|zamalek|al ?nasr|al ?nassr|al ?hilal)\b/i,
    /\b(dynamo kyiv|shakhtar|oleksandri[ya]|zoria|metalist|karpaty|kryvbas|polissya|veres|epicentr|kudrivka|rukh)\b/i,
    /\b(js omrane|avenir sportif|stade tunisien|bizertin|zarzis|gabes)\b/i,
    /\b(saham|oman fc|bahla|al-?nasr\b)\b/i,
    /\b(ulinzi|afc leopards)\b/i,
    /\b(csk[as] sofia|first professional league|bulgarian professional)\b/i,
    /\b(forge fc|supra|fc supra)\b/i
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
    /\b(iem|esl pro|blast premier|epl s\d+|major)\b/i,
    // Simulaciones esports tipo "NBA H2H GG League 4x5 minutes"
    /\b(gg league|h2h gg|battle league|battle esports)\b/i,
    /\bbattle\s*-\s*\w+\s*-\s*\d+\s*(minutos?|minutes?)/i,
    /\d+\s*x\s*\d+\s*(minutos?|minutes?)/i,
    /\b\d+\s*minutos?\s*(de juego|playing|match)\b/i
  ];

  const ESPORTS_TEAM_PATTERNS = [
    /\(esports?\)/i,
    /\((frenzy|fury|titanium|hyper|zion|tornado|cyber|lumix|dragon|phoenix|ninja|wolf|gladiator|champion|legend|elite|pro|master)\)/i
  ];

  function isRelevantLeague(leagueName) {
    if (!leagueName) return false;
    if (BLOCKED_LEAGUE_PATTERNS.some(re => re.test(leagueName))) return false;
    return RELEVANT_LEAGUE_PATTERNS.some(re => re.test(leagueName));
  }

  /* Prioridad de partido — 0..3 score. Sirve para ordenar eventos en la UI
   * mostrando primero los partidos con equipos/ligas más reconocidos.
   * Esto es lo que pidió el user: "que priorice los equipos más conocidos". */
  const TOP_TEAMS = /\b(boca|river|racing|independiente|san lorenzo|estudiantes|velez|talleres|argentinos|gimnasia|huracan|lanus|banfield|tigre|defensa|newells|rosario central|colon|union|godoy|barracas|liverpool|arsenal|manchester city|manchester united|chelsea|tottenham|newcastle|aston villa|west ham|real madrid|barcelona|atletico|sevilla|villarreal|valencia|athletic|real sociedad|betis|napoli|juventus|inter|milan|roma|lazio|atalanta|fiorentina|bayern|dortmund|leipzig|leverkusen|psg|marseille|monaco|lyon|nice|lille|porto|benfica|sporting|ajax|psv|feyenoord|flamengo|palmeiras|santos|sao paulo|corinthians|gremio|internacional|atletico mineiro|fluminense|botafogo|cruzeiro|vasco|liga de quito|barcelona sc|independiente del valle|peñaroll|nacional|olimpia|cerro porte|universidad catolica|colo|universidad de chile|alianza lima|universitario|sporting cristal|america de cali|junior|millonarios|santa fe|nacional med|club leon|america mex|monterrey|tigres|guadalajara|cruz azul|pumas|nfl|nba|mlb|nhl|nets|lakers|celtics|warriors|heat|nuggets|bucks|76ers|knicks|bulls|spurs|raptors|mavericks|suns|clippers|cowboys|patriots|eagles|chiefs|49ers|packers|steelers|yankees|dodgers|red sox|cubs|astros|rangers|atp|wta|federer|nadal|djokovic|alcaraz|sinner|medvedev|atletico mineiro|barcelona|chelsea|real betis)\b/i;

  function eventPriority(ev) {
    let p = 0;
    if (isRelevantLeague(ev.leagueName)) p += 1;
    const teams = `${ev.home?.name || ''} ${ev.away?.name || ''}`;
    if (TOP_TEAMS.test(teams)) p += 2;
    // Bonus si AMBOS equipos son top
    if (TOP_TEAMS.test(ev.home?.name || '') && TOP_TEAMS.test(ev.away?.name || '')) p += 1;
    return p;
  }

  function looksLikeEsports(ev) {
    if (typeof ev === 'string') return ESPORTS_LEAGUE_PATTERNS.some(re => re.test(ev));
    if (!ev) return false;
    if (ev.leagueName && ESPORTS_LEAGUE_PATTERNS.some(re => re.test(ev.leagueName))) return true;
    const teamsBlob = `${ev.home?.name || ''} ${ev.away?.name || ''}`;
    if (ESPORTS_TEAM_PATTERNS.some(re => re.test(teamsBlob))) return true;
    return false;
  }

  /* Devuelve el sport "efectivo" — si la liga o los nombres de equipo gritan
   * esports, devuelve 'esports' sin importar lo que dijera el scraper.
   * Cubre simulaciones como "NBA H2H GG League 4x5 minutes" o equipos con
   * sufijo "(Esports)" / "(FRENZY)" (player handles). */
  function effectiveSport(ev) {
    if (ev.sport !== 'esports' && looksLikeEsports(ev)) return 'esports';
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
    const { sport, league, leagues, all, sortByPriority = true, includePast = false } = filter;
    const filterLeague = !all;
    // CRITICAL: filtrar eventos pasados (Bayern vs PSG May 6 cuando hoy es May 13).
    // Default: solo futuros + en vivo (hasta 2h post kickoff).
    const now = Date.now();
    const pastThreshold = now - 2 * 60 * 60 * 1000;
    const out = state.events.filter(ev => {
      if (!includePast && Number.isFinite(ev.start) && ev.start < pastThreshold) return false;
      const evSport = effectiveSport(ev);
      return (!sport || sport === 'all' || evSport === sport);
    }).filter(ev =>
      (!league || ev.league === league) &&
      (!Array.isArray(leagues) || leagues.includes(ev.league)) &&
      (!filterLeague || isRelevantLeague(ev.leagueName))
    );
    if (sortByPriority) {
      // Prioridad: partidos con equipos top primero, después por proximidad de start.
      // Es lo que pidió el user: "priorice mediante IA los equipos más conocidos".
      out.sort((a, b) => {
        const pdiff = eventPriority(b) - eventPriority(a);
        if (pdiff !== 0) return pdiff;
        return (a.start || Infinity) - (b.start || Infinity);
      });
    }
    return out;
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

  /* AI-curated combos: 2-5 legs cada uno, la IA decide cuántos.
   * Reemplaza el modelo viejo de "un pick por partido".
   * Path: /api/curated-combos (NO /api/picks/curated porque chocaba con
   * /api/picks/:matchId que toma "curated" como matchId). */
  async function getCuratedCombos(opts = {}) {
    const q = new URLSearchParams();
    if (opts.sport && opts.sport !== 'all') q.set('sport', opts.sport);
    if (opts.count) q.set('count', String(opts.count));
    if (opts.includeEsports) q.set('includeEsports', 'true');
    return await jget('/api/curated-combos?' + q.toString());
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
    isRelevantLeague, eventPriority, looksLikeEsports, effectiveSport,
    timeSinceUpdate, freshnessLabel,
    // API extendida
    getPicks, getPicksForMatch, getCuratedCombos, getFactors,
    getArbitrageSnapshot,
    generate,
    checkCorrelation,
    analyzeCombo, explainSurebet, deepAnalysis
  };
})(window);
