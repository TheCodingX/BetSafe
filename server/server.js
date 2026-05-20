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
const {
  analyzeMatch, openaiJsonGeneric, groqJsonGeneric, geminiJsonGeneric, cerebrasJsonGeneric,
  openrouterJsonGeneric, llmJsonAny, __aiStatus
} = require('./engines/ai-pipeline');

// Helper: cascada UNIVERSAL FREE-FIRST (Groq 70B → Cerebras → OpenRouter
// free models → Groq 8B → opt-in pago). Reemplaza la cascada Gemini-first
// vieja que quemaba dinero. La lógica vive en ai-pipeline.llmJsonAny y se
// aplica también a llmStructured (analyzeMatch).
//
// Devuelve directamente el JSON (no { result, provider }) para mantener
// compat con los call sites existentes. El provider quedó loggeado en
// ai-pipeline. Si querés saber qué provider respondió, usá llmJsonAny directo.
const HAS_OPENAI = !!(process.env.BS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.BS_OPENAI_API_KEYS);
const HAS_GEMINI = !!(process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.BS_GEMINI_API_KEYS);
const HAS_GROQ = !!(process.env.BS_GROQ_API_KEY || process.env.GROQ_API_KEY || process.env.BS_GROQ_API_KEYS);
const HAS_CEREBRAS = !!(process.env.BS_CEREBRAS_API_KEY || process.env.CEREBRAS_API_KEY || process.env.BS_CEREBRAS_API_KEYS);
const HAS_OPENROUTER = !!(process.env.BS_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || process.env.BS_OPENROUTER_API_KEYS);
const HAS_ANY_LLM = HAS_OPENAI || HAS_GROQ || HAS_CEREBRAS || HAS_OPENROUTER || HAS_GEMINI;

async function preferredJson(systemPrompt, userPrompt, opts = {}) {
  if (!HAS_ANY_LLM) throw new Error('Sin LLM disponible (configurá BS_OPENAI_API_KEY, BS_GROQ_API_KEY, BS_CEREBRAS_API_KEY u OpenRouter)');
  const { result, provider, trace } = await llmJsonAny(systemPrompt, userPrompt, opts);
  if (!result) {
    log(`[preferredJson] all providers failed · trace: ${trace.join(' | ')}`);
    throw new Error(`All LLM providers failed: ${trace.slice(-3).join(' ; ')}`);
  }
  // Loguear provider solo si no es el primary (para no spammear)
  if (provider !== 'groq-70b') log(`[preferredJson] respondió ${provider}`);
  return result;
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
  if (!/\/api\/(betsafe-ai|combo\/analyze|surebet\/.+\/explain|daily-report|support\/ask)/.test(req.path)) {
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
  const { getScrapingBeeUsage, scrapingBeeStats, getSbeeStatus } = require('./lib');
  const usage = await getScrapingBeeUsage(req.query.refresh === '1');
  if (!usage && !process.env.SCRAPINGBEE_KEY) {
    return res.status(404).json({ error: 'SCRAPINGBEE_KEY no configurada' });
  }
  const sbeeStatus = getSbeeStatus ? getSbeeStatus() : null;
  const out = {
    usage,
    remaining: usage ? Math.max(0, (usage.max_api_credit || 0) - (usage.used_api_credit || 0)) : null,
    pctRemaining: usage?.max_api_credit
      ? Number(((usage.max_api_credit - (usage.used_api_credit || 0)) / usage.max_api_credit * 100).toFixed(1))
      : null,
    // Estado del auto-disable: si la key dio 401, marcamos inválida por 30min
    // para evitar 30s × N de timeouts inútiles. Re-intenta automáticamente.
    keyStatus: sbeeStatus,
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

// Status del cascade IA — qué providers tienen key, cuántas keys cargadas,
// modelo default, y si paid tier está habilitado.
app.get('/api/ai/status', (req, res) => {
  try { res.json(__aiStatus()); }
  catch (e) { res.status(500).json({ error: e?.message }); }
});

app.get('/api/debug/llm-trace', async (req, res) => {
  const out = { providers: {}, status: __aiStatus() };
  const SYS = 'Sos un assistant que responde JSON.';
  const USR = 'Devolveme {"ok": true}.';
  const tests = [
    { name: 'openai-gpt5-mini', guard: HAS_OPENAI,    fn: () => openaiJsonGeneric(SYS, USR, { maxTokens: 200 }) },
    { name: 'groq-70b',         guard: HAS_GROQ,      fn: () => groqJsonGeneric(SYS, USR, { maxTokens: 50 }) },
    { name: 'cerebras',         guard: HAS_CEREBRAS,  fn: () => cerebrasJsonGeneric(SYS, USR, { maxTokens: 50 }) },
    { name: 'openrouter',       guard: HAS_OPENROUTER, fn: () => openrouterJsonGeneric(SYS, USR, { maxTokens: 50 }) },
    { name: 'gemini',           guard: HAS_GEMINI,    fn: () => geminiJsonGeneric(SYS, USR, { maxTokens: 50 }) }
  ];
  try {
    for (const t of tests) {
      if (!t.guard) { out.providers[t.name] = { skipped: 'no-key' }; continue; }
      const t0 = Date.now();
      try {
        const r = await t.fn();
        out.providers[t.name] = { ok: true, ms: Date.now() - t0, response: r };
      } catch (e) {
        out.providers[t.name] = { ok: false, ms: Date.now() - t0, error: e?.message?.slice(0, 200) };
      }
    }

    // Forzar re-análisis de un evento sin cache si pasó ?eventId=...
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
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
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

app.get('/api/arbitrage/snapshot', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.json(arbEngine.snapshot());
});

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
  // Cache-Control upfront: garantiza que TODOS los paths de salida (early
  // returns por errores, picks vacíos, etc.) no se cacheen en el navegador
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
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
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 4));

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

  // ── ENRIQUECIMIENTO PARA UI ──────────────────────────────────────────────
  // Por cada selection, agregamos las cuotas de TODAS las books (line shopping)
  // y el sharp score explícito al nivel de pick. Esto le permite al frontend
  // mostrar "casa A: 2.15, casa B: 2.18 (mejor)" sin pedir más data al backend.
  const eventsById = new Map(events.map(e => [e.id, e]));
  const finalPicks = ranked.slice(0, limit).map(pick => {
    const ev = eventsById.get(pick.event?.id);
    const enrichedSelections = (pick.selections || []).map(sel => ({
      ...sel,
      bookOdds: ev?.markets ? bookOddsForSelection(ev.markets, sel.market, sel.outcome, sel.line) : null
    }));
    return {
      ...pick,
      selections: enrichedSelections,
      sharpScore: pick.factors?.sharp?.score || 0,
      sharpMovesCount: pick.factors?.sharp?.steamMoves?.length || 0
    };
  });

  res.json({
    picks: finalPicks,
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

// ─────────────────────────────────────────────────────────────────────────
// LINE SHOPPING — extrae cuotas de las 6 books para un outcome específico
// y calcula best/worst/avg + edgePct (cuánto mejor es la mejor vs la peor).
// Devuelve null si ninguna book ofrece ese outcome.
// ─────────────────────────────────────────────────────────────────────────
function bookOddsForSelection(eventMarkets, market, outcome, line) {
  if (!eventMarkets) return null;
  const m = eventMarkets[market];
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const [book, data] of Object.entries(m)) {
    if (!data || typeof data !== 'object') continue;
    let odd = null;
    if (market === 'h2h') {
      // outcome: home/draw/away
      odd = data[outcome];
    } else if (market === 'totals' && line != null) {
      // data: { 2.5: { over, under }, 3: {...} }
      const lineData = data[line] || data[String(line)] || data[Number(line)];
      if (lineData) odd = lineData[outcome]; // outcome: over | under
    } else if (market === 'btts') {
      odd = data[outcome]; // yes | no
    } else if (market === 'dc') {
      // outcome viene del LLM como 'home_or_draw'/'draw_or_away'/'home_or_away'
      // y el sanitizer ya guarda con esa misma key.
      odd = data[outcome];
    } else if (market === 'ah') {
      // data plano: { line, home_minus, away_plus }
      if (line == null || data.line == null || Math.abs(Number(line) - Number(data.line)) < 0.01) {
        odd = data[outcome];
      }
    }
    // Markets extendidos (2026-05-17): mismo patrón que los core
    else if (market === 'dnb') {
      odd = data[outcome];                                              // home | away
    } else if (market === 'ht-result') {
      odd = data[outcome];                                              // home | draw | away
    } else if (market === 'totals-ht' && line != null) {
      const lineData = data[line] || data[String(line)] || data[Number(line)];
      if (lineData) odd = lineData[outcome];                            // over | under
    } else if (market === 'corners-total' && line != null) {
      const lineData = data[line] || data[String(line)] || data[Number(line)];
      if (lineData) odd = lineData[outcome];                            // over | under
    } else if (market === 'cards-total' && line != null) {
      const lineData = data[line] || data[String(line)] || data[Number(line)];
      if (lineData) odd = lineData[outcome];                            // over | under
    } else if (market === 'exact-score') {
      odd = data[outcome];                                              // "1-0", "2-1", etc.
    }
    if (Number.isFinite(odd) && odd > 1) out[book] = Number(odd.toFixed(3));
  }
  if (!Object.keys(out).length) return null;
  const odds = Object.values(out);
  const best = Math.max(...odds);
  const worst = Math.min(...odds);
  const avg = odds.reduce((s, o) => s + o, 0) / odds.length;
  const bestBook = Object.keys(out).find(b => out[b] === best);
  const edgePct = best > worst ? Number(((best - worst) / worst * 100).toFixed(2)) : 0;
  return {
    books: out,
    best: Number(best.toFixed(3)),
    bestBook,
    worst: Number(worst.toFixed(3)),
    avg: Number(avg.toFixed(3)),
    edgePct,
    bookCount: Object.keys(out).length
  };
}

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
  // Cache-Control upfront: aplica a TODOS los paths (early returns incluidos)
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  const sport = req.query.sport || 'all';
  const count = Math.min(6, Math.max(2, Number(req.query.count) || 4));
  const includeEsports = req.query.includeEsports === 'true' || sport === 'esports';

  // FASE 4.1 — Filtros avanzados del usuario:
  //   - oddMin/oddMax: rango de cuota total aceptable para el combo final
  //   - timeWindowH: solo partidos en las próximas N horas (default 36)
  //   - marketsAllow: lista de mercados permitidos en las legs (h2h,totals,btts,ah,dc,corners-total,cards-total,...)
  const oddMin = Number(req.query.oddMin) || null;
  const oddMax = Number(req.query.oddMax) || null;
  const timeWindowH = Math.max(1, Math.min(168, Number(req.query.timeWindowH) || 36));
  const marketsAllowRaw = String(req.query.marketsAllow || '').trim();
  const marketsAllow = marketsAllowRaw ? new Set(marketsAllowRaw.split(',').map(s => s.trim()).filter(Boolean)) : null;

  // 1) Pool de eventos del día — FILTRO ESTRICTO por deporte
  let events = orchestrator.events({ sport: sport === 'all' ? 'all' : sport })
    .filter(e => e.bestOdds?.h2h);
  if (!includeEsports) {
    events = events.filter(e => e.sport !== 'esports' && !orchestrator.looksLikeEsports?.(e));
  }
  // Filtro tiempo: parametrizado (default 36h, user puede pedir 2h/6h/12h/24h)
  const now = Date.now();
  events = events.filter(e => Number.isFinite(e.start) && e.start >= now && e.start <= now + timeWindowH * 3600 * 1000);

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
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 4));
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
      // FASE 4.1: si el user pidió mercados específicos, descartamos otros desde el pool.
      // Sin esto el LLM curator podría meter mercados que el user no quiere.
      if (marketsAllow && !marketsAllow.has(sel.market)) continue;
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
    aiResp = await preferredJson(systemPrompt, userPrompt, { maxTokens: 1400, temperature: 0.5 });
  } catch (e) {
    log(`[curated] AI err: ${e?.message?.slice(0, 100)}`);
  }

  let aiCombos = Array.isArray(aiResp?.combos) ? aiResp.combos : [];
  let usedAlgorithmicFallback = false;

  // FALLBACK ALGORÍTMICO: si el LLM curator devolvió vacío pero tenemos
  // 4+ picks en el pool, armamos los combos por score. Pero DEJAMOS los
  // textos descriptivos en null — un 2do pass IA más abajo los va a generar
  // por combo. NUNCA mostrar textos genéricos al usuario.
  if (!aiCombos.length && topPool.length >= 4) {
    log(`[curated] LLM curator vacío — armando algorítmicamente desde pool de ${topPool.length} (narratives se generarán con IA en 2do pass)`);
    usedAlgorithmicFallback = true;
    const ranked = topPool.slice().sort((a, b) => b.score - a.score);

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
    if (topPool.length >= 2) {
      const idx = pickIndices(2, 0, true);
      if (idx.length === 2) fallbackCombos.push({ legs: idx, risk: 'seguro', narrative: null, edge: null, keyFactor: null });
    }
    if (topPool.length >= 3) {
      fallbackCombos.push({ legs: pickIndices(3, 0, false), risk: 'equilibrado', narrative: null, edge: null, keyFactor: null });
    }
    if (topPool.length >= 4 && fallbackCombos.length < count) {
      fallbackCombos.push({ legs: pickIndices(4, 1, false), risk: 'agresivo', narrative: null, edge: null, keyFactor: null });
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
        // RISK por TOTAL ODD siempre (override LLM): el LLM tendía a etiquetar
        // como "agresivo" combos de cuota 1.8-3.0 que en realidad son seguros.
        // Ahora el riesgo lo dicta la cuota total: agresivo SIEMPRE >12.
        risk: totalOdd < 4 ? 'seguro' : totalOdd < 12 ? 'equilibrado' : 'agresivo',
        narrative: String(c.narrative || '').slice(0, 600),
        edge: String(c.edge || '').slice(0, 250),
        keyFactor: String(c.keyFactor || '').slice(0, 200),
        sportsCount: new Set(legs.map(l => l.sport)).size
      };
    })
    .filter(Boolean);

  // ── ENRIQUECIMIENTO HIPER-AVANZADO ──────────────────────────────────────
  // Cada leg recibe: bookOdds (line shopping completo), sharp data (steam moves
  // de la última hora), y movement (cambio % desde primera vez visto). Esto
  // alimenta los componentes "premium" del frontend (sparkline, multi-model
  // bar, line shopping inline).
  const eventsById = new Map(events.map(e => [e.id, e]));
  const analyzedById = new Map();
  for (const r of analyzed) {
    if (r.status === 'fulfilled' && r.value?.event?.id) analyzedById.set(r.value.event.id, r.value);
  }
  // FASE 4.1: filtrar combos por cuota total (oddMin/oddMax) antes de enriquecer.
  // Hacemos slice(0, count*3) primero para tener margen tras el filtro, y luego cap a count.
  let filteredCombos = combos.slice();
  if (oddMin != null) filteredCombos = filteredCombos.filter(c => Number(c.totalOdd) >= oddMin);
  if (oddMax != null) filteredCombos = filteredCombos.filter(c => Number(c.totalOdd) <= oddMax);
  const finalCombos = filteredCombos.slice(0, count).map(c => {
    const enrichedLegs = (c.legs || []).map(leg => {
      const ev = eventsById.get(leg.eventId);
      const an = analyzedById.get(leg.eventId);
      return {
        ...leg,
        bookOdds: ev?.markets ? bookOddsForSelection(ev.markets, leg.market, leg.outcome, leg.line) : null,
        sharpScore: an?.factors?.sharp?.score || 0,
        sharpMoves: (an?.factors?.sharp?.steamMoves || []).slice(0, 4).map(m => ({
          market: m.market, outcome: m.outcome, deltaPct: Number(m.deltaPct) || 0, ts: m.ts
        })),
        // Datos quant para multi-model bar visual
        modelProbs: (() => {
          const sel = (an?.selections || []).find(s =>
            s.market === leg.market && s.outcome === leg.outcome &&
            (leg.line == null || Math.abs(Number(s.line || 0) - Number(leg.line || 0)) < 0.01)
          );
          if (!sel) return null;
          return {
            market: sel.fairProb,
            poisson: sel.poissonProb,
            elo: sel.eloProb,
            llm: sel.llmProb,
            consensus: sel.consensusProb,
            kellyFractional: sel.kellyFractional,
            modelConvergence: sel.modelConvergence,
            valueGap: sel.valueGap
          };
        })()
      };
    });
    // Stats agregados del combo para mostrar en hero
    const totalSharpMoves = enrichedLegs.reduce((a, l) => a + (l.sharpMoves?.length || 0), 0);
    const maxSharpScore = enrichedLegs.reduce((a, l) => Math.max(a, l.sharpScore || 0), 0);
    const lineShopEdgePct = enrichedLegs.reduce((a, l) => a + (l.bookOdds?.edgePct || 0), 0);
    return {
      ...c,
      legs: enrichedLegs,
      stats: {
        totalSharpMoves,
        maxSharpScore: Number(maxSharpScore.toFixed(2)),
        lineShopEdgePctSum: Number(lineShopEdgePct.toFixed(2)),
        // Probabilidad combinada usando consensusProb si existe, sino confidence
        combinedProb: enrichedLegs.reduce((p, l) => p * (l.modelProbs?.consensus || l.confidence || 0.5), 1)
      }
    };
  });

  // ── DEFENSIVE FILTER: descartar combos con CUALQUIER leg ya empezada ────
  // Doble check: el filtro inicial de events.start >= now puede dejar pasar
  // algún edge case (cache stale del orchestrator, eventos sin start válido,
  // race condition entre fetch y render). Si una leg ya empezó, el combo no
  // sirve y le mostraríamos basura al usuario.
  const nowMs = Date.now();
  const STARTED_GRACE_MS = 5 * 60 * 1000;  // tolerancia 5min para partidos que arrancan ya
  const liveCombos = finalCombos.filter(c => {
    const anyStarted = (c.legs || []).some(l => Number.isFinite(l.start) && l.start <= nowMs - STARTED_GRACE_MS);
    if (anyStarted) {
      log(`[curated] descarto combo (legs ya empezadas): ${(c.legs || []).map(l => l.home).join(' + ')}`);
      return false;
    }
    return true;
  });

  // ── 2DO PASS IA: para combos sin narrative (fallback algorítmico), pedir IA
  // que los narre individualmente. NUNCA mostramos textos genéricos al user.
  // Si la IA falla, los campos quedan null y el frontend oculta el bloque.
  const needsNarrative = liveCombos.filter(c => !c.narrative);
  if (needsNarrative.length > 0) {
    log(`[curated] 2do pass IA: narrando ${needsNarrative.length} combos`);
    await Promise.allSettled(needsNarrative.map(async (c) => {
      try {
        const legsSummary = (c.legs || []).map((l, i) =>
          `${i+1}. ${l.home} vs ${l.away} (${l.sport || '?'} · ${l.league || '?'}) — ${l.label} @ ${l.odd?.toFixed(2)} | EV ${(l.ev || 0).toFixed(1)}%`
        ).join('\n');
        const narrSystem = `Sos un analista cuantitativo SENIOR que narra una combinada específica de apuestas. Lenguaje argentino, sin jerga técnica. JSON estricto.`;
        const narrPrompt = `Esta combinada (riesgo "${c.risk || 'equilibrado'}", cuota total ${c.totalOdd?.toFixed(2)}, ${c.legCount || c.legs?.length} legs):

${legsSummary}

Devolvé un análisis breve y PERSONALIZADO (no genérico — mencioná los equipos/ligas/mercados específicos de estas legs):

{
  "narrative": "<2-3 frases que expliquen por qué ESTOS partidos específicos juntos tienen sentido. Hablá de los equipos por nombre.>",
  "edge": "<una frase: dónde está el valor REAL vs el mercado en esta combinada específica>",
  "keyFactor": "<una frase: el factor más importante a vigilar antes del primer kickoff de estos partidos>"
}`;
        const r = await llmJsonAny(narrSystem, narrPrompt, { maxTokens: 500, temperature: 0.5 });
        if (r.result) {
          if (typeof r.result.narrative === 'string') c.narrative = r.result.narrative.slice(0, 600);
          if (typeof r.result.edge === 'string')      c.edge      = r.result.edge.slice(0, 250);
          if (typeof r.result.keyFactor === 'string') c.keyFactor = r.result.keyFactor.slice(0, 200);
        }
      } catch (e) {
        log(`[curated:narr] err: ${e?.message?.slice(0, 80)}`);
      }
    }));
  }

  // Quick insights del día — narrativa corta para banner del UI
  const quickInsights = [];
  const totalSharpAcrossAll = liveCombos.reduce((a, c) => a + (c.stats?.totalSharpMoves || 0), 0);
  if (totalSharpAcrossAll >= 3) quickInsights.push(`📊 ${totalSharpAcrossAll} movimientos sharp detectados en las últimas combinadas`);
  const avgEvAcross = liveCombos.length ? (liveCombos.reduce((a, c) => a + (c.avgEv || 0), 0) / liveCombos.length) : 0;
  if (avgEvAcross > 4) quickInsights.push(`⚡ EV promedio +${avgEvAcross.toFixed(1)}% — día con mucho valor`);
  const totalLineShopEdge = liveCombos.reduce((a, c) => a + (c.stats?.lineShopEdgePctSum || 0), 0);
  if (totalLineShopEdge > 8) quickInsights.push(`🎯 Diferencias de hasta ${Math.round(totalLineShopEdge / Math.max(1, liveCombos.length))}% entre casas — line shopping muy útil hoy`);
  const ligas = new Set();
  liveCombos.forEach(c => c.legs?.forEach(l => l.league && ligas.add(l.league)));
  if (ligas.size >= 3) quickInsights.push(`🏆 ${ligas.size} ligas representadas en los combos del día`);

  // BRIEF DEL DÍA con IA: si los thresholds estáticos no llenan ≥2 insights,
  // pedimos a la IA un brief específico basado en los combos generados HOY.
  if (quickInsights.length < 2 && liveCombos.length > 0) {
    try {
      const briefSystem = `Sos un analista deportivo argentino. Generás insights cortos sobre el panorama de apuestas del día. JSON estricto.`;
      const briefPrompt = `Combinadas curadas para hoy (${liveCombos.length} combos, ${analyzed.length} partidos analizados, ${ligas.size} ligas):

${liveCombos.slice(0, 4).map((c, i) =>
  `Combo ${i+1} [${c.risk}, cuota ${c.totalOdd?.toFixed(2)}]: ${(c.legs || []).map(l => `${l.home}/${l.away} (${l.market}: ${l.outcome})`).join(' + ')}`
).join('\n')}

Devolvé 2-3 insights cortos (max 80 chars cada uno) sobre lo más interesante del día. Mencioná ligas, equipos o mercados específicos. NUNCA frases genéricas. Cada insight empieza con un emoji relevante.

{ "insights": ["📊 ...", "⚡ ...", "🎯 ..."] }`;
      const r = await llmJsonAny(briefSystem, briefPrompt, { maxTokens: 350, temperature: 0.6 });
      if (Array.isArray(r.result?.insights)) {
        for (const ins of r.result.insights) {
          if (typeof ins === 'string' && ins.length > 5 && ins.length < 120 && !quickInsights.includes(ins)) {
            quickInsights.push(ins);
            if (quickInsights.length >= 4) break;
          }
        }
      }
    } catch (e) {
      log(`[curated:brief] err: ${e?.message?.slice(0, 80)}`);
    }
  }

  res.json({
    combos: liveCombos,
    meta: {
      analyzedEvents: analyzed.length,
      poolSize: pool.length,
      topPoolSize: topPool.length,
      sport,
      includeEsports,
      generatedAt: Date.now(),
      usedAlgorithmicFallback,
      narrativeSource: usedAlgorithmicFallback ? 'second-pass-llm' : 'curator-llm',
      droppedStaleCombos: finalCombos.length - liveCombos.length,
      quickInsights,
      stats: {
        totalSharpMoves: totalSharpAcrossAll,
        avgEvPct: Number(avgEvAcross.toFixed(2)),
        ligasCount: ligas.size,
        combosCount: liveCombos.length,
        avgConfidence: liveCombos.length ? Number((liveCombos.reduce((a, c) => a + (c.avgConfidence || 0), 0) / liveCombos.length * 100).toFixed(0)) : 0
      }
    }
  });
});

