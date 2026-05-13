#!/usr/bin/env node
/* BetSafe — Backend de scraping en vivo
 * ============================================================================
 * Servicio Node.js que:
 *   1) Scrapea las 12 casas de apuestas argentinas legales (LOTBA / IPLyC)
 *      cada N segundos (default 30s, configurable por ENV).
 *   2) Expone los datos via:
 *        - REST:  GET /api/odds/:sport
 *                 GET /api/odds/match/:id
 *                 GET /api/surebets
 *                 GET /api/health
 *                 GET /api/books         (estado por casa)
 *        - WebSocket: ws://host/api/live  (push en tiempo real cuando hay cambios)
 *   3) Detecta surebets cruzando las casas en cada tick.
 *   4) Detecta steam moves (movimientos sharp >5% en <1h) comparando snapshots.
 *
 * Por qué 30s y no 1s:
 *   - Los mercados se mueven en 5-30s, no en 1s. Pedir cada segundo es bandera
 *     roja para anti-bot (Cloudflare, DataDome) y termina en ban de IP.
 *   - Cada casa publica overhead que tarda 1-3s en cargar — el ciclo realista
 *     es 15-30s, y eso ya es agresivo. Lo configuré en SCRAPE_INTERVAL_MS.
 *   - Cuando hay cambios entre snapshots, los pushea al frontend via WebSocket
 *     en milisegundos — el usuario los ve "casi en vivo".
 *
 * Estructura:
 *   /scrapers/<bookKey>.js  → módulo con función scrape(sport) → events[]
 *   /lib/index.js           → utilidades (browser pool, parser, normalize)
 *   /server.js              → orquestador, HTTP, WebSocket
 *
 * Deploy:
 *   - Render Web Service Node 20
 *   - Comando build:   npm install && npm run install-browsers
 *   - Comando start:   npm start
 *   - Variables ENV opcionales: PORT, SCRAPE_INTERVAL_MS, ENABLED_BOOKS,
 *     ODDS_API_KEY (suplemento), CORS_ORIGIN.
 * ============================================================================
 */
'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const { browserPool, sleep, normalizeTeam, log } = require('./lib');
const pLimit = require('p-limit').default;
const orchestrator = require('./lib/orchestrator');
const { ArbitrageEngine } = require('./engines/arbitrage');
const { analyzeMatch, groqJsonGeneric } = require('./engines/ai-pipeline');
const { analyzeCombo, pairCorrelation } = require('./engines/correlation');
const { buildFactors } = require('./factors');

const PORT                  = Number(process.env.PORT || 8787);
const SCRAPE_INTERVAL_MS    = Number(process.env.SCRAPE_INTERVAL_MS || 30000);
const ARB_INTERVAL_MS       = Number(process.env.ARB_INTERVAL_MS || 5000);
const ENABLED_BOOKS         = (process.env.ENABLED_BOOKS || 'bplay,betano,betwarrior,bet365ar,codere,betsson').split(',').map(s=>s.trim()).filter(Boolean);
const CORS_ORIGIN           = process.env.CORS_ORIGIN || '*';
const PUBLIC_DIR            = path.resolve(__dirname, '..');

// Motor de arbitraje dedicado: corre cada ARB_INTERVAL_MS (5s) sobre el
// snapshot en memoria. Mucho más rápido que el ciclo de scraping (30s).
const arbEngine = new ArbitrageEngine({
  getEvents: () => orchestrator.events({ sport: 'all' }),
  getBookStatus: () => orchestrator.bookStatus(),
  emit: (type, data) => broadcast(type, data),
  interval: ARB_INTERVAL_MS,
  minRoi: 0.001,
  maxAgeMs: 120000
});

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Security headers básicos
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ── Rate limiting básico (in-memory) — protege /api/betsafe-ai/build y
// /api/combo/analyze que disparan calls LLM costosos. Por IP, 30 req/min.
const rateLimitBuckets = new Map();
function rateLimit(req, res, next) {
  // Solo aplicar a endpoints AI
  if (!/\/api\/(betsafe-ai|combo\/analyze|surebet\/.+\/explain|daily-report)/.test(req.path)) {
    return next();
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60000;
  }
  bucket.count++;
  rateLimitBuckets.set(ip, bucket);
  if (bucket.count > 30) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Demasiadas solicitudes — esperá un momento.' });
  }
  // Cleanup: si el map supera 1000 IPs, purgar los expirados
  if (rateLimitBuckets.size > 1000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (now > v.resetAt + 60000) rateLimitBuckets.delete(k);
    }
  }
  next();
}
app.use(rateLimit);

// Servir el frontend estático en raíz (single deploy).
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file) {
    if (file.endsWith('.html'))      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    else if (file.match(/\.(css|js)$/)) res.setHeader('Cache-Control', 'public, max-age=3600');
    else if (file.match(/\.(svg|png|jpg|jpeg|gif|webp|woff2?)$/)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// ── API ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    state: orchestrator.health(),
    interval: SCRAPE_INTERVAL_MS,
    enabledBooks: ENABLED_BOOKS,
    ts: Date.now()
  });
});

app.get('/api/books', (req, res) => res.json(orchestrator.bookStatus()));
app.get('/api/sources', (req, res) => res.json(orchestrator.sourceStatus()));
app.get('/api/quota', (req, res) => res.json(orchestrator.quota()));
// Estado de los circuit breakers de cada scraper (CLOSED/OPEN/HALF_OPEN +
// fail counts). Útil para debug cuando Cloudflare empieza a banear.
app.get('/api/breakers', (req, res) => res.json(orchestrator.breakers ? orchestrator.breakers() : {}));

