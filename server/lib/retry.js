/* BetSafe — Retry helper + Circuit breaker
 * ============================================================================
 * Dos utilidades para hacer robustos los scrapers ante:
 *   - Errores transitorios (5xx, timeout, ECONNRESET, ENOTFOUND)
 *   - Anti-bot intermitente (Cloudflare 403/429/503)
 *
 * `withRetry(fn, opts)` — corre `fn` con retries exponenciales + jitter.
 *   - Default: 2 retries, base 400ms, factor 2, jitter 300ms.
 *   - Retry condition: por defecto cualquier throw que no esté en `nonRetriable`.
 *   - El último error se relanza si no logra completar.
 *
 * `CircuitBreaker(opts)` — patrón clásico cerrado / abierto / half-open:
 *   - CLOSED   → todo pasa. Si ocurren N fallas consecutivas → OPEN.
 *   - OPEN     → todo rechaza inmediatamente sin ejecutar. Tras `cooldownMs`
 *                pasa a HALF_OPEN.
 *   - HALF_OPEN → permite UN intento. Si OK → CLOSED. Si falla → OPEN
 *                con cooldown más largo (backoff exponencial).
 *
 * Beneficios:
 *   - Cuando Cloudflare empieza a banear sostenidamente, no martillamos
 *     cada 30s — ahorramos requests + bandwidth.
 *   - La métrica `state` se expone para que `/api/sources` muestre el
 *     estado real de cada scraper.
 * ============================================================================
 */
'use strict';

const NON_RETRIABLE_STATUS = new Set([400, 401, 403, 404, 422]);

function isRetriable(err) {
  // Mensajes y códigos típicos transitorios
  const msg = err?.message || '';
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|aborted/i.test(msg)) return true;
  // HTTP 5xx siempre retriable; 429 también (rate limit suele ser transitorio).
  const m = msg.match(/HTTP (\d{3})/);
  if (m) {
    const code = Number(m[1]);
    if (code >= 500) return true;
    if (code === 429) return true;
    if (NON_RETRIABLE_STATUS.has(code)) return false;
    return false;
  }
  // Default: retriable (red genérica / parseo)
  return true;
}

async function withRetry(fn, opts = {}) {
  const maxAttempts = Number(opts.maxAttempts ?? 3);    // 1 try + 2 retries
  const baseMs = Number(opts.baseMs ?? 400);
  const factor = Number(opts.factor ?? 2);
  const jitterMs = Number(opts.jitterMs ?? 300);
  const shouldRetry = typeof opts.shouldRetry === 'function' ? opts.shouldRetry : isRetriable;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
      const delay = baseMs * Math.pow(factor, attempt - 1) + Math.random() * jitterMs;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/* Circuit breaker con backoff exponencial en cooldown.
 * Uso típico:
 *   const cb = new CircuitBreaker({ name: 'betano', failThreshold: 4, cooldownMs: 60_000 });
 *   try {
 *     return await cb.exec(() => fetchData());
 *   } catch (e) { ... }
 */
class CircuitBreaker {
  constructor(opts = {}) {
    this.name = opts.name || 'breaker';
    this.failThreshold = Number(opts.failThreshold ?? 4);
    this.cooldownMs = Number(opts.cooldownMs ?? 60_000);
    this.maxCooldownMs = Number(opts.maxCooldownMs ?? 15 * 60_000);
    this.state = 'CLOSED';                  // CLOSED | OPEN | HALF_OPEN
    this.consecutiveFails = 0;
    this.lastOpenedAt = 0;
    this.cooldownAttempts = 0;
    this.totals = { ok: 0, fail: 0, rejected: 0 };
    this.lastError = null;          // string mensaje del último error (debug)
    this.lastErrorAt = 0;           // timestamp último error
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFails: this.consecutiveFails,
      lastOpenedAt: this.lastOpenedAt,
      cooldownAttempts: this.cooldownAttempts,
      totals: { ...this.totals },
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt
    };
  }

  _onSuccess() {
    this.totals.ok++;
    this.consecutiveFails = 0;
    this.cooldownAttempts = 0;
    this.state = 'CLOSED';
  }

  _onFailure(err) {
    this.totals.fail++;
    this.consecutiveFails++;
    if (err?.message) {
      this.lastError = String(err.message).slice(0, 300);
      this.lastErrorAt = Date.now();
    }
    if (this.consecutiveFails >= this.failThreshold) {
      this.state = 'OPEN';
      this.lastOpenedAt = Date.now();
      this.cooldownAttempts++;
    }
  }

  /* Si está OPEN y el cooldown pasó, pasa a HALF_OPEN para probar un intento. */
  _maybeReset() {
    if (this.state !== 'OPEN') return;
    const cooldown = Math.min(this.maxCooldownMs, this.cooldownMs * Math.pow(2, this.cooldownAttempts - 1));
    if (Date.now() - this.lastOpenedAt >= cooldown) {
      this.state = 'HALF_OPEN';
    }
  }

  async exec(fn) {
    this._maybeReset();
    if (this.state === 'OPEN') {
      this.totals.rejected++;
      const err = new Error(`circuit-open:${this.name}`);
      err.circuitOpen = true;
      throw err;
    }
    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }
}

/* Convenience: combina withRetry + CircuitBreaker — útil cuando queremos
 * retries para errores transitorios PERO el breaker se abra si los fallos
 * persisten más allá de N retries. */
async function withRetryAndBreaker(breaker, fn, retryOpts = {}) {
  return breaker.exec(() => withRetry(fn, retryOpts));
}

module.exports = { withRetry, CircuitBreaker, withRetryAndBreaker, isRetriable };
