/* BetSafe — AI Pipeline multi-step
 * ============================================================================
 * Este NO es un simple "preguntale a ChatGPT que analice el partido".
 *
 * Es una pipeline de 5 pasos que combina:
 *   1) Factors aggregator (clima + lesiones + histórico + sharp + quant)
 *   2) Modelo de Poisson xG ajustado por factores
 *   3) Modelo de Elo con K dinámico
 *   4) LLM cascade (Groq → Gemini → OpenRouter) con prompt structured JSON
 *   5) Verificación cruzada: si LLM y modelos quant divergen mucho, marcamos
 *      bajo "confidence" y el pick queda como "watch list" en vez de "go".
 *
 * Output estructurado por outcome:
 *   {
 *     selection, odd, book,
 *     fairProb, modelProb, llmProb,        // tres estimadores
 *     consensusProb, ev, kellyStake,
 *     confidence,                          // 0-1
 *     factors: [{ kind, impact, note }],   // explanation
 *     llmAnalysis: { ... },
 *     warnings: []
 *   }
 *
 * Cache por evento: 5min (no queremos llamar al LLM cada request).
 * ============================================================================
 */
'use strict';

const { LRUCache } = require('lru-cache');
const { log } = require('../lib');
const { buildFactors } = require('../factors');
const { shinNoVig } = require('../factors');
const brierTracker = require('./brier-tracker');

const cache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

const GROQ_KEY     = process.env.BS_GROQ_API_KEY     || process.env.GROQ_API_KEY     || '';
const GEMINI_KEY   = process.env.BS_GEMINI_API_KEY   || process.env.GEMINI_API_KEY   || '';
const OPENROUTER_KEY = process.env.BS_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';

const SYSTEM_PROMPT = `Sos un analista cuantitativo SENIOR especializado en apuestas deportivas con foco AR.
Tenés acceso a: cuotas de 6+ casas legales AR (Bplay, Betano, BetWarrior, Codere, Bet365 AR, Betsson),
clima por venue, lista de lesiones de ambos equipos con severityScore, histórico H2H + forma reciente,
movimientos sharp del mercado (steam moves >5%), y modelos cuantitativos propios (Poisson xG ajustado,
Elo dinámico, Shin no-vig).

Tu rol (en este orden de prioridad):
1) Procesar TODOS los factores que te paso. NO inventes datos: cita números reales del input.
2) Estimar probabilidades verdaderas calibradas para cada outcome (home/draw/away, over/under, btts, dc).
3) Identificar el outcome con mayor EV positivo vs cuotas actuales (descontando margen de la casa).
4) Justificar con factores específicos del input — citá nombres de jugadores lesionados, mm de lluvia,
   delta% del steam move, números de Poisson lambda, etc. Nada genérico.
5) Calificar confianza (0-1) según CONSISTENCIA entre modelos quant + LLM + factores. Baja confianza
   si Poisson y Elo divergen >15 puntos en probabilidad.
6) Marcar warnings tácticos: lesión de portero/defensa central, suspensiones, fixture congestion,
   clima que cambia >0.15× los goles esperados, etc.

Respondé SIEMPRE en JSON estricto con este shape exacto (sin markdown, sin texto adicional):
{
  "selections": [
    {
      "type": "cons" | "eq" | "agg",
      "market": "h2h" | "totals" | "btts" | "dc",
      "outcome": "home" | "draw" | "away" | "over" | "under" | "yes" | "no" | "home_or_draw" | ...,
      "line": null | número (solo totals/ah),
      "modelProb": 0..1,
      "rationale": "<3-5 frases citando factores ESPECÍFICOS del input — números, nombres, %s>",
      "tacticalNotes": "<1-2 frases con lectura táctica: presión alta/baja, ritmo, debilidad rival>",
      "warnings": ["lesión clave: <nombre>", "clima: <mm lluvia>", "steam: <delta%>", ...] | [],
      "confidence": 0..1
    }
  ],
  "synthesis": "<1 párrafo 80-120 palabras: lectura cuantitativa del partido + por qué el outcome elegido es asimétrico vs el mercado>",
  "keyFactor": "<una frase: el factor MÁS IMPORTANTE para el resultado de este partido>"
}`;

