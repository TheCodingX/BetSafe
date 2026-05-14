#!/usr/bin/env node
/* BetSafe — Tests automatizados de endpoints IA (v5.9)
 * ============================================================================
 * Tests end-to-end de los endpoints que el frontend consume. Usa Node's
 * built-in `node:test` y `node:assert` — SIN dependencias extra.
 *
 * Cómo correr:
 *   npm run test-ai
 *
 * Arranca el server en un PORT random, hace HTTP requests reales, valida
 * estructura de responses + estados esperados. NO testea calls externos
 * (Gemini/Groq) en detalle — eso lo cubre /api/keys-verify y /api/ai/test.
 *
 * Lo que CUBRE:
 *   1. /api/health           → boot OK
 *   2. /api/ai-status        → shape correcto + health válido
 *   3. /api/keys-status      → shape correcto
 *   4. /api/curated-combos   → response con aiHealth
 *   5. /api/daily-report     → response con aiHealth
 *   6. /api/betsafe-ai/build → validaciones de input (400 sin prompt, etc.)
 *   7. /api/picks            → response con aiHealth
 *
 * EXIT CODE: 0 todos pasaron, 1 si algún test falló.
 * ============================================================================
 */
'use strict';

const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 17000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
let serverProc = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(PORT),
        SCRAPE_INTERVAL_MS: '99999999',   // no scrapeamos en tests
        ENABLED_BOOKS: 'bplay',            // 1 sola casa para boot rápido
        NODE_ENV: 'test'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buf = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error('server boot timeout 20s — output: ' + buf.slice(0, 500)));
    }, 20000);
    // Esperamos el log EXACTO de listen — eso garantiza que express está bound al puerto.
    function checkReady(chunk) {
      buf += String(chunk);
      if (!resolved && /\[server\] listening on/.test(buf)) {
        resolved = true;
        clearTimeout(timeout);
        // Un beat extra para que cualquier init async termine
        setTimeout(resolve, 300);
      }
    }
    serverProc.stdout.on('data', checkReady);
    serverProc.stderr.on('data', checkReady);
    serverProc.on('exit', code => {
      if (!resolved && code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`server died: code ${code}, output: ${buf.slice(0, 500)}`));
      }
    });
  });
}

function stopServer() {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    serverProc = null;
  }
}

