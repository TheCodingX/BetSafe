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

// Cargar .env (busca primero en raíz del proyecto, después en server/) para
// que en local funcionen las keys sin tener que `export` cada vez. En Render
// las vars vienen del dashboard y dotenv no encuentra .env — no rompe nada.
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
  require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
} catch (_) { /* sin dotenv, sigue como antes con env del shell */ }

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const { browserPool, sleep, normalizeTeam, log } = require('./lib');
const pLimit = require('p-limit').default;
const orchestrator = require('./lib/orchestrator');
const { ArbitrageEngine } = require('./engines/arbitrage');
const { analyzeMatch, groqJsonGeneric, geminiJsonGeneric } = require('./engines/ai-pipeline');

// Helper: cascada GEMINI-FIRST (el user pidió explícitamente que Gemini sea
// el motor principal — pagar Gemini 2.5 Flash no es problema, 1M context).
// Patrón: 3 retries de Gemini con backoff, después Groq como red de seguridad
// para no devolver vacío al cliente. Si en el futuro queremos Claude para
// algunos parsers, agregar acá entre los retries de Gemini y Groq.
const HAS_GEMINI = !!(process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
const HAS_GROQ = !!(process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY);
async function preferredJson(systemPrompt, userPrompt, opts = {}) {
  let lastErr = null;
  if (HAS_GEMINI) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await geminiJsonGeneric(systemPrompt, userPrompt, opts);
      } catch (e) {
        lastErr = e;
        // Backoff exponencial: 200ms, 600ms, 1800ms
        if (attempt < 3) await new Promise(r => setTimeout(r, 200 * Math.pow(3, attempt - 1)));
      }
    }
    log(`[preferredJson] gemini falló 3 veces: ${lastErr?.message?.slice(0,80)} — fallback a Groq`);
  }
  if (HAS_GROQ) return groqJsonGeneric(systemPrompt, userPrompt, opts);
  throw lastErr || new Error('Sin LLM disponible (configurá BS_GEMINI_API_KEY o BS_GROQ_API_KEY)');
}
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

// Verifica CADA API key haciendo un request real al provider. Devuelve
// {ok: true|false, status: 200, msg: ...} por cada uno. Útil para diagnosticar
// "key configurada pero inválida" vs "key correcta y funcionando".
// Cada test es lightweight (1 request) y tiene timeout de 8s.
app.get('/api/keys-verify', async (req, res) => {
  const verify = async (name, fn) => {
    const t0 = Date.now();
    try {
      const r = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 8s')), 8000))
      ]);
      return { ...r, durMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: (e?.message || String(e)).slice(0, 200), durMs: Date.now() - t0 };
    }
  };

  const results = {};

  // Gemini
  results.gemini = await verify('gemini', async () => {
    const k = process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${k}`);
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    return { ok: true, status: 200, modelsCount: (j.models || []).length };
  });

  // Anthropic Claude
  results.anthropic = await verify('anthropic', async () => {
    const k = process.env.BS_ANTHROPIC_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] })
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    return { ok: true, status: 200 };
  });

  // Groq
  results.groq = await verify('groq', async () => {
    const k = process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: 'Bearer ' + k }
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    return { ok: true, status: 200, modelsCount: (j.data || []).length };
  });

  // OpenRouter
  results.openrouter = await verify('openrouter', async () => {
    const k = process.env.BS_OPENROUTER_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: 'Bearer ' + k }
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    return { ok: true, status: 200, info: j.data?.label || 'authed' };
  });

  // The Odds API
  results.theOddsApi = await verify('theOddsApi', async () => {
    const k = process.env.THE_ODDS_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${k}`);
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const remaining = r.headers.get('x-requests-remaining');
    const j = await r.json();
    return { ok: true, status: 200, sportsCount: Array.isArray(j) ? j.length : 0, requestsRemaining: remaining };
  });

  // API-Football directo
  results.apiSports = await verify('apiSports', async () => {
    const k = process.env.APISPORTS_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': k }
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    const acct = j.response?.account || {};
    const sub = j.response?.subscription || {};
    return { ok: true, status: 200, plan: sub.plan, active: sub.active, account: acct.firstname };
  });

  // RapidAPI (api-football via rapid)
  results.rapidApi = await verify('rapidApi', async () => {
    const k = process.env.RAPIDAPI_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch('https://api-football-v1.p.rapidapi.com/v3/status', {
      headers: {
        'X-RapidAPI-Key': k,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
      }
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    return { ok: true, status: 200 };
  });

  // OpenWeather
  results.openWeather = await verify('openWeather', async () => {
    const k = process.env.OPENWEATHER_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=Buenos%20Aires&appid=${k}`);
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    return { ok: true, status: 200, city: j.name, temp: j.main?.temp };
  });

  // Football-Data.org
  results.footballData = await verify('footballData', async () => {
    const k = process.env.BS_FOOTBALL_DATA_API_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch('https://api.football-data.org/v4/competitions', {
      headers: { 'X-Auth-Token': k }
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    return { ok: true, status: 200, competitionsCount: (j.competitions || []).length };
  });

  // ScrapingBee
  results.scrapingBee = await verify('scrapingBee', async () => {
    const k = process.env.SCRAPINGBEE_KEY;
    if (!k) return { ok: false, error: 'key not set' };
    const r = await fetch(`https://app.scrapingbee.com/api/v1/usage?api_key=${k}`);
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
    const j = await r.json();
    return { ok: true, status: 200, creditsRemaining: j.max_api_credit - j.used_api_credit, plan: j.subscription_name };
  });

  // Summary
  const summary = {
    primary_gemini_works: results.gemini?.ok === true,
    has_data_for_player_props: results.apiSports?.ok || results.rapidApi?.ok,
    has_weather: results.openWeather?.ok === true,
    has_h2h_history: results.footballData?.ok === true,
    has_cross_validation: results.theOddsApi?.ok === true,
    total_working: Object.values(results).filter(r => r.ok).length,
    total_tested: Object.keys(results).length
  };

  res.json({ results, summary, hint: 'OK = key configurada Y working. Si una falla con 401/403 → key inválida. Con 429 → rate limit. Con network/timeout → bloqueo de red.' });
});

