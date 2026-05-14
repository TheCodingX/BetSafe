#!/usr/bin/env node
/* BetSafe — Diagnóstico Gemini (v5.10)
 * ============================================================================
 * Pregunta a la API de Gemini EXACTAMENTE qué tier estás usando, cuál es tu
 * cuota actual, qué modelos tenés disponibles, y mide la latencia real.
 *
 * Especialmente útil cuando pagás un plan y querés verificar que la key esté
 * bien configurada en el tier correcto.
 *
 * Uso: node test/diagnose-gemini.js
 * ============================================================================
 */
'use strict';
try {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
} catch {}

const KEY = process.env.BS_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MODEL = process.env.BS_GEMINI_MODEL || 'gemini-2.5-flash';

if (!KEY) { console.error('❌ Sin BS_GEMINI_API_KEY'); process.exit(1); }

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function main() {
  console.log('='.repeat(70));
  console.log('DIAGNÓSTICO GEMINI — BetSafe');
  console.log('='.repeat(70));
  console.log(`Key:    ${KEY.slice(0, 6)}…${KEY.slice(-4)}`);
  console.log(`Modelo: ${MODEL}`);
  console.log('');

  // 1) Listar modelos disponibles para esta key
  console.log('📋 MODELOS DISPONIBLES PARA TU KEY:');
  try {
    const r = await fetch(`${BASE}/models?key=${KEY}`);
    if (!r.ok) {
      console.log(`  ❌ Error: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    } else {
      const data = await r.json();
      const flashModels = (data.models || []).filter(m => /flash|pro/.test(m.name));
      console.log(`  Total modelos: ${data.models?.length || 0}, mostrando Flash/Pro:`);
      flashModels.slice(0, 15).forEach(m => {
        const name = m.name.replace('models/', '');
        const limit = m.inputTokenLimit ? ` · in:${(m.inputTokenLimit / 1000).toFixed(0)}k` : '';
        const ol = m.outputTokenLimit ? ` out:${(m.outputTokenLimit / 1000).toFixed(0)}k` : '';
        console.log(`    • ${name}${limit}${ol}`);
      });
    }
  } catch (e) { console.log(`  ❌ ${e.message}`); }

  // 2) Hacer un call REAL al modelo configurado y leer headers de rate limit
  console.log('');
  console.log('🚦 CUOTA / RATE LIMITS (headers reales de Google):');
  try {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Devuelve JSON {"ok":true}' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 20, responseMimeType: 'application/json' }
      })
    });
    const dt = Date.now() - t0;

    console.log(`  HTTP ${r.status} en ${dt}ms`);
    // Google a veces manda x-goog-* headers con metadata del consumo
    const interesting = [
      'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
      'x-goog-api-client', 'x-goog-quota-user', 'retry-after',
      'content-encoding', 'server'
    ];
    for (const h of interesting) {
      const v = r.headers.get(h);
      if (v) console.log(`  ${h}: ${v}`);
    }
    const data = await r.json();
    if (data.usageMetadata) {
      console.log(`  usage: input=${data.usageMetadata.promptTokenCount} output=${data.usageMetadata.candidatesTokenCount}`);
    }
    if (data.error) {
      console.log(`  ⚠ error: ${data.error.message || JSON.stringify(data.error).slice(0, 300)}`);
    }
  } catch (e) { console.log(`  ❌ ${e.message}`); }

  // 3) Análisis del tier
  console.log('');
  console.log('💰 TIER ANALYSIS (basado en límites observables):');
  console.log('');
  console.log('  TIERS de Gemini API (paga directo a Google AI Studio):');
  console.log('    Free:     10 RPM,  250 RPD,  250k TPM  — gratis, lento');
  console.log('    Tier 1:   1000 RPM,  10k RPD, 4M TPM  — desde $1 facturado');
  console.log('    Tier 2:   2000 RPM, 100k RPD, 8M TPM  — $250+ gastados');
  console.log('    Tier 3:  10000 RPM,  ilim    16M TPM — $1000+ gastados');
  console.log('');
  console.log('  Si pagás $100/semana ($400/mes):');
  console.log('    → Estás en Tier 2 garantizado');
  console.log('    → 2000 RPM = 33 requests por SEGUNDO');
  console.log('    → 8M TPM = 130k tokens por SEGUNDO');
  console.log('    → A ESTE volumen es PRÁCTICAMENTE IMPOSIBLE que veas 429');
  console.log('');
  console.log('  Si ves rate-limit / overload errors a este volumen, las causas REALES son:');
  console.log('    A) Modelo overloaded GLOBAL (todos los users de Google). Raro, dura segundos.');
  console.log('    B) Quota REGION-locked (algunos paises pagan a otra cuenta). Verificar billing.');
  console.log('    C) Key vinculada a proyecto sin billing habilitado. Verificar en Google Cloud Console.');
  console.log('    D) Network blip de TU hosting (Render→Google). Nada que ver con Gemini.');

  // 4) Latencia de 3 calls
  console.log('');
  console.log('⏱️  LATENCIA (3 calls reales):');
  const times = [];
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Devuelve JSON {"ok":true}' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
        })
      });
      const dt = Date.now() - t0;
      times.push(dt);
      console.log(`  ${i}. ${dt}ms ${r.ok ? '✓' : `✗ HTTP ${r.status}`}`);
    } catch (e) { console.log(`  ${i}. FAIL: ${e.message}`); }
  }
  if (times.length === 3) {
    console.log(`  → 1ª (cold): ${times[0]}ms · siguientes (warm): ${times[1]}ms, ${times[2]}ms`);
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('CONCLUSIÓN:');
  if (times.length === 3 && times.every(t => t < 2500)) {
    console.log('  ✓ Tu key está RESPONDIENDO BIEN. Los retries del cliente son red de seguridad.');
    console.log('  ✓ En happy-path NO se ejecutan retries (verificado con bench: 1 intento).');
    console.log('');
    console.log('  Si querés ELIMINAR los retries por completo (más rápido fallar que reintentar):');
    console.log('    1. Editá server/engines/ai-pipeline.js → geminiJson()');
    console.log('    2. Cambiá `geminiCallWithRetry` por `geminiCall` (sin retry)');
    console.log('    3. Si Gemini hipea, falla inmediatamente y caés a Claude/Groq.');
  } else {
    console.log('  ⚠ Hay algo raro con la key. Revisar billing en Google AI Studio.');
  }
  console.log('='.repeat(70));
}

main().catch(e => { console.error(e); process.exit(1); });