// ── /api/support/ask ──────────────────────────────────────────────────────
// Soporte IA del FAB flotante. Responde dudas sobre la plataforma usando la
// cascada universal (free-first). Knowledge base en el system prompt.
// Rate-limited (30 req/min/IP vía rateLimit() arriba).
const SUPPORT_KB = `
BetSafe es una plataforma argentina LEGAL de análisis inteligente de apuestas
deportivas. NO somos casa de apuestas — comparamos cuotas de las 6 casas LOTBA
habilitadas y damos herramientas de análisis. +18.

CASAS COMPARADAS (6 LOTBA legales): Bplay, Betano, BetWarrior, Bet365 AR, Codere, Betsson.

PRODUCTOS PRINCIPALES:
- Comparador: compara cuotas de las 6 casas en tiempo real. Te muestra qué
  casino paga más por la cuota que querés. Página: dashboard.html#comparator.
- Quant IA: análisis cuantitativo de partidos con cuotas reales por casino —
  sin fallbacks sintéticos. Devuelve probabilidades modeladas + EV por mercado.
  Página: dashboard.html#ai.
- Coach IA: conversacional. Pedile combinadas naturalmente
  ("haceme una combinada segura de Boca esta noche") y arma la combinada con
  partidos reales, respetando filtros, riesgo, ligas, mercados, cuota mínima/máxima.
  Página: dashboard.html#aigenerator.
- Builder: armado manual de combinadas con análisis de correlación.
- Arbitraje (VIP): detecta surebets (ROI > 0) entre casas. Dashboard.html#arbitrage.
- Calculadora Pro: Kelly, banca, ROI, stake óptimo.
- Tracker: registro de apuestas con stats de Brier score, hit rate.
- Mundial 2026: cuotas y proyecciones específicas del WC26.
- Bonos: comparador de bonos de bienvenida y promos vigentes de las 6 casas.

CONCEPTOS CLAVE:
- EV (valor esperado): (probabilidad × cuota) − 1. Si EV > 0, la apuesta es
  matemáticamente rentable a largo plazo. BetSafe calcula EV usando la
  probabilidad modelada por la IA, no la implícita en la cuota.
- Kelly: fórmula para tamaño óptimo de apuesta dado tu edge y banca.
- Cuota justa (fair): la cuota que reflejaría la probabilidad real sin margen
  del casino. Si la cuota del casino > fair, hay valor.
- Brier score: métrica de calibración de probabilidades. Más bajo = mejor.
- Riesgo: cons (conservador, cuotas bajas), eq (equilibrado), agg (agresivo).

SUSCRIPCIONES (pricing.html):
- Free: comparador básico, Coach IA limitado.
- Pro: Quant IA, generador, calculadora pro.
- VIP: arbitraje, alertas live, todas las funciones.

JUEGO RESPONSABLE:
- Respondé siempre con responsabilidad. Recordá +18 y la línea de ayuda 0800 444 4000.
- Página: responsable.html. NUNCA recomendes una apuesta puntual ni des
  garantías de ganancia.

PROBLEMAS TÉCNICOS:
- Si una cuota no aparece: el scraper de esa casa puede estar caído
  temporalmente (ver dashboard.html#settings → "Estado de fuentes").
- Si la imagen vieja persiste tras cambios: hard refresh (Ctrl+F5).
- Contacto: contacto.html.

ESTILO DE RESPUESTA:
- Tono profesional, breve, claro, conversacional argentino.
- Sin emojis salvo que el user los use primero.
- Si la pregunta es ambigua, pedí una sola aclaración.
- Si no sabés algo concreto del producto (precios exactos, tickets de soporte),
  derivá a Contacto en vez de inventar.
- Máximo ~120 palabras por respuesta salvo que el user pida detalle.

REFERENCIAS A SECCIONES (REGLA CRÍTICA):
NUNCA escribas el filename ".html" en la respuesta visible. Usá SIEMPRE el
nombre amigable de la sección. El frontend los convierte en links automáticamente.

Mapeo OBLIGATORIO (escribí solo el nombre, NO el .html):
  Inicio · Dashboard · Comparador · Quant IA · Coach IA · Builder · Arbitraje ·
  Calculadora Pro · Tracker · Mundial 2026 · Configuración · Precios · Contacto ·
  Funciones · Herramientas · Academia · Bonos · Juego Responsable · Términos ·
  Privacidad · Cookies · Ingresar · Crear cuenta · Nosotros.

Ejemplos correctos:
  ✓ "Lo encontrás en Precios."
  ✓ "Escribinos desde Contacto y te respondemos."
  ✓ "Probá Coach IA para armar combinadas."
  ✓ "Mirá el Comparador para ver qué casino paga más."

Ejemplos INCORRECTOS (NO HACER):
  ✗ "Lo encontrás en pricing.html"
  ✗ "Escribinos a contacto.html"
  ✗ "Andá a dashboard.html#aigenerator"
`;