// Reset manual de breakers. Si está seteado DEBUG_KEY hay que pasar ?key=
// para evitar que cualquiera resetee desde la internet pública.
//   POST /api/breakers/reset                       → resetea todos
//   POST /api/breakers/reset?name=scraper:betano   → solo ese scraper (incluye sub-breakers)
//   POST /api/breakers/reset?name=scraper:betano:playwright → solo ese sub-breaker
app.post('/api/breakers/reset', (req, res) => {
  if (process.env.DEBUG_KEY && req.query.key !== process.env.DEBUG_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const name = req.query.name ? String(req.query.name) : null;
  const reset = orchestrator.resetBreakers ? orchestrator.resetBreakers(name) : [];
  res.json({ reset, count: reset.length });
});

// Force-refresh: limpia el cache de un scraper para que el próximo ciclo
// haga un scrape fresco (ignorando el TTL). Útil antes de un partido grande
// cuando querés cuotas FRESCAS ya, sin esperar al TTL de 8 minutos.
//   POST /api/sources/refresh                     → todos los scrapers
//   POST /api/sources/refresh?name=scraper:betano → solo betano
app.post('/api/sources/refresh', (req, res) => {
  if (process.env.DEBUG_KEY && req.query.key !== process.env.DEBUG_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const name = req.query.name ? String(req.query.name) : null;
  const cleared = orchestrator.clearScraperCache ? orchestrator.clearScraperCache(name) : [];
  res.json({ cleared, count: cleared.length });
});

// Estado de uso de ScrapingBee: créditos consumidos + restantes, por scraper.
// El campo `lastUsage` viene del endpoint /usage de scrapingbee (cacheado 5min).
// El campo `stats` es local del proceso (resetea al redeploy).
//   GET /api/sbee/usage              → estado cacheado
//   GET /api/sbee/usage?refresh=1    → fuerza re-check contra scrapingbee
app.get('/api/sbee/usage', async (req, res) => {
  const { getScrapingBeeUsage, scrapingBeeStats } = require('./lib');
  const usage = await getScrapingBeeUsage(req.query.refresh === '1');
  if (!usage && !process.env.SCRAPINGBEE_KEY) {
    return res.status(404).json({ error: 'SCRAPINGBEE_KEY no configurada' });
  }
  const out = {
    usage,
    remaining: usage ? Math.max(0, (usage.max_api_credit || 0) - (usage.used_api_credit || 0)) : null,
    pctRemaining: usage?.max_api_credit
      ? Number(((usage.max_api_credit - (usage.used_api_credit || 0)) / usage.max_api_credit * 100).toFixed(1))
      : null,
    processStats: {
      callsTotal: scrapingBeeStats.callsTotal,
      callsFailed: scrapingBeeStats.callsFailed,
      creditsUsedSinceBoot: scrapingBeeStats.totalCreditsUsed,
      callsByPath: scrapingBeeStats.callsByPath,
      creditsByPath: scrapingBeeStats.creditsByPath
    }
  };
  res.json(out);
});

// Brier score tracker: snapshot del estado de calibración del ensemble.
const brierTracker = require('./engines/brier-tracker');
app.get('/api/brier', (req, res) => {
  try { res.json(brierTracker.snapshot()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Registrar el outcome real de un evento finalizado. Permite calibrar el
// ensemble del AI pipeline con histórico de aciertos. Requiere DEBUG_KEY
// para evitar pollución de data desde clientes públicos.
app.post('/api/results', express.json(), (req, res) => {
  if (process.env.DEBUG_KEY && req.query.key !== process.env.DEBUG_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { eventId, market, outcome } = req.body || {};
  if (!eventId || !market || !outcome) {
    return res.status(400).json({ error: 'eventId, market y outcome son requeridos' });
  }
  brierTracker.recordOutcome(eventId, market, outcome);
  res.json({ ok: true });
});

// Listar deportes presentes en el snapshot actual (útil para popular filtros UI).
app.get('/api/sports', (req, res) => {
  const events = orchestrator.events({ sport: 'all' });
  const counts = {};
  for (const ev of events) {
    if (!ev.sport) continue;
    counts[ev.sport] = (counts[ev.sport] || 0) + 1;
  }
  res.json({
    sports: Object.entries(counts).map(([key, count]) => ({ key, count }))
                 .sort((a, b) => b.count - a.count),
    total: events.length, ts: Date.now()
  });
});

// Listar ligas presentes en el snapshot actual.
app.get('/api/leagues', (req, res) => {
  const events = orchestrator.events({ sport: req.query.sport || 'all' });
  const map = new Map();
  for (const ev of events) {
    const key = ev.league || ev.leagueName || null;
    if (!key) continue;
    const entry = map.get(key) || { league: ev.league, leagueName: ev.leagueName, sport: ev.sport, count: 0 };
    entry.count++;
    map.set(key, entry);
  }
  res.json({
    leagues: [...map.values()].sort((a, b) => b.count - a.count),
    total: events.length, ts: Date.now()
  });
});

// Metrics estilo Prometheus-lite (text/plain) para monitoring básico.
app.get('/api/metrics', (req, res) => {
  const snap = orchestrator.health ? orchestrator.health() : null;
  const events = orchestrator.events({ sport: 'all' });
  const arbSnap = arbEngine.snapshot();
  const lines = [
    `# HELP betsafe_events_total Eventos en snapshot`,
    `# TYPE betsafe_events_total gauge`,
    `betsafe_events_total ${events.length}`,
    `# HELP betsafe_surebets_active Surebets activas`,
    `# TYPE betsafe_surebets_active gauge`,
    `betsafe_surebets_active ${arbSnap.activeSurebets || 0}`,
    `# HELP betsafe_cycles_total Ciclos de scraping ejecutados`,
    `# TYPE betsafe_cycles_total counter`,
    `betsafe_cycles_total ${snap?.cycles || 0}`,
    `# HELP betsafe_arb_cycles_total Ciclos de arbitraje`,
    `# TYPE betsafe_arb_cycles_total counter`,
    `betsafe_arb_cycles_total ${arbSnap.cycles || 0}`,
    `# HELP betsafe_last_cycle_ms Duración del último ciclo de scraping`,
    `# TYPE betsafe_last_cycle_ms gauge`,
    `betsafe_last_cycle_ms ${snap?.lastCycleMs || 0}`
  ];
  res.type('text/plain').send(lines.join('\n') + '\n');
});

// Cross-validation: discrepancias entre fuentes (admin/debug)
// El parámetro level filtra: 'critical' (>=5%) o 'warning' (2-5%).
app.get('/api/discrepancies', (req, res) => {
  res.json(orchestrator.discrepancies({
    level: req.query.level,
    limit: Number(req.query.limit) || 100
  }));
});

// DEBUG: corre un scraper específico y devuelve TODOS los XHRs que capturó
// con preview del body. Sirve para inspeccionar sin abrir DevTools manualmente.
// Uso: GET /api/debug/scraper/bplay?url=https://www.bplay.com.ar/apuestas-deportivas

/* GET /api/debug/scrape-now/:name — Ejecuta un scraper EN VIVO y devuelve
 * trace completo. Útil para diagnosticar por qué un scraper devuelve 0 events.
 * Sin ?url= (a diferencia del debug/scraper que usa Playwright). */
app.get('/api/debug/scrape-now/:name', async (req, res) => {
  const name = req.params.name;
  try {
    let scraper;
    try { scraper = require('./scrapers/' + name); } catch (e) {
      return res.status(404).json({ error: 'scraper no encontrado: ' + name });
    }
    const t0 = Date.now();
    // Limpiar cache si existe
    if (typeof scraper.clearCache === 'function') scraper.clearCache();
    const events = await scraper({ sports: ['soccer', 'basketball', 'tennis'] });
    const dur = Date.now() - t0;
    res.json({
      name,
      dur,
      eventCount: Array.isArray(events) ? events.length : 0,
      sample: Array.isArray(events) ? events.slice(0, 3).map(e => ({
        home: e.home?.name,
        away: e.away?.name,
        sport: e.sport,
        league: e.leagueName,
        marketsKeys: Object.keys(e.markets || {}),
        booksInH2h: e.markets?.h2h ? Object.keys(e.markets.h2h) : []
      })) : [],
      breakers: scraper.breaker ? { [name]: { state: scraper.breaker.state, fails: scraper.breaker.fails } }
              : scraper.breakers ? Object.fromEntries(Object.entries(scraper.breakers).map(([k, b]) => [k, { state: b.state, fails: b.fails }]))
              : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 3) });
  }
});

app.get('/api/debug/scraper/:bookKey', async (req, res) => {
  // Protección básica: requiere ?key=<DEBUG_KEY> si está configurada
  if (process.env.DEBUG_KEY && req.query.key !== process.env.DEBUG_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const { deepCapture } = require('./scrapers/_deepCapture');
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'falta ?url=...' });
    const t0 = Date.now();
    const result = await deepCapture({
      url,
      bookKey: req.params.bookKey,
      navTimeoutMs: 35000,
      scrollPasses: 3,
      settleMs: 2500
    });
    res.json({
      dur: Date.now() - t0,
      detected: result.events.length,
      stats: result.stats,
      // Lista de XHR URLs + bodyKeys (los TOP-level keys del JSON response)
      // ESTO ES LO MÁS ÚTIL: mostrá qué endpoints respondieron con qué estructura
      captures: result.captures,
      sample: result.events.slice(0, 3)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/odds', (req, res) => {
  const sport = String(req.query.sport || 'all');
  const league = req.query.league ? String(req.query.league) : null;
  res.json(orchestrator.events({ sport, league }));
});

app.get('/api/odds/:sport', (req, res) => {
  res.json(orchestrator.events({ sport: req.params.sport }));
});

app.get('/api/odds/match/:id', (req, res) => {
  const ev = orchestrator.findEvent(req.params.id);
  if (!ev) return res.status(404).json({ error: 'not-found' });
  res.json(ev);
});

// Surebets: combina las del orchestrator (3-way h2h básico) con las del
// motor avanzado (cross-market, AH, totals, BTTS, todo enriquecido).
app.get('/api/surebets', (req, res) => {
  const minRoi = Number(req.query.minRoi || 0) / 100;
  const sport = req.query.sport;
  const minConf = Number(req.query.minConfidence || 0);
  const advanced = arbEngine.snapshot().detected;
  const filtered = advanced
    .filter(sb => sb.netRoi >= minRoi)
    .filter(sb => !sport || sb.sport === sport)
    .filter(sb => sb.confidence >= minConf);
  res.json({
    surebets: filtered,
    meta: {
      cycles: arbEngine.cycles,
      lastCycleMs: arbEngine.lastCycleMs,
      active: arbEngine.activeIds.size,
      interval: arbEngine.interval
    }
  });
});

app.get('/api/arbitrage/snapshot', (req, res) => res.json(arbEngine.snapshot()));

app.get('/api/steam', (req, res) => {
  // Filtrar steam moves de esports/sims/leagues bloqueadas — el smart money
  // que mostramos al usuario debe ser REAL (no esports nor sims TT/KOK).
  const all = orchestrator.steamMoves() || [];
  const events = orchestrator.events() || [];
  const eventMap = new Map(events.map(e => [e.id, e]));
  const filtered = all.filter(s => {
    const ev = eventMap.get(s.eventId);
    if (!ev) return false;
    // Re-usar la lógica de orchestrator para esports detection
    const sport = (typeof orchestrator.effectiveSport === 'function') ? orchestrator.effectiveSport(ev) : ev.sport;
    if (sport === 'esports') return false;
    // Filtros adicionales por liga/nombre (sims TT/KOK)
    const lg = String(ev.leagueName || '').toLowerCase();
    if (/\b(tt-cup|setka cup|gg league|kok|hapoel|maccabi|israel|lavanga|liga pro)\b/.test(lg)) return false;
    return true;
  });
  res.json(filtered);
});

// ── AI Pipeline endpoints ──────────────────────────────────────────────────

// Hyper-detailed picks para UN partido (con todos los factores)
app.get('/api/picks/:matchId', async (req, res) => {
  const ev = orchestrator.findEvent(req.params.matchId);
  if (!ev) return res.status(404).json({ error: 'event-not-found' });
  try {
    const result = await analyzeMatch(ev, {
      steamMoves: orchestrator.steamMoves(),
      surebets: arbEngine.snapshot().detected
    });
    res.json(result || { error: 'no-analysis' });
  } catch (e) {
    res.status(500).json({ error: 'pipeline-error', detail: e?.message });
  }
});

// Factors aggregator (sin LLM, solo data)
app.get('/api/factors/:matchId', async (req, res) => {
  const ev = orchestrator.findEvent(req.params.matchId);
  if (!ev) return res.status(404).json({ error: 'event-not-found' });
  try {
    const factors = await buildFactors(ev, {
      steamMoves: orchestrator.steamMoves(),
      surebets: arbEngine.snapshot().detected
    });
    res.json(factors || {});
  } catch (e) {
    res.status(500).json({ error: 'factors-error', detail: e?.message });
  }
});

// Batch picks: top N partidos con análisis IA (para el AI Picks tab)
app.get('/api/picks', async (req, res) => {
  // Default 6 picks (era 8) — más rápido + el LRU cache pre-calienta para
  // siguientes requests. Max 12.
  const limit = Math.min(12, Number(req.query.limit) || 6);
  const sport = req.query.sport;
  const league = req.query.league;
  const minSharp = Number(req.query.minSharp || 0);
  const skipInjured = req.query.skipInjured === 'true';
  const skipBadWeather = req.query.skipBadWeather === 'true';
  const includeEsports = req.query.includeEsports === 'true' || sport === 'esports';

  // orchestrator.events() ya ordena por priority (top teams primero).
  // No re-ordenamos por start time porque los partidos esports simulados son
  // cada 4 minutos y dominaban el feed con basura tipo "NBA H2H GG League".
  let events = orchestrator.events({ sport: sport || 'all', league })
    .filter(e => e.bestOdds?.h2h);

  // FILTRO POR DEFAULT: eSports excluidos a menos que se pidan explícitamente.
  // Sin esto, las simulaciones eFootball/eBasket (que arrancan cada 4 minutos)
  // copan los picks y nunca se ven partidos reales.
  if (!includeEsports) {
    events = events.filter(e => e.sport !== 'esports' && !orchestrator.looksLikeEsports?.(e));
  }

  // Pedimos solo `limit + 2` para filtrar margen mínimo. Antes era `limit * 2`
  // que analizaba 16 partidos para mostrar 8 — tardaba 80s+ y el cliente
  // abortaba a los 12s. Con cache de 5min por partido, las siguientes requests
  // son instantáneas.
  events = events.slice(0, Math.min(limit + 2, 10));

  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;

  // ── Análisis concurrente con cap + retry loop ──
  // Objetivo: TODOS los picks pasan por IA. Si un partido cae a llmProvider:'offline'
  // (rate limit Groq, network blip, timeout), lo reintentamos en una segunda
  // pasada con un poco de delay para que el rate-limit window se mueva.
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 2));

  async function analyzePool(evs) {
    const settled = await Promise.allSettled(
      evs.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
    );
    return settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);
  }

  let out = await analyzePool(events);
  // RETRY: cualquier pick que quedó offline → reintentar (Groq se recupera rápido)
  const offlineEvents = out
    .filter(p => p.llmProvider === 'offline')
    .map(p => p.event.id ? events.find(e => e.id === p.event.id) : null)
    .filter(Boolean);
  if (offlineEvents.length > 0 && offlineEvents.length < events.length) {
    // Pequeño delay para que el rate-limit window se mueva
    await new Promise(r => setTimeout(r, 1500));
    // Limpiar cache de offline para forzar nuevo intento
    if (typeof analyzeMatch.clearCacheOffline === 'function') {
      offlineEvents.forEach(ev => analyzeMatch.clearCacheOffline(ev.id));
    }
    const retried = await analyzePool(offlineEvents);
    // Mergear: los retried reemplazan los offline si ahora tienen llmProvider real
    const retriedMap = new Map(retried.map(r => [r.event.id, r]));
    out = out.map(p => {
      const r = retriedMap.get(p.event.id);
      if (r && r.llmProvider !== 'offline' && p.llmProvider === 'offline') return r;
      return p;
    });
  }

  // Aplicar filtros
  let filtered = out.filter(pick => {
    if (minSharp > 0 && (pick.factors?.sharp?.score || 0) < minSharp) return false;
    if (skipInjured && (pick.factors?.injuries?.severityScore?.home > 0.5 || pick.factors?.injuries?.severityScore?.away > 0.5)) return false;
    if (skipBadWeather && pick.factors?.weather?.impact?.goalsMultiplier && pick.factors.weather.impact.goalsMultiplier < 0.90) return false;
    return true;
  });

  // ── REGLA DE ORO: solo devolvemos picks con IA real. Sin fallback genérico ──
  // Si un pick no pasó por IA (offline tras retry), NO lo mostramos al usuario.
  // Mejor mostrar 3 picks con IA real que 6 con la mitad genéricos.
  const aiVerified = filtered.filter(p => p.llmProvider && p.llmProvider !== 'offline');
  const aiCount = aiVerified.length;
  const offlineCount = filtered.length - aiCount;

  res.json({
    picks: aiVerified.slice(0, limit),
    meta: {
      analyzed: out.length,
      filtered: filtered.length,
      aiVerified: aiCount,
      aiPending: offlineCount,
      // Si tiramos picks offline, avisamos al cliente:
      hint: offlineCount > 0 ? `${offlineCount} análisis IA aún procesando — refrescá en unos segundos para verlos.` : null
    }
  });
});

// Generador IA: misma pipeline pero con knobs (riesgo, ligas, mercados, n combinadas)
app.post('/api/generator', express.json(), async (req, res) => {
  const {
    sport = 'all', leagues = [], risk = 'eq', legs = 3, count = 3,
    minSharp = 0, skipInjured = false, skipBadWeather = false,
    skipCorrelated = true, markets = ['h2h', 'totals', 'btts', 'dc'],
    books = []
  } = req.body || {};

  let events = orchestrator.events({ sport: sport === 'all' ? 'all' : sport })
    .filter(e => e.bestOdds?.h2h);
  if (leagues.length && !leagues.includes('all')) {
    events = events.filter(e => leagues.includes(e.league));
  }
  const wantedBooks = Array.isArray(books) ? books.filter(Boolean) : [];

  // Excluir esports a menos que se pidan explícitamente — sin esto las
  // simulaciones NBA H2H GG League dominan el pool del Generator.
  const includeEsports = req.body?.includeEsports === true || sport === 'esports';
  if (!includeEsports) {
    events = events.filter(e => e.sport !== 'esports' && !orchestrator.looksLikeEsports?.(e));
  }

  // Top 20 partidos por priority + overround (libros más eficientes).
  // Reducido de 35 → 20 para que /api/generator complete en <90s incluso si
  // la primera tanda tiene fails y necesita retry.
  events.sort((a, b) => {
    const pdiff = (orchestrator.eventPriority?.(b) || 0) - (orchestrator.eventPriority?.(a) || 0);
    if (pdiff !== 0) return pdiff;
    return (a.overround || 99) - (b.overround || 99);
  });
  events = events.slice(0, 20);

  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;

  // Analizar con concurrencia + retry de offline (igual que /api/picks).
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 2));
  async function analyzeGenPool(evs) {
    const settled = await Promise.allSettled(
      evs.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
    );
    return settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);
  }
  let analyzed = await analyzeGenPool(events);
  // Retry los offline UNA vez
  const offlineEvs = analyzed
    .filter(a => a.llmProvider === 'offline')
    .map(a => events.find(e => e.id === a.event?.id))
    .filter(Boolean);
  if (offlineEvs.length > 0 && offlineEvs.length < events.length) {
    await new Promise(r => setTimeout(r, 1500));
    if (typeof analyzeMatch.clearCacheOffline === 'function') {
      offlineEvs.forEach(ev => analyzeMatch.clearCacheOffline(ev.id));
    }
    const retried = await analyzeGenPool(offlineEvs);
    const rmap = new Map(retried.map(r => [r.event.id, r]));
    analyzed = analyzed.map(a => {
      const r = rmap.get(a.event?.id);
      return r && r.llmProvider !== 'offline' && a.llmProvider === 'offline' ? r : a;
    });
  }
  // FILTRO IA: solo eventos con análisis IA real entran al pool del generator.
  analyzed = analyzed.filter(a => a.llmProvider && a.llmProvider !== 'offline');

  // Filtros
  const passing = analyzed.filter(a => {
    if (minSharp > 0 && (a.factors?.sharp?.score || 0) < minSharp) return false;
    if (skipInjured && (a.factors?.injuries?.severityScore?.home > 0.5 || a.factors?.injuries?.severityScore?.away > 0.5)) return false;
    if (skipBadWeather && a.factors?.weather?.impact?.goalsMultiplier && a.factors.weather.impact.goalsMultiplier < 0.88) return false;
    return true;
  });

  // ── Pool universal: TODAS las selections válidas, no solo una por evento ──
  // Permite multi-leg por partido + diversificación entre deportes/ligas.
  const pool = [];
  for (const a of passing) {
    const evSelections = (a.selections || [])
      .filter(s => markets.includes(s.market))
      .filter(s => !wantedBooks.length || wantedBooks.includes(s.book));
    for (const sel of evSelections) {
      pool.push({
        event: a.event,
        factors: a.factors,
        sel,
        score: (sel.consensusEv || 0) + (sel.confidence || 0) * 5    // ranking compuesto
      });
    }
  }
  pool.sort((a, b) => b.score - a.score);

  // ── Estrategia de construcción de combos ──
  // legsPerMatch: cuántos legs del mismo partido se permiten (1 = clásico, 2-3 = multi-leg)
  // targetOdd: objetivo de cuota total (null = libre)
  // mixSports: si true, busca diversidad de deporte
  // useAiBuilder: si true Y hay LLM disponible, pide a Groq que elija los combos
  const legsPerMatch = Math.max(1, Math.min(3, Number(req.body?.legsPerMatch) || 1));
  const targetOdd = Number(req.body?.targetOdd) || null;
  const mixSports = req.body?.mixSports !== false;
  // useAiBuilder default TRUE — user pidió "TODO ANALISIS IA". Solo false si explícitamente lo apaga.
  const useAiBuilder = req.body?.useAiBuilder !== false;

  function buildOneCombo(targetType, excludeSigs, comboIdx = 0) {
    // Filtrar por tipo si lo pidieron (cons/eq/agg). Si no hay del tipo,
    // RELAJAMOS — mejor devolver un combo que ninguno.
    let candidates = pool.filter(p => p.sel.type === targetType);
    if (candidates.length < legs) candidates = pool;

    // ROTACIÓN: para combo 0 → top picks, combo 1 → picks 2-5, combo 2 → picks 4-7
    // Esto evita que las 3 combos llamadas seguidas devuelvan exactamente las mismas legs.
    if (comboIdx > 0 && candidates.length > legs + comboIdx) {
      // Rotar el array para empezar desde el siguiente "tier"
      const skip = Math.min(comboIdx * 2, candidates.length - legs);
      candidates = [...candidates.slice(skip), ...candidates.slice(0, skip)];
    }

    const chosen = [];
    const usedByEvent = new Map();   // eventId → count
    const usedSports = new Set();
    for (const p of candidates) {
      const evId = p.event.id;
      const cur = usedByEvent.get(evId) || 0;
      if (cur >= legsPerMatch) continue;
      // Si pedimos mix sports y ya tenemos un leg del mismo deporte, lo
      // intentamos pero priorizando diversidad
      if (mixSports && usedSports.has(p.event.sport) && chosen.length < legs && candidates.some(c => !usedSports.has(c.event.sport))) {
        continue;   // saltamos este; lo procesaremos en segunda pasada
      }
      chosen.push(p);
      usedByEvent.set(evId, cur + 1);
      usedSports.add(p.event.sport);
      if (chosen.length >= legs) break;
    }
    // Segunda pasada: si quedaron slots vacíos y NO conseguimos diversidad,
    // los llenamos con lo mejor disponible (sin importar deporte).
    if (chosen.length < legs) {
      for (const p of candidates) {
        if (chosen.some(c => c.sel === p.sel)) continue;
        const evId = p.event.id;
        const cur = usedByEvent.get(evId) || 0;
        if (cur >= legsPerMatch) continue;
        chosen.push(p);
        usedByEvent.set(evId, cur + 1);
        if (chosen.length >= legs) break;
      }
    }
    if (chosen.length === 0) return null;

    // Si pedimos targetOdd, reordenamos: priorizar legs con cuotas que nos
    // acerquen al target acumulando producto, no tomando los top EV puros.
    if (targetOdd && chosen.length === legs) {
      let prod = chosen.reduce((a, c) => a * c.sel.odd, 1);
      // Si la cuota total quedó muy lejos del target, intentamos ajustar
      // swapping un leg por uno con cuota más alta/baja.
      const tolerance = 0.3;   // ±30%
      if (prod < targetOdd * (1 - tolerance) || prod > targetOdd * (1 + tolerance)) {
        const ratio = targetOdd / prod;
        // Buscar un swap que acerque el producto al target
        for (let i = 0; i < chosen.length; i++) {
          const want = chosen[i].sel.odd * ratio;
          const replacement = candidates.find(c =>
            !chosen.some(ch => ch.sel === c.sel) &&
            Math.abs(c.sel.odd - want) < want * 0.4
          );
          if (replacement) {
            chosen[i] = replacement;
            prod = chosen.reduce((a, c) => a * c.sel.odd, 1);
            if (Math.abs(prod - targetOdd) / targetOdd < tolerance) break;
          }
        }
      }
    }

    const comboLegs = chosen.map(p => ({
      eventId: p.event.id,
      home: p.event.home?.name, away: p.event.away?.name,
      sport: p.event.sport, league: p.event.leagueName,
      market: p.sel.market, outcome: p.sel.outcome, line: p.sel.line,
      label: p.sel.label, odd: p.sel.odd, book: p.sel.book,
      confidence: p.sel.confidence, ev: p.sel.consensusEv,
      rationale: p.sel.rationale, tacticalNotes: p.sel.tacticalNotes,
      factors: p.sel.factors
    }));

    const corr = analyzeCombo(comboLegs);
    // Cuando el user pidió multi-leg-per-match, lo aceptamos sabiendo que la
    // correlación va a saltar — es by design. Solo descartamos correlación
    // si era 1-leg-per-match (donde sí, dos legs del mismo evento sería bug).
    const skipCorrCheck = legsPerMatch > 1;
    if (skipCorrelated && !skipCorrCheck && !corr.ok && corr.warnings?.length) {
      // Intentar reemplazar leg correlacionada con la siguiente mejor opción
      const corrIdx = corr.warnings[0]?.i ?? 0;
      const replacement = pool.find(p =>
        !chosen.some(c => c.sel === p.sel) &&
        !comboLegs.some(l => l.eventId === p.event.id)
      );
      if (replacement) {
        comboLegs[corrIdx] = {
          eventId: replacement.event.id,
          home: replacement.event.home?.name, away: replacement.event.away?.name,
          sport: replacement.event.sport, league: replacement.event.leagueName,
          market: replacement.sel.market, outcome: replacement.sel.outcome,
          line: replacement.sel.line, label: replacement.sel.label,
          odd: replacement.sel.odd, book: replacement.sel.book,
          confidence: replacement.sel.confidence, ev: replacement.sel.consensusEv,
          rationale: replacement.sel.rationale, tacticalNotes: replacement.sel.tacticalNotes
        };
      }
    }

    const totalOdd = comboLegs.reduce((a, b) => a * b.odd, 1);
    const sig = comboLegs.map(l => `${l.eventId}:${l.market}:${l.outcome}:${l.line || ''}`).sort().join('|');
    if (excludeSigs.has(sig)) return null;
    excludeSigs.add(sig);

    return {
      legs: comboLegs,
      totalOdd: Number(totalOdd.toFixed(2)),
      avgConfidence: Number((comboLegs.reduce((a, b) => a + (b.confidence || 0), 0) / comboLegs.length).toFixed(3)),
      sumEv: Number(comboLegs.reduce((a, b) => a + (b.ev || 0), 0).toFixed(2)),
      correlation: analyzeCombo(comboLegs),
      type: targetType,
      legCount: comboLegs.length,
      sportsCount: new Set(comboLegs.map(l => l.sport)).size
    };
  }

  const combos = [];
  const seenSigs = new Set();
  // Generar `count` combos: alternamos targetType (risk + tipo opuesto) para variedad
  const typeOrder = [risk, risk === 'cons' ? 'eq' : risk === 'eq' ? 'agg' : 'eq', 'eq'];
  for (let i = 0; i < count * 3 && combos.length < count; i++) {
    const t = typeOrder[i % typeOrder.length];
    const combo = buildOneCombo(t, seenSigs, combos.length);
    if (combo) combos.push(combo);
  }

  // Si activaron useAiBuilder Y tenemos LLM, pedimos a Groq que ELIJA los
  // mejores combos del pool con justificación profunda — no solo EV ranking.
  let aiNarrative = null;
  if (useAiBuilder && pool.length >= legs && process.env.BS_GROQ_API_KEY) {
    try {
      const topPool = pool.slice(0, Math.min(30, pool.length));
      const aiPrompt = `Tenés ${topPool.length} picks candidatos de partidos de hoy. El user quiere ${count} combinada(s) de ${legs} legs cada una.
Riesgo: ${risk}. Mezclar deportes: ${mixSports}. Legs por partido máx: ${legsPerMatch}.
${targetOdd ? `Cuota total objetivo: ~${targetOdd.toFixed(2)}` : ''}

Tu tarea: analizar profundamente y ELEGIR las ${count} mejores combinaciones, justificando POR QUÉ esas legs se complementan (no solo EV puro — considerá: historial H2H, lesiones, importancia de la liga, ritmo del partido, correlación negativa, momento sharp).

Pool de picks (con factores resumidos):
${topPool.map((p, i) => `[${i}] ${p.event.home?.name} vs ${p.event.away?.name} | ${p.event.sport} | ${p.event.leagueName || '?'}
  Pick: ${p.sel.label || p.sel.outcome} @ ${p.sel.odd?.toFixed(2)} (${p.sel.book})
  EV: ${(p.sel.consensusEv || 0).toFixed(2)}% · Confidence: ${((p.sel.confidence || 0) * 100).toFixed(0)}%
  Rationale: ${p.sel.rationale?.slice(0, 120) || ''}`
      ).join('\n')}

JSON estricto:
{
  "combos": [
    {
      "legIndices": [<indices del pool>],
      "narrative": "<2-3 frases: por qué estas legs específicas forman una combinada sólida>",
      "edge": "<una frase: el edge estructural que ves>"
    }
  ],
  "globalInsight": "<1-2 frases: qué tienen en común las combinadas elegidas>"
}`;

      const systemPrompt = 'Sos un analista cuantitativo SENIOR construyendo combinadas óptimas. Pensás en correlación, edge estructural, momentum, no solo EV puro. JSON estricto.';
      const aiResult = await groqJsonGeneric(systemPrompt, aiPrompt, { maxTokens: 2000, temperature: 0.4 });
      if (aiResult?.combos) {
        // Reemplazar combos basados en EV con los del LLM
        const aiCombos = [];
        for (const ac of aiResult.combos) {
          if (!Array.isArray(ac.legIndices)) continue;
          const sel = ac.legIndices.map(i => topPool[i]).filter(Boolean);
          if (sel.length < 2) continue;
          const legs = sel.map(p => ({
            eventId: p.event.id, home: p.event.home?.name, away: p.event.away?.name,
            sport: p.event.sport, league: p.event.leagueName,
            market: p.sel.market, outcome: p.sel.outcome, line: p.sel.line,
            label: p.sel.label, odd: p.sel.odd, book: p.sel.book,
            confidence: p.sel.confidence, ev: p.sel.consensusEv,
            rationale: p.sel.rationale, tacticalNotes: p.sel.tacticalNotes
          }));
          const totalOdd = legs.reduce((a, b) => a * b.odd, 1);
          aiCombos.push({
            legs, totalOdd: Number(totalOdd.toFixed(2)),
            avgConfidence: Number((legs.reduce((a, b) => a + (b.confidence || 0), 0) / legs.length).toFixed(3)),
            sumEv: Number(legs.reduce((a, b) => a + (b.ev || 0), 0).toFixed(2)),
            correlation: analyzeCombo(legs),
            type: risk,
            legCount: legs.length,
            sportsCount: new Set(legs.map(l => l.sport)).size,
            aiNarrative: String(ac.narrative || '').slice(0, 400),
            aiEdge: String(ac.edge || '').slice(0, 200)
          });
        }
        if (aiCombos.length) {
          combos.length = 0;
          combos.push(...aiCombos.slice(0, count));
        }
        aiNarrative = aiResult.globalInsight ? String(aiResult.globalInsight).slice(0, 400) : null;
      }
    } catch (e) {
      log(`[generator:ai] ${e?.message?.slice(0, 120)}`);
    }
  }

  res.json({
    combos: combos.slice(0, count),
    aiNarrative,
    meta: {
      analyzed: analyzed.length,
      passing: passing.length,
      poolSize: pool.length,
      filtersApplied: { minSharp, skipInjured, skipBadWeather, skipCorrelated, legsPerMatch, mixSports, useAiBuilder, targetOdd }
    }
  });
});

// Correlation check público
app.post('/api/correlation', express.json(), (req, res) => {
  const legs = req.body?.legs || [];
  res.json(analyzeCombo(legs));
});

/* ────────────────────────────────────────────────────────────────────
 * AI ANALYSIS ENDPOINTS — Groq llama-3.3-70b-versatile
 * Cada endpoint pasa por el mismo cliente Groq que /api/picks.
 * Cache LRU 5min para no quemar quota con el mismo input.
 * ──────────────────────────────────────────────────────────────────── */
const { LRUCache } = require('lru-cache');
const aiCache = new LRUCache({ max: 500, ttl: 5 * 60 * 1000 });
function aiCacheKey(prefix, payload) {
  const crypto = require('crypto');
  return prefix + ':' + crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/* POST /api/combo/analyze — Analiza una combinada armada por el user.
 * Body: { legs: [{ matchId, label, odd, book, market, outcome }], stake?: number }
 * Returns: { riskAssessment, correlationWarnings, suggestion, narrative, probWin } */
app.post('/api/combo/analyze', express.json(), async (req, res) => {
  const legs = (req.body?.legs || []).filter(l => l && l.label && Number.isFinite(l.odd));
  if (legs.length < 2) return res.status(400).json({ error: 'Necesitamos al menos 2 legs para analizar una combinada' });
  const stake = Math.max(0, Number(req.body?.stake) || 1000);

  // Enriquecer cada leg con datos del evento real si está en el snapshot
  const enriched = legs.map(l => {
    const ev = l.matchId ? orchestrator.findEvent(l.matchId) : null;
    return {
      label: l.label, odd: l.odd, book: l.book, market: l.market, outcome: l.outcome,
      home: ev?.home?.name || l.home, away: ev?.away?.name || l.away,
      league: ev?.leagueName, sport: ev?.sport, start: ev?.start
    };
  });

  const cacheKey = aiCacheKey('combo', enriched);
  if (aiCache.has(cacheKey)) return res.json(aiCache.get(cacheKey));

  const totalOdd = legs.reduce((a, l) => a * l.odd, 1);
  const naiveProbWin = 1 / totalOdd;
  const potentialPayout = Math.round(totalOdd * stake);

  const systemPrompt = `Sos un analista cuantitativo SENIOR de apuestas deportivas argentino.
Te van a pasar una combinada que armó el usuario (legs + cuotas + stake).
Tu rol:
1) Identificar legs RIESGOSAS (cuota muy alta = baja probabilidad, lesiones probables, weather).
2) Detectar correlación entre legs (mismo evento, mismo equipo, mismos factores).
3) Estimar probabilidad REAL de que la combinada gane (no la implícita ingenua).
4) Sugerir ajuste: qué leg cambiar / quitar / qué riesgo asumir.

JSON estricto:
{
  "riskAssessment": "low" | "mid" | "high" | "extreme",
  "probWinPct": 0..100,                    // tu mejor estimación calibrada
  "correlationWarnings": ["<motivo específico>", ...],
  "weakestLeg": { "index": número, "reason": "<por qué es la más débil>" },
  "strongestLeg": { "index": número, "reason": "<por qué es sólida>" },
  "suggestion": "<2-3 frases concretas: qué cambiarías, qué stake sugerís>",
  "narrative": "<1 párrafo 80-120 palabras: lectura general de la combinada>"
}`;

  const userPrompt = `Combinada del usuario:
Stake: ARS ${stake}
Cuota total: ${totalOdd.toFixed(2)}
Payout potencial: ARS ${potentialPayout}
Prob implícita (sin ajuste): ${(naiveProbWin * 100).toFixed(1)}%

Legs:
${enriched.map((l, i) => `  ${i+1}. [${l.sport || '?'} / ${l.league || '?'}] ${l.home || '?'} vs ${l.away || '?'}\n     Pick: ${l.label} @ ${l.odd} (casa: ${l.book || '?'}, mercado: ${l.market || '?'})`).join('\n')}`;

  try {
    const result = await groqJsonGeneric(systemPrompt, userPrompt, { maxTokens: 1500, temperature: 0.3 });
    if (!result) throw new Error('groq returned null');
    const sanitized = {
      riskAssessment: ['low','mid','high','extreme'].includes(result.riskAssessment) ? result.riskAssessment : 'mid',
      probWinPct: Math.max(0, Math.min(100, Number(result.probWinPct) || naiveProbWin * 100)),
      correlationWarnings: Array.isArray(result.correlationWarnings) ? result.correlationWarnings.slice(0, 5).map(s => String(s).slice(0, 200)) : [],
      weakestLeg: result.weakestLeg && typeof result.weakestLeg === 'object' ? {
        index: Number.isFinite(Number(result.weakestLeg.index)) ? Number(result.weakestLeg.index) : null,
        reason: String(result.weakestLeg.reason || '').slice(0, 250)
      } : null,
      strongestLeg: result.strongestLeg && typeof result.strongestLeg === 'object' ? {
        index: Number.isFinite(Number(result.strongestLeg.index)) ? Number(result.strongestLeg.index) : null,
        reason: String(result.strongestLeg.reason || '').slice(0, 250)
      } : null,
      suggestion: String(result.suggestion || '').slice(0, 500),
      narrative: String(result.narrative || '').slice(0, 800),
      totalOdd: Number(totalOdd.toFixed(2)),
      naiveProbWinPct: Number((naiveProbWin * 100).toFixed(2)),
      potentialPayout,
      provider: 'groq'
    };
    aiCache.set(cacheKey, sanitized);
    res.json(sanitized);
  } catch (e) {
    log(`[ai:combo] err ${e?.message?.slice(0, 100)}`);
    res.json({
      riskAssessment: totalOdd < 3 ? 'low' : totalOdd < 8 ? 'mid' : totalOdd < 20 ? 'high' : 'extreme',
      probWinPct: Number((naiveProbWin * 100).toFixed(2)),
      correlationWarnings: [],
      weakestLeg: null, strongestLeg: null,
      suggestion: 'IA temporalmente no disponible — el riesgo se estima por cuota total únicamente.',
      narrative: 'Análisis IA caído. Probá de nuevo en unos segundos.',
      totalOdd: Number(totalOdd.toFixed(2)),
      naiveProbWinPct: Number((naiveProbWin * 100).toFixed(2)),
      potentialPayout,
      provider: 'offline'
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POST /api/betsafe-ai/build — FLAGSHIP VIP feature.
 *
 * Toma un prompt en lenguaje natural del user ("haceme una combinada de 4
 * partidos de mañana de la Premier, cuota 5.5+, dentro de todo segura") e:
 *   1) Parsea la query con LLM → filtros estructurados (legs, league, sport,
 *      risk, targetOdd, time window, etc).
 *   2) Encuentra eventos REALES del orchestrator que matcheen.
 *   3) Calcula el pick óptimo por evento (analyzeMatch).
 *   4) Selecciona la mejor combinación que cumpla ALL los requisitos.
 *   5) Enriquece cada leg con logo del equipo, mejor casa, cuota real.
 *   6) Devuelve narrative + legs + totalOdd + bestBook + warnings.
 * ═══════════════════════════════════════════════════════════════════════════ */
app.post('/api/betsafe-ai/build', express.json(), async (req, res) => {
  const prompt = String(req.body?.prompt || '').slice(0, 1000).trim();
  if (!prompt) return res.status(400).json({ error: 'Necesitamos un prompt — escribí qué combinada querés' });
  if (prompt.length < 10) return res.status(400).json({ error: 'Prompt muy corto — explicanos qué combinada querés con un poco más de detalle' });

  // 1) Parse con LLM: extraer filtros estructurados
  const parserSystem = `Sos un asistente que extrae filtros estructurados de un pedido de combinada de apuestas.
Devolvés JSON estricto con este shape:
{
  "legs": número de 2 a 8 (cuántos partidos quiere combinar),
  "sport": "soccer" | "basketball" | "tennis" | "esports" | "amfootball" | "all",
  "leagues": ["premier-league" | "la-liga" | "serie-a" | "bundesliga" | "ligue-1" | "ucl" | "uel" | "lpf" | "libertadores" | "sudamericana" | "brasileirao" | "liga-mx" | "mls" | "nba" | "ufc" | ...],
  "risk": "cons" (seguro) | "eq" (equilibrado) | "agg" (agresivo),
  "targetOdd": número o null (cuota total deseada),
  "minOddPerLeg": número o null,
  "maxOddPerLeg": número o null,
  "timeWindow": "today" | "tomorrow" | "weekend" | "week" | "any",
  "preferTopTeams": true|false,
  "userIntent": "<frase corta resumiendo qué quiere>"
}
Si el usuario no menciona algo, usá defaults razonables.`;

  let parsed = null;
  try {
    parsed = await groqJsonGeneric(parserSystem, prompt, { maxTokens: 600, temperature: 0.2 });
  } catch (e) {
    log(`[betsafe-ai] parse err: ${e?.message?.slice(0, 100)}`);
  }
  // Defaults si el parse falla
  const filters = {
    legs: clamp(Number(parsed?.legs) || 4, 2, 8),
    sport: typeof parsed?.sport === 'string' ? parsed.sport : 'all',
    leagues: Array.isArray(parsed?.leagues) ? parsed.leagues.map(String) : [],
    risk: ['cons', 'eq', 'agg'].includes(parsed?.risk) ? parsed.risk : 'eq',
    targetOdd: Number.isFinite(Number(parsed?.targetOdd)) ? Number(parsed.targetOdd) : null,
    minOddPerLeg: Number.isFinite(Number(parsed?.minOddPerLeg)) ? Number(parsed.minOddPerLeg) : null,
    maxOddPerLeg: Number.isFinite(Number(parsed?.maxOddPerLeg)) ? Number(parsed.maxOddPerLeg) : null,
    timeWindow: ['today','tomorrow','weekend','week','any'].includes(parsed?.timeWindow) ? parsed.timeWindow : 'any',
    preferTopTeams: parsed?.preferTopTeams !== false,
    userIntent: String(parsed?.userIntent || prompt).slice(0, 250)
  };

  // ── REGEX FALLBACK: si el LLM no extrajo leagues, hacemos detection manual
  // por keywords en el prompt. Esto es CRÍTICO porque a veces el parser falla
  // y el resultado son partidos random.
  if (!filters.leagues.length) {
    const p = prompt.toLowerCase();
    const KW = {
      'premier-league': /(premier\s*league|premier(?:\s+inglesa)?|epl)/i,
      'la-liga':        /(la\s*liga|laliga|primera\s*divisi[óo]n\s*esp|liga\s*espa[ñn]ola)/i,
      'serie-a':        /(serie\s*a|seriea|italia(?:no)?\s*serie)/i,
      'bundesliga':     /(bundesliga|alemana)/i,
      'ligue-1':        /(ligue\s*[1u]|ligue1|francesa)/i,
      'ucl':            /(champions(?:\s*league)?|ucl|uefa\s*champions)/i,
      'uel':            /(europa\s*league|uel)/i,
      'libertadores':   /(libertadores|copa\s*libertadores)/i,
      'sudamericana':   /(sudamericana|copa\s*sudamericana)/i,
      'lpf':            /(liga\s*profesional|lpf|liga\s*argentina|primera\s*argentina)/i,
      'copa-argentina': /(copa\s*argentina)/i,
      'brasileirao':    /(brasileir[ãa]o|brasil(?:e[ñn]o)?)/i,
      'liga-mx':        /(liga\s*mx|liga\s*mexicana)/i,
      'mls':            /(\bmls\b|major\s*league\s*soccer)/i,
      'nba':            /(\bnba\b|baloncesto\s*nba)/i,
      'ufc':            /(\bufc\b|mma)/i
    };
    for (const [key, re] of Object.entries(KW)) {
      if (re.test(p)) filters.leagues.push(key);
    }
  }
  // Misma idea para deporte si no se detectó
  if (filters.sport === 'all') {
    const p = prompt.toLowerCase();
    if (/futbol|fútbol|soccer|partid|premier|liga/i.test(p)) filters.sport = 'soccer';
    else if (/básq|basket|nba/i.test(p)) filters.sport = 'basketball';
    else if (/tenis|tennis|atp|wta/i.test(p)) filters.sport = 'tennis';
    else if (/esports|cs:?go|valorant|dota|lol/i.test(p)) filters.sport = 'esports';
  }

  // 2) Buscar eventos REALES del orchestrator que matcheen
  const now = Date.now();
  const timeRange = {
    today:    [now, now + 24*3600*1000],
    tomorrow: [now + 16*3600*1000, now + 48*3600*1000],
    weekend:  [now, now + 5*24*3600*1000],
    week:     [now, now + 8*24*3600*1000],
    any:      [now, now + 14*24*3600*1000]
  }[filters.timeWindow];
  let candidates = orchestrator.events({ sport: filters.sport === 'all' ? 'all' : filters.sport });
  // Filtro de tiempo
  candidates = candidates.filter(e => Number.isFinite(e.start) && e.start >= timeRange[0] && e.start <= timeRange[1]);
  // Filtro de liga (matching flexible: nombre, slug, alias)
  if (filters.leagues.length) {
    const leagueRegex = new RegExp(filters.leagues.map(l => l.replace(/-/g, '[\\s-]?')).join('|'), 'i');
    candidates = candidates.filter(e => leagueRegex.test(e.leagueName || '') || filters.leagues.includes(e.league));
  }
  // Filtro: top teams (si el user pide "no tan riesgosa" implícitamente quiere top teams)
  if (filters.preferTopTeams && filters.risk === 'cons') {
    candidates.sort((a, b) => (orchestrator.eventPriority?.(b) || 0) - (orchestrator.eventPriority?.(a) || 0));
  }
  if (!candidates.length) {
    return res.json({
      ok: false,
      reason: 'no-events',
      message: 'No encontramos partidos que cumplan tus filtros en la ventana de tiempo pedida. Probá ampliar las ligas o el periodo.',
      filters
    });
  }

  // 3) Analizar los top candidates con la pipeline.
  // TOP_N: pool de eventos a analizar antes de seleccionar las legs finales.
  // Más alto = más opciones pero más tiempo. legs=4 → analizamos ~max(8, legs*2) = 8.
  // legs=8 → analizamos 16. Cap a 14 para no exceder 30s total.
  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;
  const TOP_N = Math.min(14, Math.max(8, filters.legs * 2), candidates.length);
  const top = candidates.slice(0, TOP_N);
  const analyzeLimit = pLimit(2);
  const analyzed = await Promise.allSettled(
    top.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
  );
  const pool = [];
  for (const r of analyzed) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const a = r.value;
    // Elegir el pick acorde al risk pedido
    const wantType = filters.risk;
    const sel = (a.selections || []).find(s => s.type === wantType) ||
                a.selections?.[0];
    if (!sel || !sel.odd) continue;
    // Validar minOdd/maxOdd por leg
    if (filters.minOddPerLeg && sel.odd < filters.minOddPerLeg) continue;
    if (filters.maxOddPerLeg && sel.odd > filters.maxOddPerLeg) continue;
    pool.push({ event: a.event, factors: a.factors, sel, llmKey: a.llmKeyFactor, llmSynth: a.llmSynthesis });
  }

  if (pool.length < filters.legs) {
    return res.json({
      ok: false,
      reason: 'insufficient-pool',
      message: `Pediste ${filters.legs} legs pero solo encontramos ${pool.length} picks que cumplan los criterios. Probá bajar el número de legs o relajar el riesgo.`,
      filters, foundPicks: pool.length
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4) SMART LEG SELECTION — algoritmo multi-criterio
  // ══════════════════════════════════════════════════════════════════════════
  // Cada leg se rankea por SCORE compuesto:
  //   score = EV * 1.0 + confidence * 25 + (top_team ? 8 : 0) + (in_league_filter ? 10 : 0)
  // Si hay targetOdd: optimization de Pareto buscando combo más cercana,
  // priorizando combos con mayor score promedio.
  function legScore(p) {
    const ev = p.sel.consensusEv || 0;
    const conf = p.sel.confidence || 0;
    const isTop = orchestrator.eventPriority?.(p.event) >= 2 ? 1 : 0;
    const hasLeague = filters.leagues.length === 0 || filters.leagues.some(lg =>
      (p.event.leagueName || '').toLowerCase().includes(lg.replace(/-/g, ' ')) ||
      p.event.league === lg
    ) ? 1 : 0;
    return ev + conf * 25 + isTop * 8 + hasLeague * 10;
  }
  const sortedPool = pool.slice().sort((a, b) => legScore(b) - legScore(a));
  let chosen = sortedPool.slice(0, filters.legs);

  if (filters.targetOdd) {
    // ── Optimization híbrida: greedy + random sampling para targetOdd ──
    const N = pool.length;
    let bestCombo = chosen;
    let bestComboTotal = chosen.reduce((a, c) => a * c.sel.odd, 1);
    let bestScore = -Infinity;

    function evalCombo(combo) {
      const total = combo.reduce((a, c) => a * c.sel.odd, 1);
      const diff = Math.abs(total - filters.targetOdd);
      const avgScore = combo.reduce((a, c) => a + legScore(c), 0) / combo.length;
      // Función objetivo: minimizar diff de cuota target, maximizar avgScore.
      // El peso de diff es alto cuando estamos lejos del target.
      const fit = -diff * 2 + avgScore;
      return { total, diff, fit };
    }

    // 1) Greedy: empezar con top-scored y reemplazar 1 leg a la vez si mejora.
    let cur = chosen.slice();
    for (let iter = 0; iter < 20; iter++) {
      const { fit } = evalCombo(cur);
      let improved = false;
      // Intentar reemplazar cada leg actual con cada candidato del pool
      for (let i = 0; i < cur.length; i++) {
        for (let j = 0; j < N; j++) {
          if (cur.includes(pool[j])) continue;
          const newCur = cur.slice();
          newCur[i] = pool[j];
          const r = evalCombo(newCur);
          if (r.fit > fit + 0.01) {
            cur = newCur;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (!improved) break;
    }
    const greedyResult = evalCombo(cur);
    if (greedyResult.fit > bestScore) {
      bestScore = greedyResult.fit;
      bestCombo = cur;
      bestComboTotal = greedyResult.total;
    }

    // 2) Random sampling: 80 intentos rápidos buscando mejor fit
    for (let i = 0; i < 80; i++) {
      const sample = [];
      const used = new Set();
      while (sample.length < filters.legs && used.size < N) {
        const idx = Math.floor(Math.random() * N);
        if (used.has(idx)) continue;
        used.add(idx);
        sample.push(pool[idx]);
      }
      if (sample.length !== filters.legs) continue;
      const r = evalCombo(sample);
      if (r.fit > bestScore) {
        bestScore = r.fit;
        bestCombo = sample;
        bestComboTotal = r.total;
      }
    }
    chosen = bestCombo;
  }
  // Evitar 2 legs del mismo partido (correlación inválida)
  const seenEvents = new Set();
  chosen = chosen.filter(c => {
    if (seenEvents.has(c.event.id)) return false;
    seenEvents.add(c.event.id);
    return true;
  });
  // Si quedaron menos por dedup, completar con sortedPool
  if (chosen.length < filters.legs) {
    for (const p of sortedPool) {
      if (chosen.includes(p)) continue;
      if (seenEvents.has(p.event.id)) continue;
      chosen.push(p);
      seenEvents.add(p.event.id);
      if (chosen.length >= filters.legs) break;
    }
  }

  // 5) Enriquecer cada leg con info del evento + cuota real por casa
  const enrichedLegs = chosen.map(c => {
    const ev = orchestrator.findEvent(c.event.id);
    return {
      eventId: c.event.id,
      home: { id: ev?.home?.id, name: ev?.home?.name || c.event.home?.name },
      away: { id: ev?.away?.id, name: ev?.away?.name || c.event.away?.name },
      start: ev?.start || c.event.start,
      sport: ev?.sport || c.event.sport,
      league: ev?.league || c.event.league,
      leagueName: ev?.leagueName || c.event.leagueName,
      market: c.sel.market,
      outcome: c.sel.outcome,
      line: c.sel.line || null,
      label: c.sel.label,
      odd: c.sel.odd,
      book: c.sel.book,
      bookAlternatives: getBookAlternatives(ev, c.sel),
      confidence: c.sel.confidence,
      ev: c.sel.consensusEv,
      rationale: c.sel.rationale,
      llmKeyFactor: c.llmKey
    };
  });

  const totalOdd = enrichedLegs.reduce((a, l) => a * l.odd, 1);

  // 6) Pedir al LLM una narrative final de POR QUÉ esta combinada cumple lo pedido
  const narrativeSystem = `Sos un analista que justifica una combinada al usuario en lenguaje natural.
Escribí un párrafo de 80-120 palabras, en castellano argentino, sin jerga técnica.
JSON estricto: { "narrative": "<párrafo>", "headline": "<una frase atractiva>" }`;
  const narrativePrompt = `El usuario pidió: "${filters.userIntent}"
Le construí esta combinada de ${enrichedLegs.length} partidos con cuota total ${totalOdd.toFixed(2)}:
${enrichedLegs.map((l, i) => `${i+1}. ${l.home.name} vs ${l.away.name} | ${l.leagueName} | ${l.label} @ ${l.odd}`).join('\n')}
Explicá brevemente POR QUÉ esta combinada cumple lo pedido + qué tiene de interesante.`;
  let narrative = null;
  try {
    narrative = await groqJsonGeneric(narrativeSystem, narrativePrompt, { maxTokens: 500, temperature: 0.5 });
  } catch (e) {
    log(`[betsafe-ai] narrative err: ${e?.message?.slice(0, 80)}`);
  }

  res.json({
    ok: true,
    filters,
    legs: enrichedLegs,
    totalOdd: Number(totalOdd.toFixed(2)),
    headline: narrative?.headline || `Combinada de ${enrichedLegs.length} partidos a cuota ${totalOdd.toFixed(2)}`,
    narrative: narrative?.narrative || `Armé esta combinada de ${enrichedLegs.length} partidos basándome en tu pedido. Cada leg fue seleccionada por su edge sobre la casa y consistencia con el resto.`,
    avgConfidence: Number((enrichedLegs.reduce((a, l) => a + (l.confidence || 0), 0) / enrichedLegs.length).toFixed(3))
  });
});

/* Helper: para una selection {market, outcome}, devuelve ranking de las
 * casas argentinas con mejor cuota para ESE outcome específico. */
function getBookAlternatives(ev, sel) {
  if (!ev?.markets?.[sel.market]) return [];
  const market = ev.markets[sel.market];
  const alternatives = [];
  for (const [bookKey, bookOdds] of Object.entries(market)) {
    if (bookKey.endsWith('Book') || bookKey === 'line') continue;
    let odd = null;
    if (sel.line && bookOdds[sel.line]) {
      odd = bookOdds[sel.line][sel.outcome];
    } else if (bookOdds[sel.outcome]) {
      odd = bookOdds[sel.outcome];
    }
    if (Number.isFinite(odd) && odd > 1.01) {
      alternatives.push({ book: bookKey, odd: Number(odd.toFixed(3)) });
    }
  }
  alternatives.sort((a, b) => b.odd - a.odd);
  return alternatives.slice(0, 5);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/daily-report — Reporte ejecutivo del día (VIP feature).
 *
 * Resumen accionable de TODO lo que está pasando AHORA:
 *  - Top 5 picks del día por EV
 *  - Surebets activas (con ROI y casas)
 *  - Movimientos sharp recientes (top 5 por delta%)
 *  - Lesiones críticas (severityScore > 0.4)
 *  - Resumen narrativo IA: qué partido mirar, qué riesgo asumir hoy
 *
 * Cache: 10min (regenera cada 10min para mantener fresco sin quemar LLM).
 * ═══════════════════════════════════════════════════════════════════════════ */
const dailyReportCache = { ts: 0, data: null };
app.get('/api/daily-report', async (req, res) => {
  const now = Date.now();
  if (dailyReportCache.data && now - dailyReportCache.ts < 10 * 60_000) {
    return res.json(dailyReportCache.data);
  }

  try {
    // 1) Top 5 picks por EV
    const events = orchestrator.events();
    const steam = orchestrator.steamMoves();
    const surebets = arbEngine.snapshot().detected || [];
    const top10 = events.slice(0, 10);
    const analyzeLimit = pLimit(2);
    const analyzed = await Promise.allSettled(
      top10.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
    );
    const allPicks = [];
    for (const r of analyzed) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const sel = r.value.selections?.find(s => s.type === 'eq');
      if (sel && sel.odd) {
        allPicks.push({
          home: r.value.event.home?.name,
          away: r.value.event.away?.name,
          league: r.value.event.leagueName,
          sport: r.value.event.sport,
          start: r.value.event.start,
          pick: sel.label || sel.outcome,
          odd: sel.odd,
          book: sel.book,
          ev: sel.consensusEv,
          confidence: sel.confidence,
          keyFactor: r.value.llmKeyFactor
        });
      }
    }
    allPicks.sort((a, b) => (b.ev || 0) - (a.ev || 0));
    const topPicks = allPicks.slice(0, 5);

    // 2) Surebets (top 5 por ROI)
    const topSurebets = surebets.slice(0, 5).map(s => ({
      event: s.event,
      books: s.books,
      roi: s.roi,
      market: s.market,
      key: s.key
    }));

    // 3) Movimientos sharp top 5 (filtrados de esports/sims)
    const eventMap = new Map(events.map(e => [e.id, e]));
    const cleanSteam = steam
      .filter(s => {
        const ev = eventMap.get(s.eventId);
        if (!ev) return false;
        const sport = orchestrator.effectiveSport?.(ev) || ev.sport;
        if (sport === 'esports') return false;
        return s.sharp === true;
      })
      .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
      .slice(0, 5)
      .map(s => ({ event: s.event, side: s.side, from: s.from, to: s.to, deltaPct: s.deltaPct }));

    // 4) Resumen narrativo IA
    let aiNarrative = null;
    if (topPicks.length) {
      const prompt = `Generá un brief ejecutivo del día para un apostador AR profesional. Tono natural, en argentino, sin jerga técnica.
Hoy tenemos:
- ${topPicks.length} picks con edge positivo (top por EV): ${topPicks.slice(0,3).map(p=>`${p.home} vs ${p.away} → ${p.pick} @ ${p.odd}`).join(' | ')}
- ${topSurebets.length} surebets activas${topSurebets[0] ? ` (mejor ROI: ${topSurebets[0].roi.toFixed(2)}%)` : ''}
- ${cleanSteam.length} movimientos del mercado relevantes${cleanSteam[0] ? ` (mayor: ${cleanSteam[0].event} ${cleanSteam[0].deltaPct.toFixed(1)}%)` : ''}

Devolvé JSON: {"headline": "<frase atractiva max 80 chars>", "summary": "<párrafo 80-130 palabras>", "topTip": "<una frase: el pick que MÁS recomendás hoy con por qué>"}`;
      try {
        const r = await groqJsonGeneric(
          'Sos un analista senior generando un brief ejecutivo diario. Tono argentino natural, sin jerga técnica. JSON estricto.',
          prompt,
          { maxTokens: 600, temperature: 0.5 }
        );
        if (r) aiNarrative = r;
      } catch (e) { log(`[daily-report] AI err: ${e?.message?.slice(0, 80)}`); }
    }

    const report = {
      generatedAt: now,
      topPicks,
      topSurebets,
      steamMoves: cleanSteam,
      aiNarrative,
      counts: {
        totalEvents: events.length,
        liveSurebets: surebets.length,
        sharpMoves: cleanSteam.length
      }
    };
    dailyReportCache.ts = now;
    dailyReportCache.data = report;
    res.json(report);
  } catch (e) {
    log(`[daily-report] err: ${e?.message?.slice(0, 100)}`);
    res.status(500).json({ error: 'No pudimos generar el reporte en este momento.' });
  }
});

/* GET /api/surebet/:key/explain — Explica POR QUÉ una surebet es válida.
 * Útil para que el user entienda el setup antes de ejecutar. */
app.get('/api/surebet/:key/explain', async (req, res) => {
  const key = req.params.key;
  const arb = arbEngine.snapshot();
  const sb = (arb.detected || []).find(s => s.key === key);
  if (!sb) return res.status(404).json({ error: 'Surebet no encontrada en el snapshot actual' });

  const cacheKey = aiCacheKey('surebet', { key, ts: Math.floor(Date.now() / 60000) });   // bucket por minuto
  if (aiCache.has(cacheKey)) return res.json(aiCache.get(cacheKey));

  const systemPrompt = `Sos un experto en arbitraje deportivo argentino. Explicale al user POR QUÉ esta surebet
existe, qué riesgos tiene (palpable error, stake límite, slip de timing), y cómo ejecutarla en orden óptimo.
JSON estricto:
{
  "whyExists": "<2-3 frases: por qué hay un gap entre las cuotas>",
  "executionOrder": ["paso 1", "paso 2", ...],
  "risks": ["<risk específico>", ...],
  "shouldExecute": true | false,
  "shouldExecuteReason": "<por qué sí o por qué no>"
}`;

  const userPrompt = `Surebet detectada:
Partido: ${sb.event}
Liga: ${sb.leagueName || sb.league}
Sport: ${sb.sport}
Mercado: ${sb.market}
Outcomes: ${(sb.outcomes || []).join(' / ')}
Odds: ${(sb.odds || []).join(' / ')}
Casas: ${(sb.books || []).join(' / ')}
ROI bruto: ${(sb.grossRoi * 100).toFixed(2)}%
ROI net (slippage): ${(sb.netRoi * 100).toFixed(2)}%
Confidence: ${(sb.confidence * 100).toFixed(0)}%
${sb.flag ? `Flag: ${sb.flag}` : ''}
${sb.timeToEvent ? `Minutes to kickoff: ${Math.floor(sb.timeToEvent / 60000)}` : ''}`;

  try {
    const r = await groqJsonGeneric(systemPrompt, userPrompt, { maxTokens: 1000 });
    const out = {
      whyExists: String(r?.whyExists || '').slice(0, 500),
      executionOrder: Array.isArray(r?.executionOrder) ? r.executionOrder.slice(0, 5).map(s => String(s).slice(0, 200)) : [],
      risks: Array.isArray(r?.risks) ? r.risks.slice(0, 5).map(s => String(s).slice(0, 200)) : [],
      shouldExecute: r?.shouldExecute === true,
      shouldExecuteReason: String(r?.shouldExecuteReason || '').slice(0, 400),
      provider: 'groq'
    };
    aiCache.set(cacheKey, out);
    res.json(out);
  } catch (e) {
    log(`[ai:surebet] err ${e?.message?.slice(0, 100)}`);
    res.status(503).json({ error: 'IA no disponible' });
  }
});

/* ────────────────────────────────────────────────────────────────────
 * UNIVERSAL LOGO RESOLVER — ESPN search API (rica, gratis, sin key)
 *
 * Devuelve URLs reales de ESPN CDN para cualquier equipo. Soporta soccer,
 * basketball, baseball, american-football, hockey, tennis, mma.
 *
 * Cache permanente in-memory (logos rara vez cambian). Negative cache 24h.
 *
 * El demo key '3' de TheSportsDB devuelve Arsenal para todas las queries —
 * inútil. ESPN search devuelve resultados correctos con relevance ranking.
 * ──────────────────────────────────────────────────────────────────── */
const logoCache = new LRUCache({ max: 10000, ttl: 0 });   // ttl 0 = no expira
const logoNegativeCache = new LRUCache({ max: 5000, ttl: 24 * 60 * 60 * 1000 });

function normalizeLogoKey(name) {
  return String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip acentos
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* Sport key (nuestro) → leagueSlug filter para ESPN (puede ser null = todos). */
function sportToEspnType(sport) {
  switch (sport) {
    case 'soccer':     return 'soccer';
    case 'basketball': return 'basketball';
    case 'amfootball': return 'football';      // ESPN llama "football" al americano
    case 'baseball':   return 'baseball';
    case 'hockey':     return 'hockey';
    case 'tennis':     return 'tennis';
    case 'mma':        return 'mma';
    default:           return null;
  }
}

async function resolveLogo(team, sport) {
  const key = normalizeLogoKey(team) + '|' + (sport || '');
  if (!key.startsWith('|')) {
    if (logoCache.has(key)) return logoCache.get(key);
    if (logoNegativeCache.has(key)) return null;
  } else {
    return null;   // nombre vacío
  }

  const espnSport = sportToEspnType(sport);
  // Multiple ESPN search endpoints — algunos hosts pueden estar bloqueados
  // por Cloudflare/network desde Render.
  const queries = [
    `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(team)}&limit=8&type=team`,
    `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(team)}&limit=8&type=team`
  ];

  for (const url of queries) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      if (!r.ok) {
        log(`[logo:espn] HTTP ${r.status} for ${url.split('?')[0]}`);
        continue;
      }
      const data = await r.json();
      const items = (data?.items || []).filter(it => it?.type === 'team' && Array.isArray(it.logos) && it.logos.length);
      if (!items.length) {
        log(`[logo:espn] no items for "${team}" via ${url.split('//')[1].split('/')[0]}`);
        continue;
      }
      // Priorizar match exacto + filtro de deporte
      const norm = normalizeLogoKey(team);
      const ranked = items.slice().sort((a, b) => {
        const aSport = String(a.sport || '').toLowerCase();
        const bSport = String(b.sport || '').toLowerCase();
        const aSportMatch = espnSport ? (aSport === espnSport ? 0 : 1) : 0;
        const bSportMatch = espnSport ? (bSport === espnSport ? 0 : 1) : 0;
        if (aSportMatch !== bSportMatch) return aSportMatch - bSportMatch;
        const aNameMatch = normalizeLogoKey(a.displayName || '') === norm ? 0 : 1;
        const bNameMatch = normalizeLogoKey(b.displayName || '') === norm ? 0 : 1;
        if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch;
        return Number(b.relevance || 0) - Number(a.relevance || 0);
      });
      const best = ranked[0];
      // Si el filtro de sport es estricto y no match, mejor null que logo erróneo
      if (espnSport && String(best.sport || '').toLowerCase() !== espnSport) {
        // Aceptamos solo si no había NINGÚN match del sport correcto
        const correctSport = ranked.find(it => String(it.sport || '').toLowerCase() === espnSport);
        if (correctSport && Array.isArray(correctSport.logos) && correctSport.logos[0]?.href) {
          const url = correctSport.logos[0].href;
          logoCache.set(key, url);
          return url;
        }
        // Si no había match exacto del sport, devolvemos best anyway (mejor algo que nada)
      }
      const logoUrl = best.logos.find(l => Array.isArray(l.rel) && l.rel.includes('default'))?.href || best.logos[0]?.href;
      if (logoUrl) {
        logoCache.set(key, logoUrl);
        return logoUrl;
      }
    } catch (e) {
      log(`[logo:espn] ${e?.message?.slice(0, 80)}`);
    }
  }

  logoNegativeCache.set(key, true);
  return null;
}

/* Pre-warm: en startup, fetcheamos las listas de equipos de las ligas top
 * en ESPN y poblamos logoCache. Así los users tienen logos REALES desde el
 * primer load, sin depender de fetches por-equipo a runtime.
 *
 * Ligas pre-warmed (ESPN league slugs):
 *   arg.1 (LPF Argentina), bra.1 (Brasileirão), uefa.champions/europa,
 *   eng.1, esp.1, ita.1, ger.1, fra.1, conmebol.libertadores/sudamericana,
 *   chi.1, par.1, uru.1, col.1, per.1, ecu.1, bol.1, mex.1, usa.1,
 *   plus NBA/NFL/MLB/NHL.
 *
 * Esto se ejecuta una sola vez al startup y refresca cada 24h. */
const PREWARM_LEAGUES = [
  { slug: 'arg.1', sport: 'soccer' },
  { slug: 'arg.2', sport: 'soccer' },
  { slug: 'bra.1', sport: 'soccer' },
  { slug: 'bra.2', sport: 'soccer' },
  { slug: 'eng.1', sport: 'soccer' },
  { slug: 'eng.2', sport: 'soccer' },
  { slug: 'esp.1', sport: 'soccer' },
  { slug: 'esp.2', sport: 'soccer' },
  { slug: 'ita.1', sport: 'soccer' },
  { slug: 'ger.1', sport: 'soccer' },
  { slug: 'fra.1', sport: 'soccer' },
  { slug: 'por.1', sport: 'soccer' },
  { slug: 'ned.1', sport: 'soccer' },
  { slug: 'uefa.champions', sport: 'soccer' },
  { slug: 'uefa.europa', sport: 'soccer' },
  { slug: 'uefa.europa.conf', sport: 'soccer' },
  { slug: 'conmebol.libertadores', sport: 'soccer' },
  { slug: 'conmebol.sudamericana', sport: 'soccer' },
  { slug: 'fifa.worldq.conmebol', sport: 'soccer' },
  { slug: 'chi.1', sport: 'soccer' },
  { slug: 'par.1', sport: 'soccer' },
  { slug: 'uru.1', sport: 'soccer' },
  { slug: 'col.1', sport: 'soccer' },
  { slug: 'per.1', sport: 'soccer' },
  { slug: 'ecu.1', sport: 'soccer' },
  { slug: 'bol.1', sport: 'soccer' },
  { slug: 'mex.1', sport: 'soccer' },
  { slug: 'usa.1', sport: 'soccer' },
  { slug: 'nba', sport: 'basketball' },
  { slug: 'nfl', sport: 'football' },
  { slug: 'mlb', sport: 'baseball' },
  { slug: 'nhl', sport: 'hockey' }
];

async function prewarmLogoFromLeague(leagueSlug, sport) {
  // ESPN expone /apis/site/v2/sports/{sport}/{leagueSlug}/teams para soccer
  // y para otros sports usa /apis/site/v2/sports/{sport}/leagues/{slug}/teams
  // Probamos las dos variantes.
  const urls = sport === 'soccer'
    ? [`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams`]
    : [`https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/teams`];

  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const data = await r.json();
      const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
      let count = 0;
      for (const item of teams) {
        const t = item?.team || item;
        if (!t) continue;
        const name = t.displayName || t.name;
        const logos = t.logos || (t.logo ? [{ href: t.logo }] : []);
        const logoUrl = logos.find(l => Array.isArray(l.rel) && l.rel.includes('default'))?.href || logos[0]?.href;
        if (name && logoUrl) {
          // Poblamos múltiples claves para mejor matching
          const variations = [name, t.shortDisplayName, t.nickname, t.location].filter(Boolean);
          for (const v of variations) {
            const k = normalizeLogoKey(v) + '|' + sport;
            logoCache.set(k, logoUrl);
          }
          count++;
        }
      }
      if (count > 0) {
        log(`[logo:prewarm] ${leagueSlug} → ${count} equipos`);
        return count;
      }
    } catch (e) {
      log(`[logo:prewarm] ${leagueSlug} err: ${e?.message?.slice(0, 60)}`);
    }
  }
  return 0;
}

async function prewarmAllLogos() {
  log('[logo:prewarm] iniciando...');
  let total = 0;
  for (const { slug, sport } of PREWARM_LEAGUES) {
    total += await prewarmLogoFromLeague(slug, sport);
    await new Promise(r => setTimeout(r, 250));   // gentle pace
  }
  log(`[logo:prewarm] terminado · ${total} equipos cacheados`);
}

// Disparar prewarm 10s después del startup (para no bloquear cold-start de Render).
setTimeout(() => { prewarmAllLogos().catch(e => log(`[logo:prewarm] fatal: ${e?.message}`)); }, 10000);
// Refresh cada 24h
setInterval(() => { prewarmAllLogos().catch(() => {}); }, 24 * 60 * 60 * 1000);

/* GET /api/ai/test — diagnóstico: prueba Groq directamente y devuelve raw response. */
app.get('/api/ai/test', async (req, res) => {
  const key = process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY || '';
  if (!key) return res.json({ ok: false, error: 'NO_GROQ_KEY', detail: 'BS_GROQ_API_KEY no está en env' });
  const keyPreview = key.slice(0, 6) + '...' + key.slice(-4);
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.BS_GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Responde JSON: {"ok": true, "msg": "<saludo>"}' },
          { role: 'user', content: 'Test' }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 100
      })
    });
    const text = await r.text();
    res.json({
      ok: r.ok, status: r.status, keyPreview,
      model: process.env.BS_GROQ_MODEL || 'llama-3.3-70b-versatile',
      response: text.slice(0, 800)
    });
  } catch (e) {
    res.json({ ok: false, error: e?.message, keyPreview });
  }
});

