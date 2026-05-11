/* BetSafe — Adapter pattern para fuentes de cuotas
 * ============================================================================
 * Cada fuente (The Odds API, scrapers individuales, football-data, etc.)
 * implementa la misma interfaz:
 *
 *   class Source {
 *     name: string                            // 'oddsapi', 'scraper:bplay', ...
 *     priority: number                        // 1 = preferida, mayor = fallback
 *     covers(sport, league): boolean          // ¿la fuente cubre este deporte?
 *     async fetch(sports[]): event[]          // trae eventos normalizados
 *     status(): { ok, lastFetch, error, count }
 *   }
 *
 * El orchestrator consulta TODAS las fuentes habilitadas, mergea por evento,
 * y cuando dos fuentes coinciden en mismo evento+casa+mercado, dispara
 * cross-validation para detectar discrepancias.
 *
 * Formato del evento normalizado (idéntico al que ya produce el orchestrator
 * actual):
 *   {
 *     home: { name },
 *     away: { name },
 *     start: ms,
 *     league: 'epl' | 'lpf' | ...,
 *     leagueName: string,
 *     sport: 'soccer' | ...,
 *     markets: {
 *       h2h: { bookKey: { home, draw, away } },
 *       totals: { bookKey: { line: { line, over, under } } },
 *       btts: { bookKey: { yes, no } },
 *       ...
 *     },
 *     _source: 'oddsapi' | 'scraper:bplay' | ...   // INTERNO, no se expone
 *   }
 *
 * NOTA: el campo `_source` se usa SOLO para tracking interno (logs,
 * cross-validation). NUNCA se expone al frontend.
 * ============================================================================
 */
'use strict';

class SourceBase {
  constructor({ name, priority = 5, timeoutMs = 30000 }) {
    this.name = name;
    this.priority = priority;
    this.timeoutMs = timeoutMs;
    this._lastFetch = 0;
    this._lastError = null;
    this._lastCount = 0;
  }

  /** Override en subclases. Devuelve true si la fuente puede traer este deporte/liga. */
  covers(/* sport, league */) { return true; }

  /** Override en subclases. Debe devolver array de eventos normalizados. */
  async fetch(/* sports */) { return []; }

  /** Estado para health endpoint */
  status() {
    return {
      name: this.name,
      priority: this.priority,
      ok: !this._lastError,
      lastFetch: this._lastFetch,
      lastError: this._lastError,
      count: this._lastCount
    };
  }

  /** Wraps fetch con timeout global + timing + error capture.
   *  Si la fuente cuelga más de timeoutMs, se aborta y devuelve [].
   *  Esto evita que un scraper colgado bloquee el ciclo entero. */
  async safeFetch(sports) {
    const t0 = Date.now();
    try {
      const events = await Promise.race([
        this.fetch(sports),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`source-timeout ${this.timeoutMs}ms`)), this.timeoutMs)
        )
      ]);
      const arr = Array.isArray(events) ? events : [];
      arr.forEach(ev => { if (ev && !ev._source) ev._source = this.name; });
      this._lastFetch = Date.now();
      this._lastError = null;
      this._lastCount = arr.length;
      return arr;
    } catch (e) {
      this._lastError = e?.message || String(e);
      this._lastFetch = Date.now();
      this._lastCount = 0;
      return [];
    } finally {
      this._durMs = Date.now() - t0;
    }
  }
}

module.exports = { SourceBase };