// Status de las API keys configuradas. NO devuelve los valores — solo true/false
// si están presentes y un preview (3 primeros chars + length) para verificar
// que sean keys "razonables" (no strings vacíos accidentales).
app.get('/api/keys-status', (req, res) => {
  const check = (name) => {
    const v = process.env[name];
    if (!v) return { present: false };
    return {
      present: true,
      length: v.length,
      preview: v.slice(0, 4) + '…' + v.slice(-2)
    };
  };
  res.json({
    primary: {
      'BS_GEMINI_API_KEY': check('BS_GEMINI_API_KEY'),
      'GEMINI_API_KEY':    check('GEMINI_API_KEY')
    },
    fallback: {
      'BS_ANTHROPIC_API_KEY': check('BS_ANTHROPIC_API_KEY'),
      'BS_GROQ_API_KEY':      check('BS_GROQ_API_KEY'),
      'GROQ_API_KEY':         check('GROQ_API_KEY'),
      'BS_OPENROUTER_API_KEY': check('BS_OPENROUTER_API_KEY')
    },
    data: {
      'THE_ODDS_API_KEY':       check('THE_ODDS_API_KEY'),
      'APISPORTS_KEY':          check('APISPORTS_KEY'),
      'RAPIDAPI_KEY':           check('RAPIDAPI_KEY'),
      'OPENWEATHER_API_KEY':    check('OPENWEATHER_API_KEY'),
      'BS_FOOTBALL_DATA_API_KEY': check('BS_FOOTBALL_DATA_API_KEY'),
      'SCRAPINGBEE_KEY':        check('SCRAPINGBEE_KEY')
    },
    persistence: {
      'BS_SUPABASE_URL':      check('BS_SUPABASE_URL'),
      'BS_SUPABASE_ANON_KEY': check('BS_SUPABASE_ANON_KEY')
    },
    notes: {
      envLoaded: typeof process.env.BS_GEMINI_API_KEY !== 'undefined' || typeof process.env.THE_ODDS_API_KEY !== 'undefined',
      nodeEnv: process.env.NODE_ENV || 'development',
      port: process.env.PORT || '8787',
      hint: 'Pon las keys en /Users/rocki/Documents/betposta/.env (o donde corra el server) y reinicia. .env se carga automáticamente.'
    }
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

// Diagnóstico profundo: chequea por qué analyzeMatch cae a offline aunque
// algún provider esté OK. Devuelve traza del cascade + payload sample.
/* POST /api/debug/clear-ai-cache — Limpia LRU cache de analyzeMatch.
 * Útil después de upgrade de provider (free → paid) para forzar re-análisis
 * con la nueva calidad. */
app.post('/api/debug/clear-ai-cache', express.json(), async (req, res) => {
  if (process.env.DEBUG_KEY && req.body?.key !== process.env.DEBUG_KEY) {
    // Sin DEBUG_KEY configurada, permitir libre. Con DEBUG_KEY, requiere coincidir.
    if (process.env.DEBUG_KEY) return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const cleared = typeof analyzeMatch.clearAllCache === 'function'
      ? analyzeMatch.clearAllCache()
      : 0;
    log(`[admin] AI cache cleared (${cleared} entries)`);
    res.json({ ok: true, cleared, message: `Cache de ${cleared} análisis limpiado. Próximas requests re-analizan con LLM actual.` });
  } catch (e) {
    res.status(500).json({ error: e?.message });
  }
});

app.get('/api/debug/llm-trace', async (req, res) => {
  const out = { providers: {}, casks: [] };
  try {
    // 1) Test Groq con prompt mínimo
    if (process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY) {
      try {
        const r = await groqJsonGeneric('Sos un assistant que responde JSON.',
          'Devolveme {"ok": true}.', { maxTokens: 50 });
        out.providers.groq = { ok: true, response: r };
      } catch (e) {
        out.providers.groq = { ok: false, error: e?.message?.slice(0, 200) };
      }
    } else { out.providers.groq = { skipped: 'no-key' }; }

    // 2) Test Gemini con prompt mínimo
    if (process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY) {
      try {
        const r = await geminiJsonGeneric('Sos un assistant que responde JSON.',
          'Devolveme {"ok": true}.', { maxTokens: 50 });
        out.providers.gemini = { ok: true, response: r };
      } catch (e) {
        out.providers.gemini = { ok: false, error: e?.message?.slice(0, 200) };
      }
    } else { out.providers.gemini = { skipped: 'no-key' }; }

    // 3) Forzar re-análisis de un evento sin cache
    const eventId = req.query.eventId;
    if (eventId) {
      const ev = orchestrator.findEvent(eventId);
      if (ev) {
        if (typeof analyzeMatch.clearCacheOffline === 'function') {
          analyzeMatch.clearCacheOffline(ev.id);
        }
        const t0 = Date.now();
        const r = await analyzeMatch(ev, { steamMoves: orchestrator.steamMoves(), surebets: arbEngine.snapshot().detected });
        out.analyzeMatch = {
          eventId: ev.id,
          home: ev.home?.name,
          away: ev.away?.name,
          durMs: Date.now() - t0,
          llmProvider: r?.llmProvider,
          selectionsCount: r?.selections?.length,
          synthesis: r?.llmSynthesis ? r.llmSynthesis.slice(0, 200) + '...' : null
        };
      }
    }

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e?.message, out });
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
  const snap = arbEngine.snapshot();
  const filtered = snap.detected
    .filter(sb => sb.netRoi >= minRoi)
    .filter(sb => !sport || sb.sport === sport)
    .filter(sb => sb.confidence >= minConf);
  res.json({
    surebets: filtered,
    meta: {
      cycles: snap.cycles,
      lastCycleMs: snap.lastCycleMs,
      lastCycleAt: snap.lastCycleAt,
      active: snap.activeSurebets,
      interval: snap.interval,
      serverNow: Date.now()
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
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 8));

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
  const aiVerified = filtered.filter(p => p.llmProvider && p.llmProvider !== 'offline');

  // ── NUEVO: filtro por VALOR REAL ──
  // Solo mostramos picks donde el modelo de consenso ve valor (EV o valueGap
  // positivos). Picks con EV negativo significa que la casa cobra más de lo
  // que el modelo cree que vale → mostrarlos es ruido y confunde al usuario.
  // Default ON; se puede desactivar con ?onlyValue=false (debug/admin).
  const onlyValue = req.query.onlyValue !== 'false';
  const ranked = aiVerified
    .map(p => {
      // Score primario del pick: usamos el mejor type (eq por default).
      const sel = (p.selections || []).find(s => s.type === 'eq')
               || (p.selections || []).find(s => s.type === 'cons')
               || p.selections?.[0];
      const ev = sel?.consensusEv ?? null;
      const vg = sel?.valueGap ?? null;
      // Score compuesto: prioriza EV positivo, luego valueGap, luego confianza.
      const score = (ev || 0) + (vg || 0) * 0.5 + (sel?.confidence || 0) * 30;
      return { pick: p, sel, ev, vg, score };
    })
    .filter(r => {
      if (!onlyValue) return true;
      // Mantener solo picks con EV positivo o valueGap positivo (al menos uno)
      const hasPositiveValue = (r.ev != null && r.ev > 0) || (r.vg != null && r.vg > 0);
      return hasPositiveValue;
    })
    .sort((a, b) => b.score - a.score)
    .map(r => r.pick);

  const aiCount = aiVerified.length;
  const valueCount = ranked.length;
  const rejectedByValue = aiCount - valueCount;
  const offlineCount = filtered.length - aiCount;

  res.json({
    picks: ranked.slice(0, limit),
    meta: {
      analyzed: out.length,
      filtered: filtered.length,
      aiVerified: aiCount,
      aiPending: offlineCount,
      valueFiltered: valueCount,
      rejectedByValue,
      onlyValue,
      // Si tiramos picks offline, avisamos al cliente:
      hint: offlineCount > 0
        ? `${offlineCount} análisis IA aún procesando — refrescá en unos segundos para verlos.`
        : (rejectedByValue > 0 ? `${rejectedByValue} picks descartados por no tener valor positivo. Para ver todos: ?onlyValue=false` : null)
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/picks/curated
 * ═══════════════════════════════════════════════════════════════════════════
 * Devuelve combinadas CURADAS por IA. NO un pick por partido — combinadas
 * inteligentes con 2-5 legs cada una, donde la IA decide:
 *   - Qué partidos combinar (solo los que tienen señales fuertes y data profunda)
 *   - Cuántas legs (2-5) según la calidad de las señales
 *   - Qué tipo de combo (segura/equilibrada/agresiva) según contexto
 *
 * Filosofía: CALIDAD > cantidad. Es preferible 3 combinadas brillantes que 8
 * mediocres. Si un día no hay suficiente data fuerte, devolvemos menos combos
 * con la disclosure correspondiente.
 *
 * Query params:
 *   - sport=soccer|basketball|tennis|amfootball|baseball|esports (default all)
 *   - count=N (default 4, max 6) — máximo de combinadas a devolver
 *   - includeEsports=true (default false: NUNCA esports a menos que se pida)
 * ═══════════════════════════════════════════════════════════════════════════ */
app.get('/api/curated-combos', async (req, res) => {
  const sport = req.query.sport || 'all';
  const count = Math.min(6, Math.max(2, Number(req.query.count) || 4));
  const includeEsports = req.query.includeEsports === 'true' || sport === 'esports';

  // 1) Pool de eventos del día — FILTRO ESTRICTO por deporte
  let events = orchestrator.events({ sport: sport === 'all' ? 'all' : sport })
    .filter(e => e.bestOdds?.h2h);
  if (!includeEsports) {
    events = events.filter(e => e.sport !== 'esports' && !orchestrator.looksLikeEsports?.(e));
  }
  // Solo partidos que empiezan en las próximas 36hs
  const now = Date.now();
  events = events.filter(e => Number.isFinite(e.start) && e.start >= now && e.start <= now + 36*3600*1000);

  if (!events.length) {
    return res.json({
      combos: [],
      meta: { reason: 'no-events', sport, message: `No hay partidos${sport!=='all'?` de ${sport}`:''} en las próximas 36hs.` }
    });
  }

  // 2) Profundidad de data — priorizar eventos con MÚLTIPLES casas, factores
  //    completos y eventos top (más data = mejor análisis).
  function dataDepth(ev) {
    const bookCount = Object.keys(ev.markets?.h2h || {}).length;
    const hasFactors = !!(ev.factors || ev.weather || ev.lineup);
    const priority = orchestrator.eventPriority?.(ev) || 0;
    return bookCount * 2 + (hasFactors ? 5 : 0) + priority * 3;
  }
  events.sort((a, b) => dataDepth(b) - dataDepth(a));

  // 3) Analizar top N — más pool = mejor curado. Cap 16 por timeout.
  const TOP_N = Math.min(16, events.length);
  const top = events.slice(0, TOP_N);
  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 8));
  const analyzed = await Promise.allSettled(
    top.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
  );

  // 4) Construir pool de picks con EV positivo. Cada evento aporta sus mejores
  //    selections (h2h, totals, btts según riesgo).
  //
  // NOTA: Permitimos picks con `llmProvider: offline` siempre que tengan
  //  selections válidas. Esos picks vienen de los modelos cuantitativos puros
  //  (Poisson + Elo + Shin fair odds). Sin esta tolerancia, si todos los
  //  providers LLM fallan simultáneamente (ej: Gemini 429 + Groq cuelgue),
  //  la app queda con pantalla vacía aunque el motor cuantitativo tenga
  //  picks válidos. Marcamos los picks "offline" para que el frontend pueda
  //  mostrar un disclaimer.
  const pool = [];
  let llmOk = 0, llmOffline = 0;
  for (const r of analyzed) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const a = r.value;
    if (a.llmProvider && a.llmProvider !== 'offline') llmOk++;
    else llmOffline++;
    for (const sel of (a.selections || [])) {
      if (!sel.odd || sel.market === 'combo') continue;
      const ev = sel.consensusEv;
      const vg = sel.valueGap;
      // Solo picks con valor positivo y prob real ≥ 30% (no apuestas locas)
      if (ev == null || ev <= 0) continue;
      if (sel.consensusProb && sel.consensusProb < 0.30) continue;
      pool.push({
        event: a.event,
        factors: a.factors,
        sel,
        score: ev + (vg || 0) * 0.5 + (sel.confidence || 0) * 30,
        isLlmBacked: a.llmProvider && a.llmProvider !== 'offline'
      });
    }
  }

  if (pool.length < 4) {
    return res.json({
      combos: [],
      meta: {
        reason: 'pool-too-small',
        analyzed: analyzed.length,
        analyzedEvents: analyzed.length,
        llmOk, llmOffline,
        poolSize: pool.length,
        message: pool.length === 0
          ? `Hoy no encontramos picks con valor positivo. Probablemente los modelos cuantitativos no detectan edge claro en los partidos disponibles.`
          : `Solo encontramos ${pool.length} picks con valor positivo. Necesitamos al menos 4 para armar combinadas de calidad.`
      }
    });
  }

  // 5) Sort pool por calidad
  pool.sort((a, b) => b.score - a.score);
  const topPool = pool.slice(0, Math.min(20, pool.length));

  // 6) Pedirle a la IA que arme las combinadas curadas
  const poolSummary = topPool.map((p, i) =>
    `[${i}] ${p.event.home?.name} vs ${p.event.away?.name} | ${p.event.leagueName || p.event.sport} | ${p.sel.market}:${p.sel.outcome} (${p.sel.label}) @ ${p.sel.odd} | EV ${p.sel.consensusEv?.toFixed(1)}% | conf ${(p.sel.confidence*100)?.toFixed(0)}% | book ${p.sel.book}`
  ).join('\n');

  const systemPrompt = `Sos un analista cuantitativo SENIOR de apuestas deportivas que arma combinadas curadas para usuarios serios.

Tu trabajo: del pool de picks (todos con EV positivo y data profunda), elegir las MEJORES ${count} COMBINADAS posibles. NO un combo por partido. NO repetir el mismo evento entre legs. NO combos genéricos.

REGLAS:
- Cada combinada tiene 2 a 5 legs (vos decidís cuántas según calidad de las señales disponibles).
- NUNCA combos de 1 leg (eso es una single).
- DIVERSIDAD DE MERCADOS OBLIGATORIA: si la combinada tiene 3+ legs, los mercados deben ser DIVERSOS (mezclar 1X2, totals, córners, tarjetas, BTTS, AH, etc.). NUNCA armar combinadas de 3-4 legs todas del mismo mercado (ej: 4 "Under 2.5 goles" en distintos partidos es PEREZOSO y poco profesional). El usuario quiere VARIEDAD de mercados — combina ganadores con córners con tarjetas con goleadores.
- Mezclá perfil de riesgo: al menos 1 combo seguro (cuota total ≤ 4), 1-2 equilibrados (cuota 4-12), y opcionalmente 1 agresivo (cuota 12-50).
- Los partidos en una misma combinada NO deben estar correlacionados estructuralmente (ej: no combines "Local A gana" + "Local A marca primero" del mismo partido).
- Si no podés armar combos de alta calidad CON DIVERSIDAD DE MERCADOS, devolvé MENOS combos — preferible 2 brillantes que 5 mediocres con el mismo mercado repetido.
- Cada combo necesita una NARRATIVA que explique por qué esos partidos juntos tienen sentido + qué hace interesante la mezcla de mercados.

Devolvés JSON estricto:
{
  "combos": [
    {
      "legs": [<índices del pool, ej [3, 7, 12]>],
      "risk": "seguro" | "equilibrado" | "agresivo",
      "narrative": "<2-3 frases que expliquen la lógica de unir estos partidos>",
      "edge": "<frase corta: por qué esta combinada tiene valor real vs el mercado>",
      "keyFactor": "<el factor más importante a vigilar antes del kickoff>"
    },
    ...
  ]
}`;

  const userPrompt = `POOL DE PICKS DE ALTA CALIDAD (top ${topPool.length} con EV positivo + data profunda):

${poolSummary}

Generá las ${count} mejores combinadas posibles. Usá los índices del pool. Recordá: calidad > cantidad.`;

  let aiResp = null;
  try {
    aiResp = await preferredJson(systemPrompt, userPrompt, { maxTokens: 2500, temperature: 0.5 });
  } catch (e) {
    log(`[curated] AI err: ${e?.message?.slice(0, 100)}`);
  }

  let aiCombos = Array.isArray(aiResp?.combos) ? aiResp.combos : [];

  // FALLBACK ALGORÍTMICO: si el LLM curator devolvió vacío pero tenemos
  // 4+ picks en el pool, generamos combos por score con diversidad de riesgo.
  // El usuario merece ver combos en lugar de pantalla vacía.
  if (!aiCombos.length && topPool.length >= 4) {
    log(`[curated] LLM curator vacío — generando algorítmicamente desde pool de ${topPool.length}`);
    const ranked = topPool.slice().sort((a, b) => b.score - a.score);

    // Generamos hasta `count` combos:
    // 1) Seguro: top 2-3 picks (cuota total más baja)
    // 2) Equilibrado: top 3 distintos (cuota media)
    // 3) Agresivo: top 4 con cuotas medias-altas
    const usedIndices = new Set();
    function pickIndices(n, startIdx, preferLowOdd) {
      const picked = [];
      const seenEvents = new Set();
      const candidates = preferLowOdd
        ? ranked.slice().sort((a, b) => a.sel.odd - b.sel.odd)
        : ranked;
      for (let i = startIdx; i < candidates.length && picked.length < n; i++) {
        const p = candidates[i];
        if (seenEvents.has(p.event.id)) continue;
        const originalIdx = topPool.indexOf(p);
        if (originalIdx < 0) continue;
        picked.push(originalIdx);
        seenEvents.add(p.event.id);
      }
      return picked;
    }

    const fallbackCombos = [];
    // Seguro: 2 legs cuota más baja
    if (topPool.length >= 2) {
      const idx = pickIndices(2, 0, true);
      if (idx.length === 2) {
        fallbackCombos.push({
          legs: idx,
          risk: 'seguro',
          narrative: 'Combinada conservadora con los dos picks de mejor relación valor/cuota del día. Ambos partidos con señales claras de los modelos cuantitativos.',
          edge: 'EV positivo en cada leg, cuota total accesible.',
          keyFactor: 'Verificar alineaciones 30 min antes del kickoff.'
        });
      }
    }
    // Equilibrado: 3 legs top
    if (topPool.length >= 3) {
      fallbackCombos.push({
        legs: pickIndices(3, 0, false),
        risk: 'equilibrado',
        narrative: 'Combinada equilibrada que aprovecha los 3 mejores picks del día por score compuesto (EV + confianza + tier de liga).',
        edge: 'Combinación de valor del mercado con consistencia de modelo.',
        keyFactor: 'Lesiones de último momento.'
      });
    }
    // Agresivo: 4 legs si hay
    if (topPool.length >= 4 && fallbackCombos.length < count) {
      fallbackCombos.push({
        legs: pickIndices(4, 1, false),
        risk: 'agresivo',
        narrative: 'Combinada agresiva que multiplica valor combinando 4 picks con edge positivo. Mayor cuota pero exige acierto en todos los partidos.',
        edge: 'EV acumulado alto si la correlación entre legs es baja.',
        keyFactor: 'Es 4 legs — un solo fallo cae todo. Stake recomendado: 1-2% de banca.'
      });
    }

    aiCombos = fallbackCombos.slice(0, count);
  }

  if (!aiCombos.length) {
    return res.json({
      combos: [],
      meta: {
        reason: 'ai-empty',
        analyzed: analyzed.length,
        poolSize: pool.length,
        message: pool.length < 4
          ? `Solo encontramos ${pool.length} picks con valor positivo. Necesitamos al menos 4 para armar combinadas de calidad. Probá ampliar el deporte o esperá unos minutos a que el motor analice más partidos.`
          : 'La IA no pudo armar combinadas con confianza suficiente del pool actual.'
      }
    });
  }

  // 7) Hidratar las combinadas con datos reales + ENFORZAR DIVERSIDAD
  const combos = aiCombos
    .map((c, idx) => {
      const indices = Array.isArray(c.legs) ? c.legs.map(Number).filter(i => i >= 0 && i < topPool.length) : [];
      if (indices.length < 2 || indices.length > 5) return null;
      // Evitar duplicados de mismo evento
      const seenEvents = new Set();
      const legs = [];
      // v5.3: permitimos hasta 3 legs del mismo partido (multi-bet típico:
      // goleador + córners + tarjetas del mismo match). Garantizamos que
      // no se repita la misma selección y que market+outcome sean únicos.
      const legsPerEvent = new Map();
      const seenSelections = new Set();   // key = eventId+market+outcome+line
      const marketsInCombo = new Map();
      for (const i of indices) {
        const p = topPool[i];
        const evId = p.event.id;
        const cur = legsPerEvent.get(evId) || 0;
        if (cur >= 3) continue;   // max 3 legs por partido
        const selKey = `${evId}|${p.sel.market}|${p.sel.outcome}|${p.sel.line || ''}`;
        if (seenSelections.has(selKey)) continue;
        seenSelections.add(selKey);
        legsPerEvent.set(evId, cur + 1);
        seenEvents.add(evId);
        marketsInCombo.set(p.sel.market, (marketsInCombo.get(p.sel.market) || 0) + 1);
        legs.push({
          eventId: p.event.id,
          home: p.event.home?.name,
          away: p.event.away?.name,
          sport: p.event.sport,
          league: p.event.leagueName || p.event.league,
          start: p.event.start,
          market: p.sel.market,
          outcome: p.sel.outcome,
          line: p.sel.line || null,
          analytical: !!p.sel.analytical,
          analyticalDisclaimer: p.sel.analyticalDisclaimer || null,
          player: p.sel.player || null,
          label: p.sel.label,
          odd: p.sel.odd,
          book: p.sel.book,
          confidence: p.sel.confidence,
          ev: p.sel.consensusEv,
          rationale: p.sel.rationale || '',
          factors: (p.sel.factors || []).slice(0, 3)
        });
      }
      if (legs.length < 2) return null;

      // ── ENFORCE DIVERSITY: si 3+ legs y todas del MISMO market, sustituimos ──
      // Para combos de 3+ legs, ningún mercado debe ocupar más del 60% de las legs.
      if (legs.length >= 3) {
        const dominantMarket = [...marketsInCombo.entries()]
          .sort((a, b) => b[1] - a[1])[0];
        if (dominantMarket && dominantMarket[1] / legs.length > 0.6) {
          // Buscar picks de OTROS mercados en el pool para reemplazar
          const dominantMkt = dominantMarket[0];
          const usedEventIds = new Set(legs.map(l => l.eventId));
          const diversityCandidates = topPool.filter(p =>
            p.sel.market !== dominantMkt && !usedEventIds.has(p.event.id)
          ).slice(0, 4);
          // Reemplazar legs excedentes del market dominante
          const allowedFromDominant = Math.max(1, Math.floor(legs.length * 0.5));
          let removedFromDominant = 0;
          for (let i = legs.length - 1; i >= 0 && diversityCandidates.length; i--) {
            if (legs[i].market === dominantMkt && (marketsInCombo.get(dominantMkt) - removedFromDominant) > allowedFromDominant) {
              const replacement = diversityCandidates.shift();
              if (replacement) {
                legs[i] = {
                  eventId: replacement.event.id,
                  home: replacement.event.home?.name,
                  away: replacement.event.away?.name,
                  sport: replacement.event.sport,
                  league: replacement.event.leagueName || replacement.event.league,
                  start: replacement.event.start,
                  market: replacement.sel.market,
                  outcome: replacement.sel.outcome,
                  line: replacement.sel.line || null,
                  analytical: !!replacement.sel.analytical,
                  analyticalDisclaimer: replacement.sel.analyticalDisclaimer || null,
                  player: replacement.sel.player || null,
                  label: replacement.sel.label,
                  odd: replacement.sel.odd,
                  book: replacement.sel.book,
                  confidence: replacement.sel.confidence,
                  ev: replacement.sel.consensusEv,
                  rationale: replacement.sel.rationale || '',
                  factors: (replacement.sel.factors || []).slice(0, 3)
                };
                removedFromDominant++;
              }
            }
          }
        }
      }

      const totalOdd = legs.reduce((a, l) => a * l.odd, 1);
      // Contar mercados únicos para el meta
      const uniqueMarkets = [...new Set(legs.map(l => l.market))];
      return {
        id: `curated-${idx}-${Date.now()}`,
        legs,
        legCount: legs.length,
        marketsCount: uniqueMarkets.length,
        marketsUsed: uniqueMarkets,
        totalOdd: Number(totalOdd.toFixed(2)),
        avgConfidence: Number((legs.reduce((a, l) => a + (l.confidence || 0), 0) / legs.length).toFixed(3)),
        avgEv: Number((legs.reduce((a, l) => a + (l.ev || 0), 0) / legs.length).toFixed(2)),
        risk: c.risk || (totalOdd < 4 ? 'seguro' : totalOdd < 12 ? 'equilibrado' : 'agresivo'),
        narrative: String(c.narrative || '').slice(0, 600),
        edge: String(c.edge || '').slice(0, 250),
        keyFactor: String(c.keyFactor || '').slice(0, 200),
        sportsCount: new Set(legs.map(l => l.sport)).size
      };
    })
    .filter(Boolean);

  res.json({
    combos: combos.slice(0, count),
    meta: {
      analyzedEvents: analyzed.length,
      poolSize: pool.length,
      topPoolSize: topPool.length,
      sport,
      includeEsports,
      generatedAt: Date.now()
    }
  });
});

// Generador IA: misma pipeline pero con knobs (riesgo, ligas, mercados, n combinadas)
// v5.1: markets default ahora incluye TODOS los mercados analíticos también
// (córners, tarjetas, goleadores, marcador exacto, etc.) para que el generador
// produzca combinadas variadas en vez de "4 unders y un h2h".
app.post('/api/generator', express.json(), async (req, res) => {
  // Catálogo COMPLETO de mercados — single source of truth en lib/marketCatalog.
  // Antes era una lista manual desincronizada con el prompt LLM. Ahora todo
  // sale del mismo catálogo (126 keys legacy + variantes nuevas).
  // El LLM ve el mismo catálogo en ai-pipeline.llmStructured() vía describeForPrompt.
  const { allLegacyKeys: _allLegacyKeys } = require('./lib/marketCatalog');
  const ALL_MARKETS_DEFAULT = _allLegacyKeys();

  const {
    sport = 'all', leagues = [], risk = 'eq', legs = 3, count = 3,
    minSharp = 0, skipInjured = false, skipBadWeather = false,
    skipCorrelated = true, markets = ALL_MARKETS_DEFAULT,
    books = []
  } = req.body || {};

  // Trace de filtros (para ver dónde se pierden eventos)
  const trace = {};
  trace.orchestratorAll = orchestrator.events({ sport: 'all' }).length;
  trace.orchestratorSport = orchestrator.events({ sport: sport === 'all' ? 'all' : sport }).length;

  let events = orchestrator.events({ sport: sport === 'all' ? 'all' : sport });
  trace.afterSportFilter = events.length;
  // Filtro bestOdds.h2h relajado: acepta también events con markets.h2h (que es
  // donde realmente vive la cuota). bestOdds es un derivado que puede no estar
  // poblado para todos los eventos.
  events = events.filter(e => e.bestOdds?.h2h || (e.markets?.h2h && Object.keys(e.markets.h2h).length));
  trace.afterH2hFilter = events.length;

  if (leagues.length && !leagues.includes('all')) {
    events = events.filter(e => leagues.includes(e.league));
    trace.afterLeagueFilter = events.length;
  }
  const wantedBooks = Array.isArray(books) ? books.filter(Boolean) : [];

  // Excluir esports a menos que se pidan explícitamente — sin esto las
  // simulaciones NBA H2H GG League dominan el pool del Generator.
  const includeEsports = req.body?.includeEsports === true || sport === 'esports';
  if (!includeEsports) {
    events = events.filter(e => e.sport !== 'esports' && !orchestrator.looksLikeEsports?.(e));
  }
  trace.afterEsportsFilter = events.length;

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
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 8));
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
  // Tracking de cuántos eventos tuvieron LLM válido vs offline.
  // ANTES filtrábamos out los offline → si todos los providers caen, el
  // Generator devolvía 0 partidos analizados aunque hubiera 500+ disponibles.
  // AHORA mantenemos los offline para que el motor cuantitativo (Poisson +
  // Elo + Shin fair) siga generando combinadas. El frontend puede mostrar
  // disclaimer si llmOk es bajo.
  const llmOk = analyzed.filter(a => a.llmProvider && a.llmProvider !== 'offline').length;
  const llmOffline = analyzed.length - llmOk;

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
      // Analytical picks NO se filtran por casa (no tienen book asignado)
      .filter(s => s.analytical || !wantedBooks.length || wantedBooks.includes(s.book));
    for (const sel of evSelections) {
      // Scoring v5.5 — "máxima precisión dentro del riesgo elegido por el user"
      //
      // El user fija el riesgo (cuota target, legs, count). El motor NO debe
      // penalizar magnitud de cuota — debe maximizar la PROBABILIDAD REAL
      // del pick condicionado a su cuota. Una cuota de 5.0 con 35% prob real
      // y EV+8% es OBJETIVAMENTE MEJOR que una cuota de 1.5 con 65% prob real
      // y EV-3% — aunque la primera "parezca más arriesgada".
      //
      // Score por leg = z-score de calidad:
      //   • conf × edge: cuánto cree el modelo Y cuánto excede el precio fair
      //   • confianza relativa al precio: prob real / prob implícita
      //   • boost analíticos para diversidad (corners/tarjetas/props)
      //   • factor coherencia: penaliza picks con factors negativos críticos
      //
      // El user_decide cuota total — la combinación de legs se busca después
      // (buildOneCombo) con sampling exhaustivo respetando target_odd.
      const ev = sel.consensusEv || 0;          // % (-100..+100), value vs fair
      const conf = sel.confidence || 0;         // 0..1, prob real del modelo
      const odd = sel.odd || 1.5;
      const fairProb = odd > 1.01 ? (1 / odd) : 0.5;
      // edge = qué tan undervalued está la cuota para el modelo
      const edgeRatio = fairProb > 0 ? Math.max(0, (conf - fairProb) / fairProb) : 0;
      // Score base: confidence relativa al precio (no absoluta).
      // Una cuota de 1.5 con conf 70% (esperada 67%) tiene edgeRatio ~0.05.
      // Una cuota de 4.0 con conf 30% (esperada 25%) tiene edgeRatio ~0.20.
      // → la segunda es MEJOR porque el modelo cree que el precio está mal.
      let score = (ev || 0) * 0.5            // EV crudo en %, 0.5x para no dominar
                + edgeRatio * 100            // edge ratio en %
                + conf * 3;                  // pequeño boost por confianza absoluta
      // Factor de coherencia: si los factors marcan riesgo crítico (lesiones
      // severas del lado favorecido, clima muy adverso para totals altos, etc.)
      // → penalizamos el score para que el motor prefiera otros candidatos.
      const factors = a.factors || {};
      const sev = factors.injuries?.severityScore;
      if (sev) {
        // Si la lesión severa está del lado que el pick favorece, malo.
        const isHomePick = /home|local|1$/.test(String(sel.outcome));
        const isAwayPick = /away|visit|2$/.test(String(sel.outcome));
        if (isHomePick && sev.home > 0.4) score -= 6;
        if (isAwayPick && sev.away > 0.4) score -= 6;
      }
      // Clima adverso (lluvia / viento) para mercados de goles altos
      const wm = factors.weather?.impact?.goalsMultiplier;
      if (wm && wm < 0.88 && /over|btts/.test(String(sel.outcome))) score -= 3;
      // Sharp money respaldando el lado del pick → boost
      const sharpScore = factors.sharp?.score || 0;
      if (sharpScore > 0.5) score += 2;
      // Mercados analíticos: boost para diversidad (corners/cards/props) —
      // si no, h2h domina TODO el pool y las combinadas son siempre 3 h2h.
      if (sel.analytical) score += 3;
      pool.push({ event: a.event, factors: a.factors, sel, score });
    }
  }
  pool.sort((a, b) => b.score - a.score);

  // ── Estrategia de construcción de combos ──
  // legsPerMatch: cuántos legs del mismo partido se permiten (1 = clásico, 2-3 = multi-leg)
  // targetOdd: objetivo de cuota total (null = libre)
  // mixSports: si true, busca diversidad de deporte
  // useAiBuilder: si true Y hay LLM disponible, pide a Groq que elija los combos
  // v5.3: default 3 — permite multi-leg del mismo partido (corners + cards + goleador
  // de un mismo match es la combinada profesional que el usuario pidió).
  const legsPerMatch = Math.max(1, Math.min(5, Number(req.body?.legsPerMatch) || 3));
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
    const usedMarkets = new Map();   // market → count
    // Diversity threshold ESTRICTO: ningún mercado puede repetirse en 2+ legs
    // si hay >=2 legs. Esto fuerza variedad real (h2h + corners + cards + ...).
    const maxLegsPerMarket = legs >= 2 ? 1 : legs;

    // PASADA 1: STRICT — ningún mercado repetido. Si no logramos completar
    // las N legs, hacemos una pasada 2 relajada.
    for (const p of candidates) {
      const evId = p.event.id;
      const cur = usedByEvent.get(evId) || 0;
      if (cur >= legsPerMatch) continue;
      const mktCount = usedMarkets.get(p.sel.market) || 0;
      if (mktCount >= maxLegsPerMarket) continue;  // STRICT: no repetimos mercado
      if (mixSports && usedSports.has(p.event.sport) && chosen.length < legs && candidates.some(c => !usedSports.has(c.event.sport) && !chosen.includes(c))) {
        continue;
      }
      chosen.push(p);
      usedByEvent.set(evId, cur + 1);
      usedSports.add(p.event.sport);
      usedMarkets.set(p.sel.market, mktCount + 1);
      if (chosen.length >= legs) break;
    }

    // PASADA 2: relajar diversidad — si no completamos N legs, permitimos
    // 2 del mismo mercado (pero nunca 3+). Mejor combinada un poco más
    // monocromática que devolver menos legs.
    if (chosen.length < legs) {
      const relaxedMax = 2;
      for (const p of candidates) {
        if (chosen.includes(p)) continue;
        const evId = p.event.id;
        const cur = usedByEvent.get(evId) || 0;
        if (cur >= legsPerMatch) continue;
        const mktCount = usedMarkets.get(p.sel.market) || 0;
        if (mktCount >= relaxedMax) continue;
        chosen.push(p);
        usedByEvent.set(evId, cur + 1);
        usedMarkets.set(p.sel.market, mktCount + 1);
        if (chosen.length >= legs) break;
      }
    }
    // PASADA 3 (último recurso): si igual no llegamos, llenamos sin restricciones
    if (chosen.length < legs) {
      for (const p of candidates) {
        if (chosen.includes(p)) continue;
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

    // Re-evaluar correlación final (puede haber cambiado tras swaps) y aplicar
    // el evAdjustment al EV bruto. evAdjustment ∈ [-0.40, 0]: cuando hay legs
    // correlacionadas positivas, la casa infla la cuota — el EV "real" para el
    // apostador es menor que la suma cruda. Reportamos ambos al cliente para
    // transparencia (sumEv = bruto, evAdjusted = post-correlación).
    const finalCorr = analyzeCombo(comboLegs);
    const sumEv = comboLegs.reduce((a, b) => a + (b.ev || 0), 0);
    const evAdj = Number(finalCorr.evAdjustment) || 0;
    const evAdjusted = sumEv * (1 + evAdj);

    return {
      legs: comboLegs,
      totalOdd: Number(totalOdd.toFixed(2)),
      avgConfidence: Number((comboLegs.reduce((a, b) => a + (b.confidence || 0), 0) / comboLegs.length).toFixed(3)),
      sumEv: Number(sumEv.toFixed(2)),
      evAdjusted: Number(evAdjusted.toFixed(2)),
      correlation: finalCorr,
      type: targetType,
      legCount: comboLegs.length,
      sportsCount: new Set(comboLegs.map(l => l.sport)).size
    };
  }

  // ── Búsqueda EXHAUSTIVA de combinaciones (v5.5) ────────────────────────
  // El user fija cuota target + legs + count. El motor genera MUCHOS más
  // candidatos que los `count` finales y los rankea por score compuesto
  // (prob real × edge × coherencia entre legs × cumplimiento del target).
  // El user NUNCA va a ver un combo "primero que cumple" — ve los top-K.
  const TIME_BUDGET_MS = 9000;     // máx para no exceder el timeout LLM downstream
  const TARGET_CANDIDATES = Math.max(40, count * 12);  // ej. count=3 → ~36 candidatos
  const allCandidates = [];
  const seenSigs = new Set();
  const t0Combo = Date.now();
  // Alternamos tipo para diversidad — el risk del user es el primary type,
  // pero rotamos para no devolver siempre el mismo perfil.
  const typeOrder = [risk, risk === 'cons' ? 'eq' : risk === 'eq' ? 'agg' : 'eq',
                     'eq', risk === 'agg' ? 'eq' : 'agg', 'cons'];
  let attempts = 0;
  while (allCandidates.length < TARGET_CANDIDATES && attempts < TARGET_CANDIDATES * 4) {
    if (Date.now() - t0Combo > TIME_BUDGET_MS) break;
    const t = typeOrder[attempts % typeOrder.length];
    const combo = buildOneCombo(t, seenSigs, allCandidates.length);
    if (combo) allCandidates.push(combo);
    attempts++;
  }

  // Score compuesto por candidato:
  //   • prob real (producto de avgConfidence × leg confidences) — peso principal
  //   • edge ajustado por correlación (evAdjusted) — premia value
  //   • cumplimiento del target_odd si el user lo fijó
  //   • diversidad de mercados (más mercados distintos = más robusto)
  //   • bonus por tier alto (top leagues = más data, menos varianza)
  function scoreCombo(c) {
    const probReal = c.legs.reduce((a, l) => a * Math.max(0.05, l.confidence || 0.5), 1);
    const edgeAdj = (c.evAdjusted != null ? c.evAdjusted : c.sumEv) || 0;
    const diversity = new Set(c.legs.map(l => l.market)).size / c.legs.length;
    let s = probReal * 100              // prob real total en %
          + edgeAdj * 0.6                // edge adjusted descontado por correlación
          + diversity * 5                // diversidad de mercados
          + (c.sportsCount || 1) * 1.5;  // mixSports bonus suave
    // Target_odd compliance: si el user lo pidió, penalizar combos lejos del target.
    if (targetOdd) {
      const distance = Math.abs(c.totalOdd - targetOdd) / targetOdd;
      s -= distance * 25;                // 25% de penalización por cada 100% de desvío
    }
    // Penalizar correlación positiva fuerte entre legs (book inflando cuota).
    const maxCorr = c.correlation?.maxPositiveCorrelation || 0;
    if (maxCorr > 0.30) s -= maxCorr * 20;
    return s;
  }

  // Rankear y quedarnos con los top `count`.
  allCandidates.sort((a, b) => scoreCombo(b) - scoreCombo(a));
  const combos = allCandidates.slice(0, count);
  // Anotamos el score en cada combo para debug + UI ("calidad" score)
  combos.forEach(c => { c.qualityScore = Number(scoreCombo(c).toFixed(2)); });
  trace.candidatesEvaluated = allCandidates.length;
  trace.combosTimeBudgetMs = Date.now() - t0Combo;

  // Si activaron useAiBuilder Y tenemos algún LLM, le pedimos al modelo que
  // ELIJA los mejores combos del pool con justificación profunda — no solo EV
  // ranking. Antes solo chequeábamos BS_GROQ_API_KEY (filtro estrecho que
  // dejaba sin IA a setups con sólo Gemini/Claude); ahora cualquier proveedor
  // activa el path y caemos a una cascada Gemini → Groq.
  let aiNarrative = null;
  let aiProvider = null;
  const HAS_ANY_LLM = !!(process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY ||
                         process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY);
  if (useAiBuilder && pool.length >= legs && HAS_ANY_LLM) {
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
      // Cascada GEMINI-FIRST 3-retries — el user pidió Gemini al 100% con
      // fallbacks. Si Gemini falla 3 veces consecutivas, cae a Groq.
      let aiResult = null;
      const aiOpts = { maxTokens: 2000, temperature: 0.4 };
      if (process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY) {
        for (let att = 1; att <= 3 && !aiResult?.combos; att++) {
          try {
            aiResult = await geminiJsonGeneric(systemPrompt, aiPrompt, aiOpts);
            if (aiResult?.combos) aiProvider = 'gemini';
          } catch (e) {
            log(`[generator:gemini attempt ${att}] ${e?.message?.slice(0, 120)}`);
            if (att < 3) await new Promise(r => setTimeout(r, 250 * Math.pow(3, att - 1)));
          }
        }
      }
      if (!aiResult?.combos && (process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY)) {
        try {
          aiResult = await groqJsonGeneric(systemPrompt, aiPrompt, aiOpts);
          if (aiResult?.combos) aiProvider = 'groq';
        } catch (e) { log(`[generator:groq fallback] ${e?.message?.slice(0, 120)}`); }
      }
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
          const corrR = analyzeCombo(legs);
          const sumEvR = legs.reduce((a, b) => a + (b.ev || 0), 0);
          const evAdjR = Number(corrR.evAdjustment) || 0;
          aiCombos.push({
            legs, totalOdd: Number(totalOdd.toFixed(2)),
            avgConfidence: Number((legs.reduce((a, b) => a + (b.confidence || 0), 0) / legs.length).toFixed(3)),
            sumEv: Number(sumEvR.toFixed(2)),
            evAdjusted: Number((sumEvR * (1 + evAdjR)).toFixed(2)),
            correlation: corrR,
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
    aiProvider,                                  // 'gemini' | 'groq' | null
    aiHealth: aiProvider                         // estado para que el frontend
              ? 'ok'                              // muestre badge correcto en vez
              : useAiBuilder && HAS_ANY_LLM      // de hardcodear "groq".
                ? 'degraded'
                : useAiBuilder
                  ? 'no-keys'
                  : 'disabled',
    meta: {
      analyzed: analyzed.length,
      passing: passing.length,
      poolSize: pool.length,
      llmOk, llmOffline,
      // Disclaimer cuando llmOk == 0 → el motor cuantitativo solo (Poisson+Elo)
      // armó los combos. Análisis menos profundo que con LLM.
      llmDegraded: llmOk === 0 && llmOffline > 0,
      trace,  // diag: tamaños por filtro step
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

  // 1) Parse con LLM (Gemini-primero, Groq fallback): extraer filtros estructurados
  const parserSystem = `Sos un asistente que extrae filtros estructurados de un pedido de combinada de apuestas en español argentino.
Devolvés JSON estricto con este shape:
{
  "legs": número de 2 a 8 (cuántos partidos quiere combinar),
  "sport": "soccer" | "basketball" | "tennis" | "esports" | "amfootball" | "hockey" | "baseball" | "mma" | "all",
  "leagues": ["premier-league" | "la-liga" | "serie-a" | "bundesliga" | "ligue-1" | "ucl" | "uel" | "lpf" | "libertadores" | "sudamericana" | "brasileirao" | "liga-mx" | "mls" | "nba" | "nfl" | "nhl" | "mlb" | "ufc" | ...],
  "books": ["betano" | "bplay" | "betsson" | "codere" | "betwarrior" | "casino-magic" | ...],
  "markets": ["h2h" | "totals" | "btts" | "ah" | "dc" | "corners-total" | "cards-total" | "goalscorer-anytime" | "exact-score" | "first-goalscorer" | "red-card" | "penalty" | "fouls-total" | "shots-on-target-total" | "player-points" | "ht-result" | "totals-ht" | "dnb" | "result-btts" | "first-team-score" | ...],
  "risk": "cons" (seguro) | "eq" (equilibrado) | "agg" (agresivo),
  "targetOdd": número o null (cuota total deseada),
  "minOddPerLeg": número o null,
  "maxOddPerLeg": número o null,
  "timeWindow": "today" | "tomorrow" | "weekend" | "week" | "any",
  "preferTopTeams": true|false,
  "userIntent": "<frase corta resumiendo qué quiere>"
}
REGLAS IMPORTANTES:
- Si el usuario dice "para Betano" / "en Betano" / "en bplay" → llenar "books" con esa casa en minúscula.
- Si el usuario dice "cuota más de 3" / "cuota mayor a 3" → poner "minOddPerLeg": 3.
- Si el usuario dice "cuota menos de 5" → poner "maxOddPerLeg": 5.
- Si dice "agresiva" / "arriesgada" → risk: "agg".
- Si dice "segura" / "tranqui" → risk: "cons".
- Si NO menciona cantidad de legs → "legs": null (la decide la IA después).

DETECCIÓN DE LIGAS — CRÍTICO no confundir:
- "Liga Argentina" / "Liga Profesional Argentina" / "fútbol argentino" → leagues: ["lpf"] (NUNCA agregues "la-liga")
- "La Liga" / "La Liga española" / "fútbol español" / "primera división española" → leagues: ["la-liga"]
- "Liga MX" / "fútbol mexicano" → leagues: ["liga-mx"]
- "Premier League" / "EPL" / "fútbol inglés" → leagues: ["premier-league"]
- "Serie A" / "calcio italiano" → leagues: ["serie-a"]
- "Bundesliga" → leagues: ["bundesliga"]
- "Ligue 1" / "fútbol francés" → leagues: ["ligue-1"]
- "Champions" / "Champions League" / "UCL" → leagues: ["ucl"]
- "Europa League" / "UEL" → leagues: ["uel"]
- "Libertadores" → leagues: ["libertadores"]
- "Sudamericana" → leagues: ["sudamericana"]
- "Brasileirao" / "Brasil" → leagues: ["brasileirao"]
- "NBA" → leagues: ["nba"]
- "UFC" / "MMA" → leagues: ["ufc"]
NUNCA mezcles "la-liga" con "lpf" — son ligas distintas en países distintos.

DETECCIÓN DE MERCADOS — IMPORTANTE:
- Si dice "córners" / "tiros de esquina" / "corners" → markets: ["corners-total"]
- Si dice "tarjetas" / "amonestaciones" → markets: ["cards-total"]
- Si dice "tarjeta roja" / "expulsión" → markets: ["red-card"]
- Si dice "goleadores" / "que marque X" / "anota X" → markets: ["goalscorer-anytime"]
- Si dice "primer goleador" / "abre el marcador X" → markets: ["first-goalscorer"]
- Si dice "marcador exacto" / "resultado exacto" → markets: ["exact-score"]
- Si dice "hándicap" / "handicap" → markets: ["ah"]
- Si dice "ambos marcan" / "BTTS" → markets: ["btts"]
- Si dice "más/menos goles" / "over/under" → markets: ["totals"]
- Si dice "doble oportunidad" / "1X o X2" → markets: ["dc"]
- Si dice "habrá penal" → markets: ["penalty"]
- Si dice "tiros al arco" → markets: ["shots-on-target-total"]
- Si dice "1er tiempo" / "medio tiempo" → markets: ["ht-result", "totals-ht"]
- Si dice "puntos jugador NBA" / "Lebron puntos" → markets: ["player-points"]
- Si dice "rebotes jugador" → markets: ["player-rebounds"]
- Si dice "asistencias jugador" → markets: ["player-assists"]
- Si no menciona mercado específico → markets: [] (todos disponibles)`;

  let parsed = null;
  try {
    parsed = await preferredJson(parserSystem, prompt, { maxTokens: 700, temperature: 0.2 });
  } catch (e) {
    log(`[betsafe-ai] parse err: ${e?.message?.slice(0, 100)}`);
  }
  // Defaults si el parse falla
  const filters = {
    legs: Number.isFinite(Number(parsed?.legs)) ? clamp(Number(parsed.legs), 2, 8) : null,
    sport: typeof parsed?.sport === 'string' ? parsed.sport : 'all',
    leagues: Array.isArray(parsed?.leagues) ? parsed.leagues.map(String) : [],
    books: Array.isArray(parsed?.books) ? parsed.books.map(b => String(b).toLowerCase().trim()) : [],
    markets: Array.isArray(parsed?.markets) ? parsed.markets.map(m => String(m).toLowerCase().trim()) : [],
    risk: ['cons', 'eq', 'agg'].includes(parsed?.risk) ? parsed.risk : 'eq',
    targetOdd: Number.isFinite(Number(parsed?.targetOdd)) ? Number(parsed.targetOdd) : null,
    minOddPerLeg: Number.isFinite(Number(parsed?.minOddPerLeg)) ? Number(parsed.minOddPerLeg) : null,
    maxOddPerLeg: Number.isFinite(Number(parsed?.maxOddPerLeg)) ? Number(parsed.maxOddPerLeg) : null,
    timeWindow: ['today','tomorrow','weekend','week','any'].includes(parsed?.timeWindow) ? parsed.timeWindow : 'any',
    preferTopTeams: parsed?.preferTopTeams !== false,
    userIntent: String(parsed?.userIntent || prompt).slice(0, 250)
  };

  // ── REGEX FALLBACK para books si el LLM no los extrajo ──
  if (!filters.books.length) {
    const p = prompt.toLowerCase();
    const BOOK_KW = {
      'betano':       /\bbetano\b/i,
      'bplay':        /\b(bplay|b\s*play)\b/i,
      'betsson':      /\bbetsson\b/i,
      'codere':       /\bcodere\b/i,
      'betwarrior':   /\b(bet\s*warrior|betwarrior|warrior)\b/i,
      'casino-magic': /\bcasino\s*magic\b/i
    };
    for (const [key, re] of Object.entries(BOOK_KW)) {
      if (re.test(p)) filters.books.push(key);
    }
  }

  // ── REGEX FALLBACK para markets específicos ──
  if (!filters.markets.length) {
    const p = prompt.toLowerCase();
    const MARKET_KW = {
      'corners-total':            /c[óo]rners?|tiros?\s+de\s+esquina/i,
      'cards-total':              /tarjetas?(?!\s*roja)|amonestaci[óo]n/i,
      'red-card':                 /tarjeta\s*roja|expulsi[óo]n|expulsado/i,
      'goalscorer-anytime':       /goleadore?s?|anota|que\s*marque|marcar?\s*gol/i,
      'first-goalscorer':         /primer\s*goleador|abre\s*el\s*marcador|primer\s*gol/i,
      'exact-score':              /marcador\s*exacto|resultado\s*exacto/i,
      'ah':                       /h[áa]ndicap|handicap/i,
      'btts':                     /ambos\s*(equipos\s*)?(anotan|marcan)|btts|gol\s*y\s*gol/i,
      'totals':                   /m[áa]s\s*\/?\s*menos|over\s*under|total\s*de?\s*goles/i,
      'dc':                       /doble\s*oportunidad|1x\s*o\s*x2/i,
      'penalty':                  /penal(?:ti|es)?\b/i,
      'shots-on-target-total':    /tiros\s+al\s+arco|remates\s+al\s+arco/i,
      'fouls-total':              /faltas\s+totales?/i,
      'ht-result':                /(?:1er|primer)\s*tiempo|medio\s+tiempo/i,
      'dnb':                      /empate\s*no\s*apuesta|draw\s*no\s*bet|dnb/i,
      'player-points':            /puntos?\s+(de\s+)?(jugador|lebron|curry|durant|jokic)/i,
      'player-rebounds':          /rebotes?\s+(de\s+)?(jugador|lebron|curry)/i,
      'player-assists':           /asistencias?\s+(de\s+)?(jugador|lebron|curry)/i
    };
    for (const [key, re] of Object.entries(MARKET_KW)) {
      if (re.test(p)) filters.markets.push(key);
    }
  }

  // ── REGEX FALLBACK para minOddPerLeg (NO confundir con cuota total) ──
  // Solo si la frase contiene "cuota por leg" / "cada leg" / "mín por leg"
  if (filters.minOddPerLeg == null) {
    const m = prompt.match(/cuota\s+(?:mayor|m[áa]s)\s+(?:de|a|que)\s+(\d+(?:[.,]\d+)?)\s+(?:por|cada)\s+leg/i);
    if (m) filters.minOddPerLeg = Number(m[1].replace(',', '.'));
  }

  // ── REGEX FALLBACK para targetOdd (cuota TOTAL) — CRÍTICO ──
  // Capturamos las formas más comunes en castellano rioplatense:
  //   "cuota total 15" / "cuota cerca de 15" / "cuota final 15"
  //   "que pague 15" / "que pague x15" / "x15" / "15x" / "por 15"
  //   "pagar X15" / "queremos 15" / "combinada de cuota 15"
  if (filters.targetOdd == null) {
    const patterns = [
      /cuota\s+total\s+(?:de|cerca\s+de|alrededor\s+de|aprox(?:imada)?|sobre)?\s*(\d+(?:[.,]\d+)?)/i,
      /cuota\s+(?:cerca\s+de|alrededor\s+de|aprox(?:imada)?|sobre)\s+(\d+(?:[.,]\d+)?)/i,
      /cuota\s+(?:final|combinada|target|objetivo|de)\s+(?:de\s+)?(\d+(?:[.,]\d+)?)/i,
      // "que pague x15" / "que pague 15" / "pague 15x"
      /pa(?:gar|gue)n?\s+(?:x\s*)?(?:cerca\s+de\s+)?(\d+(?:[.,]\d+)?)\s*x?/i,
      // "x15" o "x 15" o "15x" pegado a "pague/cuota/multiplicador"
      /(?:^|\s)x\s*(\d+(?:[.,]\d+)?)\b/i,
      /\b(\d+(?:[.,]\d+)?)\s*x(?:\s|$)/i,
      /(?:cuota|paga|x|multiplicador|por)\s+(\d+(?:[.,]\d+)?)\s*(?:total|combinada|final)/i,
      // "multiplique por 15" / "que multiplique 15"
      /multiplicar?\s+(?:por\s+)?(\d+(?:[.,]\d+)?)/i
    ];
    for (const re of patterns) {
      const m = prompt.match(re);
      if (m) {
        const v = Number(m[1].replace(',', '.'));
        // Solo aceptar valores razonables (1.5 a 100) para evitar matches falsos
        if (v >= 1.5 && v <= 100) { filters.targetOdd = v; break; }
      }
    }
  }

  // ── REGEX FALLBACK para timeWindow ──
  // "hoy" / "para hoy" → today
  // "mañana" / "para mañana" → tomorrow
  // "fin de semana" / "este finde" → weekend
  // "esta semana" → week
  // Sin esto, "para hoy" se ignoraba y el motor devolvía partidos de TODA la semana.
  if (parsed?.timeWindow == null) {
    const p = prompt.toLowerCase();
    if (/\b(hoy|esta\s*noche|esta\s*tarde|en\s*el\s*d[íi]a|para\s*el\s*d[íi]a\s+de\s+hoy)\b/i.test(p)) {
      filters.timeWindow = 'today';
    } else if (/\b(ma[ñn]ana|para\s*ma[ñn]ana)\b/i.test(p)) {
      filters.timeWindow = 'tomorrow';
    } else if (/\b(este\s*finde|fin\s*de\s*semana|s[áa]bado|domingo|este\s*s[áa]bado|este\s*domingo)\b/i.test(p)) {
      filters.timeWindow = 'weekend';
    } else if (/\b(esta\s*semana|los\s*pr[óo]ximos?\s*d[íi]as)\b/i.test(p)) {
      filters.timeWindow = 'week';
    }
  }

  // ── REGEX FALLBACK para legs si el LLM no lo extrajo ──
  // Capturamos "5 partidos" / "5 legs" / "combinada de 5"
  if (filters.legs == null) {
    const m = prompt.match(/\b(\d+)\s*(?:partidos?|legs?|equipos?)\b/i) ||
              prompt.match(/combinada\s+de\s+(\d+)/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 8) filters.legs = n;
    }
  }
  // Default 3 si nada se detectó
  if (filters.legs == null) filters.legs = 3;

  // ── CRITICAL FIX: el LLM a veces confunde "Liga Argentina" con "la-liga".
  // Si el prompt contiene CLARAMENTE "argentina"/"argentino" → forzar lpf
  // y borrar la-liga si fue agregada incorrectamente.
  // Tolerante a typos comunes: "argentn[ao]" (sin 'i'), "argentín[ao]" (con tilde)
  const promptLower = prompt.toLowerCase();
  const mentionsArg = /\bargen?t[ií]?n?[ao]?\b|liga\s*arg|liga\s*profesional|\blpf\b|primera\s*nacional|\bafa\b|river|boca|racing|independiente|san\s*lorenzo|estudiantes|v[ée]lez/i.test(promptLower);
  const mentionsEsp = /espa[ñn]ol|laliga|la\s*liga\s*espa|primera\s*divisi[óo]n\s*esp|real\s*madrid|barcelon|atl[ée]tico\s*madrid/i.test(promptLower);
  if (mentionsArg && !mentionsEsp) {
    // El usuario QUIERE Liga Argentina. Si el LLM agregó la-liga, sacarla.
    filters.leagues = filters.leagues.filter(l => l !== 'la-liga');
    if (!filters.leagues.includes('lpf')) filters.leagues.push('lpf');
  }
  if (mentionsEsp && !mentionsArg) {
    filters.leagues = filters.leagues.filter(l => l !== 'lpf');
    if (!filters.leagues.includes('la-liga')) filters.leagues.push('la-liga');
  }

  // ── REGEX FALLBACK: si el LLM no extrajo leagues, hacemos detection manual
  // por keywords en el prompt. Esto es CRÍTICO porque a veces el parser falla
  // y el resultado son partidos random.
  if (!filters.leagues.length) {
    const p = prompt.toLowerCase();
    // ORDEN IMPORTANTE: chequear "Liga Argentina"/lpf ANTES que "la-liga"
    // (porque ambas contienen "liga"). Las regex de lpf son más específicas.
    const KW_ORDERED = [
      ['lpf',            /(liga\s*argentina|liga\s*profesional\s*argentina|primera\s*argentina|\blpf\b|liga\s*profesional\s*de\s*f[úu]tbol)/i],
      ['copa-argentina', /(copa\s*argentina)/i],
      ['primera-nacional', /(primera\s*nacional)/i],
      ['premier-league', /(premier\s*league|premier(?:\s+inglesa)?|\bepl\b)/i],
      ['la-liga',        /(la\s*liga\s*(?:espa)?|laliga|primera\s*divisi[óo]n\s*esp|liga\s*espa[ñn]ola)/i],
      ['serie-a',        /(serie\s*a|seriea|italia(?:no)?\s*serie)/i],
      ['bundesliga',     /(bundesliga|alemana)/i],
      ['ligue-1',        /(ligue\s*[1u]|ligue1|francesa)/i],
      ['ucl',            /(champions(?:\s*league)?|\bucl\b|uefa\s*champions)/i],
      ['uel',            /(europa\s*league|\buel\b)/i],
      ['libertadores',   /(libertadores|copa\s*libertadores)/i],
      ['sudamericana',   /(sudamericana|copa\s*sudamericana)/i],
      ['brasileirao',    /(brasileir[ãa]o|brasil(?:e[ñn]o)?)/i],
      ['liga-mx',        /(liga\s*mx|liga\s*mexicana)/i],
      ['mls',            /(\bmls\b|major\s*league\s*soccer)/i],
      ['nba',            /(\bnba\b|baloncesto\s*nba)/i],
      ['nfl',            /(\bnfl\b)/i],
      ['nhl',            /(\bnhl\b)/i],
      ['mlb',            /(\bmlb\b|major\s*league\s*baseball)/i],
      ['ufc',            /(\bufc\b|mma)/i]
    ];
    for (const [key, re] of KW_ORDERED) {
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
  // ── Filtro de liga ROBUSTO ──
  // Antes, el slug 'lpf' no matcheaba leagueName "Liga Profesional de Fútbol"
  // porque buscaba literal "lpf". Ahora usamos un mapa de slug → patterns
  // que cubre los nombres reales en español + inglés.
  if (filters.leagues.length) {
    const LEAGUE_PATTERNS = {
      'premier-league': /premier\s*league|premiership\b|english.*premier|epl/i,
      'la-liga':        /la\s*liga|laliga|primera\s*divisi[óo]n\s*esp|liga\s*espa[ñn]ola/i,
      'serie-a':        /serie\s*a\b/i,
      'bundesliga':     /bundesliga/i,
      'ligue-1':        /ligue\s*[1u]|ligue1/i,
      'ucl':            /champions\s*league|uefa\s*champions|^ucl\b/i,
      'uel':            /europa\s*league|^uel\b/i,
      'libertadores':   /libertadores/i,
      'sudamericana':   /sudamericana/i,
      // STRICT: requiere "argentina" o LPF explícito — sin esto "Liga Profesional Saudí" matcheaba.
      'lpf':            /(?:liga\s*profesional\s*de\s*f[úu]tbol|liga\s*profesional\s*argentina|liga\s*argentina|primera\s*argentina|primera\s*divisi[óo]n\s*argentin|\blpf\b|apertura\s*argentin|clausura\s*argentin)/i,
      'copa-argentina': /copa\s*argentina/i,
      'brasileirao':    /brasileir[ãa]o|brasil\s*serie/i,
      'liga-mx':        /liga\s*mx|liga\s*mexicana/i,
      'mls':            /\bmls\b|major\s*league\s*soccer/i,
      'nba':            /\bnba\b/i,
      'ufc':            /\bufc\b/i,
      'primera-nacional': /primera\s*nacional|nacional\s*b\b/i,
      'copa-mundial':   /copa\s*mundial|mundial\s*fifa|world\s*cup/i
    };
    const matchers = filters.leagues
      .map(slug => LEAGUE_PATTERNS[slug] || new RegExp(slug.replace(/-/g, '[\\s-]?'), 'i'));
    candidates = candidates.filter(e => {
      const name = String(e.leagueName || '');
      const slug = String(e.league || '');
      // CRÍTICO: NO usar slug fallback porque los events viejos del orchestrator
      // pueden tener slug='lpf' incorrecto (cacheados antes del fix masivo de
      // LEAGUE_MAP). Solo matcheamos por NOMBRE de liga vía regex stricto.
      return matchers.some(re => re.test(name));
    });
    log(`[betsafe-ai] league filter ${filters.leagues.join(',')}: ${candidates.length} candidates`);
  }
  // Filtro: top teams (si el user pide "no tan riesgosa" implícitamente quiere top teams)
  if (filters.preferTopTeams && filters.risk === 'cons') {
    candidates.sort((a, b) => (orchestrator.eventPriority?.(b) || 0) - (orchestrator.eventPriority?.(a) || 0));
  }

  // ── NUEVO: filtro por casa ──
  // Si el usuario pidió "para Betano" (o cualquier otra casa), filtramos
  // candidates donde esa casa tenga cuotas para el evento. Sin esto, el motor
  // analizaba el pool entero y muchas veces no había picks rescatables para
  // la casa pedida.
  if (filters.books.length) {
    const requestedBooks = new Set(filters.books);
    candidates = candidates.filter(e => {
      const h2hBooks = Object.keys(e.markets?.h2h || {});
      return h2hBooks.some(b => requestedBooks.has(b));
    });
    log(`[betsafe-ai] book filter ${[...requestedBooks].join(',')}: ${candidates.length} candidates`);
  }

  if (!candidates.length) {
    const bookList = filters.books.length ? ` en ${filters.books.join('/')}` : '';
    return res.json({
      ok: false,
      reason: 'no-events',
      message: `No encontramos partidos${bookList} que cumplan tus filtros en la ventana de tiempo pedida. Probá ampliar las ligas, el periodo o no especificar una casa.`,
      filters
    });
  }

  // 3) Analizar los top candidates con la pipeline.
  // TOP_N: pool de eventos a analizar antes de seleccionar las legs finales.
  // Si hay filtros restrictivos (minOdd, books), ampliamos el pool para tener
  // más opciones antes de rechazar por filtros.
  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;
  const hasRestrictiveFilters = !!(filters.minOddPerLeg || filters.books.length);
  const TOP_N = Math.min(
    hasRestrictiveFilters ? 20 : 14,
    Math.max(8, filters.legs * 2),
    candidates.length
  );
  const top = candidates.slice(0, TOP_N);
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 8));
  const analyzed = await Promise.allSettled(
    top.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
  );

  // Helper: si el user pidió una casa específica, intentamos REEMPLAZAR la cuota
  // de la selection (que usa la mejor casa por default) con la de la casa pedida,
  // si existe para ese mercado/outcome. Si no existe, el pick queda fuera.
  function tryBookOverride(sel, event) {
    if (!filters.books.length) return sel;
    const requested = filters.books;
    // Buscar la cuota en alguna de las casas pedidas para el mercado/outcome del sel
    const mkt = sel.market;
    const outcome = sel.outcome;
    for (const book of requested) {
      let odd = null;
      if (mkt === 'h2h') {
        odd = event.markets?.h2h?.[book]?.[outcome];
      } else if (mkt === 'totals' && sel.line != null) {
        odd = event.markets?.totals?.[book]?.[sel.line]?.[outcome];
      } else if (mkt === 'btts') {
        odd = event.markets?.btts?.[book]?.[outcome];
      } else if (mkt === 'dc') {
        odd = event.markets?.dc?.[book]?.[outcome];
      } else if (mkt === 'ah' && sel.line != null) {
        odd = event.markets?.ah?.[book]?.[sel.line]?.[outcome];
      }
      if (Number.isFinite(odd) && odd > 1.01) {
        // Encontramos cuota en la casa pedida → usar esa
        return { ...sel, odd: Number(odd), book };
      }
    }
    return null; // ninguna casa pedida tiene esta combinación → descartar
  }

  const pool = [];
  for (const r of analyzed) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const a = r.value;
    const wantType = filters.risk;

    // ── Si el user pidió MERCADOS específicos (córners, tarjetas, goleadores,
    // etc.), buscamos selections de ESOS mercados. Sino, agregamos TODAS las
    // selections del partido — h2h, totals, btts, corners-total, cards-total,
    // goalscorers, etc. — para que el motor de selección final (más abajo)
    // pueda armar combinadas DIVERSAS, no 3 h2h iguales.
    const candidateSels = [];
    if (filters.markets.length) {
      for (const s of (a.selections || [])) {
        if (filters.markets.includes(s.market)) candidateSels.push(s);
      }
    } else {
      // Antes: solo 1 sel por partido (típicamente h2h). Esto causaba que
      // todas las combinadas fueran 3 h2h. Ahora: TODAS las selections van
      // al pool. Si un partido tiene 1 h2h + 1 corners + 1 cards, los 3
      // van al pool y el algoritmo de leg selection elige los mejores
      // bonificando diversidad de mercados.
      for (const s of (a.selections || [])) {
        if (s && s.odd) candidateSels.push(s);
      }
    }

    for (let sel of candidateSels) {
      if (!sel || !sel.odd) continue;
      // Si el user pidió casa específica Y el pick NO es analítico → intentar override.
      // Los analíticos no se filtran por casa (no tienen book asignado).
      if (filters.books.length && !sel.analytical) {
        const overridden = tryBookOverride(sel, a.event);
        if (!overridden) continue;
        sel = overridden;
      }
      if (filters.minOddPerLeg && sel.odd < filters.minOddPerLeg) continue;
      if (filters.maxOddPerLeg && sel.odd > filters.maxOddPerLeg) continue;
      pool.push({ event: a.event, factors: a.factors, sel, llmKey: a.llmKeyFactor, llmSynth: a.llmSynthesis });
    }
  }

  // ── MODO STRICT: si el usuario pidió liga específica + cantidad específica,
  // NO adaptamos silenciosamente. Es preferible fallar honestamente que
  // entregar Liga MX cuando el usuario pidió Liga AR.
  // Solo "adaptamos" cuando NO hay criterios duros (ej: usuario no especificó liga).
  const userSpecifiedLeague = filters.leagues.length > 0;
  const userSpecifiedLegs = !!parsed?.legs;   // si el LLM lo extrajo del prompt
  const userSpecifiedTargetOdd = filters.targetOdd != null;
  const STRICT = userSpecifiedLeague || userSpecifiedTargetOdd;

  if (pool.length < filters.legs) {
    if (STRICT || pool.length < 2) {
      const bookHint = filters.books.length ? ` en ${filters.books.join('/')}` : '';
      const oddHint = filters.minOddPerLeg ? ` con cuota mínima por leg ${filters.minOddPerLeg}` : '';
      const targetHint = filters.targetOdd ? ` con cuota total cerca de ${filters.targetOdd}` : '';
      const leagueHint = filters.leagues.length
        ? ` en ${filters.leagues.join(' / ').replace(/-/g, ' ')}`
        : '';
      return res.json({
        ok: false,
        reason: 'insufficient-pool',
        message: `Buscamos ${filters.legs} partidos${leagueHint}${bookHint}${oddHint}${targetHint} pero solo encontramos ${pool.length} picks que cumplan tus criterios. NO te armé una combinada distinta a propósito — preferimos ser honestos y avisarte. Probá ampliar las ligas, reducir la cantidad de legs o ampliar el rango de tiempo.`,
        filters, foundPicks: pool.length
      });
    } else {
      // Sin liga/cuota específica → degradamos a la cantidad que hay
      log(`[betsafe-ai] adaptando legs: pediste ${filters.legs}, devolvemos ${pool.length} (no se especificó liga/cuota)`);
      filters.legs = pool.length;
      filters._adapted = true;
    }
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

  // Greedy SELECTION CON BONUS DE DIVERSIDAD: elegimos legs una por una,
  // penalizando markets que ya están en chosen. Antes la combinada era
  // siempre "3 picks tipo h2h del top scoring". Ahora si el #1 es h2h, el
  // #2 prefiere otro mercado (corners/cards/totals) si el score no cae
  // mucho. Resultado: combinadas con MEZCLA real de mercados, no 3 h2h.
  function pickWithDiversity(maxLegs) {
    const out = [];
    const usedEvents = new Set();
    const marketCount = new Map();
    while (out.length < maxLegs) {
      // Re-rankear cada vez basado en lo que ya elegimos
      const remaining = sortedPool.filter(p => !out.includes(p) && !usedEvents.has(p.event.id));
      if (!remaining.length) break;
      let best = remaining[0];
      let bestScore = -Infinity;
      for (const p of remaining) {
        const baseScore = legScore(p);
        // Penalizar markets repetidos: -10 por cada ocurrencia previa
        const repeatPenalty = (marketCount.get(p.sel.market) || 0) * 10;
        const adjusted = baseScore - repeatPenalty;
        if (adjusted > bestScore) { bestScore = adjusted; best = p; }
      }
      out.push(best);
      usedEvents.add(best.event.id);
      marketCount.set(best.sel.market, (marketCount.get(best.sel.market) || 0) + 1);
    }
    return out;
  }
  let chosen = pickWithDiversity(filters.legs);

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
  // Cascada Gemini-first 3-retries — primary del producto. Groq solo fallback.
  let narrative = null;
  let aiProvider = null;
  const HAS_GEMINI_LOCAL = !!(process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
  const HAS_GROQ_LOCAL = !!(process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY);
  if (HAS_GEMINI_LOCAL) {
    for (let att = 1; att <= 3 && !narrative; att++) {
      try {
        narrative = await geminiJsonGeneric(narrativeSystem, narrativePrompt, { maxTokens: 500, temperature: 0.5 });
        if (narrative) aiProvider = 'gemini';
      } catch (e) {
        log(`[betsafe-ai gemini attempt ${att}] ${e?.message?.slice(0, 80)}`);
        if (att < 3) await new Promise(r => setTimeout(r, 250 * Math.pow(3, att - 1)));
      }
    }
  }
  if (!narrative && HAS_GROQ_LOCAL) {
    try {
      narrative = await groqJsonGeneric(narrativeSystem, narrativePrompt, { maxTokens: 500, temperature: 0.5 });
      if (narrative) aiProvider = 'groq';
    } catch (e) { log(`[betsafe-ai groq fallback] ${e?.message?.slice(0, 80)}`); }
  }

  res.json({
    ok: true,
    filters,
    legs: enrichedLegs,
    totalOdd: Number(totalOdd.toFixed(2)),
    headline: narrative?.headline || `Combinada de ${enrichedLegs.length} partidos a cuota ${totalOdd.toFixed(2)}`,
    narrative: narrative?.narrative || `Armé esta combinada de ${enrichedLegs.length} partidos basándome en tu pedido. Cada leg fue seleccionada por su edge sobre la casa y consistencia con el resto.`,
    aiProvider,                                                          // 'gemini' | 'groq' | null
    aiHealth: aiProvider ? 'ok' : (HAS_GEMINI || HAS_GROQ ? 'degraded' : 'no-keys'),
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
    const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 8));
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
  const groqKey = process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  const anthropicKey = process.env.BS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const openrouterKey = process.env.BS_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';

  const previewKey = (k) => k ? (k.slice(0, 6) + '...' + k.slice(-4)) : null;

  const status = {
    configured: {
      groq: !!groqKey, gemini: !!geminiKey, anthropic: !!anthropicKey, openrouter: !!openrouterKey
    },
    keyPreviews: {
      groq: previewKey(groqKey), gemini: previewKey(geminiKey),
      anthropic: previewKey(anthropicKey), openrouter: previewKey(openrouterKey)
    },
    tests: {}
  };

  // ── Test Groq ──
  if (groqKey) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 12000);
      const t0 = Date.now();
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: process.env.BS_GROQ_MODEL || 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: 'Say {"ok":true} in JSON.' }],
          temperature: 0, response_format: { type: 'json_object' }, max_tokens: 30
        })
      });
      status.tests.groq = { ok: r.ok, status: r.status, durMs: Date.now() - t0 };
      if (!r.ok) status.tests.groq.error = (await r.text()).slice(0, 200);
    } catch (e) { status.tests.groq = { ok: false, error: e?.message }; }
  } else status.tests.groq = { skipped: 'no key' };

  // ── Test Gemini ──
  if (geminiKey) {
    try {
      const model = process.env.BS_GEMINI_MODEL || 'gemini-2.5-flash';
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 12000);
      const t0 = Date.now();
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say {"ok":true} in JSON.' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 30, responseMimeType: 'application/json' }
        })
      });
      status.tests.gemini = { ok: r.ok, status: r.status, model, durMs: Date.now() - t0 };
      if (!r.ok) status.tests.gemini.error = (await r.text()).slice(0, 200);
    } catch (e) { status.tests.gemini = { ok: false, error: e?.message }; }
  } else status.tests.gemini = { skipped: 'no key' };

  // ── Test Anthropic ──
  if (anthropicKey) {
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 12000);
      const t0 = Date.now();
      const model = process.env.BS_ANTHROPIC_MODEL || 'claude-sonnet-4-5';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model, max_tokens: 30,
          messages: [{ role: 'user', content: 'Say {"ok":true} in JSON.' }]
        })
      });
      status.tests.anthropic = { ok: r.ok, status: r.status, model, durMs: Date.now() - t0 };
      if (!r.ok) status.tests.anthropic.error = (await r.text()).slice(0, 200);
    } catch (e) { status.tests.anthropic = { ok: false, error: e?.message }; }
  } else status.tests.anthropic = { skipped: 'no key' };

  // ── Decision tree: cuál se usa de primary? ──
  if (geminiKey) status.activeStrategy = 'Gemini primary (3 retries) + Claude premium + Groq fallback';
  else if (groqKey) status.activeStrategy = 'Groq primary (no Gemini configured)';
  else status.activeStrategy = 'NINGUNA AI CONFIGURADA — picks vacíos esperados';

  // Backward compat con código viejo
  status.ok = status.tests.gemini?.ok || status.tests.groq?.ok || false;
  status.keyPreview = previewKey(groqKey);
  status.model = process.env.BS_GROQ_MODEL || 'llama-3.1-8b-instant';

  res.json(status);
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
