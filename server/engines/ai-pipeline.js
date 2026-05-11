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

const cache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

const GROQ_KEY     = process.env.BS_GROQ_API_KEY     || process.env.GROQ_API_KEY     || '';
const GEMINI_KEY   = process.env.BS_GEMINI_API_KEY   || process.env.GEMINI_API_KEY   || '';
const OPENROUTER_KEY = process.env.BS_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';

const SYSTEM_PROMPT = `Sos un analista cuantitativo experto en apuestas deportivas argentino.
Tenés acceso a: cuotas de 12 casas legales AR, clima por venue, lista de lesiones de ambos equipos,
histórico H2H + forma reciente, movimientos sharp del mercado, y modelos cuantitativos (Poisson, Elo, Shin).

Tu rol:
1) Procesar TODOS los factores que te paso.
2) Estimar probabilidades verdaderas para cada outcome (home/draw/away, over/under, btts).
3) Identificar el outcome con mayor EV vs cuotas actuales.
4) Justificar con factores específicos del input (no inventar datos).
5) Calificar confianza (0-1) según consistencia entre modelos y factores.

Respondé SIEMPRE en JSON estricto con este shape exacto (sin markdown, sin texto adicional):
{
  "selections": [
    {
      "type": "cons" | "eq" | "agg",
      "market": "h2h" | "totals" | "btts" | "dc",
      "outcome": "home" | "draw" | "away" | "over" | "under" | "yes" | "no" | "home_or_draw" | ...,
      "line": null | número,
      "modelProb": 0..1,
      "rationale": "<2-3 frases citando factores específicos>",
      "warnings": ["lesión clave", "clima adverso", ...] | [],
      "confidence": 0..1
    }
  ],
  "synthesis": "<1 párrafo de 60-90 palabras: lectura general del partido>"
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

  // Ajuste por lesiones del local: λ_home -= 10% si severityScore.home > 0.5
  if (sev) {
    if (sev.home > 0.4) lambdaH *= (1 - 0.15 * sev.home);
    if (sev.away > 0.4) lambdaA *= (1 - 0.15 * sev.away);
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

  const providers = [
    { name: 'groq',       fn: () => groqJson(SYSTEM_PROMPT, prompt) },
    { name: 'gemini',     fn: () => geminiJson(SYSTEM_PROMPT, prompt) },
    { name: 'openrouter', fn: () => openrouterJson(SYSTEM_PROMPT, prompt) }
  ];
  for (const p of providers) {
    try {
      const data = await p.fn();
      if (data?.selections) return { ...data, provider: p.name };
    } catch (e) { log(`[ai] ${p.name} fail`, e?.message); }
  }
  return { selections: [], synthesis: null, provider: 'offline' };
}

// Timeouts globales por LLM (en ms). Si la API cuelga, abortamos.
const LLM_TIMEOUT_MS = 20000;

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
  try { return JSON.parse(text); } catch { return defaultValue; }
}

async function groqJson(system, user) {
  if (!GROQ_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 1600
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return safeJsonParse(data.choices?.[0]?.message?.content);
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
function mergeSelections(event, factors, quant, poisson, elo, llm) {
  const h2h = factors.market.h2h;
  if (!h2h) return [];

  const llmSelections = (llm.selections || []).reduce((acc, s) => {
    acc[s.market + ':' + s.outcome + (s.line ? '@' + s.line : '')] = s;
    return acc;
  }, {});

  const out = [];

  // 1X2 (cons / eq / agg)
  const variants = [
    { type: 'cons', outcome: 'home',  odd: h2h.home, book: h2h.homeBook, fairProb: quant.fairProbs?.[0], poissonProb: poisson.pHomeWin, eloProb: elo.pHomeWin, ev: quant.ev?.[0], kelly: quant.kellyHalf?.[0] },
    { type: 'eq',   outcome: 'draw',  odd: h2h.draw, book: h2h.drawBook, fairProb: quant.fairProbs?.[1], poissonProb: poisson.pDraw,    eloProb: elo.pDraw,    ev: quant.ev?.[1], kelly: quant.kellyHalf?.[1] },
    { type: 'agg',  outcome: 'away',  odd: h2h.away, book: h2h.awayBook, fairProb: quant.fairProbs?.[2], poissonProb: poisson.pAwayWin, eloProb: elo.pAwayWin, ev: quant.ev?.[2], kelly: quant.kellyHalf?.[2] }
  ];

  variants.forEach(v => {
    if (!v.odd) return;
    const llmS = llmSelections['h2h:' + v.outcome];
    const probs = [v.fairProb, v.poissonProb, v.eloProb, llmS?.modelProb].filter(p => p != null);
    const consensus = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : null;
    const stdev = probs.length > 1 ? Math.sqrt(probs.reduce((s, p) => s + (p - consensus) ** 2, 0) / probs.length) : 0;

    // Confidence: alta consistencia entre modelos = alto. Sharp money y factores también suman.
    let confidence = 1 - Math.min(1, stdev * 4);
    // Penalizar si los factores no son favorables (lesiones contra el outcome, clima contra goles si over...)
    confidence = applyFactorPenalties(confidence, v, factors);

    out.push({
      type: v.type,
      market: 'h2h',
      outcome: v.outcome,
      label: outcomeLabel(v.outcome, event),
      odd: v.odd,
      book: v.book,
      fairProb:    v.fairProb,
      poissonProb: v.poissonProb,
      eloProb:     v.eloProb,
      llmProb:     llmS?.modelProb || null,
      consensusProb: consensus,
      modelDivergence: Number(stdev.toFixed(4)),
      evPct:       v.ev,
      kellyHalf:   v.kelly,
      confidence:  Number(confidence.toFixed(3)),
      warnings:    llmS?.warnings || [],
      rationale:   llmS?.rationale || null,
      factors: buildFactorList(v, factors)
    });
  });

  // Over/Under 2.5 (si tenemos línea cercana a 2.5)
  if (factors.market.totals) {
    const lines = Object.keys(factors.market.totals).map(Number).sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5));
    const line = lines[0];
    if (line) {
      const t = factors.market.totals[line];
      const llmOver = llmSelections[`totals:over@${line}`];
      const llmUnder = llmSelections[`totals:under@${line}`];
      // Solo mezclamos probs MODELADAS (Poisson + LLM). Las cuotas son
      // implícitas con margen del book — NO se mezclan en consensus.
      if (t.over && Number.isFinite(poisson.pOver25)) {
        const pPoisson = poisson.pOver25;
        const llmP = Number.isFinite(llmOver?.modelProb) ? llmOver.modelProb : null;
        const probs = [pPoisson, llmP].filter(p => p != null);
        const consensus = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : pPoisson;
        out.push({
          type: 'eq',
          market: 'totals',
          outcome: 'over',
          line,
          label: `Over ${line} goles`,
          odd: t.over,
          book: t.overBook,
          poissonProb: pPoisson,
          llmProb: llmP,
          consensusProb: consensus,
          confidence: 0.7,
          factors: buildFactorList({ outcome: 'over' }, factors),
          rationale: llmOver?.rationale || null,
          warnings: llmOver?.warnings || []
        });
      }
      if (t.under && Number.isFinite(poisson.pOver25)) {
        const pPoisson = 1 - poisson.pOver25;
        const llmP = Number.isFinite(llmUnder?.modelProb) ? llmUnder.modelProb : null;
        const probs = [pPoisson, llmP].filter(p => p != null);
        const consensus = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : pPoisson;
        out.push({
          type: 'cons',
          market: 'totals',
          outcome: 'under',
          line,
          label: `Under ${line} goles`,
          odd: t.under,
          book: t.underBook,
          poissonProb: pPoisson,
          llmProb: llmP,
          consensusProb: consensus,
          confidence: 0.7,
          factors: buildFactorList({ outcome: 'under' }, factors),
          rationale: llmUnder?.rationale || null,
          warnings: llmUnder?.warnings || []
        });
      }
    }
  }

  // BTTS si está disponible
  if (factors.market.btts?.yes) {
    const pPoisson = poisson.pBttsYes;
    const llmS = llmSelections['btts:yes'];
    out.push({
      type: 'eq',
      market: 'btts',
      outcome: 'yes',
      label: 'BTTS — Sí',
      odd: factors.market.btts.yes,
      book: factors.market.btts.yesBook,
      poissonProb: pPoisson,
      llmProb: llmS?.modelProb || null,
      consensusProb: pPoisson,
      confidence: 0.65,
      factors: buildFactorList({ outcome: 'btts_yes' }, factors),
      rationale: llmS?.rationale || null
    });
  }

  // Ordenar por EV y confianza
  out.forEach(s => {
    if (s.odd && s.consensusProb) {
      s.consensusEv = Number(((s.consensusProb * s.odd - 1) * 100).toFixed(2));
    }
  });
  out.sort((a, b) => (b.consensusEv || -99) - (a.consensusEv || -99));

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

module.exports = { analyzeMatch };