/* GET /api/logo?team=X&sport=Y — devuelve URL de logo o 404.
 * Cliente lo llama async y reemplaza placeholder cuando llega.
 * Pasar ?debug=1 para diagnóstico (devuelve la respuesta cruda de ESPN). */
app.get('/api/logo', async (req, res) => {
  const team = String(req.query.team || '').trim();
  const sport = String(req.query.sport || '').trim();
  if (!team) return res.status(400).json({ error: 'missing team' });
  // Debug mode — hace fetch directo y devuelve la respuesta de ESPN
  if (req.query.debug === '1') {
    try {
      const url = `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(team)}&limit=8&type=team`;
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });
      const text = await r.text();
      return res.json({ status: r.status, body: text.slice(0, 2000), url });
    } catch (e) {
      return res.json({ error: e?.message, type: 'fetch-error' });
    }
  }
  try {
    const url = await resolveLogo(team, sport);
    if (!url) return res.status(404).json({ error: 'not-found' });
    res.json({ url, source: 'espn' });
  } catch (e) {
    res.status(500).json({ error: e?.message });
  }
});

/* POST /api/logos/batch — resolver muchos equipos en una sola call. */
app.post('/api/logos/batch', express.json(), async (req, res) => {
  const teams = (req.body?.teams || []).filter(Boolean).slice(0, 50);
  const sport = req.body?.sport;
  const results = {};
  await Promise.all(teams.map(async name => {
    try { results[name] = await resolveLogo(name, sport); }
    catch { results[name] = null; }
  }));
  res.json(results);
});