app.post('/api/support/ask', express.json({ limit: '32kb' }), async (req, res) => {
  try {
    const { question, history } = req.body || {};
    const q = String(question || '').trim();
    if (!q) return res.status(400).json({ error: 'question requerido' });
    if (q.length > 600) return res.status(400).json({ error: 'pregunta demasiado larga (max 600)' });

    if (!HAS_ANY_LLM) {
      return res.json({
        answer: 'El servicio de IA no está disponible en este momento. Escribinos desde contacto.html y te respondemos.',
        suggestions: []
      });
    }

    const hist = Array.isArray(history) ? history.slice(-8) : [];
    const histText = hist
      .filter(m => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
      .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${String(m.text).slice(0, 500)}`)
      .join('\n');

    const systemPrompt = `Sos BetSafe Assistant, el soporte IA 24/7 de BetSafe.
Respondé SIEMPRE en español rioplatense (Argentina), tono profesional y cercano.
Usá el knowledge base para responder. Si el user pregunta algo fuera del scope
(temas no relacionados a BetSafe / apuestas legales en Argentina), redirigilo
amablemente al alcance del soporte.

KNOWLEDGE BASE:
${SUPPORT_KB}

FORMATO DE SALIDA: JSON estricto con esta forma:
{
  "answer": "texto de respuesta (máx ~120 palabras, en es-AR, podés usar **negrita** y links a páginas internas como dashboard.html)",
  "suggestions": ["pregunta sugerida 1", "pregunta sugerida 2", "pregunta sugerida 3"]
}
Las "suggestions" son 2-3 follow-ups cortos y útiles relacionados con la respuesta.
NO incluyas markdown fuera de **bold** y links plain text estilo "dashboard.html".`;

    const userPrompt = `${histText ? `Conversación previa:\n${histText}\n\n` : ''}Nueva pregunta del usuario: ${q}`;

    const result = await preferredJson(systemPrompt, userPrompt, {
      maxTokens: 600,
      temperature: 0.4
    });

    const answer = String(result?.answer || '').trim() || 'No pude generar una respuesta. Probá reformular la pregunta.';
    const suggestions = Array.isArray(result?.suggestions)
      ? result.suggestions.filter(s => typeof s === 'string' && s.trim()).slice(0, 4)
      : [];

    res.json({ answer, suggestions });
  } catch (e) {
    log(`[support] error: ${e?.message || e}`);
    res.status(500).json({
      answer: 'Tuve un problema procesando tu consulta. Intentá de nuevo en unos segundos.',
      suggestions: []
    });
  }
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

  // FIX 2026-05: Rechazar eventos con cuotas stale. El orchestrator setea
  // `lastUpdate` cada vez que un scraper o source actualiza el evento. Si
  // pasaron >90s desde la última actualización, las cuotas que tenemos NO
  // representan el mercado actual — los casinos pudieron mover líneas.
  // Apostar con datos viejos genera "fake edges" que cierran antes de
  // ejecutar el ticket. 90s es un compromiso entre frescura y cobertura
  // (algunos sports/ligas tienen ciclos de scraping más lentos).
  const MAX_STALE_MS = 90_000;
  const _now = Date.now();
  trace.afterStalenessFilter_skipped = 0;
  events = events.filter(e => {
    const age = _now - (e.lastUpdate || 0);
    if (age > MAX_STALE_MS) { trace.afterStalenessFilter_skipped++; return false; }
    return true;
  });
  trace.afterStalenessFilter = events.length;

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
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 4));
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
  //
  // FIX 2026-05: Antes el pool aceptaba picks con EV negativo y confidence baja.
  // Resultado: combinadas formadas por picks que el motor mismo creía perdedoras.
  // Ahora aplicamos pisos por nivel de riesgo. Una pick que no supera el piso
  // NO entra al pool — preferimos devolver menos combinadas (o ninguna) a
  // armar combos con picks que el motor descarta como EV-negativos.
  const MIN_EV_BY_RISK = { cons: 2.0, eq: 1.5, agg: 0.5 };
  const MIN_CONF_BY_RISK = { cons: 0.58, eq: 0.52, agg: 0.46 };
  const minEv = MIN_EV_BY_RISK[risk] ?? 1.5;
  const minConf = MIN_CONF_BY_RISK[risk] ?? 0.50;
  trace.poolRejectedLowEv = 0;
  trace.poolRejectedLowConf = 0;
  const pool = [];
  for (const a of passing) {
    const evSelections = (a.selections || [])
      .filter(s => markets.includes(s.market))
      // Analytical picks NO se filtran por casa (no tienen book asignado)
      .filter(s => s.analytical || !wantedBooks.length || wantedBooks.includes(s.book));
    for (const sel of evSelections) {
      // Pisos duros: EV y confidence por nivel de riesgo. Una pick que el
      // propio motor evalúa por debajo del piso NO debe formar combinada.
      if ((sel.consensusEv || 0) < minEv) { trace.poolRejectedLowEv++; continue; }
      if ((sel.confidence || 0) < minConf) { trace.poolRejectedLowConf++; continue; }
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

      // FIX 2026-05 #11: PENALIZACIÓN CONTRA-MERCADO FUERTE.
      // Cuando una pick va contra la opinión clara del mercado (cuota >2.10
      // en Totals/BTTS, o >3.00 en h2h = underdog real), exigimos evidencia
      // fuerte para no ser contrarian a ciegas. El bias documentado de este
      // motor está en Totals — 10 picks Under 2.5 en una jornada perdieron 9
      // porque las cuotas (2.33-2.60) eran claramente del lado Over.
      const _outLow = String(sel.outcome || '').toLowerCase();
      const _mktLow = String(sel.market || '').toLowerCase();
      const _isContrarian =
        (_mktLow === 'totals' && odd >= 2.10) ||
        (_mktLow === 'btts' && odd >= 2.10) ||
        (_mktLow === 'h2h' && odd >= 3.00);
      if (_isContrarian) {
        const sharpAligned = sharpScore > 0.6;
        const confEdge = conf - fairProb;
        if (sharpAligned && confEdge > 0.10) {
          // Contrarian PERO con sharp money + edge fuerte: aceptamos
        } else if (confEdge > 0.15) {
          // Sin sharp pero el modelo dice edge alto: penalización moderada
          score -= 8;
        } else {
          // Sin sharp ni edge fuerte: contrarian débil → penalización dura
          score -= 18;
        }
      }
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

  // FIX 2026-05 #9: tracking de picks usadas entre todos los combos del batch.
  // Antes los N combos compartían picks del top del pool → si una pick fallaba
  // (ej. "Chelsea-Tottenham Under 2.5"), TODOS los combos morían juntos. Ahora
  // cada vez que una pick entra a un combo se acumula en `picksUsedAcrossCombos`
  // y el siguiente combo la skipea (excepto en la última pasada cuando no queda
  // otra opción).
  const picksUsedAcrossCombos = new Map();   // pickSig → count
  function pickSig(p) {
    return `${p.event.id}|${p.sel.market}|${p.sel.outcome}|${p.sel.line || ''}`;
  }
  // FIX 2026-05 #10: contador de outcomes "bajistas" usados en el batch. Cuando
  // el modelo apuesta múltiples "Under 2.5" en jornadas distintas, está expuesto
  // a un día de goleadas que mata todo. Limitamos el % de Unders por batch.
  const outcomeBiasCount = { under: 0, over: 0, btts_no: 0, btts_yes: 0, total: 0 };
  function classifyBias(p) {
    const o = String(p.sel.outcome || '').toLowerCase();
    const m = String(p.sel.market || '').toLowerCase();
    if (m === 'totals' && o.includes('under')) return 'under';
    if (m === 'totals' && o.includes('over')) return 'over';
    if (m === 'btts' && (o === 'no' || o === 'btts_no')) return 'btts_no';
    if (m === 'btts' && (o === 'yes' || o === 'btts_yes')) return 'btts_yes';
    return null;
  }

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

    // FIX #10: piso dinámico de "bias bajista" por batch. Para count=3 combos
    // permitimos hasta ⌈count×legs/4⌉ Unders en total (≈25%). Resto debe ser
    // diverso (h2h, AH, BTTS-Yes, corners, etc).
    const batchTotalLegs = count * legs;
    const MAX_UNDER_IN_BATCH = Math.max(1, Math.ceil(batchTotalLegs * 0.30));
    const MAX_BTTSNO_IN_BATCH = Math.max(1, Math.ceil(batchTotalLegs * 0.30));

    // PASADA 1: STRICT — ningún mercado repetido + skip de picks ya usadas
    // en otros combos del batch + tope de bias Under/BTTS-No.
    for (const p of candidates) {
      const evId = p.event.id;
      const cur = usedByEvent.get(evId) || 0;
      if (cur >= legsPerMatch) continue;
      const mktCount = usedMarkets.get(p.sel.market) || 0;
      if (mktCount >= maxLegsPerMarket) continue;  // STRICT: no repetimos mercado
      // FIX #9 STRICT: si esta pick ya está en otro combo del batch, skip.
      if ((picksUsedAcrossCombos.get(pickSig(p)) || 0) > 0) continue;
      // FIX #10: tope de bias por batch.
      const bias = classifyBias(p);
      if (bias === 'under' && outcomeBiasCount.under >= MAX_UNDER_IN_BATCH) continue;
      if (bias === 'btts_no' && outcomeBiasCount.btts_no >= MAX_BTTSNO_IN_BATCH) continue;
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
    // 2 del mismo mercado (pero nunca 3+) Y permitimos 1 pick compartida con
    // otro combo (pero NUNCA 2 picks compartidas con el mismo combo).
    if (chosen.length < legs) {
      const relaxedMax = 2;
      for (const p of candidates) {
        if (chosen.includes(p)) continue;
        const evId = p.event.id;
        const cur = usedByEvent.get(evId) || 0;
        if (cur >= legsPerMatch) continue;
        const mktCount = usedMarkets.get(p.sel.market) || 0;
        if (mktCount >= relaxedMax) continue;
        // FIX #9 RELAX: permitimos picks que ya están en otro combo, pero
        // solo si esta combinada no tiene ya OTRA pick compartida. Eso evita
        // que dos combos compartan 2+ picks (riesgo concentrado).
        const sharedAlready = chosen.filter(c => (picksUsedAcrossCombos.get(pickSig(c)) || 0) > 0).length;
        if ((picksUsedAcrossCombos.get(pickSig(p)) || 0) > 0 && sharedAlready >= 1) continue;
        const bias = classifyBias(p);
        if (bias === 'under' && outcomeBiasCount.under >= MAX_UNDER_IN_BATCH) continue;
        if (bias === 'btts_no' && outcomeBiasCount.btts_no >= MAX_BTTSNO_IN_BATCH) continue;
        chosen.push(p);
        usedByEvent.set(evId, cur + 1);
        usedMarkets.set(p.sel.market, mktCount + 1);
        if (chosen.length >= legs) break;
      }
    }
    // PASADA 3 (último recurso): si igual no llegamos, llenamos sin restricciones
    // de mercado/sharing, pero MANTENEMOS el tope de bias Under/BTTS-No por batch.
    if (chosen.length < legs) {
      for (const p of candidates) {
        if (chosen.includes(p)) continue;
        const evId = p.event.id;
        const cur = usedByEvent.get(evId) || 0;
        if (cur >= legsPerMatch) continue;
        const bias = classifyBias(p);
        if (bias === 'under' && outcomeBiasCount.under >= MAX_UNDER_IN_BATCH) continue;
        if (bias === 'btts_no' && outcomeBiasCount.btts_no >= MAX_BTTSNO_IN_BATCH) continue;
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
    // FIX 2026-05: Antes había un bypass `skipCorrCheck = legsPerMatch > 1`
    // que aceptaba combos altamente correlacionados "by design" cuando el
    // user pedía multi-leg. Eso destruye el EV real del combo porque la casa
    // INFLA la cuota del segundo leg cuando son correlacionados positivos.
    //
    // Política nueva: si skipCorrelated=true (default), HARD reject de
    // cualquier combo con correlación positiva >0.45 (umbral profesional —
    // por ej. "Home + 1X" tiene corr 0.95, "Over + BTTS-Yes" tiene 0.55).
    // El builder reintenta con otras legs.
    const HARD_CORR_THRESHOLD = 0.45;
    if (skipCorrelated && (corr.maxPositiveCorrelation || 0) > HARD_CORR_THRESHOLD) {
      return null;  // reintentar con legs distintas
    }
    if (skipCorrelated && !corr.ok && corr.warnings?.length) {
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

    // FIX #9/#10: registrar las picks usadas + actualizar contadores de bias
    // para que el SIGUIENTE buildOneCombo del batch sepa qué evitar.
    for (const l of comboLegs) {
      const psig = `${l.eventId}|${l.market}|${l.outcome}|${l.line || ''}`;
      picksUsedAcrossCombos.set(psig, (picksUsedAcrossCombos.get(psig) || 0) + 1);
      const mkt = String(l.market || '').toLowerCase();
      const out = String(l.outcome || '').toLowerCase();
      if (mkt === 'totals' && out.includes('under')) outcomeBiasCount.under++;
      else if (mkt === 'totals' && out.includes('over')) outcomeBiasCount.over++;
      else if (mkt === 'btts' && (out === 'no' || out === 'btts_no')) outcomeBiasCount.btts_no++;
      else if (mkt === 'btts' && (out === 'yes' || out === 'btts_yes')) outcomeBiasCount.btts_yes++;
      outcomeBiasCount.total++;
    }

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
    // FIX 2026-05: HARD REJECT de combos con EV total negativo. El scoring
    // anterior dejaba que probReal*100 dominase y un combo "alta prob pero
    // EV-10%" puntuaba parecido a uno "menor prob pero EV+10%". Apostar combos
    // con EV negativo es perder por matemática — el motor no debe rankearlos.
    const edgeAdj = (c.evAdjusted != null ? c.evAdjusted : c.sumEv) || 0;
    if (edgeAdj < 0) return -1000 + edgeAdj;   // los manda al fondo, no se eligen

    const probReal = c.legs.reduce((a, l) => a * Math.max(0.05, l.confidence || 0.5), 1);
    const diversity = new Set(c.legs.map(l => l.market)).size / c.legs.length;
    let s = probReal * 100              // prob real total en %
          + edgeAdj * 1.5                // FIX: peso ↑ (era 0.6) — EV debe pesar más
          + diversity * 5                // diversidad de mercados
          + (c.sportsCount || 1) * 1.5;  // mixSports bonus suave
    // Target_odd compliance: si el user lo pidió, penalizar combos lejos del target.
    if (targetOdd) {
      const distance = Math.abs(c.totalOdd - targetOdd) / targetOdd;
      s -= distance * 25;                // 25% de penalización por cada 100% de desvío
    }
    // Penalizar correlación positiva entre legs (book inflando cuota).
    // FIX: umbral ↓ (era 0.30) y peso ↑ (era ×20) — ahora cualquier corr >0.20
    // empieza a penalizar. Por encima de 0.45 ya hay hard reject en buildOneCombo.
    const maxCorr = c.correlation?.maxPositiveCorrelation || 0;
    if (maxCorr > 0.20) s -= maxCorr * 35;
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
      // Cascada universal free-first (Groq 70B → Cerebras → OpenRouter → Groq 8B → opt-in pago)
      let aiResult = null;
      const aiOpts = { maxTokens: 1400, temperature: 0.4 };
      try {
        const r = await llmJsonAny(systemPrompt, aiPrompt, aiOpts);
        if (r.result?.combos) {
          aiResult = r.result;
          aiProvider = r.provider;
        } else if (r.result) {
          // El LLM respondió algo pero sin "combos" — log para debug
          log(`[generator] ${r.provider} respondió sin combos · keys=${Object.keys(r.result).slice(0,5)}`);
        }
      } catch (e) { log(`[generator:llm] ${e?.message?.slice(0, 120)}`); }
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

  // FIX 2026-05: si TODOS los matches analizados cayeron a offline (sin LLM real),
  // el aiHealth debe ser 'degraded' aunque después el aiBuilder no se haya
  // ejecutado. Antes este caso devolvía 'ok'/'no-keys' y el frontend nunca
  // mostraba el banner de degradación.
  const _llmAllOffline = llmOk === 0 && llmOffline > 0;
  res.json({
    combos: combos.slice(0, count),
    aiNarrative,
    aiProvider,                                  // 'gemini' | 'groq' | null
    aiHealth: _llmAllOffline ? 'degraded'
              : aiProvider ? 'ok'
              : useAiBuilder && HAS_ANY_LLM ? 'degraded'
              : useAiBuilder ? 'no-keys'
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
  // preferredBook (NUEVO): casino que el user eligió en el selector del frontend.
  // Se aplica como filtro HARD: las legs deben tener cuota REAL en ese casino,
  // sino se descartan. Cubre el bug "Coach IA me dio 8 legs pero 6 no estaban
  // en Betano" — antes los markets analíticos (corners/cards/etc) se colaban
  // como cuotas estimadas. Ahora con preferredBook seteado, NUNCA se devuelven
  // picks que no tengan cuota real en esa casa.
  const preferredBook = String(req.body?.preferredBook || '').toLowerCase().trim();
  const VALID_BOOKS = new Set(['bplay','betano','betwarrior','bet365ar','codere','betsson','casino-magic']);
  const lockedBook = VALID_BOOKS.has(preferredBook) ? preferredBook : null;

  // forceInclude (NUEVO 2026-05-19): array de eventIds que el frontend pide
  // forzar dentro de la combinada. Se usa cuando el user toca "Agregar
  // partido igualmente" sobre un partido que la IA marcó como riesgoso
  // (status: analyzed_but_unfit) en el panel de "partidos pedidos".
  // El backend los inserta en enrichedLegs aún si su score no es óptimo.
  const forceInclude = Array.isArray(req.body?.forceInclude)
    ? req.body.forceInclude.map(String).filter(Boolean).slice(0, 5)
    : [];

  if (!prompt) return res.status(400).json({ error: 'Necesitamos un prompt — escribí qué combinada querés' });
  if (prompt.length < 10) return res.status(400).json({ error: 'Prompt muy corto — explicanos qué combinada querés con un poco más de detalle' });

  // ──────────────────────────────────────────────────────────────────────────
  // PARSER 100% IA — el LLM interpreta TODO sin regex fallbacks.
  // El user puede escribir naturalmente cualquier cosa ("dame algo seguro
  // para el clásico del finde", "necesito recuperar, algo arriesgado para
  // mañana", "combinada de la NBA con totales altos") y la IA entiende.
  // Para que esto funcione, le damos al LLM TODO el contexto que necesita:
  //   • Fecha actual + día de semana en ART (para que interprete "hoy",
  //     "mañana", "este sábado", "el 18", "el lunes" sin ambigüedad)
  //   • Catálogo completo de slugs canónicos de ligas/books/markets
  //   • Few-shot examples reales para queries típicas argentinas
  // ──────────────────────────────────────────────────────────────────────────
  const nowDate = new Date();
  const ART_OFFSET_MS = -3 * 3600 * 1000; // UTC-3
  const nowArt = new Date(nowDate.getTime() + ART_OFFSET_MS);
  const DOW_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const MONTH_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  const todayArtIso = fmt(nowArt);
  const tomorrowArt = new Date(nowArt.getTime() + 24*3600*1000);
  const dowLabel = DOW_ES[nowArt.getUTCDay()];
  const dateHumanLabel = `${nowArt.getUTCDate()} de ${MONTH_ES[nowArt.getUTCMonth()]} de ${nowArt.getUTCFullYear()}`;

  const parserSystem = `Sos el INTÉRPRETE del Coach IA de BetSafe (app argentina de análisis de apuestas).
Tu única tarea: convertir el pedido del usuario (escrito en castellano rioplatense, con jerga, typos, frases incompletas o ambiguas) en un objeto JSON con los filtros estructurados que el motor entiende.

═══════════════════════════════════════════════════════════════════════
CONTEXTO TEMPORAL (zona horaria Argentina, UTC-3):
═══════════════════════════════════════════════════════════════════════
HOY es ${dowLabel} ${dateHumanLabel} (ISO: ${todayArtIso})
MAÑANA es ${fmt(tomorrowArt)}

Cuando el usuario diga "hoy" → exactDate: "${todayArtIso}"
Cuando diga "mañana" → exactDate: "${fmt(tomorrowArt)}"
Cuando diga "el lunes" / "este sábado" → calculá la fecha YYYY-MM-DD del próximo lunes/sábado a partir de hoy.
Cuando diga "el 18 de mayo" / "18/05" / "18-mayo" / "el 18" (sin mes, mes actual) → exactDate ISO de ese día.
Si la fecha mencionada ya pasó (ej hoy es 17 y dice "el 15"), asumí el mes/año siguiente.
Si NO menciona fecha alguna → exactDate: null Y timeWindow apropiado:
  • "esta semana" / "los próximos días" → timeWindow: "week"
  • "fin de semana" / "este finde" → timeWindow: "weekend"
  • sin mención → timeWindow: "any" (hasta 14 días)

═══════════════════════════════════════════════════════════════════════
CATÁLOGOS — siempre devolvés los slugs EXACTOS de abajo, nunca inventes:
═══════════════════════════════════════════════════════════════════════

SPORTS: soccer | basketball | tennis | amfootball | hockey | baseball | mma | esports | all

LEAGUES (slug canónico → cómo lo dice el usuario):
- lpf                → Liga Argentina, Liga Profesional, fútbol argentino, primera argentina, AFA, "Boca/River/Racing/Independiente/San Lorenzo/Estudiantes/Vélez"
- copa-argentina     → Copa Argentina
- primera-nacional   → Primera Nacional, Nacional B
- premier-league     → Premier League, EPL, fútbol inglés, "Liverpool/Arsenal/Manchester/Chelsea"
- la-liga            → La Liga, LaLiga, primera española, "Real Madrid/Barcelona/Atlético Madrid"
- serie-a            → Serie A, calcio italiano, "Juventus/Milan/Inter/Roma/Napoli"
- bundesliga         → Bundesliga, alemana, "Bayern/Dortmund"
- ligue-1            → Ligue 1, francesa, "PSG/Marseille"
- ucl                → Champions, Champions League, UCL, UEFA Champions
- uel                → Europa League, UEL
- libertadores       → Libertadores, Copa Libertadores
- sudamericana       → Sudamericana, Copa Sudamericana
- brasileirao        → Brasileirão, Brasil Serie A, fútbol brasileño
- liga-mx            → Liga MX, mexicana, "Pumas/Pachuca/América"
- mls                → MLS, Major League Soccer, "Inter Miami/Messi"
- nba                → NBA, "Lakers/Celtics/Lebron/Curry"
- nfl                → NFL
- nhl                → NHL
- mlb                → MLB
- ufc                → UFC, MMA, peleas

CRÍTICO — NUNCA confundir:
• "Liga Argentina" → SOLO lpf (NUNCA la-liga)
• "La Liga" / "La Liga española" → SOLO la-liga (NUNCA lpf)

BOOKS (casas argentinas legales):
betano | bplay | betsson | codere | betwarrior | bet365ar | casino-magic
• "en Betano" / "para Betano" / "que sirva en bplay" → llenar books

MARKETS (200+ disponibles, usá los slugs):
- h2h                       → ganador 1X2, quién gana
- dc                        → doble oportunidad, 1X o X2
- totals                    → más/menos goles, over/under
- btts                      → ambos marcan, BTTS, "gol y gol"
- ah                        → hándicap asiático
- dnb                       → empate no apuesta, DNB
- ht-result, totals-ht      → primer tiempo / medio tiempo
- exact-score               → marcador exacto, resultado exacto
- result-btts               → 1X2 + ambos marcan
- corners-total             → córners totales, tiros de esquina
- corners-ht, corners-team  → córners 1T / por equipo
- cards-total               → tarjetas, amonestaciones
- red-card                  → tarjeta roja, expulsión
- penalty                   → penal, habrá penal
- fouls-total               → faltas
- shots-on-target-total     → tiros al arco
- goalscorer-anytime        → goleadores, "que marque X", "anota X"
- first-goalscorer          → primer goleador, abre el marcador
- player-points             → puntos jugador NBA (Lebron, Curry, etc)
- player-rebounds           → rebotes jugador
- player-assists            → asistencias jugador
- totals-points             → totales NBA
- mma-rounds, mma-method    → MMA: rounds / método (KO/sub/decisión)

═══════════════════════════════════════════════════════════════════════
SCHEMA DEL JSON QUE TENÉS QUE DEVOLVER:
═══════════════════════════════════════════════════════════════════════
{
  "legs": 2-8 o null si no menciona,
  "sport": un slug de SPORTS arriba o "all" si ambiguo,
  "leagues": [array de slugs de LEAGUES, vacío si no menciona],
  "excludeSports": [array de slugs de SPORTS a EXCLUIR — ej "no esports" → ["esports"]],
  "excludeLeagues": [array de slugs de LEAGUES a EXCLUIR — ej "menos brasileirao" → ["brasileirao"]],
  "specificMatches": [array de "TeamA vs TeamB" si el user PIDE partidos específicos — ej "que incluya Boca vs River" → ["Boca vs River"]],
  "books": [array de slugs de BOOKS, vacío si no menciona],
  "markets": [array de slugs de MARKETS, vacío si no menciona — significa "todos"],
  "risk": "cons" | "eq" | "agg",
  "targetOdd": número (cuota total deseada) o null,
  "minTotalOdd": número (cuota total mínima — ej "entre 10x y 15x" → 10) o null,
  "maxTotalOdd": número (cuota total máxima — ej "entre 10x y 15x" → 15) o null,
  "minOddPerLeg": número o null,
  "maxOddPerLeg": número o null,
  "exactDate": "YYYY-MM-DD" o null (fecha calendario exacta en ART),
  "exactDateRange": ["YYYY-MM-DD inicio", "YYYY-MM-DD fin"] o null (rango de fechas explícito, ej "del 18 al 20 de mayo"),
  "timeWindow": "today" | "tomorrow" | "weekend" | "week" | "any",
  "preferTopTeams": true/false,
  "userIntent": "<frase de 1 línea resumiendo qué pidió el usuario>"
}

REGLAS DE RISK:
• "segura"/"tranqui"/"baja"/"conservadora"/"sin riesgo" → cons
• "equilibrada"/"balanceada"/sin mencionar → eq
• "agresiva"/"arriesgada"/"alta cuota"/"para pagar fuerte"/"recuperar" → agg

REGLAS DE CUOTA:
• "cuota 3" / "cuota total 3" / "pague 3" / "x3" / "por 3" → targetOdd: 3
• "entre X y Y" / "de X a Y" / "rango X-Y" → minTotalOdd: X, maxTotalOdd: Y
  (ejemplo: "entre 10x y 15x" → minTotalOdd: 10, maxTotalOdd: 15, targetOdd: null)
• "cuota mayor a X por leg" / "mín X cada leg" → minOddPerLeg: X
• "cuota total alrededor de X" / "cerca de X" / "como X" → targetOdd: X
• "más de X" sin más contexto → minTotalOdd: X
• "menos de X" sin más contexto → maxTotalOdd: X
• Cuando el user dice "que pague más de X" sin clarificar leg → minTotalOdd (cuota total mínima)

REGLAS DE EXCLUSIÓN (CRÍTICO):
• "no incluyas X" / "sin X" / "menos X" / "que no haya X" / "no quiero X" → excludeSports o excludeLeagues
  Ejemplos:
  - "no esports" / "sin esports" / "que no haya esports" → excludeSports: ["esports"]
  - "no incluyas brasileirao" → excludeLeagues: ["brasileirao"]
  - "menos NBA, sin tenis" → excludeSports: ["tennis"], excludeLeagues: ["nba"]
  CRUCIAL: cuando el user dice "no esports", marcalo en excludeSports — sino el motor IGNORA esa exclusión.

═══════════════════════════════════════════════════════════════════════
EJEMPLOS — INTERPRETÁ EXACTAMENTE ASÍ:
═══════════════════════════════════════════════════════════════════════

User: "haceme una combinada de 5 legs entre 10x y 15x para el 18 de mayo, no incluyas esports"
→ { "legs": 5, "sport": "all", "leagues": [], "excludeSports": ["esports"], "excludeLeagues": [], "specificMatches": [], "books": [], "markets": [], "risk": "agg", "targetOdd": null, "minTotalOdd": 10, "maxTotalOdd": 15, "minOddPerLeg": null, "maxOddPerLeg": null, "exactDate": "2026-05-18", "exactDateRange": null, "timeWindow": "custom", "preferTopTeams": true, "userIntent": "Combinada de 5 legs cuota total 10-15 para el 18 de mayo, sin esports" }

User: "haceme una combinada agresiva que pague mas de x3 pero segura con varias legs y varios deportes para mañana 18 de mayo"
→ { "legs": 4, "sport": "all", "leagues": [], "excludeSports": [], "excludeLeagues": [], "specificMatches": [], "books": [], "markets": [], "risk": "agg", "targetOdd": null, "minTotalOdd": 3, "maxTotalOdd": null, "minOddPerLeg": null, "maxOddPerLeg": null, "exactDate": "${fmt(tomorrowArt)}", "exactDateRange": null, "timeWindow": "tomorrow", "preferTopTeams": true, "userIntent": "Combinada agresiva multi-deporte cuota >3 para mañana" }

User: "algo seguro para el partido de Boca de esta noche"
→ { "legs": 2, "sport": "soccer", "leagues": ["lpf"], "excludeSports": [], "excludeLeagues": [], "specificMatches": ["Boca"], "books": [], "markets": [], "risk": "cons", "targetOdd": null, "minTotalOdd": null, "maxTotalOdd": null, "minOddPerLeg": null, "maxOddPerLeg": null, "exactDate": "${todayArtIso}", "exactDateRange": null, "timeWindow": "today", "preferTopTeams": true, "userIntent": "Combinada segura sobre Boca esta noche" }

User: "necesito recuperar lo perdido, algo arriesgado de la nba para mañana, sin tenis ni esports"
→ { "legs": 4, "sport": "basketball", "leagues": ["nba"], "excludeSports": ["tennis", "esports"], "excludeLeagues": [], "specificMatches": [], "books": [], "markets": [], "risk": "agg", "targetOdd": null, "minTotalOdd": null, "maxTotalOdd": null, "minOddPerLeg": null, "maxOddPerLeg": null, "exactDate": "${fmt(tomorrowArt)}", "exactDateRange": null, "timeWindow": "tomorrow", "preferTopTeams": false, "userIntent": "Combinada NBA agresiva para recuperar pérdida, sin tenis ni esports" }

User: "combinada con corners y tarjetas de premier para el sabado"
→ { "legs": 3, "sport": "soccer", "leagues": ["premier-league"], "excludeSports": [], "excludeLeagues": [], "specificMatches": [], "books": [], "markets": ["corners-total","cards-total"], "risk": "eq", "targetOdd": null, "minTotalOdd": null, "maxTotalOdd": null, "minOddPerLeg": null, "maxOddPerLeg": null, "exactDate": "<ISO del próximo sábado>", "exactDateRange": null, "timeWindow": "weekend", "preferTopTeams": true, "userIntent": "Combinada Premier con córners y tarjetas sábado" }

User: "10 partidos de la champions super agresivo, que multiplique por 30"
→ { "legs": 8, "sport": "soccer", "leagues": ["ucl"], "excludeSports": [], "excludeLeagues": [], "specificMatches": [], "books": [], "markets": [], "risk": "agg", "targetOdd": 30, "minTotalOdd": null, "maxTotalOdd": null, "minOddPerLeg": null, "maxOddPerLeg": null, "exactDate": null, "exactDateRange": null, "timeWindow": "any", "preferTopTeams": true, "userIntent": "Champions multi-leg muy agresiva con cuota total 30" }

═══════════════════════════════════════════════════════════════════════
INSTRUCCIONES FINALES:
═══════════════════════════════════════════════════════════════════════
• SIEMPRE devolvé JSON válido — NO markdown, NO texto extra.
• Si el user pide algo IMPOSIBLE (ej "combinada de 50 legs") clampeá al máximo (8) y avisalo en userIntent.
• Si el user pide un equipo específico ("Boca", "Real Madrid"), inferí la liga correcta.
• Si menciona típos del estilo "argentn" en lugar de "argentino", entendelo igual.
• Si el pedido es CLARAMENTE para fútbol pero no especifica liga, dejá leagues: [] (todos).
• userIntent debe ser una frase humana, no una repetición del JSON.`;

  let parsed = null;
  try {
    parsed = await preferredJson(parserSystem, prompt, { maxTokens: 800, temperature: 0.2 });
  } catch (e) {
    log(`[betsafe-ai] parse err: ${e?.message?.slice(0, 100)}`);
  }

  // Si el parser TOTALMENTE falló, devolvemos error claro en lugar de armar
  // una combinada random con defaults — eso engaña al user.
  if (!parsed || (typeof parsed !== 'object')) {
    return res.status(503).json({
      error: 'El motor IA no está respondiendo en este momento. Refrescá en unos segundos.',
      retry: true
    });
  }

  // Convertir exactDate "YYYY-MM-DD" a rango ART [start, end] en ms
  function isoToArtRange(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const [y, m, d] = iso.split('-').map(Number);
    // Medianoche ART = 03:00 UTC. Fin de día ART = 02:59:59 UTC del día siguiente.
    const start = Date.UTC(y, m - 1, d, 3, 0, 0);
    const end   = Date.UTC(y, m - 1, d + 1, 2, 59, 59, 999);
    return { start, end, label: `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`, iso };
  }

  // exactDateRange: si el user pide rango ["2026-05-18", "2026-05-20"]
  function isoRangeToArt(arr) {
    if (!Array.isArray(arr) || arr.length !== 2) return null;
    const a = isoToArtRange(arr[0]);
    const b = isoToArtRange(arr[1]);
    if (!a || !b) return null;
    return { start: a.start, end: b.end, label: `${a.label} → ${b.label}`, iso: `${a.iso}..${b.iso}` };
  }

  const filters = {
    legs: Number.isFinite(Number(parsed.legs)) ? clamp(Number(parsed.legs), 2, 8) : 3,
    sport: typeof parsed.sport === 'string' ? parsed.sport : 'all',
    leagues: Array.isArray(parsed.leagues) ? parsed.leagues.map(String) : [],
    excludeSports: Array.isArray(parsed.excludeSports) ? parsed.excludeSports.map(s => String(s).toLowerCase().trim()).filter(Boolean) : [],
    excludeLeagues: Array.isArray(parsed.excludeLeagues) ? parsed.excludeLeagues.map(s => String(s).toLowerCase().trim()).filter(Boolean) : [],
    specificMatches: Array.isArray(parsed.specificMatches) ? parsed.specificMatches.map(String).filter(Boolean) : [],
    books: Array.isArray(parsed.books) ? parsed.books.map(b => String(b).toLowerCase().trim()) : [],
    markets: Array.isArray(parsed.markets) ? parsed.markets.map(m => String(m).toLowerCase().trim()) : [],
    risk: ['cons','eq','agg'].includes(parsed.risk) ? parsed.risk : 'eq',
    targetOdd: Number.isFinite(Number(parsed.targetOdd)) ? Number(parsed.targetOdd) : null,
    minTotalOdd: Number.isFinite(Number(parsed.minTotalOdd)) ? Number(parsed.minTotalOdd) : null,
    maxTotalOdd: Number.isFinite(Number(parsed.maxTotalOdd)) ? Number(parsed.maxTotalOdd) : null,
    minOddPerLeg: Number.isFinite(Number(parsed.minOddPerLeg)) ? Number(parsed.minOddPerLeg) : null,
    maxOddPerLeg: Number.isFinite(Number(parsed.maxOddPerLeg)) ? Number(parsed.maxOddPerLeg) : null,
    timeWindow: ['today','tomorrow','weekend','week','any','custom'].includes(parsed.timeWindow) ? parsed.timeWindow : 'any',
    preferTopTeams: parsed.preferTopTeams !== false,
    userIntent: String(parsed.userIntent || prompt).slice(0, 250),
    exactDate: isoToArtRange(parsed.exactDate),
    exactDateRange: isoRangeToArt(parsed.exactDateRange)
  };
  if (filters.exactDate || filters.exactDateRange) filters.timeWindow = 'custom';

  // ── BOOK LOCK desde selector del frontend ──────────────────────────────
  // Si el user eligió un casino específico en el dropdown, lo forzamos
  // en filters.books (override del LLM parse, que podría haber detectado
  // otra cosa o nada). Esto activa modo strict: SOLO cuotas reales de
  // ese casino, sin analíticas estimadas.
  if (lockedBook) {
    filters.books = [lockedBook];
    filters.lockedBook = lockedBook;
  }

  log(`[betsafe-ai] filters parsed: sport=${filters.sport} leagues=[${filters.leagues}] books=[${filters.books}] markets=[${filters.markets}] legs=${filters.legs} risk=${filters.risk} targetOdd=${filters.targetOdd} date=${filters.exactDate?.label || filters.timeWindow}`);

  // 2) Buscar eventos REALES del orchestrator que matcheen
  const now = Date.now();
  // exactDateRange > exactDate > timeWindow (en orden de prioridad)
  // Para "today"/"tomorrow" usamos el día CALENDARIO ART, no ventanas de 24h
  // (sino "today" a las 02:00 incluiría toda la mañana siguiente).
  function calendarDayArt(offsetDays = 0) {
    const d = new Date(now + ART_OFFSET_MS + offsetDays * 24*3600*1000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    return {
      start: Date.UTC(y, m, day, 3, 0, 0),               // 00:00 ART = 03:00 UTC
      end:   Date.UTC(y, m, day + 1, 2, 59, 59, 999)     // 23:59 ART
    };
  }
  const timeRange = filters.exactDateRange
    ? [filters.exactDateRange.start, filters.exactDateRange.end]
    : filters.exactDate
      ? [filters.exactDate.start, filters.exactDate.end]
      : (filters.timeWindow === 'today'
          ? (() => { const d = calendarDayArt(0); return [d.start, d.end]; })()
          : filters.timeWindow === 'tomorrow'
            ? (() => { const d = calendarDayArt(1); return [d.start, d.end]; })()
            : ({
                weekend: [now, now + 5*24*3600*1000],
                week:    [now, now + 8*24*3600*1000],
                any:     [now, now + 14*24*3600*1000]
              }[filters.timeWindow] || [now, now + 14*24*3600*1000]));
  let candidates = orchestrator.events({ sport: filters.sport === 'all' ? 'all' : filters.sport });
  // Filtro de tiempo (STRICT — si exactDate, solo ese día calendario en ART)
  candidates = candidates.filter(e => Number.isFinite(e.start) && e.start >= timeRange[0] && e.start <= timeRange[1]);
  if (filters.exactDate || filters.exactDateRange) {
    const lbl = filters.exactDateRange?.label || filters.exactDate?.label;
    log(`[betsafe-ai] date filter ${lbl}: ${candidates.length} events en rango`);
  }

  // ── EXCLUSIÓN DE SPORTS (HARD) ──
  // Si user dijo "no esports" / "sin tenis", se respeta a rajatabla.
  if (filters.excludeSports.length) {
    const before = candidates.length;
    const excludedSet = new Set(filters.excludeSports);
    candidates = candidates.filter(e => {
      // Usar effectiveSport del orchestrator que detecta esports por nombre
      // incluso si el scraper lo marcó mal como otro sport.
      const sportRaw = e.sport || 'other';
      const evSport = orchestrator.effectiveSport ? orchestrator.effectiveSport(e) : sportRaw;
      // Match contra ambos: declared sport + effective sport
      if (excludedSet.has(sportRaw) || excludedSet.has(evSport)) return false;
      // Fallback heurístico AGRESIVO para esports — pesca casos donde
      // effectiveSport falla. Patrones reales que aparecieron en data:
      //   "Battle - Premier League - Partido de 2 x 4 minutos"
      //   "Arsenal (R0ge) (Esports) vs Liverpool (cl1vlind) (Esports)"
      //   "NBA Batalla - 4x5 min de juego"
      //   "GG League - H2H - 5x5"
      // CRITICAL: el regex NO debe tener \b al final cuando captura "min"
      // porque "min|utos" no tiene boundary entre n y u.
      if (excludedSet.has('esports')) {
        const blob = `${e.leagueName || ''} ${e.home?.name || ''} ${e.away?.name || ''}`;
        const esportsRe = /(esports?|gg\s*league|battle\b|cyber|h2h\s*gg|\d+\s*x\s*\d+\s*min(?:utos?)?|\d+\s*min(?:utos?)?\s*(?:de\s*juego|playing))/i;
        if (esportsRe.test(blob)) return false;
        // También: nombres con paréntesis tipo "Team (Handle)" (común en esports)
        const teamsBlob = `${e.home?.name || ''} ${e.away?.name || ''}`;
        if (/\(\w{2,8}\)/.test(teamsBlob)) {
          // Solo si HAY "(Esports)" o pattern claro de handle
          if (/\(esports?\)|\(\w{3,8}\)\s*\(esports?\)/i.test(teamsBlob)) return false;
        }
      }
      return true;
    });
    log(`[betsafe-ai] excludeSports[${filters.excludeSports.join(',')}]: ${before} → ${candidates.length}`);
  }

  // ── EXCLUSIÓN DE LEAGUES (HARD) ──
  // Usa regex robusto que matchea variantes con acentos/tildes/sufijos.
  // CRÍTICO: el user pidió "brasileirao" y se coló "Brasileirão C" (con tilde)
  // porque substring matching no normaliza accents. Ahora usamos LEAGUE_EXCLUDE_PATTERNS
  // que cubre variantes ortográficas + acentos + sub-divisiones (A/B/C/2/Serie).
  const LEAGUE_EXCLUDE_PATTERNS = {
    // Brasileirão = el user pidió "toda la liga brasilera" — agressivo:
    // brasileir[áaãei]?[oa]s? (brasileiro/a/as/os), brasilero, brazilian, copa do brasil,
    // serie A/B/C/D/Brasil, paulista, carioca, gaucho, mineiro (ligas regionales)
    'brasileirao':       /brasileir[ãaáei]?[oa]s?|brasilero|brazilian|copa\s*do\s*brasil|s[ée]rie\s*[abcd]?\s*brasil|brasil(?:e[ñn]o)?\s*s[ée]rie|paulist[ao]|carioca|gaucho|mineiro|catarinense/i,
    'premier-league':    /premier\s*league|premiership\b|english.*premier|epl/i,
    'la-liga':           /la\s*liga|laliga|primera\s*divisi[óo]n\s*esp/i,
    'serie-a':           /serie\s*a\b/i,
    'bundesliga':        /bundesliga/i,
    'ligue-1':           /ligue\s*[1u]/i,
    'ucl':               /champions\s*league|uefa\s*champions|^ucl\b/i,
    'uel':               /europa\s*league|^uel\b/i,
    'libertadores':      /libertadores/i,
    'sudamericana':      /sudamericana/i,
    'lpf':               /(?:liga\s*profesional\s*de\s*f[úu]tbol|liga\s*profesional\s*argentina|liga\s*argentina|primera\s*argentina|\blpf\b)/i,
    'liga-mx':           /liga\s*mx|liga\s*mexicana/i,
    'mls':               /\bmls\b|major\s*league\s*soccer/i,
    'nba':               /\bnba\b/i,
    'nfl':               /\bnfl\b/i,
    'mlb':               /\bmlb\b/i,
    'nhl':               /\bnhl\b/i,
    'ufc':               /\bufc\b/i,
    'copa-argentina':    /copa\s*argentina/i,
    'primera-nacional':  /primera\s*nacional|nacional\s*b\b/i
  };
  // Helper: normaliza accents para fallback substring match (sin tilde)
  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  if (filters.excludeLeagues.length) {
    const before = candidates.length;
    // Construir matchers: usa regex predefinido si existe, sino fallback genérico
    const excludeMatchers = filters.excludeLeagues.map(slug => {
      const s = slug.toLowerCase().trim();
      if (LEAGUE_EXCLUDE_PATTERNS[s]) return { slug: s, re: LEAGUE_EXCLUDE_PATTERNS[s] };
      // Fallback: regex genérico con escape, también buscamos en versión sin acentos
      const escaped = s.replace(/[-]/g, '[\\s-]?').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { slug: s, re: new RegExp(escaped, 'i') };
    });

    candidates = candidates.filter(e => {
      const lg = (e.league || '').toLowerCase();
      const lgName = e.leagueName || '';
      const lgNameNorm = stripAccents(lgName).toLowerCase();
      return !excludeMatchers.some(({ slug, re }) => {
        if (lg === slug) return true;
        if (re.test(lgName) || re.test(lgNameNorm)) return true;
        // Substring backup (con accents normalizados)
        if (lgNameNorm.includes(slug.replace(/-/g, ' '))) return true;
        if (lgNameNorm.includes(slug)) return true;
        return false;
      });
    });
    log(`[betsafe-ai] excludeLeagues[${filters.excludeLeagues.join(',')}]: ${before} → ${candidates.length}`);
  }

  // ── SPECIFIC MATCHES — búsqueda GLOBAL + coherencia status ────────────────
  // Refactor 2026-05-19 (bug crítico de coherencia reportado):
  //
  // Antes: el matching solo buscaba dentro de `candidates` (post date+sport+
  // league filter) por substring directo del nombre. Si el partido pedido
  // existía pero estaba excluido por otros filtros (ej user pidió Boca vs
  // Cruzeiro sin liga → el LLM marcó lpf, así Cruzeiro de Brasilerão se
  // filtraba), o si el partido NO existía en absoluto, igual se mostraba
  // un warning genérico "no se encontraron picks" mientras la combinada
  // armada incluía OTROS partidos con Boca y Cruzeiro por separado.
  //
  // Ahora: hacemos búsqueda EXHAUSTIVA en TODO el catálogo (orchestrator
  // sport=all, sin date filter), con team-name matching robusto usando
  // normalizeTeam (alias + accent fold). Resultado: specificMatchEvents[req]
  // = evento real | null. Esto alimenta:
  //   1) re-injection de events en candidates (sobrepasa filtros para que
  //      lleguen al pool análisis)
  //   2) specificMatchesStatus[] que el frontend renderiza arriba con el
  //      status REAL de cada partido pedido (incluido / no apto / no existe).
  const specificMatchEvents = {};   // requested string → orchestrator event | null
  if (filters.specificMatches.length) {
    const allEventsGlobal = orchestrator.events({ sport: 'all' });
    // Helper: dado un term "Boca Juniors vs Cruzeiro", buscar event que
    // matchee ambos teams en cualquier orden, con normalizeTeam.
    function findSpecificEvent(term) {
      const lower = term.toLowerCase().trim();
      const parts = lower.split(/\s+vs?\s+/).map(p => p.trim()).filter(Boolean);
      if (!parts.length) return null;
      // Caso A: "TeamA vs TeamB" → buscar event con ambos teams
      if (parts.length >= 2) {
        const idA = normalizeTeam(parts[0])?.id || '';
        const idB = normalizeTeam(parts[1])?.id || '';
        if (idA && idB) {
          // Match estricto: ambos IDs deben matchear (cualquier orden)
          let found = allEventsGlobal.find(e => {
            const hId = normalizeTeam(e.home?.name || '')?.id || '';
            const aId = normalizeTeam(e.away?.name || '')?.id || '';
            return (hId === idA && aId === idB) || (hId === idB && aId === idA);
          });
          if (found) return found;
          // Fallback: substring match sobre normalized names (cubre casos
          // donde normalizeTeam genera ID distinto por sufijo raro)
          const pA = parts[0].normalize('NFD').replace(/[̀-ͯ]/g, '');
          const pB = parts[1].normalize('NFD').replace(/[̀-ͯ]/g, '');
          found = allEventsGlobal.find(e => {
            const h = (e.home?.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            const a = (e.away?.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            return (h.includes(pA) && a.includes(pB)) || (h.includes(pB) && a.includes(pA));
          });
          return found || null;
        }
      }
      // Caso B: solo un team mencionado ("Boca") → primer event del calendario
      // donde ese team juegue (preferimos el más próximo en tiempo)
      const idSolo = normalizeTeam(parts[0])?.id || '';
      const term0Norm = parts[0].normalize('NFD').replace(/[̀-ͯ]/g, '');
      const matches = allEventsGlobal.filter(e => {
        const hId = normalizeTeam(e.home?.name || '')?.id || '';
        const aId = normalizeTeam(e.away?.name || '')?.id || '';
        if (idSolo && (hId === idSolo || aId === idSolo)) return true;
        const h = (e.home?.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const a = (e.away?.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return h.includes(term0Norm) || a.includes(term0Norm);
      });
      if (!matches.length) return null;
      matches.sort((a, b) => (a.start || Infinity) - (b.start || Infinity));
      return matches[0];
    }
    for (const term of filters.specificMatches) {
      specificMatchEvents[term] = findSpecificEvent(term);
    }
    // Re-injectar los specificMatch events en candidates ANTES de continuar.
    // Estos sobrepasan los filtros de fecha/liga/sport — son explícitamente
    // pedidos por el user y deben tener PRIORIDAD ABSOLUTA según las nuevas
    // reglas de Coach IA (2026-05-19).
    const candidateIds = new Set(candidates.map(e => e.id));
    for (const [term, ev] of Object.entries(specificMatchEvents)) {
      if (!ev) continue;
      ev._coachSpecificMatch = true;
      ev._coachSpecificRequest = term;
      if (!candidateIds.has(ev.id)) {
        candidates.unshift(ev);
        candidateIds.add(ev.id);
      }
    }
    const realMatched = Object.values(specificMatchEvents).filter(Boolean).length;
    log(`[betsafe-ai] specificMatches GLOBAL search: ${realMatched}/${filters.specificMatches.length} encontrados — re-injected en candidates`);
  }
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
    // ── Búsqueda ALTERNATIVA: si no hay para timeWindow pedido, probamos
    // ampliando a week/any para sugerir cuándo sí hay partidos de esa liga.
    // Sin esto, el user recibe "no-events" mudo sin saber que River juega el sábado.
    let suggested = null;
    if (filters.timeWindow !== 'any') {
      const wideRange = [now, now + 14 * 24 * 3600 * 1000];
      let wide = orchestrator.events({ sport: filters.sport === 'all' ? 'all' : filters.sport })
        .filter(e => Number.isFinite(e.start) && e.start >= wideRange[0] && e.start <= wideRange[1]);
      if (filters.leagues.length) {
        const LEAGUE_PATTERNS_W = {
          'premier-league': /premier\s*league|premiership\b|english.*premier|epl/i,
          'la-liga':        /la\s*liga|laliga|primera\s*divisi[óo]n\s*esp|liga\s*espa[ñn]ola/i,
          'serie-a':        /serie\s*a\b/i,
          'bundesliga':     /bundesliga/i,
          'ligue-1':        /ligue\s*[1u]|ligue1/i,
          'ucl':            /champions\s*league|uefa\s*champions|^ucl\b/i,
          'uel':            /europa\s*league|^uel\b/i,
          'libertadores':   /libertadores/i,
          'sudamericana':   /sudamericana/i,
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
        const matchersW = filters.leagues.map(slug => LEAGUE_PATTERNS_W[slug] || new RegExp(slug.replace(/-/g, '[\\s-]?'), 'i'));
        wide = wide.filter(e => matchersW.some(re => re.test(String(e.leagueName || ''))));
      }
      if (wide.length) {
        wide.sort((a, b) => a.start - b.start);
        const nextEv = wide[0];
        const nextDate = new Date(nextEv.start);
        const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
        const dow = days[nextDate.getDay()];
        const dd = nextDate.getDate();
        const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const mm = months[nextDate.getMonth()];
        suggested = {
          window: filters.timeWindow === 'today' ? 'esta semana' : 'próximas 2 semanas',
          count: wide.length,
          nextDate: `${dow} ${dd} de ${mm}`,
          examples: wide.slice(0, 3).map(e => ({
            home: e.home?.name || e.home,
            away: e.away?.name || e.away,
            league: e.leagueName || e.league,
            start: e.start
          }))
        };
      }
    }
    const bookList = filters.books.length ? ` en ${filters.books.join('/')}` : '';
    const baseMsg = `No hay partidos${bookList} que cumplan tus filtros para ${filters.timeWindow === 'today' ? 'hoy' : filters.timeWindow === 'tomorrow' ? 'mañana' : 'esa fecha'}.`;
    // Sugerencia priorizada: si hay lockedBook, el primer hint debe ser quitar
    // ese filtro (es la causa más común de "no encuentro nada" — user no se
    // dio cuenta que el selector de casino quedó pegado de antes).
    let suggestMsg;
    if (filters.lockedBook) {
      suggestMsg = ` Tenés el selector de casino en **${filters.lockedBook}** arriba — probá cambiándolo a "Cualquier casa" para ver muchas más opciones.`;
      if (suggested) suggestMsg += ` También podés pedir "para esta semana" o "el finde" en lugar de una fecha específica.`;
    } else if (suggested) {
      suggestMsg = ` El próximo partido es el ${suggested.nextDate} (${suggested.examples.map(e => `${e.home} vs ${e.away}`).join(', ')}). Pedime la combinada para "esta semana" o "el finde".`;
    } else {
      suggestMsg = ' Probá ampliar las ligas o el periodo (ej "esta semana" en lugar de un día específico).';
    }
    return res.json({
      ok: false,
      reason: 'no-events',
      message: baseMsg + suggestMsg,
      filters,
      suggested
    });
  }

  // 3) Analizar los top candidates con la pipeline.
  // TOP_N: pool de eventos a analizar antes de seleccionar las legs finales.
  //
  // ESTRATEGIA EXPANDIDA (2026-05-18): cuando el user es EXPLÍCITO con filtros
  // restrictivos (cuota range, legs ≥4, excludes, specific matches, fecha),
  // necesitamos un pool MÁS GRANDE para tener picks que cumplan tras single-book.
  // Antes capábamos en 14-20 → ahora hasta 60 con filtros explícitos.
  //
  // Trade-off: 60 análisis × ~2s con concurrency=8 → ~15s total. Aceptable
  // para Coach IA (es VIP feature, latency 10-20s tolerable a cambio de fit real).
  const steam = orchestrator.steamMoves();
  const surebets = arbEngine.snapshot().detected;
  const hasRestrictiveFilters = !!(filters.minOddPerLeg || filters.books.length
    || filters.minTotalOdd != null || filters.maxTotalOdd != null
    || filters.excludeSports.length || filters.excludeLeagues.length
    || filters.specificMatches.length);
  const isExplicit = hasRestrictiveFilters || filters.legs >= 4;
  const TOP_N = Math.min(
    isExplicit ? 60 : (hasRestrictiveFilters ? 20 : 14),
    Math.max(8, filters.legs * 6),  // tras single-book, ~2-3x del target es safe
    candidates.length
  );
  log(`[betsafe-ai] analyzing top=${TOP_N}/${candidates.length} candidates (explicit=${isExplicit})`);
  // FIX 2026-05: filtro de staleness — descartar eventos con cuotas >90s
  // sin update. Las cuotas viejas generan "fake edges" porque las casas ya
  // movieron las líneas. Aplicamos el mismo umbral que /api/generator.
  const _coachStaleCutoff = Date.now() - 90_000;
  const _coachBeforeStale = candidates.length;
  let _coachFreshCandidates = candidates.filter(e => (e.lastUpdate || 0) >= _coachStaleCutoff);
  // Si el filtro deja menos de filters.legs eventos, relajamos a 180s para no
  // dejar al user sin combinada por una pausa transitoria del scraper.
  if (_coachFreshCandidates.length < filters.legs) {
    const _looseCutoff = Date.now() - 180_000;
    _coachFreshCandidates = candidates.filter(e => (e.lastUpdate || 0) >= _looseCutoff);
    log(`[betsafe-ai] staleness relaxed to 180s — fresh count strict=${candidates.filter(e => (e.lastUpdate || 0) >= _coachStaleCutoff).length} loose=${_coachFreshCandidates.length}`);
  }
  log(`[betsafe-ai] staleness filter: ${_coachBeforeStale} → ${_coachFreshCandidates.length}`);
  const top = _coachFreshCandidates.slice(0, TOP_N);
  const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 4));
  const analyzed = await Promise.allSettled(
    top.map(ev => analyzeLimit(() => analyzeMatch(ev, { steamMoves: steam, surebets })))
  );

  // Helper: si el user pidió una casa específica, intentamos REEMPLAZAR la cuota
  // de la selection (que usa la mejor casa por default) con la de la casa pedida,
  // si existe para ese mercado/outcome. Si no existe, el pick queda fuera.
  function tryBookOverride(sel, event) {
    if (!filters.books.length) return sel;
    const requested = filters.books;
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
      // Markets extendidos (2026-05-17) — disponibles en Bplay después de
      // agregar parsers en bplayXml.js. Si la casa los tiene, ya no son
      // "estimación analítica" sino cuota real verificable.
      else if (mkt === 'dnb') {
        odd = event.markets?.dnb?.[book]?.[outcome];                                      // home | away
      } else if (mkt === 'ht-result') {
        odd = event.markets?.['ht-result']?.[book]?.[outcome];                            // home | draw | away
      } else if (mkt === 'totals-ht' && sel.line != null) {
        odd = event.markets?.['totals-ht']?.[book]?.[sel.line]?.[outcome];                // over | under
      } else if (mkt === 'corners-total' && sel.line != null) {
        odd = event.markets?.['corners-total']?.[book]?.[sel.line]?.[outcome];            // over | under
      } else if (mkt === 'cards-total' && sel.line != null) {
        odd = event.markets?.['cards-total']?.[book]?.[sel.line]?.[outcome];              // over | under
      } else if (mkt === 'exact-score') {
        // outcome esperado tipo "1-0", "2-1", etc.
        odd = event.markets?.['exact-score']?.[book]?.[outcome];
      }
      if (Number.isFinite(odd) && odd > 1.01) {
        return { ...sel, odd: Number(odd), book };
      }
    }
    return null;
  }

  // ── BUILD POOL con flag de book lock (refactor 2026-05-17) ──────────────
  //
  // REAL-ONLY vs ANALYTICAL handling (refactor 2026-05-19):
  // Markets que SOLO existen como analítico (no scrapeados de casas AR):
  //   - goalscorer-anytime, first-goalscorer (goleadores)
  //   - player-points, player-rebounds, player-assists (NBA props)
  //   - mma-method, mma-rounds (UFC método/rounds)
  //   - corners-team, corners-ht
  //   - yrfi, nrfi, f5 (MLB innings)
  //   - tennis-totals-games, tennis-aces (props tennis)
  //   - nfl player props, nhl player props
  //
  // REGLA: Si el user PIDE explícitamente uno de estos markets en su prompt
  // (filters.markets incluye uno analítico-only), permitimos analytical PARA
  // ESE request. Sino, modo conservador (solo casas reales). Esto fixea
  // los botones de Goleadores/NBA puntos/UFC método/MLB carreras que
  // devolvían vacío por filtrar agresivamente.
  const ANALYTICAL_ONLY_MARKETS = new Set([
    'goalscorer-anytime', 'first-goalscorer', 'last-goalscorer',
    'player-points', 'player-rebounds', 'player-assists', 'player-threes',
    'player-blocks', 'player-steals', 'player-double-double', 'player-triple-double',
    'mma-method', 'mma-rounds', 'mma-distance',
    'corners-team', 'corners-ht',
    'cards-team', 'cards-ht',
    'yrfi', 'nrfi', 'f5-runs', 'f5-result',
    'tennis-totals-games', 'tennis-tiebreak', 'tennis-aces-total', 'tennis-doublefaults',
    'esports-maps-total', 'esports-rounds-total', 'esports-kills-total', 'esports-firstblood',
    'shots-on-target-total', 'shots-total', 'fouls-total',
    'penalty', 'red-card', 'pass-completions',
    'nfl-spread', 'nfl-totals', 'nfl-td-first', 'nfl-td-anytime',
    'nfl-yards-passing', 'nfl-yards-rushing', 'nfl-yards-receiving',
    'nhl-goals', 'nhl-shots', 'nhl-pucks',
    'totals-points', 'spread'
  ]);
  const userAskedAnalytical = (filters.markets || []).some(m => ANALYTICAL_ONLY_MARKETS.has(m));
  const allowAnalytical = process.env.BS_COACH_ALLOW_ANALYTICAL === 'true' || userAskedAnalytical;
  if (userAskedAnalytical) {
    log(`[betsafe-ai] user asked analytical markets [${filters.markets.filter(m => ANALYTICAL_ONLY_MARKETS.has(m)).join(',')}] → enabling analytical pool`);
  }

  // FIX 2026-05: pisos de calidad para Coach IA (consistentes con /api/generator).
  // Una pick que el motor evalúa por debajo del piso NO debe entrar a la combinada.
  // Risk-aware: conservador exige más EV+confidence, agresivo permite más laxo.
  const _COACH_MIN_EV   = { cons: 2.0, eq: 1.5, agg: 0.5 }[filters.risk] ?? 1.5;
  const _COACH_MIN_CONF = { cons: 0.58, eq: 0.52, agg: 0.46 }[filters.risk] ?? 0.50;
  function buildPool(applyBookLock) {
    const out = [];
    for (const r of analyzed) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const a = r.value;
      const candidateSels = [];
      if (filters.markets.length) {
        for (const s of (a.selections || [])) if (filters.markets.includes(s.market)) candidateSels.push(s);
      } else {
        for (const s of (a.selections || [])) if (s && s.odd) candidateSels.push(s);
      }
      for (let sel of candidateSels) {
        if (!sel || !sel.odd) continue;
        // SKIP analytical UNLESS user pidió analytical-only markets explícitamente
        if (sel.analytical && !allowAnalytical) continue;
        // SKIP si no tiene book asignado (no es de una casa real) — pero permitir si analytical OK
        if (!sel.book && !allowAnalytical) continue;
        // PISOS DE CALIDAD: ningún pick con EV o conf por debajo del piso del riesgo
        if ((sel.consensusEv || 0) < _COACH_MIN_EV) continue;
        if ((sel.confidence || 0) < _COACH_MIN_CONF) continue;
        if (applyBookLock && filters.books.length) {
          if (sel.analytical) {
            sel = { ...sel, book: filters.books[0] };
          } else {
            const overridden = tryBookOverride(sel, a.event);
            if (!overridden) continue;
            sel = overridden;
          }
        }
        if (filters.minOddPerLeg && sel.odd < filters.minOddPerLeg) continue;
        if (filters.maxOddPerLeg && sel.odd > filters.maxOddPerLeg) continue;
        out.push({ event: a.event, factors: a.factors, sel, llmKey: a.llmKeyFactor, llmSynth: a.llmSynthesis });
      }
    }
    return out;
  }

  let pool = buildPool(true);

  // ── AUTO-FALLBACK del book lock ──
  // Si con la casa elegida no tenemos suficientes picks, RELAJAMOS el book
  // lock y reusamos el pool sin él. Esto evita el escenario "elegí Betano,
  // no encuentra nada, pantalla vacía" — preferimos mostrar resultados de
  // todas las casas con warning explícito.
  if (filters.lockedBook && pool.length < filters.legs) {
    const relaxedPool = buildPool(false);
    if (relaxedPool.length > pool.length) {
      log(`[betsafe-ai] auto-fallback book lock: ${pool.length} con ${filters.lockedBook} → ${relaxedPool.length} sin lock`);
      pool = relaxedPool;
      filters._bookLockRelaxed = {
        requested: filters.lockedBook,
        coveredInRequested: pool.filter(p => p.sel.book === filters.lockedBook || p.sel.analytical).length
      };
      // El frontend ya muestra los badges por leg ("✓ Betano" / "⚠ no en Betano"
      // / "~ Estimada") gracias al enrichedLegs con analytical. Acá solo
      // marcamos el meta para que el banner amarillo lo explique al user.
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
    const odd = p.sel.odd || 1.5;
    const isTop = orchestrator.eventPriority?.(p.event) >= 2 ? 1 : 0;
    const hasLeague = filters.leagues.length === 0 || filters.leagues.some(lg =>
      (p.event.leagueName || '').toLowerCase().includes(lg.replace(/-/g, ' ')) ||
      p.event.league === lg
    ) ? 1 : 0;
    let s = ev + conf * 25 + isTop * 8 + hasLeague * 10;
    // FIX 2026-05 #11 (Coach IA): misma penalización contra-mercado que /api/generator.
    // Cuota implícita del lado opuesto <48% en Totals/BTTS o <33% en h2h →
    // estás siendo contrarian al mercado, exigimos evidencia fuerte.
    const _mkt = String(p.sel.market || '').toLowerCase();
    const _isContrarian = (_mkt === 'totals' && odd >= 2.10)
                       || (_mkt === 'btts' && odd >= 2.10)
                       || (_mkt === 'h2h' && odd >= 3.00);
    if (_isContrarian) {
      const fairProb = odd > 1.01 ? (1 / odd) : 0.5;
      const sharpAligned = (p.factors?.sharp?.score || 0) > 0.6;
      const confEdge = conf - fairProb;
      if (sharpAligned && confEdge > 0.10) {
        // sharp + edge fuerte → aceptamos
      } else if (confEdge > 0.15) {
        s -= 8;
      } else {
        s -= 18;
      }
    }
    return s;
  }
  const sortedPool = pool.slice().sort((a, b) => legScore(b) - legScore(a));

  // Greedy SELECTION CON BONUS DE DIVERSIDAD: elegimos legs una por una,
  // penalizando markets que ya están en chosen. Antes la combinada era
  // siempre "3 picks tipo h2h del top scoring". Ahora si el #1 es h2h, el
  // #2 prefiere otro mercado (corners/cards/totals) si el score no cae
  // mucho. Resultado: combinadas con MEZCLA real de mercados, no 3 h2h.
  // Helpers de dedup robustos (definidos arriba en el handler también — los
  // re-declaramos acá para que pickWithDiversity los use desde el armado inicial)
  function _mkKey(ev) {
    const start = Math.floor((Number(ev?.start) || 0) / 60000);
    const home = normalizeTeam(ev?.home?.name || '')?.id || '';
    const away = normalizeTeam(ev?.away?.name || '')?.id || '';
    return `${start}|${home}|${away}`;
  }
  function pickWithDiversity(maxLegs) {
    const out = [];
    const usedEvents = new Set();      // event.id
    const usedMatches = new Set();     // start+home+away normalizado (anti cross-source dup)
    const marketCount = new Map();
    // PRIORIDAD ABSOLUTA: si user pidió partidos específicos, esos van PRIMERO
    // (siempre que el pool los haya analizado y devuelto picks). Lo único que
    // los excluye es que analyzeMatch los haya rechazado por error técnico.
    const specificPool = sortedPool.filter(p => p.event._coachSpecificMatch);
    for (const p of specificPool) {
      if (out.length >= maxLegs) break;
      if (usedEvents.has(p.event.id) || usedMatches.has(_mkKey(p.event))) continue;
      out.push(p);
      usedEvents.add(p.event.id);
      usedMatches.add(_mkKey(p.event));
      marketCount.set(p.sel.market, (marketCount.get(p.sel.market) || 0) + 1);
    }
    while (out.length < maxLegs) {
      // Re-rankear cada vez basado en lo que ya elegimos. Filtramos:
      //   - misma referencia
      //   - mismo event.id
      //   - mismo match-key (cubre eventos duplicados con IDs distintos)
      const remaining = sortedPool.filter(p =>
        !out.includes(p) &&
        !usedEvents.has(p.event.id) &&
        !usedMatches.has(_mkKey(p.event))
      );
      if (!remaining.length) break;
      let best = remaining[0];
      let bestScore = -Infinity;
      for (const p of remaining) {
        const baseScore = legScore(p);
        const repeatPenalty = (marketCount.get(p.sel.market) || 0) * 10;
        const adjusted = baseScore - repeatPenalty;
        if (adjusted > bestScore) { bestScore = adjusted; best = p; }
      }
      out.push(best);
      usedEvents.add(best.event.id);
      usedMatches.add(_mkKey(best.event));
      marketCount.set(best.sel.market, (marketCount.get(best.sel.market) || 0) + 1);
    }
    return out;
  }
  let chosen = pickWithDiversity(filters.legs);

  // ── FORCE INCLUDE — el user tocó "Agregar partido igualmente" ──────────────
  // Si forceInclude trae eventIds, los buscamos en el pool y los EMPUJAMOS
  // dentro de chosen, reemplazando legs de menor score si excedemos
  // filters.legs. Si el evento NO está en el pool (analyzeMatch falló o
  // analytical/book lock lo descartó), lo construimos sintéticamente con
  // el mejor pick disponible del orchestrator directamente.
  if (forceInclude.length) {
    const chosenIds = new Set(chosen.map(c => c.event.id));
    for (const evId of forceInclude) {
      if (chosenIds.has(evId)) continue;
      let poolEntry = pool.find(p => p.event.id === evId);
      if (!poolEntry) {
        // Buscar en analyzed (puede que esté ahí pero filtrado del pool por
        // book lock o analytical). Tomar el mejor pick que tenga.
        const a = analyzed.find(r => r.status === 'fulfilled' && r.value?.event?.id === evId);
        if (a?.value?.selections?.length) {
          const sel = a.value.selections.find(s => s && s.odd && s.book)
                   || a.value.selections.find(s => s && s.odd)
                   || a.value.selections[0];
          if (sel) {
            poolEntry = {
              event: a.value.event,
              factors: a.value.factors,
              sel,
              llmKey: a.value.llmKeyFactor,
              llmSynth: a.value.llmSynthesis,
              _forced: true
            };
          }
        }
      }
      if (!poolEntry) {
        log(`[betsafe-ai] forceInclude ${evId}: no se pudo construir leg (sin selections válidas)`);
        continue;
      }
      poolEntry._forced = true;
      if (chosen.length >= filters.legs) {
        // Reemplazar el de menor score que NO sea otro forced/specific
        let dropIdx = -1, dropScore = Infinity;
        for (let i = 0; i < chosen.length; i++) {
          const c = chosen[i];
          if (c._forced || c.event._coachSpecificMatch) continue;
          const s = legScore(c);
          if (s < dropScore) { dropScore = s; dropIdx = i; }
        }
        if (dropIdx >= 0) chosen[dropIdx] = poolEntry;
        else chosen.push(poolEntry);   // todas forced — extendemos
      } else {
        chosen.push(poolEntry);
      }
      chosenIds.add(evId);
    }
    log(`[betsafe-ai] forceInclude aplicado: ${forceInclude.length} eventIds → ${chosen.length} legs totales`);
  }

  // ── ODD OPTIMIZATION: targetOdd OR minTotalOdd/maxTotalOdd ──
  // Si el user pidió un rango (10x-15x), el algoritmo busca el combo cuyo
  // producto cae DENTRO del rango. Si pidió target X, busca el más cercano.
  // Si NO se puede caer en el rango, devuelve el más cercano a la frontera.
  const hasOddConstraint = !!(filters.targetOdd || filters.minTotalOdd != null || filters.maxTotalOdd != null);
  if (hasOddConstraint) {
    const N = pool.length;
    let bestCombo = chosen;
    let bestScore = -Infinity;

    // El target sintético del rango: si user pidió [10, 15], target = 12.5 (centro)
    // Sino, target = targetOdd literal.
    const rangeMin = filters.minTotalOdd != null ? filters.minTotalOdd : (filters.targetOdd != null ? filters.targetOdd * 0.85 : null);
    const rangeMax = filters.maxTotalOdd != null ? filters.maxTotalOdd : (filters.targetOdd != null ? filters.targetOdd * 1.15 : null);
    const syntheticTarget = filters.targetOdd != null
      ? filters.targetOdd
      : (rangeMin != null && rangeMax != null ? (rangeMin + rangeMax) / 2 : (rangeMin != null ? rangeMin * 1.1 : rangeMax * 0.9));

    function evalCombo(combo) {
      const total = combo.reduce((a, c) => a * c.sel.odd, 1);
      const inRange = (rangeMin == null || total >= rangeMin) && (rangeMax == null || total <= rangeMax);
      // Penalty por estar fuera de rango (medido por distance a la frontera más cercana)
      let outOfRangePenalty = 0;
      if (!inRange) {
        if (rangeMin != null && total < rangeMin) outOfRangePenalty = (rangeMin - total) / rangeMin;
        if (rangeMax != null && total > rangeMax) outOfRangePenalty = (total - rangeMax) / rangeMax;
      }
      // Diff vs target (suave) — segundo criterio cuando ya está en rango
      const diffPct = Math.abs(total - syntheticTarget) / syntheticTarget;
      const avgScore = combo.reduce((a, c) => a + legScore(c), 0) / combo.length;
      // Función objetivo: PRIORIZA estar en rango. Si fuera, penaliza fuerte.
      // Si en rango, secundario es: cerca de target + alto avg score.
      const fit = (inRange ? 10 : 0) - outOfRangePenalty * 20 - diffPct * 2 + avgScore * 0.5;
      return { total, inRange, fit };
    }

    // 1) Greedy 1-leg swap: empezar con top-scored y reemplazar 1 leg a la vez
    let cur = chosen.slice();
    for (let iter = 0; iter < 40; iter++) {
      const { fit: curFit } = evalCombo(cur);
      let improved = false;
      for (let i = 0; i < cur.length; i++) {
        for (let j = 0; j < N; j++) {
          if (cur.includes(pool[j])) continue;
          const newCur = cur.slice();
          newCur[i] = pool[j];
          const r = evalCombo(newCur);
          if (r.fit > curFit + 0.01) {
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
    bestScore = greedyResult.fit;
    bestCombo = cur;

    // 2) Greedy 2-leg swap: si todavía estamos fuera de rango, reemplazar
    // PARES de legs simultáneamente (encuentra combos que 1-leg swap no
    // puede). Crucial cuando cada leg individual cambia poco la cuota
    // total pero pares de legs sí.
    if (!greedyResult.inRange && N >= filters.legs + 2) {
      let cur2 = bestCombo.slice();
      for (let iter = 0; iter < 15; iter++) {
        const { fit: curFit } = evalCombo(cur2);
        let improved = false;
        // Probar todas las combinaciones de 2 legs (i,j) → reemplazar por (a,b) del pool
        outer: for (let i = 0; i < cur2.length; i++) {
          for (let j = i + 1; j < cur2.length; j++) {
            for (let a = 0; a < N; a++) {
              if (cur2.includes(pool[a])) continue;
              for (let b = a + 1; b < N; b++) {
                if (cur2.includes(pool[b])) continue;
                const newCur = cur2.slice();
                newCur[i] = pool[a];
                newCur[j] = pool[b];
                const r = evalCombo(newCur);
                if (r.fit > curFit + 0.05) {
                  cur2 = newCur;
                  improved = true;
                  break outer;
                }
              }
            }
          }
        }
        if (!improved) break;
      }
      const eval2 = evalCombo(cur2);
      if (eval2.fit > bestScore) {
        bestScore = eval2.fit;
        bestCombo = cur2;
      }
    }

    // 3) BRUTE FORCE ENUMERATION cuando es factible
    // Combinaciones N choose K: si total < 100k, enumeramos TODAS y encontramos
    // el combo óptimo absoluto. Esto garantiza encontrar combo en rango si existe.
    // 30 choose 4 = 27.4k → factible
    // 60 choose 5 = 5.5M → demasiado
    function binomial(n, k) {
      if (k < 0 || k > n) return 0;
      if (k === 0 || k === n) return 1;
      let r = 1;
      for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
      return r;
    }
    const totalCombos = binomial(N, filters.legs);
    if (totalCombos > 0 && totalCombos < 100_000) {
      log(`[betsafe-ai] brute force enumeration: ${totalCombos} combos (N=${N}, K=${filters.legs})`);
      const indexes = Array(filters.legs).fill(0).map((_, i) => i);
      let bruteCount = 0;
      const enumerate = () => {
        const combo = indexes.map(i => pool[i]);
        const r = evalCombo(combo);
        if (r.fit > bestScore) {
          bestScore = r.fit;
          bestCombo = combo;
        }
        bruteCount++;
      };
      // Iterar combinaciones con next-combination algoritmo
      enumerate();
      while (true) {
        let i = filters.legs - 1;
        while (i >= 0 && indexes[i] === N - filters.legs + i) i--;
        if (i < 0) break;
        indexes[i]++;
        for (let j = i + 1; j < filters.legs; j++) indexes[j] = indexes[j - 1] + 1;
        enumerate();
      }
      log(`[betsafe-ai] brute force: enumerated ${bruteCount} combos, bestScore=${bestScore.toFixed(2)}`);
    } else {
      // Fallback: random sampling (mucho más cuando enumeración no es viable)
      for (let i = 0; i < 800; i++) {
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
        }
      }
    }
    chosen = bestCombo;
    const finalEval = evalCombo(bestCombo);
    log(`[betsafe-ai] odd optimization FINAL: total=${finalEval.total.toFixed(2)} inRange=${finalEval.inRange} ` +
        `range=[${rangeMin || '∅'}-${rangeMax || '∅'}] target=${syntheticTarget?.toFixed(2)}`);
  }
  // ── DEDUP ROBUSTO ANTI-DUPLICADOS ───────────────────────────────────────
  // Bug reportado: combinada con OKC vs SA Spurs DOS VECES (uno con id
  // "OKC Thunder" y otro con id "Oklahoma City Thunder" — el orchestrator
  // creó 2 IDs distintos por matching imperfecto cross-source).
  // Dedup en 3 niveles, cada uno descarta el duplicado:
  //   1) event.id (el dedup original — falla cuando hay split de IDs)
  //   2) match-key: start-minute + nombres normalizados de home+away
  //      (pesca duplicados cross-source aunque tengan IDs distintos)
  //   3) pick-key: matchKey + market + outcome + line (evita 2 picks
  //      idénticos sobre el mismo partido, ej. 2 veces "Over 195.5 pts")
  const seenEvents = new Set();
  const seenMatches = new Set();
  const seenPicks = new Set();
  function matchKey(ev) {
    const start = Math.floor((Number(ev?.start) || 0) / 60000); // minuto
    const home = normalizeTeam(ev?.home?.name || '')?.id || '';
    const away = normalizeTeam(ev?.away?.name || '')?.id || '';
    return `${start}|${home}|${away}`;
  }
  function pickKey(c) {
    return `${matchKey(c.event)}|${c.sel.market}|${c.sel.outcome}|${c.sel.line || ''}`;
  }
  chosen = chosen.filter(c => {
    const eid = c.event?.id;
    const mk  = matchKey(c.event);
    const pk  = pickKey(c);
    if (eid && seenEvents.has(eid)) return false;
    if (seenMatches.has(mk)) return false;
    if (seenPicks.has(pk)) return false;
    if (eid) seenEvents.add(eid);
    seenMatches.add(mk);
    seenPicks.add(pk);
    return true;
  });
  // Si quedaron menos por dedup, completar con sortedPool (respetando dedup también)
  if (chosen.length < filters.legs) {
    for (const p of sortedPool) {
      if (chosen.includes(p)) continue;
      const eid = p.event?.id;
      const mk  = matchKey(p.event);
      const pk  = pickKey(p);
      if (eid && seenEvents.has(eid)) continue;
      if (seenMatches.has(mk)) continue;
      if (seenPicks.has(pk)) continue;
      chosen.push(p);
      if (eid) seenEvents.add(eid);
      seenMatches.add(mk);
      seenPicks.add(pk);
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
      // analytical=true: cuota estimada por el motor (no scrapeada). El user
      // debe verificarla en la casa antes de apostar. El frontend muestra
      // badge "Estimada" en lugar de "✓ verificada".
      analytical: !!c.sel.analytical,
      confidence: c.sel.confidence,
      ev: c.sel.consensusEv,
      rationale: c.sel.rationale,
      llmKeyFactor: c.llmKey
    };
  });

  const totalOdd = enrichedLegs.reduce((a, l) => a * l.odd, 1);

  // NOTA: narrative generation MOVIDA después de single-book consolidation
  // (más abajo). Antes se generaba acá con `totalOdd` pre-consolidation y
  // luego la consolidation modificaba enrichedLegs, dejando la narrative
  // mintiendo sobre "cuota X" cuando la final era distinta.
  let narrative = null;
  let aiProvider = null;

  // ── VALIDACIÓN STRICT DE FILTROS POST-ARMADO ─────────────────────────────
  // El user reportó: "pedí cuota 3, me dio 2.8 / pedí 18-may, me dio 19-may".
  // Si la combinada armada NO cumple los filtros declarados, devolvemos
  // warnings explícitos para que el frontend los muestre clarito.
  // En STRICT_MODE, si alguno se incumple, RECHAZAMOS la combinada (mejor
  // decir "no se pudo" que mentir con "respetando todos los filtros").
  const validationIssues = [];

  // Helper: usa finalTotalOddRef (recalcula post-consolidation cuando esté seteado)
  // sino usa el totalOdd inicial. Esta variable se reasigna en línea ~3265 a finalTotalOdd.
  // Por ahora usamos el pre-consolidation totalOdd; la validación detallada se recorre
  // de nuevo después del consolidate para usar el valor FINAL.

  // 1) targetOdd: verificar que la cuota total esté CERCA del target (±15%)
  if (filters.targetOdd) {
    const diff = (totalOdd - filters.targetOdd) / filters.targetOdd;
    if (Math.abs(diff) > 0.15) {
      validationIssues.push({
        type: 'target-odd-miss',
        critical: true,
        message: diff < 0
          ? `Pediste cuota ${filters.targetOdd.toFixed(2)} pero la combinada quedó en ${totalOdd.toFixed(2)} (${Math.abs(diff*100).toFixed(0)}% por debajo). El pool del día no tenía picks con valor para llegar a tu target sin sacrificar calidad.`
          : `Pediste cuota ${filters.targetOdd.toFixed(2)} pero la combinada quedó en ${totalOdd.toFixed(2)} (${Math.abs(diff*100).toFixed(0)}% por encima). Probá pidiendo menos legs o cuota más baja para ajustar.`
      });
    }
  }
  // 1b) RANGO de cuota total (minTotalOdd, maxTotalOdd) — STRICT, se re-verifica
  // post-consolidation también porque single-book puede cambiar la cuota total.
  if (filters.minTotalOdd && totalOdd < filters.minTotalOdd) {
    validationIssues.push({
      type: 'total-odd-below-min',
      critical: true,
      message: `Pediste cuota total mínimo ${filters.minTotalOdd.toFixed(2)} pero la combinada quedó en ${totalOdd.toFixed(2)}. El pool no tenía picks con valor suficiente para llegar al mínimo pedido.`
    });
  }
  if (filters.maxTotalOdd && totalOdd > filters.maxTotalOdd) {
    validationIssues.push({
      type: 'total-odd-above-max',
      critical: true,
      message: `Pediste cuota total máximo ${filters.maxTotalOdd.toFixed(2)} pero la combinada quedó en ${totalOdd.toFixed(2)}. Probá pedir menos legs o cuotas más bajas.`
    });
  }
  // 2) exactDate / exactDateRange: verificar que TODAS las legs caigan en rango
  if (filters.exactDate || filters.exactDateRange) {
    const dateRange = filters.exactDateRange || filters.exactDate;
    const legsOffDay = enrichedLegs.filter(l =>
      !l.start || l.start < dateRange.start || l.start > dateRange.end
    );
    if (legsOffDay.length) {
      validationIssues.push({
        type: 'date-mismatch',
        critical: true,
        message: `Pediste partidos del ${dateRange.label} pero ${legsOffDay.length} de las ${enrichedLegs.length} legs son de otra fecha.`
      });
    }
  }
  // 3) legs: verificar que armamos el número EXACTO pedido
  if (filters.legs && enrichedLegs.length !== filters.legs) {
    validationIssues.push({
      type: enrichedLegs.length < filters.legs ? 'legs-short' : 'legs-excess',
      critical: true,
      message: `Pediste ${filters.legs} legs pero solo armé ${enrichedLegs.length}. ${enrichedLegs.length < filters.legs ? 'El pool no tenía suficientes picks que cumplan tus filtros.' : 'El sistema añadió legs extra por error.'}`
    });
  }
  // 3b) excludeSports leak check
  if (filters.excludeSports.length) {
    const leaked = enrichedLegs.filter(l => {
      const sport = orchestrator.effectiveSport
        ? orchestrator.effectiveSport({ sport: l.sport, leagueName: l.leagueName, home: l.home, away: l.away })
        : l.sport;
      return filters.excludeSports.includes(sport) || filters.excludeSports.includes(l.sport);
    });
    if (leaked.length) {
      validationIssues.push({
        type: 'excluded-sport-leak',
        critical: true,
        message: `Pediste EXCLUIR ${filters.excludeSports.join(', ')} pero ${leaked.length} legs son de ese deporte: ${leaked.map(l => `${l.home.name} vs ${l.away.name}`).join(', ')}.`
      });
    }
  }
  // 3c) excludeLeagues leak check — usa misma logica que candidates filter
  // (regex + accents normalize). Sino daba false negatives con acentos.
  if (filters.excludeLeagues.length) {
    const leakMatchers = filters.excludeLeagues.map(slug => {
      const s = slug.toLowerCase().trim();
      if (LEAGUE_EXCLUDE_PATTERNS[s]) return { slug: s, re: LEAGUE_EXCLUDE_PATTERNS[s] };
      const escaped = s.replace(/[-]/g, '[\\s-]?').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { slug: s, re: new RegExp(escaped, 'i') };
    });
    const leaked = enrichedLegs.filter(l => {
      const lg = (l.league || '').toLowerCase();
      const lgName = l.leagueName || '';
      const lgNameNorm = stripAccents(lgName).toLowerCase();
      return leakMatchers.some(({ slug, re }) => {
        if (lg === slug) return true;
        if (re.test(lgName) || re.test(lgNameNorm)) return true;
        if (lgNameNorm.includes(slug.replace(/-/g, ' '))) return true;
        if (lgNameNorm.includes(slug)) return true;
        return false;
      });
    });
    if (leaked.length) {
      validationIssues.push({
        type: 'excluded-league-leak',
        critical: true,
        message: `Pediste EXCLUIR ligas ${filters.excludeLeagues.join(', ')} pero ${leaked.length} legs son de esas ligas: ${leaked.map(l => l.leagueName).join(', ')}.`
      });
    }
  }
  // 3d) specificMatches: el sistema COHERENTE de tracking de partidos pedidos.
  //
  // Refactor 2026-05-19: en lugar de un warning genérico crítico que
  // CONTRADECÍA la combinada (decía "no se encontró Boca vs Cruzeiro"
  // pero la combinada incluía OTROS partidos con Boca y Cruzeiro por
  // separado), ahora generamos un specificMatchesStatus array con el
  // estado REAL de cada partido pedido. El frontend lo renderiza arriba
  // como panel dedicado, con botón "Agregar igualmente" para los que
  // existen pero fueron descartados por análisis. NO se agrega
  // validationIssue acá — la UI dedicada es más clara y honesta.
  //
  // Esto cubre la regla principal de coherencia: la IA jamás puede
  // contradecirse — el mensaje debe reflejar exactamente lo que hizo.
  // 4) markets: verificar que todas las legs usen los mercados pedidos
  if (filters.markets.length) {
    const wrongMarkets = enrichedLegs.filter(l => !filters.markets.includes(l.market));
    if (wrongMarkets.length) {
      validationIssues.push({
        type: 'market-mismatch',
        message: `Pediste mercados ${filters.markets.join(', ')} pero ${wrongMarkets.length} legs usan otros mercados (no había suficientes picks con valor en los mercados pedidos).`
      });
    }
  }
  // 5b) AUTO-FALLBACK del book lock — banner explícito si el sistema relajó
  //     el filtro porque no había suficientes partidos en la casa elegida.
  if (filters._bookLockRelaxed) {
    const r = filters._bookLockRelaxed;
    validationIssues.push({
      type: 'book-lock-relaxed',
      message: `Pediste cuotas de ${r.requested} pero no había suficientes partidos ahí — relajamos el filtro y armamos con cuotas de TODAS las casas. Cada leg tiene un badge indicando si la cuota es real de ${r.requested} (✓ verde) o de otra casa (⚠ amarillo). Verificá cada cuota antes de apostar.`
    });
  }
  // 5) BOOK COVERAGE — verificar que las legs reales (no analíticas) tengan
  //    cuota REAL en el casino elegido. Los analíticos quedan etiquetados con
  //    el book elegido pero son cuota estimada — los excluimos del check de
  //    coverage (el badge "Estimada" en el frontend ya avisa al user).
  if (filters.lockedBook && !filters._bookLockRelaxed) {
    const realLegs = enrichedLegs.filter(l => !l.analytical);
    const wrongBook = realLegs.filter(l => l.book !== filters.lockedBook);
    const analyticCount = enrichedLegs.length - realLegs.length;
    if (wrongBook.length) {
      validationIssues.push({
        type: 'book-mismatch',
        message: `Pediste cuotas de ${filters.lockedBook} pero ${wrongBook.length} legs quedaron en otra casa (${[...new Set(wrongBook.map(l => l.book))].join(', ')}). Esa casa no tenía cuota disponible para esos partidos — el sistema cayó a la mejor alternativa.`
      });
    }
    if (analyticCount > 0) {
      validationIssues.push({
        type: 'book-analytical',
        message: `${analyticCount} de las ${enrichedLegs.length} legs son cuotas ESTIMADAS por el motor (córners, tarjetas, goleadores, marcador exacto). Las 6 casas AR suelen ofrecer estos mercados — verificá la cuota real en ${filters.lockedBook} antes de apostar.`
      });
    }
    log(`[betsafe-ai] book coverage en ${filters.lockedBook}: ${realLegs.length - wrongBook.length}/${realLegs.length} reales + ${analyticCount} analíticas`);
  }

  // ── SINGLE-BOOK CONSOLIDATION (2026-05-18, mejorado 2026-05-19) ──────
  // Algoritmo STRICT: TODA la combinada en UNA casa.
  //
  // SKIP cuando legs son MAYORMENTE analíticas (markets like goleadores,
  // player props, MMA método — no existen en casas AR). En ese caso, no
  // hay book real que cubra, así que dejamos el combo como analítico puro
  // (frontend muestra disclaimer "verificá en tu casa").
  const realLegsCount = enrichedLegs.filter(l => !l.analytical).length;
  const skipSingleBook = enrichedLegs.length > 0 && realLegsCount < Math.ceil(enrichedLegs.length / 2);
  if (skipSingleBook) {
    log(`[betsafe-ai] skipping single-book consolidation: ${enrichedLegs.length - realLegsCount}/${enrichedLegs.length} legs analíticas`);
  }

  const bookCoverage = {};  // book → { count, totalOdd }
  if (!skipSingleBook) {
    for (const leg of enrichedLegs) {
      for (const alt of (leg.bookAlternatives || [])) {
        if (!bookCoverage[alt.book]) bookCoverage[alt.book] = { count: 0, totalOdd: 1 };
        bookCoverage[alt.book].count++;
        bookCoverage[alt.book].totalOdd *= alt.odd;
      }
    }
  }
  let combinationBook = null;
  let droppedLegs = 0;
  if (Object.keys(bookCoverage).length) {
    // PRIORIZAR: 1° book que cubra TODAS las legs (preserva count),
    // 2° book con más cobertura (drop algunas), 3° tiebreaker mejor odd
    const targetLegs = filters.legs || enrichedLegs.length;
    const sorted = Object.entries(bookCoverage).sort((a, b) => {
      // Si A cubre todas las legs y B no → A primero
      const aFull = a[1].count >= enrichedLegs.length ? 1 : 0;
      const bFull = b[1].count >= enrichedLegs.length ? 1 : 0;
      if (aFull !== bFull) return bFull - aFull;
      // Sino: el de más cobertura
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return b[1].totalOdd - a[1].totalOdd;
    });

    // INTENTO 1: con cada book candidato, ver cuántas legs retiene
    let bestAttempt = null;
    for (const [book, info] of sorted.slice(0, 6)) {  // top 6 books
      const filteredLegs = [];
      for (const leg of enrichedLegs) {
        const alt = (leg.bookAlternatives || []).find(a => a.book === book);
        if (alt) {
          // Crear copia para no mutar el original durante el test
          filteredLegs.push({ ...leg, odd: alt.odd, book });
        }
      }
      // Si este book retiene MÁS legs que el mejor anterior, lo elegimos
      if (!bestAttempt || filteredLegs.length > bestAttempt.legs.length) {
        bestAttempt = { book, legs: filteredLegs };
      }
      // Si ya tenemos cobertura completa, paramos
      if (filteredLegs.length === enrichedLegs.length) break;
    }

    if (bestAttempt && bestAttempt.legs.length >= 2) {
      combinationBook = bestAttempt.book;
      droppedLegs = enrichedLegs.length - bestAttempt.legs.length;
      enrichedLegs.length = 0;
      enrichedLegs.push(...bestAttempt.legs);

      // INTENTO 2: si quedamos cortos (drop > 0) Y aún no llegamos a
      // filters.legs target, BUSCAR picks adicionales del pool original
      // que ESTÉN disponibles en combinationBook.
      if (filters.legs && enrichedLegs.length < filters.legs) {
        // CRÍTICO: usamos la MISMA función matchKey() del dedup principal
        // (línea 3165) que usa normalizeTeam — sino "OKC Thunder" vs
        // "Oklahoma City Thunder" se cuentan como partidos DISTINTOS y
        // se duplica la leg del mismo partido (bug reportado por user).
        // También dedupe por pick (event + market + outcome + line) para
        // que ni siquiera entre con MISMO partido y MISMO mercado.
        const seenEventIds = new Set(enrichedLegs.map(l => l.eventId));
        const seenMatchKeys = new Set();
        const seenPickKeys = new Set();
        for (const l of enrichedLegs) {
          seenMatchKeys.add(matchKey(l));
          seenPickKeys.add(`${matchKey(l)}|${l.market}|${l.outcome}|${l.line || ''}`);
        }
        // Iterar pool buscando candidatos disponibles en combinationBook
        for (const p of pool) {
          if (enrichedLegs.length >= filters.legs) break;
          const ev = p.event;
          if (seenEventIds.has(ev.id)) continue;
          const mk = matchKey(ev);
          if (seenMatchKeys.has(mk)) continue;
          const pk = `${mk}|${p.sel.market}|${p.sel.outcome}|${p.sel.line || ''}`;
          if (seenPickKeys.has(pk)) continue;
          // Verificar que esta sel esté en combinationBook
          const sel = p.sel;
          const fullEv = orchestrator.findEvent(ev.id);
          const alts = fullEv ? getBookAlternatives(fullEv, sel) : [];
          const alt = alts.find(a => a.book === combinationBook);
          if (!alt) continue;
          // Verificar excludeSports también acá
          if (filters.excludeSports.length) {
            const sportRaw = ev.sport || 'other';
            const evSport = orchestrator.effectiveSport ? orchestrator.effectiveSport(ev) : sportRaw;
            if (filters.excludeSports.includes(sportRaw) || filters.excludeSports.includes(evSport)) continue;
          }
          // Verificar excludeLeagues también acá (CRÍTICO: sin esto el
          // multi-book retry colaba ligas excluidas al completar legs)
          if (filters.excludeLeagues.length) {
            const lg = (ev.league || '').toLowerCase();
            const lgName = ev.leagueName || '';
            const lgNameNorm = stripAccents(lgName).toLowerCase();
            const leaked = filters.excludeLeagues.some(slug => {
              const s = slug.toLowerCase().trim();
              const re = LEAGUE_EXCLUDE_PATTERNS[s];
              if (lg === s) return true;
              if (re && (re.test(lgName) || re.test(lgNameNorm))) return true;
              if (lgNameNorm.includes(s.replace(/-/g, ' '))) return true;
              if (lgNameNorm.includes(s)) return true;
              return false;
            });
            if (leaked) continue;
          }
          enrichedLegs.push({
            eventId: ev.id,
            home: { id: ev.home?.id, name: ev.home?.name },
            away: { id: ev.away?.id, name: ev.away?.name },
            start: ev.start,
            sport: ev.sport,
            league: ev.league,
            leagueName: ev.leagueName,
            market: sel.market,
            outcome: sel.outcome,
            line: sel.line || null,
            label: sel.label,
            odd: alt.odd,
            book: combinationBook,
            bookAlternatives: alts,
            analytical: !!sel.analytical,
            confidence: sel.confidence,
            ev: sel.consensusEv,
            rationale: sel.rationale,
            llmKeyFactor: p.llmKey
          });
          seenEventIds.add(ev.id);
          seenMatchKeys.add(mk);
          seenPickKeys.add(pk);
        }
        if (enrichedLegs.length === filters.legs) {
          log(`[betsafe-ai] multi-book retry: completed ${filters.legs} legs en ${combinationBook}`);
        } else {
          log(`[betsafe-ai] multi-book retry: ${enrichedLegs.length}/${filters.legs} legs en ${combinationBook} (pool insuficiente)`);
        }
      }
    }
  }

  // ── DEFENSIVE DEDUP FINAL (post-multi-book retry) ──
  // Por si CUALQUIER path metió legs duplicadas (mismo partido con
  // variantes de nombre cross-source), hacemos una pasada final
  // que dropea cualquier evento o partido ya visto.
  {
    const seenE = new Set();
    const seenM = new Set();
    const seenP = new Set();
    const deduped = [];
    let dropped = 0;
    for (const l of enrichedLegs) {
      const mk = matchKey(l);
      const pk = `${mk}|${l.market}|${l.outcome}|${l.line || ''}`;
      if (l.eventId && seenE.has(l.eventId)) { dropped++; continue; }
      if (seenM.has(mk)) { dropped++; continue; }
      if (seenP.has(pk)) { dropped++; continue; }
      deduped.push(l);
      if (l.eventId) seenE.add(l.eventId);
      seenM.add(mk);
      seenP.add(pk);
    }
    if (dropped > 0) {
      log(`[betsafe-ai] DEFENSIVE DEDUP: dropeé ${dropped} legs duplicadas (mismo partido + market)`);
      enrichedLegs.length = 0;
      enrichedLegs.push(...deduped);
    }
  }

  // ── DEFENSIVE DATE FILTER (post-enrichment) ──
  // Si alguna leg quedó con start fuera del rango pedido, dropeala.
  // Esto pesca casos donde el orchestrator devolvió events con start mal
  // calculado (timezone bug del scraper) o el LLM eligió eventos del pool
  // ANTES de mi candidates filter por algún path raro.
  if (filters.exactDate || filters.exactDateRange) {
    const dateRange = filters.exactDateRange || filters.exactDate;
    const beforeCount = enrichedLegs.length;
    const filteredByDate = enrichedLegs.filter(l =>
      Number.isFinite(l.start) && l.start >= dateRange.start && l.start <= dateRange.end
    );
    if (filteredByDate.length !== beforeCount) {
      log(`[betsafe-ai] defensive date filter: ${beforeCount} → ${filteredByDate.length} (range: ${dateRange.label})`);
      enrichedLegs.length = 0;
      enrichedLegs.push(...filteredByDate);
    }
  }

  // Recalcular totalOdd con las cuotas single-book
  const finalTotalOdd = enrichedLegs.reduce((a, l) => a * l.odd, 1);

  // Si quedó vacío después del filtro STRICT, devolvemos error claro
  if (enrichedLegs.length === 0) {
    return res.status(200).json({
      ok: false,
      reason: 'no-single-book',
      message: 'No encontré una casa que ofrezca todas las apuestas juntas. Probá pidiendo menos legs, otra liga, o agregá la casa específica en tu pedido.',
      filters,
      droppedLegs: chosen.length
    });
  }

  // ── RE-VALIDACIÓN POST-CONSOLIDATION ─────────────────────────────────
  // El single-book consolidation pudo cambiar el count de legs y totalOdd.
  // Re-validamos contra el estado FINAL para que validationIssues refleje
  // la realidad (no estado previo). Limpiamos issues de tipos ahora obsoletos
  // y los re-evaluamos con finalTotalOdd / enrichedLegs.length finales.
  const obsoleteTypes = new Set(['target-odd-miss', 'total-odd-below-min', 'total-odd-above-max', 'legs-short', 'legs-excess']);
  for (let i = validationIssues.length - 1; i >= 0; i--) {
    if (obsoleteTypes.has(validationIssues[i].type)) validationIssues.splice(i, 1);
  }

  // targetOdd FINAL
  if (filters.targetOdd) {
    const diff = (finalTotalOdd - filters.targetOdd) / filters.targetOdd;
    if (Math.abs(diff) > 0.15) {
      validationIssues.push({
        type: 'target-odd-miss', critical: true,
        message: diff < 0
          ? `Pediste cuota ${filters.targetOdd.toFixed(2)} pero la combinada quedó en ${finalTotalOdd.toFixed(2)} (${Math.abs(diff*100).toFixed(0)}% por debajo).`
          : `Pediste cuota ${filters.targetOdd.toFixed(2)} pero la combinada quedó en ${finalTotalOdd.toFixed(2)} (${Math.abs(diff*100).toFixed(0)}% por encima).`
      });
    }
  }
  // RANGO FINAL
  if (filters.minTotalOdd && finalTotalOdd < filters.minTotalOdd) {
    validationIssues.push({
      type: 'total-odd-below-min', critical: true,
      message: `Pediste cuota total mínimo ${filters.minTotalOdd.toFixed(2)} pero la combinada quedó en ${finalTotalOdd.toFixed(2)}.`
    });
  }
  if (filters.maxTotalOdd && finalTotalOdd > filters.maxTotalOdd) {
    validationIssues.push({
      type: 'total-odd-above-max', critical: true,
      message: `Pediste cuota total máximo ${filters.maxTotalOdd.toFixed(2)} pero la combinada quedó en ${finalTotalOdd.toFixed(2)}.`
    });
  }
  // LEGS COUNT FINAL
  if (filters.legs && enrichedLegs.length !== filters.legs) {
    validationIssues.push({
      type: enrichedLegs.length < filters.legs ? 'legs-short' : 'legs-excess',
      critical: true,
      message: `Pediste ${filters.legs} legs pero solo armé ${enrichedLegs.length}. ${enrichedLegs.length < filters.legs ? 'El pool no tenía suficientes picks que cumplan tus filtros tras consolidar en una sola casa.' : 'El sistema añadió legs extra por error.'}`
    });
  }

  // ── STRICT MODE: si hay issues críticas Y el user FUE EXPLÍCITO con filtros,
  // rechazamos la combinada en vez de mentir con "✓ respetando todos los filtros".
  const userWasExplicit = !!(filters.legs >= 3 || filters.targetOdd || filters.minTotalOdd
    || filters.maxTotalOdd || filters.excludeSports.length || filters.excludeLeagues.length
    || filters.specificMatches.length || filters.exactDate || filters.exactDateRange);
  const criticalIssues = validationIssues.filter(v => v.critical);
  if (userWasExplicit && criticalIssues.length >= 2) {
    return res.status(200).json({
      ok: false,
      reason: 'filters-not-met',
      message: 'No pude armar una combinada que respete TODOS los filtros que pediste. Te muestro lo que armé pero no es exactamente lo pedido — preferimos ser honestos.',
      filters,
      // Devolvemos también la combinada armada como degraded para que el user vea
      // qué se intentó hacer (con los issues claros)
      degradedAttempt: {
        legs: enrichedLegs,
        totalOdd: Number(finalTotalOdd.toFixed(2)),
        combinationBook,
        validationIssues: criticalIssues
      }
    });
  }

  // ── NARRATIVE GENERATION (POST-CONSOLIDATION) ─────────────────────────
  // Generamos la narrative ACÁ con el estado FINAL (finalTotalOdd, legs reales).
  // El LLM NO debe validar compliance — el backend ya lo hizo. Le pasamos
  // explícitamente los constraints + criticalIssues para que NO mienta.
  // Además le pasamos FACTORES profundos por leg (lesiones, alineaciones,
  // momentum, clima, head-to-head) para que la narrative sea analítica real.
  const constraintsBlock = [
    filters.legs ? `- legs solicitadas: ${filters.legs} (armadas: ${enrichedLegs.length})` : '',
    filters.targetOdd ? `- cuota total target: ${filters.targetOdd} (resultado: ${finalTotalOdd.toFixed(2)})` : '',
    filters.minTotalOdd != null ? `- cuota total mínima: ${filters.minTotalOdd} (resultado: ${finalTotalOdd.toFixed(2)})` : '',
    filters.maxTotalOdd != null ? `- cuota total máxima: ${filters.maxTotalOdd} (resultado: ${finalTotalOdd.toFixed(2)})` : '',
    filters.exactDate ? `- fecha pedida: ${filters.exactDate.label}` : '',
    filters.exactDateRange ? `- rango de fechas: ${filters.exactDateRange.label}` : '',
    filters.excludeSports.length ? `- deportes EXCLUIDOS: ${filters.excludeSports.join(', ')}` : '',
    filters.excludeLeagues.length ? `- ligas EXCLUIDAS: ${filters.excludeLeagues.join(', ')}` : '',
    filters.specificMatches.length ? `- partidos pedidos: ${filters.specificMatches.join(', ')}` : ''
  ].filter(Boolean).join('\n');
  const issuesBlock = criticalIssues.length
    ? `\n\nADVERTENCIAS (NO MENTIR sobre cumplimiento — son problemas REALES):\n${criticalIssues.map(i => `- ${i.message}`).join('\n')}`
    : '';

  // ── Factores profundos por leg (lesiones, alineaciones, momentum, etc.) ──
  // Buscamos el resultado de analyzeMatch correspondiente a cada leg para
  // incluir el contexto analítico real. Si no hay datos, omitimos esa leg
  // del bloque pero la incluimos en la lista básica.
  function formatFactorsForLeg(leg) {
    const analyzed_r = analyzed.find(r => r.status === 'fulfilled' && r.value?.event?.id === leg.eventId);
    const f = analyzed_r?.value?.factors || {};
    const parts = [];
    if (f.injuries?.severityScore != null) {
      const inj = f.injuries;
      if (inj.home > 0.3 || inj.away > 0.3) {
        parts.push(`lesiones: ${leg.home.name} ${(inj.home*100).toFixed(0)}% / ${leg.away.name} ${(inj.away*100).toFixed(0)}%${inj.keyPlayers ? ` (claves: ${inj.keyPlayers.slice(0,3).join(', ')})` : ''}`);
      }
    }
    if (f.lineups?.home?.length || f.lineups?.away?.length) {
      const hl = f.lineups.home?.length || 0;
      const al = f.lineups.away?.length || 0;
      if (hl >= 8 && al >= 8) parts.push(`alineaciones confirmadas`);
    }
    if (f.form) {
      if (f.form.home) parts.push(`forma ${leg.home.name}: ${f.form.home}`);
      if (f.form.away) parts.push(`forma ${leg.away.name}: ${f.form.away}`);
    }
    if (f.h2h?.summary) parts.push(`H2H: ${f.h2h.summary}`);
    if (f.weather?.summary) parts.push(`clima: ${f.weather.summary}`);
    if (f.xg) {
      if (f.xg.home && f.xg.away) parts.push(`xG: ${f.xg.home.toFixed(2)}-${f.xg.away.toFixed(2)}`);
    }
    if (leg.llmKeyFactor) parts.push(`factor clave: ${leg.llmKeyFactor}`);
    return parts.join('; ');
  }

  const narrativeSystem = `Sos un analista cuantitativo de apuestas. Justificás una combinada al usuario en castellano argentino, 100-150 palabras, sin jerga técnica innecesaria.

REGLAS ABSOLUTAS (incumplir = FAIL):
1. NUNCA mientas sobre compliance. Si te paso ADVERTENCIAS, mencionalas honestamente al PRINCIPIO (ej: "no llegué a tu cuota mínima de 10x, quedó en 6.5").
2. NUNCA inventes números. Si te paso totalOdd=25.46, NO digas "cuota 40".
3. NUNCA digas que cumple un filtro si te paso una advertencia sobre ese filtro.
4. Si TODOS los filtros se cumplen sin advertencias, podés decirlo (sé natural).
5. USÁ los FACTORES que te paso por leg (lesiones, alineaciones, forma, xG, H2H, clima) — son data REAL del partido. Mencioná los más relevantes.
6. NO inventes lesiones ni datos. Si te paso "lesiones: 60%", podés decir "Liverpool tiene bajas importantes". Si NO te paso lesiones, NO digas "no hay lesiones".
7. COHERENCIA TOTAL: SOLO podés mencionar partidos que estén en la lista COMBINADA FINAL abajo. NUNCA menciones partidos que el user pidió pero NO están en la combinada — eso ya lo maneja el panel "Partidos que pediste" del frontend. Si decís "incluí X vs Y", X vs Y DEBE estar en la combinada final. Decir lo contrario = bug crítico de coherencia.

JSON estricto: { "narrative": "<párrafo 100-150 palabras>", "headline": "<frase corta atractiva sin números falsos>" }`;
  const narrativePrompt = `El usuario pidió: "${filters.userIntent}"

CONSTRAINTS DEL USER + RESULTADO REAL:
${constraintsBlock || '(sin constraints específicos)'}

COMBINADA FINAL (cuota total ${finalTotalOdd.toFixed(2)}, ${enrichedLegs.length} legs en ${combinationBook || 'mejor casa por leg'}):
${enrichedLegs.map((l, i) => {
  const d = l.start ? new Date(l.start) : null;
  const dateStr = d ? `${d.toLocaleDateString('es-AR',{day:'numeric',month:'short'})} ${d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}` : '';
  const factors = formatFactorsForLeg(l);
  return `${i+1}. ${l.home.name} vs ${l.away.name} | ${l.leagueName || l.league} | ${dateStr} | ${l.label} @ ${l.odd}${factors ? `\n   FACTORES: ${factors}` : ''}`;
}).join('\n')}${issuesBlock}

Explicá honestamente: si NO cumple algo del pedido (advertencias), decilo claro al principio. Después justificá CADA leg con los FACTORES reales — lesiones, forma, xG, alineaciones, H2H. Mostrá rigor analítico real.`;

  try {
    const r = await llmJsonAny(narrativeSystem, narrativePrompt, { maxTokens: 500, temperature: 0.4 });
    if (r.result) { narrative = r.result; aiProvider = r.provider; }
  } catch (e) { log(`[betsafe-ai narrative] ${e?.message?.slice(0, 80)}`); }

  // ── SPECIFIC MATCHES STATUS — fuente única de verdad para el panel del UI ──
  // Por cada partido pedido por el user, determinamos su estado FINAL:
  //   - 'included':      el partido está en enrichedLegs (lo agregamos).
  //   - 'analyzed_unfit': el partido EXISTE y fue ANALIZADO, pero no entró
  //                       a la combinada por análisis adverso (low score,
  //                       book lock excluyó la sel, etc). canForceInclude=true.
  //   - 'analyzed_failed': el partido existe pero analyzeMatch falló (sin
  //                        selections válidas). canForceInclude=false.
  //   - 'not_in_catalog': el partido no existe en orchestrator.events()
  //                       (no está en el calendario actual). canForceInclude=false.
  const specificMatchesStatus = (filters.specificMatches || []).map(requested => {
    const ev = specificMatchEvents[requested];
    if (!ev) {
      return {
        requested,
        status: 'not_in_catalog',
        canForceInclude: false,
        message: `No encontré "${requested}" en el calendario actual. Puede no estar programado o no estar en ninguna de las 6 casas legales argentinas.`
      };
    }
    const inLegs = enrichedLegs.find(l => l.eventId === ev.id);
    if (inLegs) {
      return {
        requested,
        status: 'included',
        canForceInclude: false,
        eventId: ev.id,
        home: { id: ev.home?.id, name: ev.home?.name },
        away: { id: ev.away?.id, name: ev.away?.name },
        start: ev.start,
        leagueName: ev.leagueName || ev.league,
        sport: ev.sport,
        legMarket: inLegs.market,
        legLabel: inLegs.label,
        legOdd: inLegs.odd,
        message: `Incluí ${ev.home?.name} vs ${ev.away?.name} en la combinada con el mercado más efectivo según el análisis.`
      };
    }
    // Buscar info de análisis aunque no haya entrado
    const analyzedR = analyzed.find(r => r.status === 'fulfilled' && r.value?.event?.id === ev.id);
    const inPool = pool.some(p => p.event.id === ev.id);
    if (analyzedR?.value?.selections?.length) {
      const bestSel = analyzedR.value.selections
        .filter(s => s && s.odd)
        .sort((a, b) => (b.consensusEv || 0) - (a.consensusEv || 0))[0];
      const ev_pct = bestSel?.consensusEv != null ? bestSel.consensusEv.toFixed(2) : null;
      const conf = bestSel?.confidence != null ? Math.round(bestSel.confidence * 100) : null;
      // Razón humana de por qué no entró
      let reason;
      if (!inPool) {
        reason = bestSel?.analytical
          ? `el mejor pick es analítico (no hay cuota REAL en las casas argentinas)`
          : `el book seleccionado no tiene cuotas para este partido`;
      } else {
        reason = ev_pct != null && Number(ev_pct) < 0
          ? `valor esperado negativo (EV ${ev_pct}%)`
          : (conf != null && conf < 40
              ? `confianza estadística baja (${conf}%)`
              : `volatilidad o score insuficiente para entrar al top ${filters.legs}`);
      }
      return {
        requested,
        status: 'analyzed_unfit',
        canForceInclude: true,
        eventId: ev.id,
        home: { id: ev.home?.id, name: ev.home?.name },
        away: { id: ev.away?.id, name: ev.away?.name },
        start: ev.start,
        leagueName: ev.leagueName || ev.league,
        sport: ev.sport,
        analysis: bestSel ? {
          market: bestSel.market,
          outcome: bestSel.outcome,
          label: bestSel.label,
          odd: bestSel.odd,
          book: bestSel.book,
          ev: bestSel.consensusEv,
          confidence: bestSel.confidence
        } : null,
        message: `Analicé ${ev.home?.name} vs ${ev.away?.name} pero ${reason}. Podés agregarlo igualmente — entenderás que el análisis no lo recomienda.`
      };
    }
    // analyzeMatch falló o no devolvió selections
    return {
      requested,
      status: 'analyzed_failed',
      canForceInclude: false,
      eventId: ev.id,
      home: { id: ev.home?.id, name: ev.home?.name },
      away: { id: ev.away?.id, name: ev.away?.name },
      start: ev.start,
      leagueName: ev.leagueName || ev.league,
      sport: ev.sport,
      message: `${ev.home?.name} vs ${ev.away?.name} existe en el calendario pero el motor no pudo procesar los mercados (data incompleta de las casas). Refrescá en unos minutos.`
    };
  });

  res.json({
    ok: true,
    filters,
    legs: enrichedLegs,
    totalOdd: Number(finalTotalOdd.toFixed(2)),
    // combinationBook: la casa elegida para JUGAR toda la combinada (single-book mode)
    // Si combinationBook=null, no se logró determinar una casa común.
    combinationBook,
    headline: narrative?.headline || `Combinada de ${enrichedLegs.length} partidos a cuota ${finalTotalOdd.toFixed(2)}`,
    narrative: narrative?.narrative || `Armé esta combinada de ${enrichedLegs.length} partidos basándome en tu pedido. Cada leg fue seleccionada por su edge sobre la casa y consistencia con el resto.`,
    aiProvider,                              // 'openai-gpt-5-mini' | 'groq-70b' | ... — solo info interna, no se muestra al user
    aiHealth: aiProvider ? 'ok' : (HAS_GEMINI || HAS_GROQ || HAS_OPENAI ? 'degraded' : 'no-keys'),
    avgConfidence: Number((enrichedLegs.reduce((a, l) => a + (l.confidence || 0), 0) / enrichedLegs.length).toFixed(3)),
    validationIssues,                        // array de discrepancias entre filtros y resultado
    // SOLO true si NINGUNA issue critical (banner verde "✓ respetando todos los filtros"
    // solo aparece cuando es VERDAD). Issues no-critical (warnings) sí permiten OK.
    filtersFullyRespected: criticalIssues.length === 0,
    // NUEVO 2026-05-19: estado COHERENTE de cada partido pedido específicamente
    // por el user. El frontend renderiza un panel dedicado arriba con esto.
    specificMatchesStatus,
    // Eco del forceInclude aplicado (para que el frontend sepa qué se agregó)
    forceIncludeApplied: forceInclude
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
    const analyzeLimit = pLimit(Number(process.env.PICKS_CONCURRENCY || 4));
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
      if (!r.ok) {
        const raw = await r.text();
        status.tests.gemini.error = raw.slice(0, 1200);
        try {
          const j = JSON.parse(raw);
          const details = j?.error?.details || [];
          status.tests.gemini.quotaFailure = details.find(d => d['@type']?.includes('QuotaFailure')) || null;
          status.tests.gemini.quotaMetric = status.tests.gemini.quotaFailure?.violations?.[0]?.quotaMetric || null;
          status.tests.gemini.quotaId = status.tests.gemini.quotaFailure?.violations?.[0]?.quotaId || null;
          status.tests.gemini.retryAfter = (details.find(d => d['@type']?.includes('RetryInfo'))?.retryDelay) || null;
          status.tests.gemini.help = details.find(d => d['@type']?.includes('Help'))?.links?.[0]?.url || null;
        } catch {}
      }
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