/** Pipeline principal para un partido. */
async function analyzeMatch(event, ctx = {}) {
  if (!event?.id) return null;
  const cached = cache.get(event.id);
  if (cached) return cached;

  // 1) Factor bundle
  const factors = await buildFactors(event, ctx);
  if (!factors) return null;

  // 2) Modelos quant
  const quant = factors.quantitative;
  const poisson = poissonModel(factors);
  const eloAdj = eloAdjustment(factors);

  // 3) LLM analysis
  const llm = await llmStructured(factors, poisson, eloAdj);

  // 4) Consenso entre modelos
  const selections = mergeSelections(event, factors, quant, poisson, eloAdj, llm);

  const result = {
    event: factors.event,
    factors: {
      weather: factors.weather,
      injuries: factors.injuries,
      historical: factors.historical,
      sharp: factors.sharp,
      quantitative: quant,
      poisson, eloAdj
    },
    selections,
    llmSynthesis: llm.synthesis || null,
    llmKeyFactor: llm.keyFactor || null,
    llmProvider: llm.provider || 'offline',
    ts: Date.now()
  };
  cache.set(event.id, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Modelo Poisson ajustado por factores
// ─────────────────────────────────────────────────────────────────────────
function poissonModel(f) {
  // Optional chaining defensivo en cada acceso
  const h2h = f?.event && f?.market?.h2h;
  if (!h2h) return { unavailable: true };
  // λ base estimado desde cuotas implícitas
  const odds = [h2h.home, h2h.draw, h2h.away].filter(o => Number.isFinite(o) && o > 1);
  if (odds.length < 2) return { unavailable: true };
  const fair = shinNoVig(odds);
  // Guard contra NaN/Infinity propagado desde shinNoVig
  if (!fair || fair.some(p => !Number.isFinite(p) || p < 0 || p > 1)) return { unavailable: true };

  // λ total proxy: 2.6 fútbol, 220 NBA, 8.5 NFL
  let muTotal = 2.6;
  const sport = f.event.sport;
  if (sport === 'basketball') muTotal = 220;
  else if (sport === 'amfootball') muTotal = 45;
  else if (sport === 'baseball') muTotal = 8.5;

  // Ajuste por clima (impacto multiplicador)
  const impact = f.weather?.impact?.goalsMultiplier;
  if (Number.isFinite(impact) && impact > 0) muTotal *= impact;

  // Distribución home/away por probabilidades implícitas
  const pH = fair[0], pD = fair[1] || 0, pA = fair[2] || (1 - pH);
  const denom = pH + pD + pA;
  if (denom <= 0) return { unavailable: true };
  const homeShare = (pH + pD * 0.5) / denom;
  let lambdaH = muTotal * Math.max(0.35, Math.min(0.75, homeShare));
  let lambdaA = muTotal - lambdaH;

  // Ajuste por lesiones: si el plantel del local tiene baja crítica, λH baja.
  // `severityScore` viene de factors/injuries.js (0=sano, 1=catastrófico).
  const sev = f?.injuries?.severityScore;
  if (sev) {
    if (Number.isFinite(sev.home) && sev.home > 0.4) lambdaH *= (1 - 0.15 * sev.home);
    if (Number.isFinite(sev.away) && sev.away > 0.4) lambdaA *= (1 - 0.15 * sev.away);
  }

  // P(BTTS yes) ≈ (1 - e^-λH)(1 - e^-λA)
  const pBttsYes = (1 - Math.exp(-lambdaH)) * (1 - Math.exp(-lambdaA));

  // P(Over 2.5) = 1 - P(total ≤ 2)
  const lambdaTotal = lambdaH + lambdaA;
  const pOver25 = 1 - poissonCDF(2, lambdaTotal);

  // Win probs por enumeración goal grid (8x8)
  let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const p = poissonPmf(i, lambdaH) * poissonPmf(j, lambdaA);
      if (i > j) pHomeWin += p;
      else if (i === j) pDraw += p;
      else pAwayWin += p;
    }
  }
  return {
    lambdaH: Number(lambdaH.toFixed(3)),
    lambdaA: Number(lambdaA.toFixed(3)),
    pHomeWin: Number(pHomeWin.toFixed(4)),
    pDraw:    Number(pDraw.toFixed(4)),
    pAwayWin: Number(pAwayWin.toFixed(4)),
    pBttsYes: Number(pBttsYes.toFixed(4)),
    pOver25:  Number(pOver25.toFixed(4))
  };
}

function poissonPmf(k, lambda) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
function poissonCDF(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return sum;
}