/* GET /api/match/:id/deep — Análisis profundo de UN partido específico.
 * Usa el cache de analyzeMatch (5min TTL) — no quema quota extra. */
app.get('/api/match/:id/deep', async (req, res) => {
  const ev = orchestrator.findEvent(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado' });
  try {
    const result = await analyzeMatch(ev, {
      steamMoves: orchestrator.steamMoves(),
      surebets: arbEngine.snapshot().detected
    });
    if (!result) return res.status(503).json({ error: 'Análisis no disponible' });
    res.json(result);
  } catch (e) {
    log(`[ai:match] err ${e?.message?.slice(0, 100)}`);
    res.status(503).json({ error: e?.message });
  }
});

app.get('/api/snapshot', (req, res) => {
  res.json({
    events: orchestrator.events({ sport: 'all' }),
    surebets: orchestrator.surebets(),
    steam: orchestrator.steamMoves(),
    bookStatus: orchestrator.bookStatus(),
    health: orchestrator.health(),
    ts: Date.now()
  });
});

// Fallback HTML — SPA dashboard
app.get('/app/*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));

// 404 fallback (HTML fallback gracefully)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not-found' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// ── HTTP + WebSocket ───────────────────────────────────────────────────────
const server = http.createServer(app);
// perMessageDeflate ahorra ~70% bandwidth en frames JSON repetitivos
// (snapshot inicial es 2-5MB → ~600KB-1.5MB on the wire). Threshold 1024
// para no comprimir frames chiquitos donde el overhead supera el ahorro.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: { level: 6 },
    concurrencyLimit: 10,
    serverNoContextTakeover: true,
    clientNoContextTakeover: true
  }
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/api/live' || req.url === '/api/live/') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const clients = new Set();
wss.on('connection', ws => {
  clients.add(ws);
  // Snapshot inicial
  try {
    ws.send(JSON.stringify({
      type: 'snapshot',
      data: {
        events: orchestrator.events({ sport: 'all' }),
        surebets: orchestrator.surebets(),
        steam: orchestrator.steamMoves(),
        bookStatus: orchestrator.bookStatus(),
        ts: Date.now()
      }
    }));
  } catch {}
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => { try { ws.close(); } catch {} clients.delete(ws); });
  // heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

setInterval(() => {
  clients.forEach(ws => {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} clients.delete(ws); return; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);

// Threshold: ~512 KB buffered = cliente lento. Por encima de eso droppeamos
// el frame para no acumular memoria (los frames odds-update son ~150 KB en
// snapshots grandes, así que cada cliente puede atrasarse 3 frames antes de
// que lo skipeemos).
const WS_BACKPRESSURE_BYTES = 512 * 1024;

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  clients.forEach(ws => {
    if (ws.readyState !== 1) return;
    // Backpressure: si el cliente está atrasado, drop. Mejor frame nuevo
    // que cola creciendo + OOM.
    if (typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > WS_BACKPRESSURE_BYTES) return;
    try { ws.send(msg); } catch { /* socket cerrándose */ }
  });
}

// ── Orquestador: dispara scraping cada SCRAPE_INTERVAL_MS y emite eventos ──
orchestrator.on('cycle', (info) => broadcast('cycle', info));
orchestrator.on('odds-update', (diff) => broadcast('odds-update', diff));
orchestrator.on('surebet', (sb) => broadcast('surebet', sb));
orchestrator.on('steam', (st) => broadcast('steam', st));
orchestrator.on('book-status', (bs) => broadcast('book-status', bs));

// ── Start ──────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  log(`[server] listening on :${PORT}`);
  log(`[server] enabled books: ${ENABLED_BOOKS.join(', ')}`);
  log(`[server] scrape interval: ${SCRAPE_INTERVAL_MS / 1000}s`);
  log(`[server] arbitrage interval: ${ARB_INTERVAL_MS / 1000}s`);
  orchestrator.start({
    interval: SCRAPE_INTERVAL_MS,
    enabledBooks: ENABLED_BOOKS,
    browserPool
  });
  // Iniciar motor de arbitraje en su propio loop (más rápido)
  arbEngine.start();
  // Pre-warm AI cache cada 4 min: analiza los top 12 events para que
  // cuando el user llegue a AI Picks / Generator / BetSafe AI, los
  // análisis YA estén cacheados (5min TTL) y se sirvan instant.
  setTimeout(() => startAiPrewarm(), 30_000);   // espera 30s al primer ciclo de scraping
});

let aiPrewarmTimer = null;
async function startAiPrewarm() {
  async function prewarmOnce() {
    try {
      const events = orchestrator.events({ sport: 'all' }).slice(0, 12);
      if (!events.length) { log('[ai-prewarm] no events yet'); return; }
      const steam = orchestrator.steamMoves();
      const surebets = arbEngine.snapshot().detected;
      const limit = pLimit(1);   // sequential para no rate-limit-ear Groq
      let okCount = 0;
      for (const ev of events) {
        try {
          const r = await limit(() => analyzeMatch(ev, { steamMoves: steam, surebets }));
          if (r?.llmProvider && r.llmProvider !== 'offline') okCount++;
        } catch (_) {}
      }
      log(`[ai-prewarm] cached ${okCount}/${events.length} events with IA real`);
    } catch (e) {
      log(`[ai-prewarm] err: ${e?.message?.slice(0,100)}`);
    }
  }
  // Primera corrida + loop cada 4 min
  prewarmOnce();
  aiPrewarmTimer = setInterval(prewarmOnce, 4 * 60_000);
}

// Graceful shutdown
async function shutdown(sig) {
  log(`[server] ${sig} received, shutting down…`);
  if (aiPrewarmTimer) clearInterval(aiPrewarmTimer);
  orchestrator.stop();
  arbEngine.stop();
  await browserPool.closeAll().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => log('[unhandled]', e?.message || e));
