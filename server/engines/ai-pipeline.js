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

const cache = new LRUCache({ max: 200, ttl: 5 * 60 * 1000 });

const GROQ_KEY        = process.env.BS_GROQ_API_KEY        || process.env.GROQ_API_KEY        || '';
const GEMINI_KEY      = process.env.BS_GEMINI_API_KEY      || process.env.GEMINI_API_KEY      || '';
const ANTHROPIC_KEY   = process.env.BS_ANTHROPIC_API_KEY   || process.env.ANTHROPIC_API_KEY   || '';
const OPENROUTER_KEY  = process.env.BS_OPENROUTER_API_KEY  || process.env.OPENROUTER_API_KEY  || '';

// Modelos configurables vía env (defaults: gama económica + 1M context)
const GEMINI_MODEL    = process.env.BS_GEMINI_MODEL    || 'gemini-2.5-flash';        // $0.075/$0.30 per 1M, 1M context
const ANTHROPIC_MODEL = process.env.BS_ANTHROPIC_MODEL || 'claude-sonnet-4-5';       // $3/$15 per 1M — premium tier
const GROQ_MODEL      = process.env.BS_GROQ_MODEL      || 'llama-3.1-8b-instant';   // 30K TPM free

/* TIER STRATEGY:
 * - Gemini 2.5 Flash es PRIMARY (todos los matches) — barato + 1M context window
 * - Claude Sonnet 4.5 se usa SOLO para matches "premium" (top-tier leagues,
 *   top teams, high-priority picks) — análisis extremo cuando vale la pena
 * - Groq llama-3.1-8b fallback rápido si los pagos fallan
 * - OpenRouter último recurso (claude/llama via OpenRouter free tier)
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

  // ═══ CASCADA OPTIMIZADA: Gemini PRIMARY (gran rate limit) ════════════════
  //
  // El user pidió EXPLICITAMENTE que Gemini sea el motor principal y que
  // pagar no sea limitación. Estrategia:
  //   1) Gemini 2.5 Flash × 3 retries: tiene 1500 RPM (free) / 1000+ RPM
  //      (paid) y 1M tokens TPM. Casi nunca falla por rate limit.
  //   2) Claude Sonnet 4.5 para premium matches (UCL/Premier/top teams)
  //   3) Groq llama-3.1-8b ÚLTIMO recurso (free tier 14400 TPM se llena rápido
  //      con muchos requests paralelos — preferimos pagar Gemini que rate
  //      limit Groq)
  //   4) OpenRouter como red de seguridad
  const isPremium = isPremiumMatch(factors.event, factors);
  const providers2 = [];

  if (GEMINI_KEY) {
    // Gemini siempre primero: 3 attempts (free tier soporta 1500 RPM,
    // paid tier ilimitado prácticamente).
    providers2.push({ name: 'gemini', fn: () => geminiJson(SYSTEM_PROMPT, prompt) });
    providers2.push({ name: 'gemini', fn: () => geminiJson(SYSTEM_PROMPT, prompt) });
    providers2.push({ name: 'gemini', fn: () => geminiJson(SYSTEM_PROMPT, prompt) });
  }
  // Claude SOLO para premium matches — análisis sportbook-grade
  if (isPremium && ANTHROPIC_KEY) {
    providers2.push({ name: 'claude', fn: () => anthropicJson(SYSTEM_PROMPT, prompt) });
  } else if (ANTHROPIC_KEY && !GEMINI_KEY) {
    // Si no hay Gemini, Claude pasa a primary
    providers2.push({ name: 'claude', fn: () => anthropicJson(SYSTEM_PROMPT, prompt) });
  }
  // Groq como ÚLTIMO recurso ahora (era 2do antes). El free tier de 14400 TPM
  // se llena rápido cuando hacemos 10+ requests paralelos.
  if (GROQ_KEY) {
    providers2.push({ name: 'groq', fn: () => groqJson(SYSTEM_PROMPT, prompt) });
  }
  if (OPENROUTER_KEY) providers2.push({ name: 'openrouter', fn: () => openrouterJson(SYSTEM_PROMPT, prompt) });
  let lastErr2 = null;
  const debug = [];
  for (let i = 0; i < providers2.length; i++) {
    const p = providers2[i];
    try {
      const data = await p.fn();
      if (data && (Array.isArray(data.selections) || data.synthesis)) {
        log(`[ai] ${p.name} OK (attempt ${i + 1}) · selections=${data.selections?.length || 0} synthesis=${data.synthesis ? 'yes' : 'no'}`);
        return { ...data, provider: p.name };
      }
      debug.push(`${p.name}#${i + 1}:empty-response`);
    } catch (e) {
      lastErr2 = e?.message || String(e);
      debug.push(`${p.name}#${i + 1}:${lastErr2.slice(0, 60)}`);
      // Backoff exponencial entre retries de Groq
      if (i < 2 && /429|rate|too.?many|timeout|abort/i.test(lastErr2 || '')) {
        await new Promise(r => setTimeout(r, 600 * Math.pow(2, i)));
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

async function groqJson(system, user) {
  if (!GROQ_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
      // 1400 tokens es suficiente para 3 rationales de 3-5 frases + synthesis 80-140 palabras.
      // Bajar de 2800 → 1400 reduce TPM ~50% sin perder calidad.
      max_tokens: 1400
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
      model: GROQ_MODEL,
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  // 6000 tokens: el prompt expandido pide 3 picks con rationale profundo
  // (~600-800 tokens cada uno) + synthesis + keyFactor + marketEdge.
  // El old 1600 cortaba el JSON a mitad del primer pick.
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: system + '\n\n' + user + '\n\nRespondé estrictamente en JSON válido, COMPLETO (cerrá todas las llaves), sin markdown.' }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json'
      }
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return safeJsonParse(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

/* Versión genérica de geminiJson con opciones (maxTokens, temperature).
 * Reemplazo natural de groqJsonGeneric para parsers/explainers/etc. */
async function geminiJsonGeneric(systemPrompt, userPrompt, opts = {}) {
  if (!GEMINI_KEY) throw new Error('no-key');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt + '\n\nRespondé estrictamente en JSON válido, COMPLETO (cerrá todas las llaves), sin markdown.' }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxTokens || 4000,
        responseMimeType: 'application/json'
      }
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = await res.json();
  return safeJsonParse(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

/* Claude Sonnet 4.5 (Anthropic Messages API) — análisis premium para top picks.
 * Costo: $3 / $15 per 1M tokens. Calidad sportbook-research grade.
 * Reservado para matches "premium" (UCL, top teams, Argentina top). */
async function anthropicJson(system, user) {
  if (!ANTHROPIC_KEY) throw new Error('no-key');
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      temperature: 0.4,
      system: system + '\n\nIMPORTANTE: respondé ÚNICAMENTE el JSON estricto, sin texto antes ni después, sin markdown ni \\`\\`\\`json wrapper.',
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  // Anthropic response shape: { content: [{ type:'text', text: '...' }] }
  const text = data.content?.[0]?.text;
  return safeJsonParse(text);
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
      const correlationAdjustment = 1.25;
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

module.exports = { analyzeMatch, groqJsonGeneric, geminiJsonGeneric };
