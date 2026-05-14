/* BetSafe — Cliente Gemini optimizado (v5.10)
 * ============================================================================
 * Reemplaza las llamadas raw a fetch() con:
 *   - HTTP/1.1 keep-alive (undici.Agent) → reusa TCP+TLS, -200ms por request
 *   - Retry inteligente por tipo de error (429, 503, 500, 4xx)
 *   - Respeta `Retry-After` header de Google en 429
 *   - Timeout adaptativo según tipo de tarea (parser=15s, análisis=45s)
 *   - thinkingBudget: 0 para tareas estructuradas (Flash piensa "fast")
 *   - maxOutputTokens calibrado: parsers 700, análisis 4000 (era 6000 — exceso)
 *
 * Por qué Gemini fallaba/era lento ANTES:
 *   - Sin keep-alive: cada call sumaba ~250ms de TCP handshake + TLS
 *   - Timeout 30s y sin retry específico: 1 cold-start de Gemini → abort → fail
 *   - No respetaba Retry-After de 429: tirábamos retries cada 600ms cuando
 *     Google pedía esperar 10s → ban temporal de la key
 *   - maxOutputTokens 6000 con Flash 2.5: en horas pico se queda generando
 *     output que no usamos, sumando 5-10s extras por llamada
 *
 * Costo en producción (Gemini 2.5 Flash paid):
 *   - $0.075 / 1M input tokens, $0.30 / 1M output tokens
 *   - Un análisis típico: ~3000 in + 1500 out = $0.000675 = USD 0.0007
 *   - 1000 análisis/día = USD 0.70/día = USD 21/mes (irrisorio para el negocio)
 *
 * Tier limits Gemini 2.5 Flash:
 *   - Free: 10 RPM, 250 RPD, 250k TPM
 *   - Paid Tier 1 ($): 1000 RPM, 4M TPM (suficiente para BetSafe)
 *   - Paid Tier 2 ($$): 10000 RPM, 8M TPM
 * ============================================================================
 */
'use strict';

const { Agent, fetch: undiciFetch } = require('undici');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* Agent compartido para TODAS las llamadas Gemini: reutiliza conexiones TCP+TLS.
 *   - keepAliveTimeout: cuánto tiempo mantener una conexión idle (60s)
 *   - keepAliveMaxTimeout: cap absoluto (10min)
 *   - connections: pool size — 32 simultáneas cubre nuestro PICKS_CONCURRENCY
 *   - pipelining: 1 (request-per-connection, más predecible que pipelining 10)
 *   - bodyTimeout: timeout entre chunks del body (30s), distinto al timeout total
 *   - headersTimeout: timeout para recibir headers (10s)
 * Ganancia: ~150-300ms por request después del primero.
 */
const geminiAgent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 32,
  pipelining: 1,
  bodyTimeout: 30_000,
  headersTimeout: 10_000
});

class GeminiError extends Error {
  constructor(message, code, retryAfter, raw) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.retryAfter = retryAfter || null;
    this.raw = raw || null;
  }
}

/**
 * Una llamada a Gemini. Sin retry — el retry está en geminiCallWithRetry().
 * Esta separación permite usar la primitiva en tests / health checks sin retry.
 *
 * @param {object} opts
 * @param {string} opts.model — gemini-2.5-flash | gemini-2.0-flash-001 | gemini-2.5-pro
 * @param {string} opts.key — API key
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {number} [opts.maxOutputTokens=4000]
 * @param {number} [opts.temperature=0.3]
 * @param {number} [opts.thinkingBudget] — 0 desactiva thinking (más rápido, peor calidad). Solo Flash 2.5.
 * @param {number} [opts.timeoutMs=45000] — timeout total
 * @param {object} [opts.responseSchema] — JSON schema para forzar shape exacto (acelera)
 * @returns {Promise<{ raw: object, durMs: number, tokens: object }>}
 */
