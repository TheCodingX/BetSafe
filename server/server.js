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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

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

app.get('/api/steam', (req, res) => res.json(orchestrator.steamMoves()));

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
  const limit = Math.min(24, Number(req.query.limit) || 8);
  const sport = req.query.sport;
  const league = req.query.league;
  const minSharp = Number(req.query.minSharp || 0);
  const skipInjured = req.query.skipInjured === 'true';
  const skipBadWeather = req.query.skipBadWeather === 'true';

  const events = orchestrator.events({ sport: sport || 'all', league })
    .filter(e => e.bestOdds?.h2h)
    .sort((a, b) => (a.start || 0) - (b.start || 0))
    .slice(0, limit * 2);   // pedimos más para filtrar después

  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;

  // Análisis concurrente con cap fijo. analyzeMatch hace 1 llamada al LLM
  // por partido (timeout 20s); con 5 paralelos = 5 partidos cada ~20s,
  // así un limit=12 termina en ~50s en peor caso. El cliente espera el
  // response porque iguales necesitamos las 12 picks de una.
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 5));
  const settled = await Promise.allSettled(
    events.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
  );
  const out = settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);

  // Aplicar filtros sobre el output enriquecido
  const filtered = out.filter(pick => {
    if (minSharp > 0 && (pick.factors?.sharp?.score || 0) < minSharp) return false;
    if (skipInjured && (pick.factors?.injuries?.severityScore?.home > 0.5 || pick.factors?.injuries?.severityScore?.away > 0.5)) return false;
    if (skipBadWeather && pick.factors?.weather?.impact?.goalsMultiplier && pick.factors.weather.impact.goalsMultiplier < 0.90) return false;
    return true;
  });

  res.json({ picks: filtered.slice(0, limit), meta: { analyzed: out.length, filtered: filtered.length } });
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
  // Si el user marcó books específicos, solo aceptamos events con AL MENOS
  // una cuota h2h en alguna de esas casas — sin eso el pick puede caer en
  // una casa que el user no tiene cuenta.
  const wantedBooks = Array.isArray(books) ? books.filter(Boolean) : [];
  if (wantedBooks.length) {
    events = events.filter(e =>
      Object.keys(e.markets?.h2h || {}).some(bk => wantedBooks.includes(bk))
    );
  }

  // Top 20 partidos por overround (libros más eficientes = picks más confiables)
  events.sort((a, b) => (a.overround || 99) - (b.overround || 99));
  events = events.slice(0, 20);

  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;

  // Analizar con concurrencia controlada (compartimos cap con /api/picks)
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 5));
  const settled = await Promise.allSettled(
    events.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
  );
  const analyzed = settled.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : []);

  // Filtros
  const passing = analyzed.filter(a => {
    if (minSharp > 0 && (a.factors?.sharp?.score || 0) < minSharp) return false;
    if (skipInjured && (a.factors?.injuries?.severityScore?.home > 0.5 || a.factors?.injuries?.severityScore?.away > 0.5)) return false;
    if (skipBadWeather && a.factors?.weather?.impact?.goalsMultiplier && a.factors.weather.impact.goalsMultiplier < 0.88) return false;
    return true;
  });

  // Construir combinadas:
  // Para cada combinada, elegimos `legs` selecciones del mismo "type" (cons/eq/agg) de distintos partidos,
  // ordenadas por EV y confidence. Después chequeamos correlación.
  const combos = [];
  const seenComboSig = new Set();
  for (const targetType of [risk, risk === 'cons' ? 'eq' : risk === 'eq' ? 'cons' : 'eq']) {
    for (let tries = 0; tries < count * 4 && combos.length < count; tries++) {
      const pool = [];
      passing.forEach(a => {
        let filteredByMarket = (a.selections || []).filter(s => markets.includes(s.market));
        // Respetar selección de books del user — descartamos selections cuyo
        // book no esté en la lista marcada. Sin esto, le ofrecemos al user picks
        // en casas donde no tiene cuenta y no puede ejecutar.
        if (wantedBooks.length) {
          filteredByMarket = filteredByMarket.filter(s => wantedBooks.includes(s.book));
        }
        const matching = filteredByMarket.filter(s => s.type === targetType);
        if (matching.length) pool.push({ event: a.event, factors: a.factors, sel: matching[0] });
      });
      pool.sort((a, b) => (b.sel.consensusEv || -99) - (a.sel.consensusEv || -99));
      const chosen = [];
      const usedEvents = new Set();
      for (const p of pool) {
        if (usedEvents.has(p.event.id)) continue;
        chosen.push({
          eventId: p.event.id,
          home: p.event.home?.name, away: p.event.away?.name,
          market: p.sel.market, outcome: p.sel.outcome, line: p.sel.line,
          label: p.sel.label, odd: p.sel.odd, book: p.sel.book,
          confidence: p.sel.confidence, ev: p.sel.consensusEv,
          factors: p.sel.factors, rationale: p.sel.rationale
        });
        usedEvents.add(p.event.id);
        if (chosen.length >= legs) break;
      }
      if (chosen.length < legs) break;

      // Correlation check
      const corr = analyzeCombo(chosen);
      if (skipCorrelated && !corr.ok) {
        // intentamos otra mezcla (skip primera leg correlacionada)
        chosen.splice(corr.warnings[0]?.i || 0, 1);
        if (chosen.length < legs) continue;
      }
      const totalOdd = chosen.reduce((a, b) => a * b.odd, 1);
      const sig = chosen.map(l => `${l.eventId}:${l.market}:${l.outcome}`).sort().join('|');
      if (seenComboSig.has(sig)) continue;
      seenComboSig.add(sig);
      combos.push({
        legs: chosen,
        totalOdd: Number(totalOdd.toFixed(2)),
        avgConfidence: Number((chosen.reduce((a, b) => a + (b.confidence || 0), 0) / chosen.length).toFixed(3)),
        sumEv: Number(chosen.reduce((a, b) => a + (b.ev || 0), 0).toFixed(2)),
        correlation: corr,
        type: targetType
      });
      if (combos.length >= count) break;
    }
  }

  res.json({
    combos: combos.slice(0, count),
    meta: { analyzed: analyzed.length, passing: passing.length, filtersApplied: { minSharp, skipInjured, skipBadWeather, skipCorrelated } }
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
});

// Graceful shutdown
async function shutdown(sig) {
  log(`[server] ${sig} received, shutting down…`);
  orchestrator.stop();
  arbEngine.stop();
  await browserPool.closeAll().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => log('[unhandled]', e?.message || e));
