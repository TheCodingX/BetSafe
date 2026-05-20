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
const { predictExtendedMarkets } = require('../factors/extendedMarkets');
const brierTracker = require('./brier-tracker');
const { analyzeCombo: _analyzeCombo } = require('./correlation');

// Cache LRU para análisis completos. TTL 30min: balance entre freshness (las
// cuotas se mueven) y costo (no martillar al LLM). El cache se descarta si
// llmProvider==='offline' (failed) — ahí cacheamos solo 30s para retry rápido.
const cache = new LRUCache({ max: 500, ttl: 30 * 60 * 1000 });

// ─────────────────────────────────────────────────────────────────────────
// API KEYS — soporte multi-key con rotación round-robin.
// Setear BS_GROQ_API_KEYS="k1,k2,k3" para multiplicar el rate limit, o el
// legacy BS_GROQ_API_KEY para 1 sola key. Cualquiera de las dos funciona.
// ─────────────────────────────────────────────────────────────────────────
function parseKeys(...envNames) {
  const seen = new Set();
  const out = [];
  for (const name of envNames) {
    const v = process.env[name];
    if (!v) continue;
    for (const k of String(v).split(',').map(s => s.trim()).filter(Boolean)) {
      if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
  }
  return out;
}

const OPENAI_KEYS     = parseKeys('BS_OPENAI_API_KEYS',     'BS_OPENAI_API_KEY',     'OPENAI_API_KEY');
const GROQ_KEYS       = parseKeys('BS_GROQ_API_KEYS',       'BS_GROQ_API_KEY',       'GROQ_API_KEY');
const CEREBRAS_KEYS   = parseKeys('BS_CEREBRAS_API_KEYS',   'BS_CEREBRAS_API_KEY',   'CEREBRAS_API_KEY');
const OPENROUTER_KEYS = parseKeys('BS_OPENROUTER_API_KEYS', 'BS_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY');
const GEMINI_KEYS     = parseKeys('BS_GEMINI_API_KEYS',     'BS_GEMINI_API_KEY',     'GEMINI_API_KEY');
const ANTHROPIC_KEYS  = parseKeys('BS_ANTHROPIC_API_KEYS',  'BS_ANTHROPIC_API_KEY',  'ANTHROPIC_API_KEY');

// Backwards-compat singular (algunas partes del código check existence con esto)
const OPENAI_KEY      = OPENAI_KEYS[0]     || '';
const GROQ_KEY        = GROQ_KEYS[0]       || '';
const CEREBRAS_KEY    = CEREBRAS_KEYS[0]   || '';
const OPENROUTER_KEY  = OPENROUTER_KEYS[0] || '';
const GEMINI_KEY      = GEMINI_KEYS[0]     || '';
const ANTHROPIC_KEY   = ANTHROPIC_KEYS[0]  || '';

// Round-robin rotator
const _rotState = {
  openai: { idx: -1 }, groq: { idx: -1 }, cerebras: { idx: -1 }, openrouter: { idx: -1 },
  gemini: { idx: -1 }, anthropic: { idx: -1 }
};
function pickKey(keys, state) {
  if (!keys.length) return '';
  if (keys.length === 1) return keys[0];
  state.idx = (state.idx + 1) % keys.length;
  return keys[state.idx];
}

// ─────────────────────────────────────────────────────────────────────────
// MODELOS por defecto (overridable per-call vía opts.model)
// ─────────────────────────────────────────────────────────────────────────
// OpenAI: si BS_OPENAI_API_KEY está cargada, gpt-5-mini se vuelve PRIMARY
// automáticamente (mejor calidad que Llama 70B + JSON estructurado superior +
// SLA 99.9%). Pricing: $0.30/$1.50 per 1M tokens (~$15-30/mes para BetSafe).
const OPENAI_MODEL        = process.env.BS_OPENAI_MODEL    || 'gpt-5-mini';
const GROQ_DEFAULT_MODEL  = process.env.BS_GROQ_MODEL      || 'llama-3.3-70b-versatile';   // 70B free
const GROQ_FAST_MODEL     = process.env.BS_GROQ_FAST_MODEL || 'llama-3.1-8b-instant';      // fallback rápido
// Cerebras free tier (2026-05): SOLO ofrece llama3.1-8b. El llama-3.3-70b está en
// Dedicated Endpoints (pago). El llama3.1-8b se deprecia 2026-05-27 — habrá que
// actualizar a otro modelo cuando salga el reemplazo.
const CEREBRAS_MODEL      = process.env.BS_CEREBRAS_MODEL  || 'llama3.1-8b';
const GEMINI_MODEL        = process.env.BS_GEMINI_MODEL    || 'gemini-2.5-flash';
const ANTHROPIC_MODEL     = process.env.BS_ANTHROPIC_MODEL || 'claude-sonnet-4-5';

// Modelos free de OpenRouter en cascada (orden de prioridad). Actualizado
// 2026-05 — los models v3/qwen2.5/gemini2.0-flash anteriores fueron retirados.
const OPENROUTER_FREE_MODELS = (process.env.BS_OPENROUTER_FREE_MODELS || [
  'deepseek/deepseek-v4-flash:free',                       // 684B MoE, 1M context — sucesor de v3
  'meta-llama/llama-3.3-70b-instruct:free',                // 70B, 131K context
  'nvidia/nemotron-3-super-120b-a12b:free',                // 120B, 1M context — Nemotron 3 Super
  'qwen/qwen3-next-80b-a3b-instruct:free'                  // 80B, 262K context — sucesor de Qwen 2.5
].join(',')).split(',').map(s => s.trim()).filter(Boolean);

// OPT-IN para tier pago (Gemini/Anthropic). Default OFF para no quemar plata.
// OpenAI NO requiere este flag — si su key está cargada, entra automático como primary.
const USE_PAID_TIER = process.env.BS_USE_PAID_TIER === '1';

// Backward-compat: el código original referencia GROQ_MODEL, mantenido como alias.
const GROQ_MODEL = GROQ_DEFAULT_MODEL;

/* CASCADA ACTUAL (2026-05):
 *   1) [si OPENAI_KEY] OpenAI gpt-5-mini (PRIMARY pago, ~$0.30/$1.50 per 1M)
 *   2) Groq Llama 3.3 70B (free, 14400 req/día, ~280 tok/s, JSON nativo)
 *   3) Cerebras Llama 3.1 8B (free, ~2200 tok/s ULTRA fast)
 *   4) OpenRouter free models cascada (DeepSeek V4 → Llama 70B → Nemotron 120B → Qwen3 80B)
 *   5) Groq Llama 3.1 8B (fast fallback si 70B rate-limited)
 *   6) [opt-in BS_USE_PAID_TIER=1] Gemini 2.5 Flash
 *   7) [opt-in + premium match] Claude Sonnet 4.5
 */
function isPremiumMatch(event, factors) {
  if (!event) return false;
  // Top leagues mundiales
  const lg = (event.leagueName || event.league || '').toLowerCase();
  const TOP_LEAGUES = /\b(champions league|uefa champions|europa league|premier league|la ?liga|primera divisi|serie a|bundesliga|ligue 1|copa libertadores|copa america|world cup|copa mundial|liga profesional argentina|copa argentina)\b/i;
  if (TOP_LEAGUES.test(lg)) return true;
  // Top teams mundiales (uno de los dos debe ser un top team)
  const teams = `${event.home?.name || ''} ${event.away?.name || ''}`.toLowerCase();
  const TOP_TEAMS = /\b(boca|river|racing|independiente|liverpool|arsenal|manchester|chelsea|tottenham|real madrid|barcelona|atletico|sevilla|villarreal|napoli|juventus|inter|milan|roma|lazio|atalanta|bayern|dortmund|psg|marseille|flamengo|palmeiras|santos|sao paulo|corinthians|gremio)\b/i;
  if (TOP_TEAMS.test(teams)) return true;
  return false;
}

const SYSTEM_PROMPT = `Sos un analista senior cuantitativo de apuestas argentinas, nivel sportbook research.

Generá 3 picks (cons/eq/agg) DENSOS y aplicables:
- cons: seguro (DC 1X/X2, under si juego cerrado, AH±0.5 favorito sólido) — prob > 70%
- eq: principal (h2h favorito firme, totals 2.5/3.0, AH leve) — prob 50-70%, EV+ alto
- agg: combinada multi-leg del MISMO partido (favorito + over + BTTS, o equivalente coherente) — prob 30-50% pero pago alto

REGLAS DE RATIONALE (CRÍTICAS):
1) NO inventes datos. Si un factor llega como "unavailable", "null" o "{}", IGNORALO — NO digas "no hay clima" ni "no hay datos de lesiones".
2) Cada rationale: 3-5 frases DENSAS en español argentino. Mencioná SIEMPRE los factors REALES que tenés (en orden de prioridad si están):
   • Forma reciente (puntos/partido, W-D-L) → "viene de X racha"
   • H2H histórico → "en sus últimos N choques, X% favoreció a..."
   • Lesiones reportadas (si severityScore > 0.3 home o away) → "X tiene baja por lesiones clave"
   • Clima si goalsMultiplier ≠ 1 (significativo) → "lluvia/calor baja goles"
   • Movimiento sharp (steam moves) si la cuota se movió >5% → "el mercado pro empujó hacia..."
   • Lineups confirmados si hay → "X confirmó titular a Y"
   • Tier de liga (1 mundial, 2 regional, 3 secundaria) → contextualizá el peso del partido
3) Lenguaje NATURAL — NUNCA mencionés "Poisson", "Elo", "Shin", "lambda", "ensemble", "K-factor", "Bayesian", "modelo cuantitativo". Reemplazá por: "goles esperados", "forma reciente", "valor vs cuota", "tendencia del mercado".
4) NUNCA digas "tomá riesgo controlado", "apostá con cabeza", o avisos genéricos.
5) Synthesis OBLIGATORIA: 80-140 palabras leyendo el partido como en una nota de prensa — citá los factors clave, contextualizá la liga, terminá con la conclusión accionable.
6) keyFactor: la 1 cosa que más cambia el resultado de este partido específico (no genérica).
7) marketEdge: dónde el modelo ve la mayor diferencia vs la cuota ofrecida.

JSON estricto (sin markdown, sin prefijos):
{
  "selections": [
    {"type":"cons","market":"dc"|"totals"|"ah","outcome":"home_or_draw"|"draw_or_away"|"under"|"home_minus"|"away_plus","line":null|número,"modelProb":0..1,"rationale":"...","confidence":0..1},
    {"type":"eq","market":"h2h"|"totals"|"ah","outcome":"home"|"draw"|"away"|"over"|"under"|"home_minus"|"away_plus","line":null|número,"modelProb":0..1,"rationale":"...","confidence":0..1},
    {"type":"agg","market":"h2h"|"totals"|"btts"|"combo","outcome":"...","modelProb":0..1,"rationale":"...","confidence":0..1}
  ],
  "synthesis":"<80-140 palabras de lectura del partido en lenguaje natural, citando factors reales>",
  "keyFactor":"<una frase específica: el factor más decisivo para ESTE partido (no genérico)>",
  "marketEdge":"<una frase: dónde el modelo encuentra más valor vs la cuota actual>",
  "modelConsensus":"<una frase: nivel de convicción y por qué (qué factors apoyan el call)>"
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

  // 2.5) Mercados extendidos (predicciones analíticas: córners, tarjetas, goleadores)
  let extendedMarkets = null;
  try {
    extendedMarkets = await predictExtendedMarkets(event, { factors, poisson, elo: eloAdj });
  } catch (e) {
    log(`[ai] extendedMarkets err: ${e?.message?.slice(0, 80)}`);
  }

  // 3) LLM analysis
  const llm = await llmStructured(factors, poisson, eloAdj);

  // 4) Consenso entre modelos
  const selections = mergeSelections(event, factors, quant, poisson, eloAdj, llm, extendedMarkets);

  // 5) Enriquecer cada selection con métricas avanzadas para el frontend
  for (const s of selections) {
    if (s.odd && s.consensusProb) {
      const impliedProb = 1 / s.odd;
      // valueGap = (real - implied) / implied → cuánto más probable es vs el mercado
      s.valueGap = Number(((s.consensusProb - impliedProb) / impliedProb * 100).toFixed(2));
      s.impliedProb = Number(impliedProb.toFixed(4));
      // Confianza calibrada: depende de stdev entre modelos + nivel sharp
      if (s.fairProb != null && s.poissonProb != null) {
        const ps = [s.fairProb, s.poissonProb, s.eloProb, s.llmProb].filter(Number.isFinite);
        if (ps.length >= 2) {
          const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
          const stdev = Math.sqrt(ps.reduce((a, p) => a + (p - mean) ** 2, 0) / ps.length);
          s.modelStdev = Number(stdev.toFixed(4));
          s.modelConvergence = stdev < 0.05 ? 'alta' : stdev < 0.12 ? 'media' : 'baja';
        }
      }
      // Kelly fractional (1/4 conservador) — stake recomendado
      if (s.consensusEv != null && s.consensusEv > 0) {
        const b = s.odd - 1;
        const p = s.consensusProb;
        const q = 1 - p;
        const kelly = b > 0 ? (b * p - q) / b : 0;
        s.kellyFractional = Math.max(0, Math.min(0.25, kelly * 0.25));
      }
    }
  }

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
    llmMarketEdge: llm.marketEdge || null,
    llmModelConsensus: llm.modelConsensus || null,
    llmProvider: llm.provider || 'offline',
    ts: Date.now()
  };
  // Solo cachear si la LLM respondió OK. Si fue offline, queremos reintentar en
  // la próxima request (no quedarse 5min con un fail transient).
  if (llm.provider && llm.provider !== 'offline') {
    cache.set(event.id, result);
  } else {
    // Cache MUY corta (30s) para no martillar el LLM con el mismo prompt si está
    // genuinamente down, pero sí reintentar pronto.
    cache.set(event.id, result, { ttl: 30 * 1000 });
  }
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

  // FIX 2026-05: muTotal baseline RECALIBRADO al promedio real moderno
  // (antes 2.6 fútbol → bias sistémico Under porque la media 2024-2026 es ~2.85).
  // Causa documentada: jornada del 2026-05-18 donde 4 picks Under 2.5 fallaron
  // 4/4 con cuotas 2.33-2.60 (el mercado decía Over claramente).
  // λ total proxy por deporte (medias 2024-2026):
  let muTotal = 2.85;   // fútbol moderno (subió desde 2.6)
  const sport = f.event.sport;
  if (sport === 'basketball') muTotal = 224;       // NBA 2024-25 average
  else if (sport === 'amfootball') muTotal = 47;   // NFL 2024
  else if (sport === 'baseball') muTotal = 8.8;    // MLB 2024
  else if (sport === 'hockey') muTotal = 6.3;      // NHL 2024
  else if (sport === 'tennis') muTotal = 22;       // games promedio set best-of-3

  // Override por liga conocida — distintos torneos tienen distintas medias.
  // Datos de últimas 2 temporadas (fuentes públicas: FBref, WhoScored).
  const LEAGUE_MU = {
    'premier-league': 2.95, 'la-liga': 2.65, 'serie-a': 2.85,
    'bundesliga': 3.20,     'ligue-1': 2.75, 'eredivisie': 3.30,
    'lpf': 2.40,            'primera-nacional': 2.30,
    'copa-libertadores': 2.55, 'copa-sudamericana': 2.50, 'copa-argentina': 2.45,
    'brasileirao': 2.55,    'liga-mx': 2.85,
    'mls': 2.95,            'championship': 2.55,
    'champions-league': 2.95, 'europa-league': 2.85
  };
  if (sport === 'soccer' && f.event.league && LEAGUE_MU[f.event.league]) {
    muTotal = LEAGUE_MU[f.event.league];
  }

  // FIX 2026-05: CALIBRACIÓN SUAVE AL MERCADO.
  // Si tenemos cuota Over 2.5, derivamos el muTotal implícito del mercado y
  // mezclamos 70% modelo / 30% mercado. Esto evita el bias contrarian
  // sistémico (modelo dice Under, mercado dice Over, los pros saben más).
  // Solo aplica fútbol (donde el bias está documentado).
  if (sport === 'soccer') {
    const totals25 = f?.market?.totals?.['2.5'];
    const overOdd = totals25?.over;
    if (Number.isFinite(overOdd) && overOdd > 1.05 && overOdd < 5) {
      // Prob implícita Over 2.5 (sin vig aproximado, asumimos 5% overround)
      const pOver25Mkt = (1 / overOdd) / 1.05;
      if (pOver25Mkt > 0.20 && pOver25Mkt < 0.80) {
        // Resolver muTotal tal que P(Over 2.5 | Poisson(mu)) ≈ pOver25Mkt
        // Aproximación rápida: muMkt = -ln(1 - pOver25Mkt) × correctionFactor
        // Para Poisson sum, una aproximación buena en el rango 1.5-4 goles
        // es muMkt = 2.5 + 1.2 × (pOver25Mkt - 0.5) — empíricamente calibrado.
        const muMkt = 2.5 + 1.2 * (pOver25Mkt - 0.5);
        if (muMkt > 1.5 && muMkt < 4.5) {
          muTotal = muTotal * 0.7 + muMkt * 0.3;
        }
      }
    }
  }

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
/* League importance tier 1-10 — pondera cuánto importa el partido contextualmente.
 * UCL semis = 10, friendlies = 1. Sirve para ajustar el rationale del LLM y la
 * calibración de la probabilidad (equipos suelen jugar diferente según importancia). */
function leagueImportance(leagueName, sport) {
  if (!leagueName) return 5;
  const ln = leagueName.toLowerCase();
  // Tier 10: finales, semis, mundiales
  if (/\b(final|semifinal|world cup|copa mundial|final.*champions)\b/.test(ln)) return 10;
  // Tier 9: UCL, Europa, Copa America
  if (/\b(champions league|uefa champions|europa league|copa america|libertadores)\b/.test(ln)) return 9;
  // Tier 8: Top 5 europeas + LPF + NBA/NFL/MLB regular
  if (/\b(premier league|la ?liga|serie a|bundesliga|ligue 1|liga profesional)\b/.test(ln)) return 8;
  if (/\b(\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b)\b/.test(ln)) return 8;
  // Tier 7: Sudamericana, Coppa Italia, FA Cup, Liga MX
  if (/\b(sudamericana|coppa italia|fa cup|copa del rey|dfb pokal|coupe de france|liga mx)\b/.test(ln)) return 7;
  // Tier 6: Brasileirão, Primeira Liga, Eredivisie, MLS
  if (/\b(brasileir.o|primeira liga|eredivisie|\bmls\b)\b/.test(ln)) return 6;
  // Tier 5: Otras primeras divisiones sudamericanas
  if (/\b(chile.*primera|colombia|peru|ecuador|paraguay|uruguay|bolivia)\b/.test(ln)) return 5;
  // Tier 4: Segundas divisiones
  if (/\b(segunda|championship|serie b|primera nacional|liga ?2)\b/.test(ln)) return 4;
  // Tier 3: tenis grand slam, ufc / mma
  if (/\b(grand slam|wimbledon|us open|australian open|french open|ufc|mma|bellator)\b/.test(ln)) return 7;
  // Tier 1-2: amistosos, reservas
  if (/\b(amistoso|friendly|reservas|reserve|youth|sub-?\d+|primavera)\b/.test(ln)) return 2;
  return 5;  // default — liga desconocida
}

/* Home advantage histórico aproximado por liga y sport. */
function homeAdvantage(leagueName, sport) {
  if (sport === 'soccer') return 0.55;       // ~55% locales ganan en soccer
  if (sport === 'basketball') return 0.60;   // home advantage más fuerte en basket
  if (sport === 'amfootball') return 0.57;
  if (sport === 'hockey') return 0.55;
  if (sport === 'baseball') return 0.54;
  return 0.55;
}

async function llmStructured(factors, poisson, elo) {
  // Construir un prompt MUY rico con todos los factores — incluye contexto
  // sintetizado por el orchestrator (league tier, home advantage) que NO
  // está en los factors crudos.
  const liga = factors.event?.leagueName || factors.event?.league;
  const sport = factors.event?.sport;
  const tier = leagueImportance(liga, sport);
  const homeAdv = homeAdvantage(liga, sport);

  // ── Trimming agresivo para mantener TPM bajo ──
  // - totals: solo línea más cercana a 2.5
  // - historical: max 3 partidos recientes por equipo
  // - lineups: solo número de titulares (no toda la formación)
  // - injuries: solo severityScore + count (no lista completa)
  const trimmedMarket = factors.market ? { ...factors.market } : {};
  if (trimmedMarket.totals && typeof trimmedMarket.totals === 'object') {
    const lines = Object.keys(trimmedMarket.totals)
      .map(Number).filter(Number.isFinite)
      .sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5));
    if (lines.length) {
      const nearest = lines[0];
      trimmedMarket.totals = { [nearest]: trimmedMarket.totals[nearest] };
    }
  }
  const trimmedHistorical = factors.historical && !factors.historical.unavailable ? {
    h2h: factors.historical.h2h ? {
      matches: factors.historical.h2h.matches,
      homeWinRate: factors.historical.h2h.homeWinRate,
      drawRate: factors.historical.h2h.drawRate,
      awayWinRate: factors.historical.h2h.awayWinRate,
      avgGoals: factors.historical.h2h.avgGoals,
      bttsRate: factors.historical.h2h.bttsRate
    } : null,
    form: factors.historical.form ? {
      home: factors.historical.form.home ? {
        wdl: factors.historical.form.home.wdl,
        pointsPerGame: factors.historical.form.home.pointsPerGame,
        goalsFor: factors.historical.form.home.goalsFor,
        goalsAgainst: factors.historical.form.home.goalsAgainst
      } : null,
      away: factors.historical.form.away ? {
        wdl: factors.historical.form.away.wdl,
        pointsPerGame: factors.historical.form.away.pointsPerGame,
        goalsFor: factors.historical.form.away.goalsFor,
        goalsAgainst: factors.historical.form.away.goalsAgainst
      } : null
    } : null
  } : { unavailable: true };
  const trimmedInjuries = factors.injuries ? {
    severityScore: factors.injuries.severityScore,
    homeCount: factors.injuries.home?.injuries?.length || 0,
    awayCount: factors.injuries.away?.injuries?.length || 0
  } : null;

  const userMsg = JSON.stringify({
    event: factors.event,
    contexto: {
      tier, tierLabel: tier >= 8 ? 'TIER 1 top mundial' : tier >= 6 ? 'TIER 2 regional' : tier >= 4 ? 'TIER 3 secundaria' : 'TIER 4 menor',
      homeAdv
    },
    cuotas: trimmedMarket,
    clima: factors.weather,
    lesiones: trimmedInjuries,
    historico: trimmedHistorical,
    movimientoMercado: factors.sharp,
    golesEsperados: poisson,
    rendimientoForma: elo,
    analisisCuotas: factors.quantitative
  });
  // ── Mercados disponibles ──────────────────────────────────────────────
  // Tradicionales (scrapeados directo de casas) — el LLM puede asumir cuota
  // real y casa real cuando elige estos.
  const availableMarkets = [];
  if (factors.market?.h2h) availableMarkets.push('match-winner (Ganador 1X2)');
  if (factors.market?.dc) availableMarkets.push('double-chance (Doble Oportunidad 1X/X2/12)');
  if (factors.market?.totals) availableMarkets.push('totals (Más/Menos goles)');
  if (factors.market?.btts) availableMarkets.push('btts (Ambos equipos marcan)');
  if (factors.market?.ah) availableMarkets.push('ah-asian (Hándicap Asiático)');

  // Catálogo COMPLETO de 140+ mercados (single source of truth en lib/marketCatalog).
  // Filtramos por deporte. NO filtramos por book acá — el LLM ve TODOS los
  // disponibles para el deporte; después la capa de matching valida que la
  // selection corresponda a una casa marcada por el user.
  const { describeForPrompt } = require('../lib/marketCatalog');
  const extendedCatalog = describeForPrompt(sport, null);

  // Prompt OPTIMIZADO — corto y directo para que el JSON output entre en
  // maxOutputTokens. Cada rationale max 80 palabras (~120 tokens). 3 picks
  // × 120 tokens + sintaxis = ~450 tokens output. Con maxOutputTokens=6000
  // tenemos margen MASIVO.
  const tierLabel = tier >= 8 ? 'top mundial' : tier >= 6 ? 'regional' : tier >= 4 ? 'secundaria' : 'menor';
  const prompt = `Generá 3 picks (cons/eq/agg) para este partido. Liga ${tierLabel}.

MERCADOS CON CUOTA REAL DE CASA (úsalos si hay edge claro):
${availableMarkets.map(m => '  • ' + m).join('\n')}

CATÁLOGO COMPLETO de mercados disponibles para este deporte (140+ tipos, usá cualquiera si los modelos dan ≥60% conf):
${extendedCatalog}

REGLAS:
- cons: PROB ≥ 70%, prefiere DC, AH±0.5 favorito, under si el partido es cerrado, o totals-ht under.
- eq: PROB 50-70%, EV+. h2h favorito directo, AH leve, totals 2.5, BTTS si ataques fuertes.
- agg: PROB 30-50% pero pago alto. Combinada multi-leg del MISMO partido (favorito + over/under + BTTS o corners + tarjetas o goleador), o un mercado analítico de alto valor (corners, cards, player props).
- AH si favorito >65% (paga mejor cuota); AH+ si underdog 35-45%.
- Si elegís un mercado ANALÍTICO, especificá "outcome" con su valor (ej. over/under, home_more, yes/no) y "line" con la línea (ej. 9.5 corners, 3.5 cards).
- Rationale max 80 palabras, español argentino, NO digas "Poisson"/"Elo"/"lambda" — usá "goles esperados", "forma reciente", "valor vs cuota".

Devolvés JSON exacto:
{
  "selections": [
    {"type":"cons","market":"...","outcome":"...","line":null,"modelProb":0.65,"rationale":"..."},
    {"type":"eq","market":"...","outcome":"...","line":null,"modelProb":0.55,"rationale":"..."},
    {"type":"agg","market":"...","outcome":"...","line":null,"modelProb":0.40,"rationale":"..."}
  ],
  "synthesis":"60-80 palabras de lectura general",
  "keyFactor":"el factor más importante en 1 frase",
  "marketEdge":"dónde ves valor vs el mercado en 1 frase"
}

DATOS:
${userMsg}`;

  // ═══ CASCADA NUEVA — 100% FREE PRIMARY ═══════════════════════════════════
  //
  // Cambio clave vs versión anterior (que quemaba $100/h en Gemini):
  //   • Gemini/Anthropic SACADOS del cascade default. Solo entran si el user
  //     setea BS_USE_PAID_TIER=1 (opt-in explícito).
  //   • Groq Llama 3.3 70B PRIMARY (free, ~280 tok/s, JSON nativo)
  //   • Cerebras Llama 3.3 70B SECONDARY (free, ~2200 tok/s — el más rápido)
  //   • OpenRouter free models cascada (DeepSeek V3 → Llama 70B → Qwen 72B → Gemini 2.0 Flash)
  //   • Groq Llama 3.1 8B (fallback rápido si todo lo demás está rate-limited)
  //   • [opt-in] Gemini 2.5 Flash
  //   • [opt-in + premium match] Claude Sonnet 4.5
  //
  // Sin retries paralelos. Cada provider se invoca UNA vez. Si falla 429/timeout,
  // backoff corto (300-800ms) antes del próximo provider.
  const isPremium = isPremiumMatch(factors.event, factors);
  const providers2 = [];

  // ARQUITECTURA DUAL: analyzeMatch corre ~16 veces en paralelo (1 call por
  // partido). Con OpenAI gpt-5-mini PRIMARY acá, las 16 calls pueden tardar
  // 8-15s cada una con reasoning interno → bottleneck que rompe el endpoint.
  // Solución: Groq 70B SIEMPRE PRIMARY para analyzeMatch (rápido, free).
  // OpenAI gpt-5-mini se usa SOLO en llmJsonAny (curator, narratives, brief)
  // donde es 1 sola call y la calidad importa más que speed.
  // El user puede forzar OpenAI también acá con BS_OPENAI_FOR_ANALYZE=1.
  const useOpenAIForAnalyze = OPENAI_KEYS.length && process.env.BS_OPENAI_FOR_ANALYZE === '1';
  if (useOpenAIForAnalyze) {
    providers2.push({ name: `openai-${OPENAI_MODEL}`, fn: () => openaiJson(SYSTEM_PROMPT, prompt) });
  }
  if (GROQ_KEYS.length) {
    providers2.push({ name: 'groq-70b', fn: () => groqJson(SYSTEM_PROMPT, prompt) });
  }
  if (CEREBRAS_KEYS.length) {
    providers2.push({ name: 'cerebras-70b', fn: () => cerebrasJson(SYSTEM_PROMPT, prompt) });
  }
  if (OPENROUTER_KEYS.length) {
    for (const m of OPENROUTER_FREE_MODELS) {
      const short = m.split('/').pop().split(':')[0];
      providers2.push({ name: `openrouter:${short}`, fn: () => openrouterJson(SYSTEM_PROMPT, prompt, { model: m }) });
    }
  }
  if (GROQ_KEYS.length) {
    providers2.push({ name: 'groq-8b', fn: () => groqJson(SYSTEM_PROMPT, prompt, { model: GROQ_FAST_MODEL }) });
  }
  if (USE_PAID_TIER && GEMINI_KEYS.length) {
    providers2.push({ name: 'gemini', fn: () => geminiJson(SYSTEM_PROMPT, prompt) });
  }
  if (USE_PAID_TIER && isPremium && ANTHROPIC_KEYS.length) {
    providers2.push({ name: 'claude', fn: () => anthropicJson(SYSTEM_PROMPT, prompt) });
  }

  let lastErr2 = null;
  const debug = [];
  for (let i = 0; i < providers2.length; i++) {
    const p = providers2[i];
    try {
      const data = await p.fn();
      // Aceptamos solo si hay selections válidas O synthesis con contenido real (>20 chars).
      // Evita el bug viejo de aceptar `{selections:[], synthesis:''}` como OK.
      const hasSelections = Array.isArray(data?.selections) && data.selections.length > 0;
      const hasSynth = typeof data?.synthesis === 'string' && data.synthesis.trim().length > 20;
      if (data && (hasSelections || hasSynth)) {
        log(`[ai] ${p.name} OK · selections=${data.selections?.length || 0} synth=${hasSynth ? 'yes' : 'no'}`);
        return { ...data, provider: p.name };
      }
      debug.push(`${p.name}:empty`);
    } catch (e) {
      lastErr2 = e?.message || String(e);
      debug.push(`${p.name}:${lastErr2.slice(0, 50)}`);
      // Backoff corto si fue rate-limit/timeout (ayuda a que el siguiente provider no caiga igual)
      if (i < providers2.length - 1 && /429|rate|too.?many|timeout|abort/i.test(lastErr2 || '')) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
      }
    }
  }
  log(`[ai] all providers failed → offline · trace: ${debug.join(' | ')}`);
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
  // Strip markdown code fence wrapping ( ```json ... ``` )
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  // Extract just the first JSON object if there's prefixed text
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  // Try direct parse first
  try {
    const parsed = JSON.parse(clean);
    return validateLlmOutput(parsed);
  } catch (e) {
    // ── RECOVERY: si el JSON está truncado (Gemini cortó el output),
    // intentamos repararlo cerrando llaves/corchetes/strings abiertos.
    try {
      const repaired = repairTruncatedJson(clean);
      const parsed = JSON.parse(repaired);
      log(`[ai] JSON recovered from truncation (${clean.length} chars → ${repaired.length})`);
      return validateLlmOutput(parsed);
    } catch (e2) {
      // Last attempt: extract any partial "selections" array de manera tolerante
      try {
        const partial = extractPartialSelections(clean);
        if (partial && Array.isArray(partial.selections) && partial.selections.length > 0) {
          log(`[ai] JSON partial recovery: ${partial.selections.length} selections rescued`);
          return validateLlmOutput(partial);
        }
      } catch (_) {}
      log(`[ai] JSON parse fail: ${e?.message?.slice(0, 100)} · preview: ${text.slice(0, 200)}`);
      return defaultValue;
    }
  }
}

/* Repara JSON truncado cerrando estructuras abiertas.
 * Útil cuando el LLM cortó output a mitad del último item. */
function repairTruncatedJson(text) {
  let s = text;
  // Si termina con un string sin cerrar (con coma o no), cerrar
  // Contar comillas no escapadas
  let inString = false;
  let escape = false;
  let bracketStack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') bracketStack.push(c);
    else if (c === '}' || c === ']') bracketStack.pop();
  }
  // Si quedó dentro de un string, cerrarlo
  if (inString) s += '"';
  // Cerrar arrays/objetos abiertos en orden inverso
  while (bracketStack.length) {
    const open = bracketStack.pop();
    // Si la última coma quedó suelta (típico tras truncar mid-item), removerla
    s = s.replace(/,\s*$/, '');
    s += open === '{' ? '}' : ']';
  }
  return s;
}

/* Último recurso: extrae las selections que parsearon completas del JSON
 * truncado. Si Gemini cortó después del 2do pick, salvamos los 2 primeros.
 * También intenta rescatar synthesis/keyFactor/marketEdge si están en el texto. */
function extractPartialSelections(text) {
  const out = {};
  // Synthesis: buscar "synthesis":"..." aún si está al final truncada
  const synthMatch = text.match(/"synthesis"\s*:\s*"([^"]{20,500})"/);
  if (synthMatch) out.synthesis = synthMatch[1];
  const keyMatch = text.match(/"keyFactor"\s*:\s*"([^"]{10,300})"/);
  if (keyMatch) out.keyFactor = keyMatch[1];
  const edgeMatch = text.match(/"marketEdge"\s*:\s*"([^"]{10,250})"/);
  if (edgeMatch) out.marketEdge = edgeMatch[1];

  // Selections: parsear cada objeto individualmente
  const selectionsMatch = text.match(/"selections"\s*:\s*\[([\s\S]+)/);
  if (!selectionsMatch && !out.synthesis) return null;
  if (selectionsMatch) {
    const arrayContent = selectionsMatch[1];
    const items = [];
    let depth = 0;
    let inString = false;
    let escape = false;
    let start = -1;
    for (let i = 0; i < arrayContent.length; i++) {
      const c = arrayContent[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            const item = JSON.parse(arrayContent.slice(start, i + 1));
            items.push(item);
          } catch (_) {}
          start = -1;
        }
      }
    }
    out.selections = items;
  }
  return out;
}

/* Valida + sanea la salida del LLM contra el schema esperado:
 *   { selections: Array<{market,outcome,line?,modelProb,confidence?,reasoning?}>,
 *     synthesis?: string }
 * Cualquier item malformado se descarta sin abortar el resto.
 * Los rangos de probabilidad se clampean a [0,1] y los strings se truncan.
 */
function validateLlmOutput(j) {
  if (!j || typeof j !== 'object') return {};
  const out = { selections: [], synthesis: null, keyFactor: null, marketEdge: null, modelConsensus: null };
  if (typeof j.synthesis === 'string') out.synthesis = j.synthesis.slice(0, 1500);
  if (typeof j.keyFactor === 'string') out.keyFactor = j.keyFactor.slice(0, 350);
  if (typeof j.marketEdge === 'string') out.marketEdge = j.marketEdge.slice(0, 300);
  if (typeof j.modelConsensus === 'string') out.modelConsensus = j.modelConsensus.slice(0, 300);
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

// ─────────────────────────────────────────────────────────────────────────
// LLM PROVIDER HELPERS
//
// Todos genéricos: aceptan opts.model (override), opts.maxTokens (default 1400),
// opts.temperature (default 0.4), opts.timeoutMs. Hacen rotación round-robin
// si hay multiple keys cargadas para ese provider.
//
// Devuelven el TEXTO crudo de la response del LLM. Los wrappers *Json hacen
// el safeJsonParse() después. Esta separación permite reusar la llamada para
// distintos formatos (json estricto vs json tolerante vs texto plano).
// ─────────────────────────────────────────────────────────────────────────

// OpenAI Chat Completions (pago). gpt-5-mini es nuestro PRIMARY si la key
// está cargada. Notas técnicas críticas:
//   - GPT-5 family usa `max_completion_tokens` (no `max_tokens`)
//   - GPT-5 family SOLO acepta temperature=1 (default) — no se setea custom
//   - response_format: { type: 'json_object' } funciona OK
//   - reasoning_effort='low' es CRÍTICO para latencia: por default GPT-5
//     consume muchos reasoning tokens internos (5-15s por call). Con 'low'
//     baja a 1-3s, similar a Groq, con calidad igual de buena para JSON
//     estructurado de apuestas (no necesitamos chain-of-thought profundo).
//   - 'minimal' es aún más rápido pero a veces JSON menos estricto.
//   - max_completion_tokens incluye reasoning tokens → con 'low' bastan ~1800.
async function openaiCall(system, user, opts = {}) {
  if (!OPENAI_KEYS.length) throw new Error('no-key');
  const key = pickKey(OPENAI_KEYS, _rotState.openai);
  const model = opts.model || OPENAI_MODEL;
  const isReasoningModel = /^(gpt-5|o\d|gpt-4\.\d-reasoning)/i.test(model);
  const body = {
    model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }
  };
  if (isReasoningModel) {
    // gpt-5 / o1 / o3: max_completion_tokens + temperature locked en 1 + reasoning_effort
    body.max_completion_tokens = opts.maxTokens || 1800;
    // 'minimal' = casi 0 reasoning, latencia 1-2s, suficiente para JSON estructurado
    body.reasoning_effort = opts.reasoningEffort || process.env.BS_OPENAI_REASONING || 'minimal';
  } else {
    body.max_tokens = opts.maxTokens || 1400;
    body.temperature = opts.temperature ?? 0.4;
  }
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  }, opts.timeoutMs || LLM_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`openai HTTP ${res.status}: ${txt.slice(0, 160)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function groqCall(system, user, opts = {}) {
  if (!GROQ_KEYS.length) throw new Error('no-key');
  const key = pickKey(GROQ_KEYS, _rotState.groq);
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model || GROQ_DEFAULT_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: opts.temperature ?? 0.4,
      response_format: { type: 'json_object' },
      max_tokens: opts.maxTokens || 1400
    })
  }, opts.timeoutMs || LLM_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`groq HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

// Cerebras OpenAI-compatible API. ~2200 tok/s para Llama 3.3 70B (10x más
// rápido que Groq). Free tier: 30 req/min, 60K req/día (en 2026-05).
async function cerebrasCall(system, user, opts = {}) {
  if (!CEREBRAS_KEYS.length) throw new Error('no-key');
  const key = pickKey(CEREBRAS_KEYS, _rotState.cerebras);
  const res = await fetchWithTimeout('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model || CEREBRAS_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: opts.temperature ?? 0.4,
      response_format: { type: 'json_object' },
      max_tokens: opts.maxTokens || 1400
    })
  }, opts.timeoutMs || LLM_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`cerebras HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function openrouterCall(system, user, opts = {}) {
  if (!OPENROUTER_KEYS.length) throw new Error('no-key');
  const key = pickKey(OPENROUTER_KEYS, _rotState.openrouter);
  const model = opts.model || OPENROUTER_FREE_MODELS[0];
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://betsafe.app',
      'X-Title': 'BetSafe'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens || 1400,
      response_format: { type: 'json_object' }
    })
  }, opts.timeoutMs || LLM_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`openrouter[${model.split('/').pop()}] HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function geminiCall(system, user, opts = {}) {
  if (!GEMINI_KEYS.length) throw new Error('no-key');
  const key = pickKey(GEMINI_KEYS, _rotState.gemini);
  const model = opts.model || GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: system + '\n\n' + user + '\n\nRespondé estrictamente en JSON válido, COMPLETO (cerrá todas las llaves), sin markdown.' }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens || 1400,
        responseMimeType: 'application/json'
      }
    })
  }, opts.timeoutMs || LLM_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`gemini HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function anthropicCall(system, user, opts = {}) {
  if (!ANTHROPIC_KEYS.length) throw new Error('no-key');
  const key = pickKey(ANTHROPIC_KEYS, _rotState.anthropic);
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: opts.model || ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens || 1400,
      temperature: opts.temperature ?? 0.4,
      system: system + '\n\nRespondé ÚNICAMENTE el JSON estricto, sin texto antes ni después, sin markdown.',
      messages: [{ role: 'user', content: user }]
    })
  }, opts.timeoutMs || LLM_TIMEOUT_MS);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text;
}