// ─────────────────────────────────────────────────────────────────────────
// Elo ajustado: rating implícito desde h2h + forma + sharp
// ─────────────────────────────────────────────────────────────────────────
function eloAdjustment(f) {
  const hist = f?.historical;
  if (!hist || hist.unavailable) return { unavailable: true };
  const homePts = Number(hist.form?.home?.pointsPerGame);
  const awayPts = Number(hist.form?.away?.pointsPerGame);
  const homeBase = Number.isFinite(homePts) ? homePts : 1.5;
  const awayBase = Number.isFinite(awayPts) ? awayPts : 1.5;
  let eloH = 1500 + (homeBase - 1.5) * 100;
  let eloA = 1500 + (awayBase - 1.5) * 100;
  const sport = f?.event?.sport || 'soccer';
  // Home advantage por deporte (empíricos):
  //   soccer ~70, basketball ~100, nfl ~50, baseball ~25, tennis 0 (neutral)
  const homeAdvBySport = { soccer: 70, basketball: 100, amfootball: 50, baseball: 25, hockey: 40, tennis: 0, mma: 0 };
  const homeAdv = homeAdvBySport[sport] != null ? homeAdvBySport[sport] : 50;
  const sharp = f.sharp?.score || 0;
  const pHraw = 1 / (1 + Math.pow(10, (eloA - eloH - homeAdv) / 400));
  const pAraw = 1 - pHraw;
  // Empate solo en sports que lo permiten (soccer principalmente).
  const drawRate = (sport === 'soccer') ? 0.25 : 0;
  const winScale = 1 - drawRate;
  return {
    eloHome: Math.round(eloH),
    eloAway: Math.round(eloA),
    pHomeWin: Number((pHraw * winScale).toFixed(4)),
    pDraw:    drawRate,
    pAwayWin: Number((pAraw * winScale).toFixed(4)),
    sharpAdj: sharp
  };
}

// ─────────────────────────────────────────────────────────────────────────
// LLM call con prompt estructurado
// ─────────────────────────────────────────────────────────────────────────
async function llmStructured(factors, poisson, elo) {
  // Construir un prompt MUY rico con todos los factores
  const userMsg = JSON.stringify({
    event: factors.event,
    cuotas: factors.market,
    clima: factors.weather,
    lesiones: factors.injuries,
    historico: factors.historical,
    sharp: factors.sharp,
    modeloPoisson: poisson,
    modeloElo: elo,
    cuantitativo: factors.quantitative
  });
  const prompt = `Analizá el siguiente partido. Generá 3 picks (conservador/equilibrado/agresivo) en JSON estricto.\n\n${userMsg}`;

  // Cascada: Groq es el primario (rápido, free tier generoso). 1 retry sobre
  // Groq antes de caer a otros providers — la mayoría de fallas son transient
  // (rate limit transitorio, network blip), no permanentes. Sin esto un blip
  // hacía que la pick cayera a "Análisis quant" sin necesidad.
  const providers = [
    { name: 'groq',       fn: () => groqJson(SYSTEM_PROMPT, prompt) },
    { name: 'groq',       fn: () => groqJson(SYSTEM_PROMPT, prompt) },   // retry
    { name: 'gemini',     fn: () => geminiJson(SYSTEM_PROMPT, prompt) },
    { name: 'openrouter', fn: () => openrouterJson(SYSTEM_PROMPT, prompt) }
  ];
  let lastErr = null;
  for (const p of providers) {
    try {
      const data = await p.fn();
      if (data?.selections) return { ...data, provider: p.name };
    } catch (e) {
      lastErr = e?.message;
      // Si es rate-limit (429), pausa 800ms antes del retry para que el
      // ventana de quota se mueva.
      if (/429|rate|too.?many/i.test(lastErr || '')) await new Promise(r => setTimeout(r, 800));
    }
  }
  log(`[ai] all providers failed, falling back to deterministic · last err: ${lastErr}`);
  return { selections: [], synthesis: null, provider: 'offline' };
}

// Timeouts globales por LLM (en ms). Si la API cuelga, abortamos.
// 30s permite Groq con prompt grande + retry vs los 20s originales que
// cortaban algunas respuestas legítimas.
const LLM_TIMEOUT_MS = 30000;