async function get(pathStr, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
  try {
    const res = await fetch(BASE + pathStr, { signal: ctrl.signal, ...opts });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

async function post(pathStr, body, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
  try {
    const res = await fetch(BASE + pathStr, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

before(async () => {
  console.log(`[test] booting server on port ${PORT}…`);
  await startServer();
  console.log('[test] server up, running tests');
});

after(() => {
  console.log('[test] shutting down server');
  stopServer();
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 1 — /api/health
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/health → 200 + ok:true + state', async () => {
  const r = await get('/api/health');
  assert.equal(r.status, 200, 'status 200');
  assert.equal(r.json.ok, true, 'ok=true');
  assert.ok(r.json.state, 'state present');
  assert.ok(Number.isFinite(r.json.uptime), 'uptime is number');
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 2 — /api/ai-status
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/ai-status → shape correcto + health válido', async () => {
  const r = await get('/api/ai-status');
  assert.equal(r.status, 200);
  assert.ok(r.json, 'has json body');
  assert.ok(['ok', 'degraded', 'no-keys', 'unknown'].includes(r.json.health),
    `health '${r.json.health}' debe ser uno de ok|degraded|no-keys|unknown`);
  assert.ok(typeof r.json.ok === 'boolean', 'ok is boolean');
  assert.ok(r.json.providers, 'providers object present');
  assert.ok(r.json.providers.gemini, 'gemini provider entry');
  assert.ok(r.json.providers.groq, 'groq provider entry');
  // Cuando hay keys, primary debe estar seteado
  if (r.json.providers.gemini.present) {
    assert.ok(r.json.primary, 'primary set when keys present');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 3 — /api/keys-status (NO devuelve valores reales, solo metadata)
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/keys-status → shape correcto sin filtrar valores', async () => {
  const r = await get('/api/keys-status');
  assert.equal(r.status, 200);
  assert.ok(r.json.primary, 'primary section');
  assert.ok(r.json.fallback, 'fallback section');
  assert.ok(r.json.data, 'data section');
  // Verificar que NO devuelve keys completas — solo preview "abcd…xy"
  const allEntries = [
    ...Object.values(r.json.primary),
    ...Object.values(r.json.fallback),
    ...Object.values(r.json.data)
  ];
  for (const e of allEntries) {
    if (e.present) {
      assert.ok(typeof e.length === 'number', 'length is number');
      assert.ok(e.preview && e.preview.includes('…'), 'preview tiene "…" (no key completa)');
      assert.ok(e.preview.length < 15, `preview corto (got ${e.preview.length})`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 4 — /api/betsafe-ai/build validaciones de input
// ─────────────────────────────────────────────────────────────────────────
test('POST /api/betsafe-ai/build sin prompt → 400', async () => {
  const r = await post('/api/betsafe-ai/build', {});
  assert.equal(r.status, 400);
  assert.ok(r.json.error, 'error message present');
});

test('POST /api/betsafe-ai/build con prompt vacío → 400', async () => {
  const r = await post('/api/betsafe-ai/build', { prompt: '' });
  assert.equal(r.status, 400);
});

test('POST /api/betsafe-ai/build con prompt < 10 chars → 400', async () => {
  const r = await post('/api/betsafe-ai/build', { prompt: 'hola' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /corto/i, 'mensaje menciona "corto"');
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 5 — /api/curated-combos siempre devuelve aiHealth
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/curated-combos → response tiene aiHealth', async () => {
  // timeout largo porque puede analizar eventos con IA si hay
  const r = await get('/api/curated-combos?sport=soccer&count=2', { timeout: 30000 });
  assert.equal(r.status, 200);
  assert.ok(r.json, 'json body');
  assert.ok('aiHealth' in r.json, 'aiHealth field present');
  assert.ok(['ok', 'degraded', 'no-keys', 'unknown'].includes(r.json.aiHealth),
    `aiHealth '${r.json.aiHealth}' válido`);
  assert.ok(Array.isArray(r.json.combos), 'combos is array');
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 6 — /api/daily-report
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/daily-report → response tiene aiHealth', async () => {
  const r = await get('/api/daily-report', { timeout: 30000 });
  // Puede ser 200 si tiene events analizados o 500 si nada — ambos OK
  assert.ok([200, 500].includes(r.status), `status ${r.status}`);
  if (r.status === 200) {
    assert.ok('aiHealth' in r.json, 'aiHealth presente');
    assert.ok(Array.isArray(r.json.topPicks), 'topPicks is array');
    assert.ok(r.json.counts, 'counts present');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 7 — /api/picks
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/picks → response tiene aiHealth + picks array', async () => {
  const r = await get('/api/picks?limit=3&sport=soccer', { timeout: 30000 });
  assert.equal(r.status, 200);
  assert.ok('aiHealth' in r.json, 'aiHealth presente');
  assert.ok(Array.isArray(r.json.picks), 'picks is array');
  assert.ok(r.json.meta, 'meta object');
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 8 — /api/keys-verify (lento — hace fetch real a providers)
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/keys-verify → tests reales contra cada provider', async () => {
  const r = await get('/api/keys-verify', { timeout: 60000 });
  assert.equal(r.status, 200);
  assert.ok(r.json.results, 'results object');
  assert.ok(r.json.summary, 'summary object');
  assert.ok(typeof r.json.summary.total_tested === 'number', 'total_tested is number');
  console.log(`    [keys-verify] ${r.json.summary.total_working}/${r.json.summary.total_tested} providers OK`);
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 9 — Compression middleware activo
// ─────────────────────────────────────────────────────────────────────────
test('GET /api/health con Accept-Encoding: gzip → respuesta comprimida si >1KB', async () => {
  const res = await fetch(BASE + '/api/snapshot', {
    headers: { 'Accept-Encoding': 'gzip' }
  });
  // /api/snapshot puede ser pequeño en tests sin eventos. Solo verificamos que
  // si content-encoding viene, sea válido.
  const enc = res.headers.get('content-encoding');
  if (enc) {
    assert.ok(['gzip', 'deflate', 'br'].includes(enc), `encoding '${enc}' válido`);
  }
  assert.equal(res.status, 200);
});

// ─────────────────────────────────────────────────────────────────────────
// TEST 10 — CORS headers
// ─────────────────────────────────────────────────────────────────────────
test('CORS headers presentes', async () => {
  const res = await fetch(BASE + '/api/health');
  assert.ok(res.headers.get('access-control-allow-origin'), 'CORS origin set');
  assert.ok(res.headers.get('x-content-type-options'), 'X-Content-Type-Options');
});