async function geminiCall(opts) {
  const {
    model, key, systemPrompt, userPrompt,
    maxOutputTokens = 4000,
    temperature = 0.3,
    thinkingBudget,
    timeoutMs = 45000,
    responseSchema
  } = opts;

  if (!key) throw new GeminiError('GEMINI_KEY no configurada', 'no-key');
  if (!model) throw new GeminiError('model no especificado', 'no-model');

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: systemPrompt + '\n\n' + userPrompt + '\n\nRespondé en JSON válido, COMPLETO (todas las llaves cerradas), sin markdown ni ```.' }]
    }],
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json'
    }
  };
  if (thinkingBudget !== undefined) {
    body.generationConfig.thinkingConfig = { thinkingBudget };
  }
  if (responseSchema) {
    body.generationConfig.responseSchema = responseSchema;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await undiciFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      dispatcher: geminiAgent,
      signal: ctrl.signal
    });

    const durMs = Date.now() - t0;

    // 429 rate-limit: Google manda Retry-After con segundos a esperar
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 10;
      const txt = await res.text().catch(() => '');
      throw new GeminiError(`Rate limit (Retry-After: ${retryAfter}s)`, 'rate-limit', retryAfter, txt.slice(0, 200));
    }

    // 503 model overloaded / 502 bad gateway — transitorio, vale retry agresivo
    if (res.status === 503 || res.status === 502) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2;
      const txt = await res.text().catch(() => '');
      throw new GeminiError(`Model ${res.status === 503 ? 'overloaded' : 'unavailable'}`, 'overloaded', retryAfter, txt.slice(0, 200));
    }

    // 500: server error transitorio
    if (res.status === 500 || res.status === 504) {
      const txt = await res.text().catch(() => '');
      throw new GeminiError(`Server error ${res.status}`, 'server-error', null, txt.slice(0, 200));
    }

    // 4xx: error del prompt/config (NO retry — es un bug nuestro)
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      const txt = await res.text().catch(() => '');
      throw new GeminiError(`Request error ${res.status}: ${txt.slice(0, 200)}`, 'request-error');
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new GeminiError(`HTTP ${res.status}: ${txt.slice(0, 200)}`, 'http-error');
    }

    const data = await res.json();
    // Tokens usage (si Gemini lo devuelve)
    const tokens = data.usageMetadata ? {
      input: data.usageMetadata.promptTokenCount || 0,
      output: data.usageMetadata.candidatesTokenCount || 0,
      total: data.usageMetadata.totalTokenCount || 0
    } : null;
    return { raw: data, durMs, tokens };
  } catch (e) {
    if (e.name === 'AbortError' || /abort/i.test(e.message)) {
      throw new GeminiError(`timeout ${timeoutMs}ms`, 'timeout');
    }
    if (e instanceof GeminiError) throw e;
    throw new GeminiError(`network error: ${e.message?.slice(0, 200)}`, 'network', null, e);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Llamada a Gemini con retry inteligente por tipo de error.
 *
 * Política de retry:
 *   - 429 (rate-limit) → respeta Retry-After del header de Google (cap 12s)
 *   - 503 (overloaded) → backoff exponencial: 1s, 3s, 9s, 15s
 *   - 500 (server-error) → retry rápido: 500ms, 1.5s, 4.5s
 *   - timeout → retry con timeout más generoso siguiente vez (45s → 60s → 75s)
 *   - 4xx (request-error) → SIN RETRY (es bug nuestro, no se va a fixear)
 *   - network → retry rápido: 300ms, 900ms
 *
 * Máximo 4 intentos. Total worst-case ~30s antes de tirar el error.
 */
async function geminiCallWithRetry(opts) {
  const maxAttempts = opts.maxAttempts || 4;
  const errors = [];
  let lastTimeoutMs = opts.timeoutMs || 45000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await geminiCall({ ...opts, timeoutMs: lastTimeoutMs });
      result.attempts = attempt;
      return result;
    } catch (e) {
      errors.push({ attempt, code: e.code, msg: e.message?.slice(0, 120) });

      // 4xx: NO RETRY — es bug nuestro
      if (e.code === 'request-error' || e.code === 'no-key' || e.code === 'no-model') {
        throw e;
      }

      // Último intento — tirar el error sin esperar
      if (attempt === maxAttempts) break;

      let wait = 1000;
      if (e.code === 'rate-limit') {
        wait = Math.min((e.retryAfter || 5) * 1000, 12000);
      } else if (e.code === 'overloaded') {
        wait = Math.min(1000 * Math.pow(3, attempt - 1), 15000);
      } else if (e.code === 'timeout') {
        wait = 500;
        lastTimeoutMs = Math.min(lastTimeoutMs * 1.5, 90000);   // dale más tiempo siguiente vez
      } else if (e.code === 'server-error' || e.code === 'http-error') {
        wait = 500 * Math.pow(3, attempt - 1);
      } else if (e.code === 'network') {
        wait = 300 * Math.pow(3, attempt - 1);
      }

      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new GeminiError(
    `Gemini falló ${maxAttempts} intentos: ${errors.map(e => `${e.code}:${e.msg?.slice(0,40)}`).join(' | ')}`,
    'exhausted'
  );
}

module.exports = { geminiCall, geminiCallWithRetry, geminiAgent, GeminiError };