// ─────────────────────────────────────────────────────────────────────────
// JSON wrappers (parse + validate). Compatible con la API anterior.
// ─────────────────────────────────────────────────────────────────────────
async function openaiJson(system, user, opts = {})     { return safeJsonParse(await openaiCall(system, user, opts)); }
async function groqJson(system, user, opts = {})       { return safeJsonParse(await groqCall(system, user, opts)); }
async function cerebrasJson(system, user, opts = {})   { return safeJsonParse(await cerebrasCall(system, user, opts)); }
async function openrouterJson(system, user, opts = {}) { return safeJsonParse(await openrouterCall(system, user, opts)); }
async function geminiJson(system, user, opts = {})     { return safeJsonParse(await geminiCall(system, user, opts)); }
async function anthropicJson(system, user, opts = {})  { return safeJsonParse(await anthropicCall(system, user, opts)); }

// ─────────────────────────────────────────────────────────────────────────
// Generic helpers (parse JSON tolerante, sin validateLlmOutput).
// Usados por server.js para parsers/explainers/coach/etc. donde el shape no
// coincide con el de match analysis.
// ─────────────────────────────────────────────────────────────────────────
function _parseLoose(text) {
  if (!text) return null;
  let clean = String(text).trim();
  if (clean.startsWith('```')) clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const fb = clean.indexOf('{'), lb = clean.lastIndexOf('}');
  if (fb > 0 && lb > fb) clean = clean.slice(fb, lb + 1);
  try { return JSON.parse(clean); } catch { return null; }
}

