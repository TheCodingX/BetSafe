/* BetSafe — Brier score tracker para calibración de ensemble pesos
 * ============================================================================
 * Una predicción es un par (probabilidad, outcome_binario). El Brier score es
 *   BS = (1/N) Σ (prob_i - outcome_i)²
 * con outcome ∈ {0,1} y prob ∈ [0,1]. **Más bajo = mejor calibrado.**
 *
 * Workflow del tracker:
 *   1. Cuando el orchestrator/AI emite una predicción para un evento, llamamos
 *      `recordPrediction({eventId, market, outcome, sport, predictions:
 *        {fair, poisson, elo, llm, consensus}})`. Se persiste a JSONL en disco.
 *   2. Cuando un evento termina (poll a SofaScore/ESPN scoreboards o input
 *      manual), llamamos `recordOutcome(eventId, market, outcomeLabel)`.
 *      El tracker encuentra la predicción guardada, marca cada modelo con
 *      hit (1) o miss (0) y persiste el resultado.
 *   3. `computeWeights({sport, minSamples, halfLifeDays})` lee el log
 *      histórico, calcula el Brier por modelo por sport, y devuelve los
 *      pesos óptimos (inversamente proporcionales al Brier).
 *      Si no hay suficiente data, devuelve los pesos default.
 *
 * Persistencia: `data/brier.jsonl` (append-only, una linea por evento).
 * Tamaño esperado: ~200 bytes/evento × 100 events/día × 365 = ~7MB/año.
 * Rotamos cuando supera 50MB.
 *
 * Forma de los registros en disco:
 *   { "ts": <ms>, "kind": "prediction", "id": "...", "sport": "soccer",
 *     "market": "h2h", "outcome_pick": "home", "odd": 1.83,
 *     "preds": { "fair": 0.55, "poisson": 0.52, "elo": 0.50, "llm": 0.60, "consensus": 0.55 } }
 *   { "ts": <ms>, "kind": "outcome", "id": "...", "market": "h2h",
 *     "actual_outcome": "home", "won": true }
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'brier.jsonl');
const MAX_LOG_BYTES = 50 * 1024 * 1024;   // 50MB rotation

// Default weights cuando no hay histórico suficiente — coinciden con
// los hardcoded de ai-pipeline.js. Si en algún momento el tracker aprende
// mejores, ai-pipeline pide los actuales y los usa en lugar de estos.
const DEFAULT_WEIGHTS = Object.freeze({
  fair: 1.5, poisson: 1.0, elo: 0.8, llm: 0.7
});

let _ensureDirChecked = false;
function ensureDir() {
  if (_ensureDirChecked) return;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
  _ensureDirChecked = true;
}

/* Rotación simple: si el log supera MAX_LOG_BYTES, lo movemos a
 * brier.jsonl.old y arrancamos uno nuevo. Mantenemos sólo un viejo. */
function maybeRotate() {
  ensureDir();
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > MAX_LOG_BYTES) {
      try { fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch (_) {}
    }
  } catch (_) { /* no existe aún */ }
}

// FIX 2026-05: Cambio appendFileSync → appendFile (async) para no bloquear el
// event loop. Con 100+ events/ciclo en producción, los writes sincrónicos
// agregaban 50-100ms de latencia al broadcast del WebSocket /api/live.
// Usamos una cola en memoria + flush async para garantizar orden y no perder
// líneas si dos calls llegan simultáneamente.
const _writeQueue = [];
let _flushing = false;
function _flushQueue() {
  if (_flushing || _writeQueue.length === 0) return;
  _flushing = true;
  const batch = _writeQueue.splice(0, _writeQueue.length);
  const data = batch.map(o => JSON.stringify(o)).join('\n') + '\n';
  fs.appendFile(LOG_PATH, data, (err) => {
    _flushing = false;
    if (_writeQueue.length > 0) setImmediate(_flushQueue);
    // err silenciado: disco lleno / read-only no debe abortar el pipeline
  });
}
function appendLine(obj) {
  ensureDir();
  _writeQueue.push(obj);
  setImmediate(_flushQueue);
}

/* Registra una predicción (todas las model probs para una selection).
 * Llamado desde ai-pipeline.js cada vez que genera selections.
 * `preds` debe contener (al menos algunas) keys: fair, poisson, elo, llm, consensus.
 */
function recordPrediction(rec) {
  if (!rec || !rec.id || !rec.market || !rec.outcome_pick) return;
  if (!rec.preds || typeof rec.preds !== 'object') return;
  // Sanitizar probs a [0,1]
  const preds = {};
  for (const [k, v] of Object.entries(rec.preds)) {
    if (Number.isFinite(v) && v >= 0 && v <= 1) preds[k] = v;
  }
  if (!Object.keys(preds).length) return;
  maybeRotate();
  appendLine({
    ts: Date.now(),
    kind: 'prediction',
    id: rec.id,
    sport: rec.sport || 'other',
    market: rec.market,
    outcome_pick: rec.outcome_pick,
    odd: rec.odd || null,
    preds
  });
}