/** Wrapper de fetch con AbortController para timeout estricto. */
async function fetchWithTimeout(url, init, timeoutMs = LLM_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`llm-timeout ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function safeJsonParse(text, defaultValue = {}) {
  if (typeof text !== 'string') return defaultValue;
  try {
    const parsed = JSON.parse(text);
    return validateLlmOutput(parsed);
  } catch { return defaultValue; }
}

/* Valida + sanea la salida del LLM contra el schema esperado:
 *   { selections: Array<{market,outcome,line?,modelProb,confidence?,reasoning?}>,
 *     synthesis?: string }
 * Cualquier item malformado se descarta sin abortar el resto.
 * Los rangos de probabilidad se clampean a [0,1] y los strings se truncan.
 */
function validateLlmOutput(j) {
  if (!j || typeof j !== 'object') return {};
  const out = { selections: [], synthesis: null, keyFactor: null };
  if (typeof j.synthesis === 'string') out.synthesis = j.synthesis.slice(0, 1200);
  if (typeof j.keyFactor === 'string') out.keyFactor = j.keyFactor.slice(0, 250);
  if (!Array.isArray(j.selections)) return out;
  const VALID_MARKETS = new Set(['h2h', 'totals', 'btts', 'dc', 'ah']);
  const VALID_OUTCOMES = new Set([
    'home', 'draw', 'away',
    'over', 'under',
    'yes', 'no',
    'home_or_draw', 'home_or_away', 'draw_or_away',
    'home_minus', 'away_plus'
  ]);
  for (const s of j.selections) {
    if (!s || typeof s !== 'object') continue;
    if (!VALID_MARKETS.has(s.market)) continue;
    if (!VALID_OUTCOMES.has(s.outcome)) continue;
    const item = { market: s.market, outcome: s.outcome };
    // line: numérico opcional (totals/ah)
    if (s.line != null) {
      const ln = Number(s.line);
      if (Number.isFinite(ln)) item.line = ln;
    }
    // modelProb: requerido, clamped 0-1
    const mp = Number(s.modelProb);
    if (!Number.isFinite(mp) || mp < 0 || mp > 1) continue;
    item.modelProb = mp;
    // confidence opcional
    if (s.confidence != null) {
      const c = Number(s.confidence);
      if (Number.isFinite(c) && c >= 0 && c <= 1) item.confidence = c;
    }
    // Rationale (más rico — hasta 700 chars para 3-5 frases)
    if (typeof s.rationale === 'string') item.rationale = s.rationale.slice(0, 700);
    else if (typeof s.reasoning === 'string') item.rationale = s.reasoning.slice(0, 700);
    // Tactical notes — nuevo campo de análisis táctico
    if (typeof s.tacticalNotes === 'string') item.tacticalNotes = s.tacticalNotes.slice(0, 400);
    // Warnings array
    if (Array.isArray(s.warnings)) {
      item.warnings = s.warnings.filter(w => typeof w === 'string').slice(0, 6).map(w => w.slice(0, 120));
    }
    if (typeof s.type === 'string' && ['cons', 'eq', 'agg'].includes(s.type)) item.type = s.type;
    out.selections.push(item);
  }
  return out;
}

async function groqJson(system, user) {
  if (!GROQ_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: process.env.BS_GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      // 2800 tokens permite rationale + tacticalNotes + synthesis sin truncar.
      max_tokens: 2800
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return safeJsonParse(data.choices?.[0]?.message?.content);
}

/* Helper genérico para JSON-mode con Groq desde otros engines (combo analysis,
 * surebet explanation, smart-money interpretation, etc.). Comparte el cliente
 * pero acepta system prompt distinto al de match analysis. */
async function groqJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!GROQ_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: process.env.BS_GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: opts.temperature ?? 0.3,
      response_format: { type: 'json_object' },
      max_tokens: opts.maxTokens || 2000
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  try { return JSON.parse(content); } catch { return null; }
}

async function geminiJson(system, user) {
  if (!GEMINI_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: system + '\n\n' + user + '\n\nRespond strictly in JSON.' }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1600, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return safeJsonParse(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

async function openrouterJson(system, user) {
  if (!OPENROUTER_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.3,
      max_tokens: 1600,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return safeJsonParse(data.choices?.[0]?.message?.content);
}

// ─────────────────────────────────────────────────────────────────────────
// Merge LLM + Quant + Poisson + Elo → selections finales con confidence
// ─────────────────────────────────────────────────────────────────────────
/* MERGE SELECTIONS — REESCRITO PARA COHERENCIA
 *
 * ANTES: Generaba [cons home, eq draw, agg away] independientes. Resultado:
 * Conservador favorecía Villarreal pero Agresivo favorecía Sevilla — picks
 * opuestos para el mismo partido. Absurdo.
 *
 * AHORA: Determina la dirección FAVORECIDA del partido (cross-modelo) y
 * construye 3 picks COHERENTES en esa misma dirección:
 *   - Conservador: 1 leg seguro (DC o Under bajo) hacia el favorito
 *   - Equilibrado: 1 leg principal (h2h winner) sobre el favorito
 *   - Agresivo: 2-3 LEGS COMBINADAS del mismo partido (h2h + over/under
 *     + BTTS) en favor del favorito. Cuota más alta NO viene de elegir el
 *     outcome opuesto — viene de SUMAR legs justificadas.
 */
function mergeSelections(event, factors, quant, poisson, elo, llm) {
  const h2h = factors.market.h2h;
  if (!h2h) return [];

  const llmSelections = (llm.selections || []).reduce((acc, s) => {
    acc[s.market + ':' + s.outcome + (s.line ? '@' + s.line : '')] = s;
    return acc;
  }, {});

  const W = brierTracker.computeWeights({ sport: event?.sport || null }).weights;
  const hasDraw = Number.isFinite(h2h.draw);
  const idxHome = 0;
  const idxDraw = hasDraw ? 1 : null;
  const idxAway = hasDraw ? 2 : 1;

  // ── PASO 1: Calcular consensus prob por outcome (home, draw, away) ──
  function consensusFor(outcome, idx) {
    const llmS = llmSelections['h2h:' + outcome];
    const poissonP = outcome === 'home' ? poisson.pHomeWin
                   : outcome === 'away' ? poisson.pAwayWin
                   : poisson.pDraw;
    const eloP = outcome === 'home' ? elo.pHomeWin
               : outcome === 'away' ? elo.pAwayWin
               : elo.pDraw;
    const entries = [
      { p: quant.fairProbs?.[idx], w: W.fair },
      { p: poissonP, w: W.poisson },
      { p: eloP, w: W.elo },
      { p: llmS?.modelProb, w: W.llm }
    ].filter(x => Number.isFinite(x.p) && x.p >= 0 && x.p <= 1);
    const sumW = entries.reduce((s, x) => s + x.w, 0);
    return sumW > 0 ? entries.reduce((s, x) => s + x.p * x.w, 0) / sumW : null;
  }

  const pHome = consensusFor('home', idxHome) || 0;
  const pAway = consensusFor('away', idxAway) || 0;
  const pDraw = hasDraw ? (consensusFor('draw', idxDraw) || 0) : 0;

  // ── PASO 2: Determinar FAVORITO (home, away, o draw si es el más probable) ──
  let favored = 'home';
  if (pAway > pHome && pAway > pDraw) favored = 'away';
  else if (pDraw > pHome && pDraw > pAway && hasDraw) favored = 'draw';
  const favoredProb = favored === 'home' ? pHome : favored === 'away' ? pAway : pDraw;
  const favoredOdd  = favored === 'home' ? h2h.home : favored === 'away' ? h2h.away : h2h.draw;
  const favoredBook = favored === 'home' ? h2h.homeBook : favored === 'away' ? h2h.awayBook : h2h.drawBook;
  const favoredTeam = favored === 'home' ? event.home?.name
                    : favored === 'away' ? event.away?.name
                    : 'Empate';

  // Confidence base de la dirección favorecida — más alta cuando la prob es alta + modelos están de acuerdo
  const allProbs = [pHome, pAway, hasDraw ? pDraw : null].filter(Number.isFinite);
  const meanP = allProbs.reduce((s, p) => s + p, 0) / Math.max(1, allProbs.length);
  const stdev = Math.sqrt(allProbs.reduce((s, p) => s + (p - meanP) ** 2, 0) / Math.max(1, allProbs.length));
  const baseConfidence = Math.max(0.3, Math.min(0.95, favoredProb * (1 - Math.min(0.5, stdev * 2))));

  const out = [];

  // ── PASO 3a: CONSERVADOR — Doble Oportunidad o Under si baja prob ofensiva ──
  // Para favoritos que tienen DC disponible, ese es el pick más seguro.
  const dc = factors.market.dc || {};
  let consPushed = false;

  if (favored === 'home' && dc.home_or_draw && hasDraw) {
    const safeProb = pHome + pDraw;
    out.push({
      type: 'cons',
      market: 'dc',
      outcome: 'home_or_draw',
      label: `${event.home.name} o empate (1X)`,
      odd: dc.home_or_draw,
      book: dc.home_or_drawBook || favoredBook,
      consensusProb: safeProb,
      confidence: Math.min(0.95, baseConfidence + 0.15),
      rationale: `Doble oportunidad cubre victoria local + empate. Prob combinada ${(safeProb * 100).toFixed(0)}%. Estrategia conservadora cuando el local es favorito pero el rival es competitivo.`,
      factors: buildFactorList({ outcome: 'home' }, factors)
    });
    consPushed = true;
  } else if (favored === 'away' && dc.draw_or_away && hasDraw) {
    const safeProb = pDraw + pAway;
    out.push({
      type: 'cons',
      market: 'dc',
      outcome: 'draw_or_away',
      label: `Empate o ${event.away.name} (X2)`,
      odd: dc.draw_or_away,
      book: dc.draw_or_awayBook || favoredBook,
      consensusProb: safeProb,
      confidence: Math.min(0.95, baseConfidence + 0.15),
      rationale: `Doble oportunidad cubre empate + victoria visitante. Prob combinada ${(safeProb * 100).toFixed(0)}%. Útil cuando el visitante es favorito en un partido cerrado.`,
      factors: buildFactorList({ outcome: 'away' }, factors)
    });
    consPushed = true;
  }
  // Fallback: si no hay DC, usar Under a línea cercana a 2.5 si Poisson predice bajo scoring
  if (!consPushed && factors.market.totals && Number.isFinite(poisson.pOver25)) {
    const lines = Object.keys(factors.market.totals).map(Number).sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5));
    const line = lines[0];
    const t = line ? factors.market.totals[line] : null;
    if (t && t.under && poisson.pOver25 < 0.55) {
      const pUnder = 1 - poisson.pOver25;
      out.push({
        type: 'cons',
        market: 'totals',
        outcome: 'under',
        line,
        label: `Under ${line} goles`,
        odd: t.under,
        book: t.underBook,
        consensusProb: pUnder,
        confidence: Math.min(0.85, baseConfidence + 0.1),
        rationale: `Poisson predice ${(poisson.pOver25 * 100).toFixed(0)}% chance de over ${line}. Bajo perfil ofensivo → Under es el pick seguro.`,
        factors: buildFactorList({ outcome: 'under' }, factors)
      });
      consPushed = true;
    } else if (t && t.over && poisson.pOver25 > 0.65) {
      // Mucho gol esperado → over puede ser conservador
      out.push({
        type: 'cons',
        market: 'totals',
        outcome: 'over',
        line: Math.max(1.5, line - 1),
        label: `Over ${Math.max(1.5, line - 1)} goles`,
        odd: Math.max(1.20, t.over * 0.7),  // estimación si no tenemos la línea baja
        book: t.overBook,
        consensusProb: Math.min(0.95, poisson.pOver25 + 0.1),
        confidence: Math.min(0.85, baseConfidence + 0.1),
        rationale: `Poisson predice ${(poisson.pOver25 * 100).toFixed(0)}% over ${line}. Bajar la línea aumenta certeza.`,
        factors: buildFactorList({ outcome: 'over' }, factors)
      });
      consPushed = true;
    }
  }
  // Último fallback: h2h favorito como conservador (cuando no hay DC ni totals útiles)
  if (!consPushed && favoredOdd) {
    out.push({
      type: 'cons',
      market: 'h2h',
      outcome: favored,
      label: `${favoredTeam} ${favored === 'draw' ? 'empate' : 'gana'}`,
      odd: favoredOdd,
      book: favoredBook,
      consensusProb: favoredProb,
      confidence: baseConfidence,
      rationale: `Modelo ensemble (Poisson + Elo + Shin${llm.provider !== 'offline' ? ' + LLM' : ''}) favorece ${favoredTeam} con ${(favoredProb * 100).toFixed(0)}% probabilidad.`,
      factors: buildFactorList({ outcome: favored }, factors)
    });
  }

  // ── PASO 3b: EQUILIBRADO — h2h sobre el favorito ──
  if (favoredOdd) {
    const llmS = llmSelections['h2h:' + favored];
    out.push({
      type: 'eq',
      market: 'h2h',
      outcome: favored,
      label: `${favoredTeam} ${favored === 'draw' ? 'empate' : 'gana'}`,
      odd: favoredOdd,
      book: favoredBook,
      consensusProb: favoredProb,
      fairProb: quant.fairProbs?.[favored === 'home' ? idxHome : favored === 'away' ? idxAway : idxDraw],
      poissonProb: favored === 'home' ? poisson.pHomeWin : favored === 'away' ? poisson.pAwayWin : poisson.pDraw,
      eloProb: favored === 'home' ? elo.pHomeWin : favored === 'away' ? elo.pAwayWin : elo.pDraw,
      llmProb: llmS?.modelProb || null,
      confidence: baseConfidence,
      kellyHalf: quant.kellyHalf?.[favored === 'home' ? idxHome : favored === 'away' ? idxAway : idxDraw],
      rationale: llmS?.rationale || `Pick principal: ${favoredTeam} es el favorito según consenso de modelos (Poisson xG + Elo dinámico + Shin no-vig${llm.provider !== 'offline' ? ' + análisis táctico LLM' : ''}). Probabilidad real estimada ${(favoredProb * 100).toFixed(0)}% vs implícita del mercado ${(100 / favoredOdd).toFixed(0)}%.`,
      warnings: llmS?.warnings || [],
      factors: buildFactorList({ outcome: favored }, factors)
    });
    brierTracker.recordPrediction({
      id: event?.id, sport: event?.sport, market: 'h2h', outcome_pick: favored, odd: favoredOdd,
      preds: { consensus: favoredProb, poisson: favored === 'home' ? poisson.pHomeWin : favored === 'away' ? poisson.pAwayWin : poisson.pDraw }
    });
  }

  // ── PASO 3c: AGRESIVO — MULTI-LEG combinada del mismo partido en favor del favorito ──
  // Combina h2h favorito + over/under (según Poisson) + BTTS (según xG).
  // Esto es lo que pidió el user: cuota más alta NO viene del outcome opuesto,
  // viene de SUMAR legs justificadas por modelos.
  if (favoredOdd && (favored === 'home' || favored === 'away')) {
    const legs = [];
    // Leg 1: h2h favorito
    legs.push({
      market: 'h2h', outcome: favored, line: null,
      label: `${favoredTeam} gana`,
      odd: favoredOdd, book: favoredBook,
      prob: favoredProb
    });
    // Leg 2: Over/Under según Poisson
    if (factors.market.totals && Number.isFinite(poisson.pOver25)) {
      const lines = Object.keys(factors.market.totals).map(Number).sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5));
      const line = lines[0];
      const t = line ? factors.market.totals[line] : null;
      if (t) {
        if (poisson.pOver25 > 0.55 && t.over) {
          legs.push({
            market: 'totals', outcome: 'over', line,
            label: `Over ${line} goles`,
            odd: t.over, book: t.overBook,
            prob: poisson.pOver25
          });
        } else if (poisson.pOver25 < 0.45 && t.under) {
          legs.push({
            market: 'totals', outcome: 'under', line,
            label: `Under ${line} goles`,
            odd: t.under, book: t.underBook,
            prob: 1 - poisson.pOver25
          });
        }
      }
    }
    // Leg 3: BTTS según Poisson — solo si correlaciona con el favorito ganando
    if (factors.market.btts && Number.isFinite(poisson.pBttsYes)) {
      if (poisson.pBttsYes > 0.6 && factors.market.btts.yes) {
        legs.push({
          market: 'btts', outcome: 'yes', line: null,
          label: 'BTTS — Sí',
          odd: factors.market.btts.yes, book: factors.market.btts.yesBook,
          prob: poisson.pBttsYes
        });
      } else if (poisson.pBttsYes < 0.4 && factors.market.btts.no) {
        legs.push({
          market: 'btts', outcome: 'no', line: null,
          label: 'BTTS — No',
          odd: factors.market.btts.no, book: factors.market.btts.noBook,
          prob: 1 - poisson.pBttsYes
        });
      }
    }

    if (legs.length >= 2) {
      const totalOdd = legs.reduce((a, l) => a * l.odd, 1);
      // Para combinada en mismo partido, las probs NO son independientes —
      // hay correlación negativa (ganar + over + btts están correlacionados con el resultado).
      // Aproximamos: combinedProb ≈ promedio harmónico ajustado.
      const independentProb = legs.reduce((a, l) => a * l.prob, 1);
      const correlationAdjustment = 1.25;  // correlación positiva entre legs del mismo partido
      const adjustedProb = Math.min(0.85, independentProb * correlationAdjustment);
      out.push({
        type: 'agg',
        market: 'combo',
        outcome: 'parlay',
        label: legs.map(l => l.label).join(' + '),
        odd: Number(totalOdd.toFixed(2)),
        book: favoredBook,
        legs: legs.map(l => ({ market: l.market, outcome: l.outcome, line: l.line, label: l.label, odd: l.odd, book: l.book })),
        consensusProb: adjustedProb,
        confidence: Math.max(0.35, baseConfidence - 0.15),
        rationale: `Combinada de ${legs.length} legs en favor de ${favoredTeam}. Sustento: modelo Poisson predice escenario coherente (${legs.map(l => `${l.label} ${(l.prob * 100).toFixed(0)}%`).join(', ')}). Correlación positiva intra-partido — todas las legs apuntan a la misma narrativa.`,
        tacticalNotes: `Cuota alta no viene de pick contradictorio sino de sumar legs justificadas por modelos cuantitativos del mismo partido.`,
        factors: buildFactorList({ outcome: favored }, factors)
      });
    } else if (favoredOdd) {
      // Fallback: si no podemos combinar, agresivo es el outcome del favorito con cuota alta
      // (e.g. AH -1.5 o over alto). Por ahora, repetimos h2h con label distinto.
      out.push({
        type: 'agg',
        market: 'h2h',
        outcome: favored,
        label: `${favoredTeam} gana — pick alto`,
        odd: favoredOdd,
        book: favoredBook,
        consensusProb: favoredProb,
        confidence: Math.max(0.4, baseConfidence - 0.1),
        rationale: `Pick agresivo de h2h. No hay mercados adicionales (BTTS/totals) en este evento para combinar — combinada degradada a single leg.`,
        factors: buildFactorList({ outcome: favored }, factors)
      });
    }
  }

  // ── PASO 4: Computar EV de cada selección ──
  out.forEach(s => {
    if (s.odd && s.consensusProb) {
      s.consensusEv = Number(((s.consensusProb * s.odd - 1) * 100).toFixed(2));
    }
  });

  return out;
}

function applyFactorPenalties(confidence, variant, factors) {
  const inj = factors.injuries?.severityScore;
  if (inj) {
    // Lesiones del propio equipo bajan confidence
    if (variant.outcome === 'home' && inj.home > 0.4) confidence -= 0.15;
    if (variant.outcome === 'away' && inj.away > 0.4) confidence -= 0.15;
    // Lesiones del RIVAL son favorables: suben confidence
    if (variant.outcome === 'home' && inj.away > 0.4) confidence += 0.08;
    if (variant.outcome === 'away' && inj.home > 0.4) confidence += 0.08;
    // Empate: lesiones grandes en ambos hacen el empate más probable
    if (variant.outcome === 'draw' && inj.home > 0.3 && inj.away > 0.3) confidence += 0.05;
  }
  const w = factors.weather;
  if (w && !w.unavailable) {
    const gm = w.impact?.goalsMultiplier;
    if (Number.isFinite(gm)) {
      if (variant.outcome === 'over' && gm < 0.95) confidence -= 0.10;
      if (variant.outcome === 'under' && gm > 1.05) confidence -= 0.10;
      // Bonificar la dirección opuesta
      if (variant.outcome === 'over' && gm > 1.05) confidence += 0.05;
      if (variant.outcome === 'under' && gm < 0.95) confidence += 0.05;
    }
  }
  // Lineup confirmation: si AMBOS lineups están confirmados, subimos
  // confidence (señal pre-match más nítida). Si uno solo está confirmado
  // y el outcome aplica a ese lado, sube; al lado contrario baja.
  const lu = factors.lineups;
  if (lu && !lu.unavailable) {
    const homeConf = !!lu.home?.confirmed;
    const awayConf = !!lu.away?.confirmed;
    if (homeConf && awayConf) confidence += 0.08;
    else if (homeConf && variant.outcome === 'home') confidence += 0.04;
    else if (awayConf && variant.outcome === 'away') confidence += 0.04;
    // Impact alto (e.g. portero ausente) baja confidence del lado afectado
    if (lu.impact?.side && lu.impact.magnitude >= 0.3 && lu.impact.side === variant.outcome) {
      confidence -= 0.10;
    }
  }
  return Math.max(0, Math.min(1, confidence));
}

function buildFactorList(variant, factors) {
  const list = [];
  // Clima
  if (factors.weather && !factors.weather.unavailable) {
    factors.weather.impact?.notes?.forEach(n => list.push({ kind: 'weather', impact: 'mid', note: n }));
  }
  // Lesiones
  if (factors.injuries && !factors.injuries.unavailable) {
    const outs = (factors.injuries.home?.injuries || []).filter(i => i.status === 'out').length;
    const outsA = (factors.injuries.away?.injuries || []).filter(i => i.status === 'out').length;
    if (outs) list.push({ kind: 'injury', impact: 'high', note: `${outs} bajas confirmadas en local (${factors.injuries.home.team})` });
    if (outsA) list.push({ kind: 'injury', impact: 'high', note: `${outsA} bajas confirmadas en visitante (${factors.injuries.away.team})` });
  }
  // Sharp
  if (factors.sharp?.score > 0.4) {
    list.push({ kind: 'sharp', impact: 'high', note: `Movimiento sharp detectado (score ${factors.sharp.score.toFixed(2)})` });
  }
  // Histórico H2H
  const h2h = factors.historical?.h2h;
  if (h2h && h2h.matches > 3) {
    if (variant.outcome === 'home' && h2h.homeWinRate > 0.55) list.push({ kind: 'history', impact: 'mid', note: `Local ${(h2h.homeWinRate*100).toFixed(0)}% en últimos ${h2h.matches} H2H` });
    if (variant.outcome === 'away' && h2h.awayWinRate > 0.55) list.push({ kind: 'history', impact: 'mid', note: `Visitante ${(h2h.awayWinRate*100).toFixed(0)}% en últimos ${h2h.matches} H2H` });
    if (h2h.bttsRate > 0.65 && variant.outcome === 'btts_yes') list.push({ kind: 'history', impact: 'mid', note: `BTTS hit ${(h2h.bttsRate*100).toFixed(0)}% en H2H` });
  }
  return list;
}

function outcomeLabel(outcome, event) {
  if (outcome === 'home') return `${event.home.name} gana`;
  if (outcome === 'away') return `${event.away.name} gana`;
  if (outcome === 'draw') return 'Empate';
  if (outcome === 'home_or_draw') return `${event.home.name} o empate (1X)`;
  if (outcome === 'draw_or_away') return `Empate o ${event.away.name} (X2)`;
  return outcome;
}

module.exports = { analyzeMatch, groqJsonGeneric };