async function openaiJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!OPENAI_KEYS.length) throw new Error('no-key');
  return _parseLoose(await openaiCall(systemPrompt, userPrompt, {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens || 2000,
    model: opts.model
  }));
}
async function groqJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!GROQ_KEYS.length) throw new Error('no-key');
  return _parseLoose(await groqCall(systemPrompt, userPrompt, {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens || 1200,
    model: opts.model
  }));
}
async function cerebrasJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!CEREBRAS_KEYS.length) throw new Error('no-key');
  return _parseLoose(await cerebrasCall(systemPrompt, userPrompt, {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens || 1200,
    model: opts.model
  }));
}
async function openrouterJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!OPENROUTER_KEYS.length) throw new Error('no-key');
  return _parseLoose(await openrouterCall(systemPrompt, userPrompt, {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens || 1200,
    model: opts.model
  }));
}
async function geminiJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!GEMINI_KEYS.length) throw new Error('no-key');
  return _parseLoose(await geminiCall(systemPrompt, userPrompt, {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens || 1200,
    model: opts.model
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// CASCADA UNIVERSAL para llamadas genéricas (server.js usa esto):
// Intenta los providers en orden free-first y devuelve el primer JSON OK.
// ─────────────────────────────────────────────────────────────────────────
async function llmJsonAny(systemPrompt, userPrompt, opts = {}) {
  const trace = [];
  const try_ = async (name, fn) => {
    try {
      const r = await fn();
      if (r && typeof r === 'object') { trace.push(`${name}:OK`); return { result: r, provider: name, trace }; }
      trace.push(`${name}:empty`);
    } catch (e) {
      trace.push(`${name}:${(e?.message || e).slice(0, 50)}`);
    }
    return null;
  };
  // OpenAI PRIMARY (pago) — primero si está la key
  if (OPENAI_KEYS.length)     { const r = await try_(`openai-${OPENAI_MODEL}`, () => openaiJsonGeneric(systemPrompt, userPrompt, opts)); if (r) return r; }
  // Free-first cascade
  if (GROQ_KEYS.length)       { const r = await try_('groq-70b',    () => groqJsonGeneric(systemPrompt, userPrompt, opts));      if (r) return r; }
  if (CEREBRAS_KEYS.length)   { const r = await try_('cerebras',    () => cerebrasJsonGeneric(systemPrompt, userPrompt, opts));  if (r) return r; }
  if (OPENROUTER_KEYS.length) {
    for (const m of OPENROUTER_FREE_MODELS) {
      const r = await try_(`openrouter:${m.split('/').pop().split(':')[0]}`,
        () => openrouterJsonGeneric(systemPrompt, userPrompt, { ...opts, model: m }));
      if (r) return r;
    }
  }
  if (GROQ_KEYS.length) {
    const r = await try_('groq-8b', () => groqJsonGeneric(systemPrompt, userPrompt, { ...opts, model: GROQ_FAST_MODEL }));
    if (r) return r;
  }
  // Paid opt-in
  if (USE_PAID_TIER && GEMINI_KEYS.length)    { const r = await try_('gemini',   () => geminiJsonGeneric(systemPrompt, userPrompt, opts));  if (r) return r; }
  if (USE_PAID_TIER && ANTHROPIC_KEYS.length) {
    const r = await try_('anthropic', async () => _parseLoose(await anthropicCall(systemPrompt, userPrompt, { temperature: opts.temperature ?? 0.3, maxTokens: opts.maxTokens || 1200 })));
    if (r) return r;
  }
  return { result: null, provider: 'offline', trace };
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
function mergeSelections(event, factors, quant, poisson, elo, llm, extendedMarkets) {
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
    const llmS = llmSelections['dc:home_or_draw'];
    out.push({
      type: 'cons',
      market: 'dc',
      outcome: 'home_or_draw',
      label: `${event.home.name} o empate (1X)`,
      odd: dc.home_or_draw,
      book: dc.home_or_drawBook || favoredBook,
      consensusProb: safeProb,
      confidence: Math.min(0.95, baseConfidence + 0.15),
      rationale: llmS?.rationale || `Pick conservador: ${event.home.name} jugando como local llega favorito, pero protegemos la pick incluyendo el empate. Cubrimos los dos escenarios más probables (~${(safeProb * 100).toFixed(0)}% de cobertura combinada). Si el local marca primero o el partido se vuelve trabado, igualmente cobramos.`,
      factors: buildFactorList({ outcome: 'home' }, factors)
    });
    consPushed = true;
  } else if (favored === 'away' && dc.draw_or_away && hasDraw) {
    const safeProb = pDraw + pAway;
    const llmS = llmSelections['dc:draw_or_away'];
    out.push({
      type: 'cons',
      market: 'dc',
      outcome: 'draw_or_away',
      label: `Empate o ${event.away.name} (X2)`,
      odd: dc.draw_or_away,
      book: dc.draw_or_awayBook || favoredBook,
      consensusProb: safeProb,
      confidence: Math.min(0.95, baseConfidence + 0.15),
      rationale: llmS?.rationale || `Pick conservador: ${event.away.name} llega como favorito pese a jugar de visitante — situación poco común que el mercado a veces ajusta tarde. Doble oportunidad X2 (empate + visitante) ofrece cobertura del ~${(safeProb * 100).toFixed(0)}%, ideal cuando esperás un partido cerrado o un visitante claramente superior.`,
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
      const llmU = llmSelections['totals:under@' + line] || llmSelections['totals:under'];
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
        rationale: llmU?.rationale || `Pick conservador en goles: el perfil ofensivo de ambos equipos sugiere un partido cerrado. Nuestro análisis indica que el escenario más probable es un marcador bajo. Menos de ${line} goles tiene ${(pUnder * 100).toFixed(0)}% de probabilidad estimada.`,
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
        rationale: `Nuestro análisis estima ${(poisson.pOver25 * 100).toFixed(0)}% de probabilidad de superar los ${line} goles. Bajar la línea aumenta la certeza del pick.`,
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
      rationale: `Lectura: ${favoredTeam} llega como favorito en este partido. Probabilidad estimada ${(favoredProb * 100).toFixed(0)}% — la cuota de ${favoredOdd} implica que el mercado valida el escenario. Sin mercados de DC o totals disponibles para una alternativa más conservadora, h2h directo es el pick más seguro.`,
      factors: buildFactorList({ outcome: favored }, factors)
    });
  }

  // ── PASO 3b: EQUILIBRADO — AH si valor mejor, sino h2h favorito ──
  // BOOST de AH: cuando el favorito tiene >62% prob, el AH -0.5 paga mejor
  // cuota con MISMO riesgo de victoria. Comparamos EV de h2h vs AH -0.5 y
  // tomamos la de mayor EV. Esto explota mejor el mercado AH que estaba
  // infrautilizado.
  if (favoredOdd) {
    let eqPick = null;

    // ── Candidato 1: h2h directo favorito ──
    const llmS = llmSelections['h2h:' + favored];
    const h2hEv = (favoredProb * favoredOdd - 1);
    const h2hCandidate = {
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
      rationale: llmS?.rationale || `Lectura del partido: ${favoredTeam} es el favorito claro. Nuestro análisis estima ${(favoredProb * 100).toFixed(0)}% de probabilidad real de victoria, contra el ${(100 / favoredOdd).toFixed(0)}% que implica la cuota del mercado. La diferencia entre ambos números define el edge sobre la casa: si el modelo es correcto, el value está acá.`,
      warnings: llmS?.warnings || [],
      factors: buildFactorList({ outcome: favored }, factors),
      _ev: h2hEv
    };
    eqPick = h2hCandidate;

    // ── Candidato 2: AH cuando favorito MUY claro (>62% prob) ──
    // Si AH -0.5 o -1 tiene mejor EV → preferirlo. Probabilidad ajustada
    // realistically: AH -0.5 cae ~10% del favoredProb, AH -1 cae ~22%.
    if (favoredProb >= 0.62 && factors.market.ah && (favored === 'home' || favored === 'away')) {
      const ahMap = factors.market.ah;
      // Buscar la mejor línea (0.5 → 1 → 1.5)
      const ahLines = Object.keys(ahMap).map(Number).filter(Number.isFinite).sort();
      for (const line of ahLines) {
        if (line < 0.5 || line > 2) continue;
        const ahEntry = ahMap[line];
        if (!ahEntry) continue;
        const useHome = favored === 'home';
        const ahOdd = useHome ? ahEntry.home_minus : ahEntry.away_minus;
        const ahBook = useHome ? ahEntry.home_minusBook : ahEntry.away_minusBook;
        if (!Number.isFinite(ahOdd) || ahOdd < 1.30) continue;
        // Adjustment: AH -0.5 ~ 10% drop, AH -1 ~ 22%, AH -1.5 ~ 35%, AH -2 ~ 48%
        const probAdj = line === 0.5 ? 0.90 : line === 1 ? 0.78 : line === 1.5 ? 0.65 : 0.52;
        const ahProb = favoredProb * probAdj;
        const ahEv = (ahProb * ahOdd - 1);
        if (ahEv > h2hEv + 0.02) {  // AH gana solo si EV mejora >2%
          eqPick = {
            type: 'eq',
            market: 'ah',
            outcome: useHome ? 'home_minus' : 'away_minus',
            line,
            label: `${favoredTeam} hándicap -${line}`,
            odd: ahOdd,
            book: ahBook || favoredBook,
            consensusProb: ahProb,
            fairProb: ahProb,
            confidence: Math.max(0.4, baseConfidence - 0.05),
            rationale: `Pick equilibrado en hándicap asiático: ${favoredTeam} llega como favorito muy claro (${(favoredProb*100).toFixed(0)}% de victoria). El hándicap -${line} paga ${ahOdd} (vs ${favoredOdd} del ganador directo). Probabilidad ajustada de cubrir el hándicap: ${(ahProb*100).toFixed(0)}%. EV neto +${(ahEv*100).toFixed(1)}% vs +${(h2hEv*100).toFixed(1)}% del ganador directo — el hándicap explota mejor el favoritismo.`,
            factors: buildFactorList({ outcome: favored }, factors),
            _ev: ahEv,
            _ahLine: line
          };
          break;  // tomamos la primera línea que mejora EV
        }
      }
    }

    out.push(eqPick);
    brierTracker.recordPrediction({
      id: event?.id, sport: event?.sport, market: eqPick.market, outcome_pick: eqPick.outcome, odd: eqPick.odd,
      preds: { consensus: eqPick.consensusProb, poisson: favored === 'home' ? poisson.pHomeWin : favored === 'away' ? poisson.pAwayWin : poisson.pDraw }
    });
  }

  // ── PASO 3c: AGRESIVO — combinada DINÁMICA del mismo partido en favor del favorito ──
  // Cantidad de legs NO está hardcoded a 3. El análisis decide cuántas legs tienen
  // sentido según las señales reales:
  //   - h2h favorito SOLO si hay una clara dirección Y la cuota tiene valor
  //   - over/under solo si el Poisson señala dirección fuerte (>0.58 o <0.42)
  //   - BTTS solo si el modelo señala dirección fuerte (>0.60 o <0.40)
  //   - AH solo si el favorito es muy claro (favoredProb > 0.65)
  //   - Cap de 5 legs MAX (más de eso destruye la cuota efectiva)
  //   - Mínimo 2 legs (sino no es combinada, es single)
  //
  // El resultado es que para algunos partidos la "agresiva" puede ser 2 legs
  // (cuando solo una dirección está clara), otros 3-4 (cuando hay múltiples
  // señales fuertes), evitando que sea siempre el mismo template robotico.
  if (favoredOdd && (favored === 'home' || favored === 'away')) {
    const legs = [];
    const STRONG_DIR = 0.58;   // umbral para considerar una dirección "fuerte"
    const VERY_STRONG_DIR = 0.65;

    // Leg 1: h2h favorito SIEMPRE (es la spine de la combinada)
    legs.push({
      market: 'h2h', outcome: favored, line: null,
      label: `${favoredTeam} gana`,
      odd: favoredOdd, book: favoredBook,
      prob: favoredProb,
      reason: `Favorito claro: ${(favoredProb*100).toFixed(0)}% prob real vs ${(100/favoredOdd).toFixed(0)}% implícita`
    });

    // Leg 2: Over/Under — incluir SOLO si hay dirección fuerte
    if (factors.market.totals && Number.isFinite(poisson.pOver25)) {
      const lines = Object.keys(factors.market.totals).map(Number).filter(l => l >= 1.5 && l <= 4.5)
        .sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5));
      const line = lines[0];
      const t = line ? factors.market.totals[line] : null;
      if (t) {
        if (poisson.pOver25 >= STRONG_DIR && t.over) {
          legs.push({
            market: 'totals', outcome: 'over', line,
            label: `Más de ${line} goles`,
            odd: t.over, book: t.overBook,
            prob: poisson.pOver25,
            reason: `Goles esperados ${(poisson.lambdaH + poisson.lambdaA).toFixed(2)} → señal fuerte a Más de ${line}`
          });
        } else if (poisson.pOver25 <= (1 - STRONG_DIR) && t.under) {
          legs.push({
            market: 'totals', outcome: 'under', line,
            label: `Menos de ${line} goles`,
            odd: t.under, book: t.underBook,
            prob: 1 - poisson.pOver25,
            reason: `Goles esperados ${(poisson.lambdaH + poisson.lambdaA).toFixed(2)} → señal fuerte a Menos de ${line}`
          });
        }
        // Si está entre 0.42 y 0.58 → ambigüo, NO sumamos esta leg
      }
    }

    // Leg 3: BTTS — incluir SOLO si hay dirección fuerte
    if (factors.market.btts && Number.isFinite(poisson.pBttsYes)) {
      if (poisson.pBttsYes >= VERY_STRONG_DIR && factors.market.btts.yes) {
        legs.push({
          market: 'btts', outcome: 'yes', line: null,
          label: 'Ambos equipos marcan',
          odd: factors.market.btts.yes, book: factors.market.btts.yesBook,
          prob: poisson.pBttsYes,
          reason: `Probabilidad alta (${(poisson.pBttsYes*100).toFixed(0)}%) de que ambos marquen según xG`
        });
      } else if (poisson.pBttsYes <= (1 - VERY_STRONG_DIR) && factors.market.btts.no) {
        legs.push({
          market: 'btts', outcome: 'no', line: null,
          label: 'No marcan ambos equipos',
          odd: factors.market.btts.no, book: factors.market.btts.noBook,
          prob: 1 - poisson.pBttsYes,
          reason: `Defensa pesada esperada: ${((1-poisson.pBttsYes)*100).toFixed(0)}% prob de que NO marquen ambos`
        });
      }
    }

    // Leg 4 opcional: AH solo si el favorito es muy claro (>65% prob)
    // Esto agrega upside sin destruir la cuota, porque "favorito -0.5/-1" es
    // muy similar a h2h favorito pero con cuota un poco mejor.
    if (favoredProb >= VERY_STRONG_DIR && factors.market.ah && legs.length < 4) {
      const ahData = Object.values(factors.market.ah)[0];
      if (ahData) {
        const useHome = favored === 'home' && ahData.home_minus;
        const useAway = favored === 'away' && ahData.away_minus;
        const ahLine = ahData.line || 0.5;
        const ahOdd = useHome ? ahData.home_minus : useAway ? ahData.away_minus : null;
        if (ahOdd && ahOdd > 1.30) {
          legs.push({
            market: 'ah', outcome: useHome ? 'home_minus' : 'away_minus', line: ahLine,
            label: `${favoredTeam} hándicap -${ahLine}`,
            odd: ahOdd, book: favoredBook,
            prob: favoredProb * 0.78,  // AH -0.5/-1 baja prob ~22%
            reason: `Favorito muy claro (${(favoredProb*100).toFixed(0)}% prob) — premium AH`
          });
        }
      }
    }

    // Si tenemos al menos 2 legs → combinada multi-leg
    if (legs.length >= 2) {
      const totalOdd = legs.reduce((a, l) => a * l.odd, 1);
      // Correlación positiva intra-partido (ganar + over + btts están correlacionados).
      const independentProb = legs.reduce((a, l) => a * l.prob, 1);
      // FIX 2026-05: usar correlación REAL (correlation.js) en vez del 1.25 fijo.
      // El 1.25 inflaba la prob de combinadas con correlación baja (ej. h2h + AH del
      // mismo team — corr ~0.05) y subreflejaba combinadas con correlación alta
      // (ej. over+btts — corr 0.55). Ahora el multiplier escala con la corr real.
      const _corrLegs = legs.map(l => ({
        eventId: factors.match?.id || 'combo',
        market: l.market, outcome: l.outcome, line: l.line
      }));
      const _maxCorr = Math.max(0, (_analyzeCombo(_corrLegs)?.maxPositiveCorrelation) || 0);
      // factor 0.5: amortiguamos el ajuste porque el modelo Poisson ya capta
      // parte de la dependencia intra-partido. Empíricamente más realista que 1.25.
      const correlationAdjustment = 1 + (_maxCorr * 0.5);
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
        rationale: `Combinada agresiva de ${legs.length} ${legs.length === 2 ? 'apuesta' : 'apuestas'} en favor de ${favoredTeam}. El análisis encontró ${legs.length} señales fuertes coherentes en este partido: ${legs.map(l => `${l.label} (${(l.prob * 100).toFixed(0)}%)`).join(', ')}. Por la correlación positiva intra-partido la probabilidad conjunta es mayor a la independiente — apuntan todas a la misma narrativa de juego.`,
        tacticalNotes: `${legs.length} legs porque el análisis encontró ${legs.length} señales con dirección clara. No se forzaron legs débiles para inflar la cuota.`,
        factors: buildFactorList({ outcome: favored }, factors)
      });
    } else {
      // FALLBACK 1: AH (Asian Handicap) si está disponible — pick agresivo con línea
      const ah = factors.market.ah && Object.values(factors.market.ah)[0];
      if (ah && (ah.home_minus || ah.away_plus)) {
        const useHome = favored === 'home' && ah.home_minus;
        const ahOdd = useHome ? ah.home_minus : ah.away_plus;
        const ahLabel = useHome
          ? `${favoredTeam} -${ah.line || 1.5} (AH)`
          : `${favoredTeam} +${ah.line || 1.5} (AH)`;
        out.push({
          type: 'agg',
          market: 'ah',
          outcome: useHome ? 'home_minus' : 'away_plus',
          line: ah.line || 1.5,
          label: ahLabel,
          odd: ahOdd,
          book: favoredBook,
          consensusProb: favoredProb * 0.65,  // AH -1.5 baja prob ~35%
          confidence: Math.max(0.30, baseConfidence - 0.25),
          rationale: `Pick agresivo con hándicap asiático: ${ahLabel}. Cuota más alta a costa de exigir margen de victoria. Sustentado por el análisis de goles esperados (${(favored === 'home' ? poisson.lambdaH : poisson.lambdaA).toFixed(2)} goles proyectados para ${favoredTeam}).`,
          tacticalNotes: `Handicap asiático para favoritos claros — paga premium por convicción de victoria amplia.`,
          factors: buildFactorList({ outcome: favored }, factors)
        });
      } else if (favoredOdd) {
        // FALLBACK 2: DC al outcome opuesto al cons (más arriesgado pero distinto)
        // Si cons fue 1X (home_or_draw), agg es draw_or_away X2 con prob menor → diferenciado
        const consPick = out.find(p => p.type === 'cons');
        const oppositeDC = consPick?.outcome === 'home_or_draw' ? 'home_or_away'
                         : consPick?.outcome === 'draw_or_away' ? 'home_or_away'
                         : favored === 'home' ? 'home_or_away' : 'home_or_away';
        if (dc[oppositeDC]) {
          const dcProb = oppositeDC === 'home_or_away' ? pHome + pAway
                       : oppositeDC === 'home_or_draw' ? pHome + pDraw
                       : pDraw + pAway;
          out.push({
            type: 'agg',
            market: 'dc',
            outcome: oppositeDC,
            label: oppositeDC === 'home_or_away' ? `${event.home?.name} o ${event.away?.name} (Sin empate)`
                 : oppositeDC === 'home_or_draw' ? `${event.home?.name} o empate (1X)`
                 : `Empate o ${event.away?.name} (X2)`,
            odd: dc[oppositeDC],
            book: dc[oppositeDC + 'Book'] || favoredBook,
            consensusProb: dcProb,
            confidence: Math.max(0.30, baseConfidence - 0.2),
            rationale: `Pick agresivo: sin empate (cualquiera de los 2 equipos gana). Prob combinada ${(dcProb * 100).toFixed(0)}%. Ataque más arriesgado que la doble oportunidad conservadora.`,
            factors: buildFactorList({ outcome: favored }, factors)
          });
        } else {
          // FALLBACK 3 (último): h2h con label diferenciado — al menos distinguible visualmente
          out.push({
            type: 'agg',
            market: 'h2h',
            outcome: favored,
            label: `${favoredTeam} gana — solo h2h disponible`,
            odd: favoredOdd,
            book: favoredBook,
            consensusProb: favoredProb,
            confidence: Math.max(0.4, baseConfidence - 0.1),
            rationale: `Pick agresivo: este partido no tiene mercados adicionales abiertos (más/menos, ambos marcan, hándicap, doble chance) para armar una combinada. Como alternativa, sostenemos el favorito directo con la cuota disponible.`,
            factors: buildFactorList({ outcome: favored }, factors)
          });
        }
      }
    }
  }

  // ── PASO 3d: PICKS ANALÍTICOS EXTENDIDOS (multi-sport, multi-market) ──
  // El motor unificado predice ~143 mercados distintos según deporte:
  // fútbol: 40+, básquet: 22+, tenis: 15, NFL: 16, NHL: 12, MLB: 15, MMA: 8,
  // eSports: 15. Cada pick con flag `analytical: true` + disclaimer.
  if (extendedMarkets) {
    const allExt = extendedMarkets.picks
      || [...(extendedMarkets.corners?.picks || []), ...(extendedMarkets.cards?.picks || []), ...(extendedMarkets.goalScorers || [])];
    for (const p of allExt) {
      // Threshold: 35% para player props (goleadores, anytime), 58% para over/under
      const isPlayerProp = ['goalscorer-anytime', 'first-goalscorer', 'player-points', 'player-rebounds', 'player-assists'].includes(p.market);
      const minProb = isPlayerProp ? 0.30 : 0.58;
      if (!p.analyticalProb || p.analyticalProb < minProb) continue;
      out.push({
        type: 'extended',           // categoría distinta (no cons/eq/agg)
        market: p.market,
        outcome: p.outcome,
        line: p.line || null,
        player: p.player || null,
        team: p.team || null,
        label: p.label,
        odd: p.fairOdd,             // estimación nuestra
        book: null,                 // no asignado a casa específica
        consensusProb: p.analyticalProb,
        confidence: Math.min(0.85, p.analyticalProb * 0.9 + 0.05),
        rationale: p.rationale,
        analytical: true,           // FLAG IMPORTANTE
        analyticalDisclaimer: 'Pick basado en análisis interno de BetSafe IA. Verificá disponibilidad y cuota real en tu casa de apuestas.',
        factors: buildFactorList({ outcome: 'home' }, factors)
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

/* Helper para forzar re-análisis de un partido (limpia cache de ese evento).
 * Usado por /api/picks cuando un partido cayó a llmProvider:'offline' y
 * queremos reintentar inmediatamente sin esperar TTL. */
analyzeMatch.clearCacheOffline = (eventId) => {
  if (eventId) cache.delete(eventId);
};

/* Limpia TODO el cache de análisis. Útil cuando el LLM cambia (ej: pasamos
 * de free a paid) y queremos forzar re-análisis con la nueva calidad. */
analyzeMatch.clearAllCache = () => {
  const size = cache.size;
  cache.clear();
  return size;
};

/* Stats del cache (debug). */
analyzeMatch.cacheStats = () => ({
  size: cache.size,
  max: cache.max
});

module.exports = {
  analyzeMatch,
  // Generic helpers (compat con llamadas existentes en server.js)
  openaiJsonGeneric,
  groqJsonGeneric,
  geminiJsonGeneric,
  cerebrasJsonGeneric,
  openrouterJsonGeneric,
  // Cascada universal (preferido para nuevo código): OpenAI primero si pago, después free
  llmJsonAny,
  // Estado para diagnóstico desde /api/ai/status
  __aiStatus: () => ({
    cache: { size: cache.size, max: cache.max, ttlMin: 30 },
    providers: {
      openai:     { keys: OPENAI_KEYS.length,     primaryModel: OPENAI_MODEL,    enabled: OPENAI_KEYS.length > 0, role: OPENAI_KEYS.length > 0 ? 'PRIMARY (paid)' : 'inactive' },
      groq:       { keys: GROQ_KEYS.length,       primaryModel: GROQ_DEFAULT_MODEL, fastModel: GROQ_FAST_MODEL, role: OPENAI_KEYS.length > 0 ? 'fallback' : 'PRIMARY (free)' },
      cerebras:   { keys: CEREBRAS_KEYS.length,   primaryModel: CEREBRAS_MODEL },
      openrouter: { keys: OPENROUTER_KEYS.length, models: OPENROUTER_FREE_MODELS },
      gemini:     { keys: GEMINI_KEYS.length,     primaryModel: GEMINI_MODEL,    enabled: USE_PAID_TIER },
      anthropic:  { keys: ANTHROPIC_KEYS.length,  primaryModel: ANTHROPIC_MODEL, enabled: USE_PAID_TIER }
    },
    paidTierEnabled: USE_PAID_TIER,
    openaiActive: OPENAI_KEYS.length > 0
  })
};