/* Registra el outcome real cuando el evento termina.
 * `actual_outcome` es el label canónico (e.g. 'home'/'draw'/'away'/'over'/'under'/etc).
 * El tracker matchea contra el outcome_pick del prediction; si coinciden gana.
 */
function recordOutcome(eventId, market, actual_outcome) {
  if (!eventId || !market || !actual_outcome) return;
  maybeRotate();
  appendLine({
    ts: Date.now(),
    kind: 'outcome',
    id: eventId,
    market,
    actual_outcome
  });
}

/* Lee el log completo y construye un mapa pred_id → outcome.
 * Devuelve array de { sport, market, preds, won } para análisis.
 */
function readSamples({ sport = null, sinceMs = null } = {}) {
  ensureDir();
  if (!fs.existsSync(LOG_PATH)) return [];
  let raw;
  try { raw = fs.readFileSync(LOG_PATH, 'utf8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const predictions = new Map();   // (id+market) → prediction record
  const outcomes = new Map();      // (id+market) → outcome record
  for (const ln of lines) {
    let rec; try { rec = JSON.parse(ln); } catch { continue; }
    if (!rec.kind || !rec.id || !rec.market) continue;
    if (sinceMs && rec.ts < sinceMs) continue;
    const key = rec.id + '|' + rec.market;
    if (rec.kind === 'prediction') predictions.set(key, rec);
    else if (rec.kind === 'outcome') outcomes.set(key, rec);
  }
  const samples = [];
  for (const [key, pred] of predictions) {
    const outcome = outcomes.get(key);
    if (!outcome) continue;            // sin outcome todavía
    if (sport && pred.sport !== sport) continue;
    const won = pred.outcome_pick === outcome.actual_outcome ? 1 : 0;
    samples.push({
      sport: pred.sport, market: pred.market, preds: pred.preds, won, odd: pred.odd
    });
  }
  return samples;
}

/* Calcula Brier por modelo a partir de las samples.
 * Pondera por recencia con half-life si halfLifeDays > 0. */
function brierByModel(samples, { halfLifeDays = 0 } = {}) {
  const sumSq = new Map();     // model → Σ w*(p-y)²
  const sumW = new Map();      // model → Σ w
  const now = Date.now();
  const halfLifeMs = halfLifeDays > 0 ? halfLifeDays * 86400_000 : 0;
  for (const s of samples) {
    // Sin half-life, w=1. Con half-life, w = 0.5^(ageDays/halfLifeDays).
    let w = 1;
    if (halfLifeMs > 0 && s.ts) {
      const age = now - s.ts;
      w = Math.pow(0.5, age / halfLifeMs);
    }
    for (const [model, p] of Object.entries(s.preds || {})) {
      const sq = (p - s.won) * (p - s.won);
      sumSq.set(model, (sumSq.get(model) || 0) + w * sq);
      sumW.set(model, (sumW.get(model) || 0) + w);
    }
  }
  const out = {};
  for (const [model, ss] of sumSq) {
    const w = sumW.get(model) || 1;
    out[model] = { brier: ss / w, n: Math.round(w) };
  }
  return out;
}

/* Calcula pesos óptimos: inverso del Brier, normalizado para que el
 * peso máximo sea el del default (preserva comparabilidad).
 * Modelos sin samples suficientes (minSamples) usan default weight. */
function computeWeights({ sport = null, minSamples = 50, halfLifeDays = 30 } = {}) {
  const samples = readSamples({ sport });
  if (samples.length < minSamples) {
    return { weights: { ...DEFAULT_WEIGHTS }, source: 'default', samples: samples.length };
  }
  const brier = brierByModel(samples, { halfLifeDays });
  // Peso ∝ 1/brier (modelo más calibrado pesa más).
  // Renormalizamos para que el rango se parezca a los defaults (no inflar
  // demasiado un modelo "perfecto" que sólo tiene 5 samples).
  const weights = {};
  for (const model of Object.keys(DEFAULT_WEIGHTS)) {
    const b = brier[model];
    if (!b || b.n < minSamples) {
      weights[model] = DEFAULT_WEIGHTS[model];
      continue;
    }
    // brier máximo razonable = 0.25 (random). Si brier > 0.25 (peor que random)
    // damos peso bajo. Si brier=0 (perfecto) clampeamos para evitar inf.
    const safe = Math.max(0.01, Math.min(0.5, b.brier));
    weights[model] = Math.max(0.1, Math.min(2.0, (DEFAULT_WEIGHTS[model] * 0.20) / safe));
  }
  return { weights, source: 'history', samples: samples.length, brier };
}

/* Snapshot público para /api/brier */
function snapshot() {
  ensureDir();
  let size = 0;
  try { size = fs.statSync(LOG_PATH).size; } catch (_) {}
  const samples = readSamples({});
  const brier = brierByModel(samples);
  return {
    logBytes: size,
    samples: samples.length,
    brierByModel: brier,
    weights: computeWeights({}).weights
  };
}

module.exports = {
  recordPrediction,
  recordOutcome,
  readSamples,
  brierByModel,
  computeWeights,
  snapshot,
  DEFAULT_WEIGHTS
};
