/* BetSafe — Cross-validation engine
 * ============================================================================
 * Cuando dos fuentes (ej. The Odds API + scraper de Betano) traen cuotas para
 * EL MISMO evento + MISMA casa + MISMO mercado, comparamos los valores.
 *
 * Niveles de discrepancia:
 *   - <2%   → OK, lag normal de scraping (15-30s)
 *   - 2-5%  → warning, una fuente está stale o hay error de parse
 *   - >5%   → critical, una de las fuentes está rota (selector roto,
 *             casa cambió la cuota, o el adapter mal mapea)
 *
 * Salida: array de {
 *   eventId, eventName, bookKey, market, outcome,
 *   sourceA: { name, value }, sourceB: { name, value },
 *   deltaPct, level
 * }
 *
 * Esto se EXPONE en /api/discrepancies para que el admin pueda monitorear
 * la salud del sistema. NO se muestra al usuario final.
 * ============================================================================
 */
'use strict';

const WARN_THRESHOLD = 0.02;     // 2%
const CRITICAL_THRESHOLD = 0.05; // 5%

/** Compara los markets de un evento entre todas las fuentes que lo aportaron.
 *  El evento ya está mergeado (markets es un map global por casa).
 *  Para detectar discrepancia, el orchestrator debe guardar el contributor
 *  de cada (book, market) — eso se hace en el orchestrator y se pasa acá.
 *
 *  @param {Object} mergedEvent  evento mergeado por orchestrator
 *  @param {Map} contributorMap  Map<`${book}|${market}|${outcome}`, [{ source, value }]>
 *  @returns {Array<discrepancy>}
 */
function findDiscrepancies(mergedEvent, contributorMap) {
  const out = [];
  if (!contributorMap || !mergedEvent) return out;

  for (const [key, contributors] of contributorMap.entries()) {
    if (!contributors || contributors.length < 2) continue;
    const [book, market, outcome, line] = key.split('|');
    // Solo comparar entradas con valores válidos
    const valid = contributors.filter(c => typeof c.value === 'number' && c.value > 1);
    if (valid.length < 2) continue;

    // Comparar todos los pares
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i], b = valid[j];
        const baseline = Math.min(a.value, b.value);
        const deltaPct = Math.abs(a.value - b.value) / baseline;
        let level = null;
        if (deltaPct >= CRITICAL_THRESHOLD) level = 'critical';
        else if (deltaPct >= WARN_THRESHOLD) level = 'warning';
        if (!level) continue;
        out.push({
          eventId: mergedEvent.id,
          eventName: `${mergedEvent.home?.name} vs ${mergedEvent.away?.name}`,
          league: mergedEvent.league,
          bookKey: book,
          market,
          outcome,
          line: line || null,
          sourceA: { name: a.source, value: a.value },
          sourceB: { name: b.source, value: b.value },
          deltaPct: Number((deltaPct * 100).toFixed(2)),
          level,
          ts: Date.now()
        });
      }
    }
  }
  return out;
}

/** Buffer rotativo de últimas N discrepancias para exponer via API. */
class DiscrepancyLog {
  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.items = [];
    this.stats = { critical: 0, warning: 0, total: 0 };
  }
  add(items) {
    if (!items || !items.length) return;
    items.forEach(d => {
      this.stats.total++;
      this.stats[d.level]++;
    });
    this.items = items.concat(this.items).slice(0, this.maxSize);
  }
  snapshot(opts = {}) {
    const { level, limit = 100 } = opts;
    let list = this.items;
    if (level) list = list.filter(d => d.level === level);
    return {
      stats: this.stats,
      count: list.length,
      items: list.slice(0, limit)
    };
  }
  clear() { this.items = []; this.stats = { critical: 0, warning: 0, total: 0 }; }
}

/** Construye el contributorMap para un evento durante el merge.
 *  El orchestrator llama a esta función cada vez que mergea un evento de
 *  una source distinta, acumulando los valores por (book, market, outcome). */
function recordContributor(map, source, market, bookKey, outcome, value, line) {
  if (!value || typeof value !== 'number') return;
  const k = `${bookKey}|${market}|${outcome}|${line || ''}`;
  if (!map.has(k)) map.set(k, []);
  map.get(k).push({ source, value });
}

module.exports = {
  findDiscrepancies,
  DiscrepancyLog,
  recordContributor,
  WARN_THRESHOLD,
  CRITICAL_THRESHOLD
};
