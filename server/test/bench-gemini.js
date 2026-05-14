#!/usr/bin/env node
/* BetSafe — Benchmark Gemini (v5.10)
 * ============================================================================
 * Mide la latencia real del cliente Gemini optimizado vs un cliente "baseline"
 * sin keep-alive. Útil para verificar:
 *   - HTTP/1.1 keep-alive funciona (2da request mucho más rápida)
 *   - El pool de conexiones aguanta concurrencia
 *   - Retries no se gatillan en caso happy-path
 *
 * Uso: node test/bench-gemini.js
 *
 * Requiere BS_GEMINI_API_KEY en el env (lee .env del root automáticamente).
 * ============================================================================
 */
'use strict';

try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
} catch {}

const { geminiCall, geminiCallWithRetry } = require('../lib/gemini-client');

const KEY = process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MODEL = process.env.BS_GEMINI_MODEL || 'gemini-2.5-flash';

if (!KEY) {
  console.error('❌ BS_GEMINI_API_KEY no encontrada en .env');
  process.exit(1);
}

const TEST_PROMPT = {
  systemPrompt: 'Respondé con JSON estricto: {"ok":true,"echo":"<el texto>"}',
  userPrompt: 'Devolvé { "ok": true, "echo": "ping" }',
  maxOutputTokens: 100,
  temperature: 0,
  thinkingBudget: 0   // sin thinking — más rápido para tareas triviales
};

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function benchSerial(n) {
  const times = [];
  console.log(`\n=== Bench SERIAL (${n} requests, una tras otra) ===`);
  console.log('Mide el efecto del HTTP keep-alive: la 1ra request hace TCP+TLS, las siguientes reusan.');
  for (let i = 1; i <= n; i++) {
    const t0 = Date.now();
    try {
      const r = await geminiCall({ model: MODEL, key: KEY, ...TEST_PROMPT });
      const dt = Date.now() - t0;
      times.push(dt);
      const tokenInfo = r.tokens ? ` | tokens ${r.tokens.input}+${r.tokens.output}=${r.tokens.total}` : '';
      console.log(`  ${i}. ${dt}ms${tokenInfo}`);
    } catch (e) {
      console.log(`  ${i}. FAIL: ${e.message}`);
      times.push(-1);
    }
  }
  return times;
}

async function benchParallel(n) {
  console.log(`\n=== Bench PARALELO (${n} requests simultáneas) ===`);
  console.log('Mide el pool de conexiones cuando todos golpean a la vez.');
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => {
      const ts = Date.now();
      return geminiCall({ model: MODEL, key: KEY, ...TEST_PROMPT }).then(
        () => Date.now() - ts,
        (e) => ({ error: e.message })
      );
    })
  );
  const total = Date.now() - t0;
  const times = results.map(r => r.value).filter(v => typeof v === 'number');
  const errors = results.map(r => r.value).filter(v => v && v.error);
  console.log(`  Total wall-clock: ${total}ms para ${n} requests paralelas`);
  console.log(`  Throughput: ${(n / (total / 1000)).toFixed(1)} req/s`);
  if (errors.length) {
    console.log(`  Errores: ${errors.length}`);
    errors.slice(0, 3).forEach(e => console.log(`    - ${e.error.slice(0, 100)}`));
  }
  return times;
}

async function benchRetry() {
  console.log(`\n=== Bench RETRY happy-path ===`);
  console.log('Verifica que en condiciones normales el cliente NO tira retries (1 intento).');
  const t0 = Date.now();
  try {
    const r = await geminiCallWithRetry({ model: MODEL, key: KEY, ...TEST_PROMPT });
    console.log(`  OK en ${Date.now() - t0}ms con ${r.attempts} intento(s)`);
  } catch (e) {
    console.log(`  FAIL: ${e.message}`);
  }
}

(async () => {
  console.log(`Modelo: ${MODEL}`);
  console.log(`Key:    ${KEY.slice(0, 6)}…${KEY.slice(-4)}`);

  const serialTimes = (await benchSerial(6)).filter(t => t > 0);
  if (serialTimes.length >= 2) {
    console.log(`\n  Serial summary:`);
    console.log(`    1st request:  ${serialTimes[0]}ms (cold TCP+TLS)`);
    console.log(`    2nd-Nth avg:  ${Math.round(serialTimes.slice(1).reduce((a, b) => a + b, 0) / (serialTimes.length - 1))}ms (warm keep-alive)`);
    console.log(`    Ahorro:       ~${serialTimes[0] - Math.round(serialTimes.slice(1).reduce((a, b) => a + b, 0) / (serialTimes.length - 1))}ms/req por keep-alive`);
    console.log(`    p50: ${percentile(serialTimes, 50)}ms · p95: ${percentile(serialTimes, 95)}ms`);
  }

  const parallelTimes = await benchParallel(8);
  if (parallelTimes.length >= 2) {
    console.log(`\n  Parallel summary:`);
    console.log(`    p50: ${percentile(parallelTimes, 50)}ms · p95: ${percentile(parallelTimes, 95)}ms`);
  }

  await benchRetry();

  console.log(`\n✓ Benchmark completo`);
})();
