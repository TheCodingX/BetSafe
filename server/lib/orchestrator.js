/* BetSafe — Orquestador agnóstico a la fuente
 * ============================================================================
 * Reescrito para usar adapter pattern. Antes corría 12 scrapers directos;
 * ahora corre N "sources" donde cada source implementa SourceBase.fetch().
 *
 * Sources estándar:
 *   - OddsApiSource          (priority 1, primaria)
 *   - 12 × ScraperSource     (priority 2-4, según si cubre casa única)
 *
 * Cuando dos sources aportan al mismo (event, book, market, outcome),
 * dispara cross-validation y loguea discrepancias.
 *
 * Output igual al anterior: events Map con markets organizados por book.
 * ============================================================================
 */
'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');
const { log, eventKey, normalizeTeam, isFinite2 } = require('./index');
const pLimit = require('p-limit').default;

const { OddsApiSource } = require('../sources/oddsapi');
const { createAllScraperSources } = require('../sources/scrapers');
const { SofaScoreSource } = require('../sources/sofascore');
const { EspnSource } = require('../sources/espn');
const { findDiscrepancies, DiscrepancyLog, recordContributor } = require('../engines/cross-validation');

// Estado interno
const state = {
  events: new Map(),
  prev: new Map(),
  surebets: [],
  steam: [],
  sourceStatus: {},
  cycles: 0,
  lastCycleMs: 0,
  startedAt: Date.now(),
  running: false,
  timer: null,
  cfg: null,
  sources: [],
  discrepancyLog: new DiscrepancyLog(500),
  oddsApiQuota: { remaining: null, used: null }
};

const bus = new EventEmitter();

// ── ID estable por evento ──────────────────────────────────────────────────
function makeEventId(home, away, start) {
  const k = eventKey(home, away, start);
  return crypto.createHash('md5').update(k).digest('hex').slice(0, 16);
}

/* contributorMap por evento — clave: eventKey, valor: Map<bookMarketOutcome, contributors[]>
 * Se llena durante el ciclo y se usa al final para detectar discrepancias. */
const cycleContributors = new Map();

// ── Merge de un evento (de cualquier fuente) ──────────────────────────────
// targetMap permite pasar el newEvents del ciclo en curso, manteniendo
// state.events intacto hasta que el swap atómico ocurre al final.
function mergeEventFromSource(sourceName, ev, targetMap) {
  const map = targetMap || state.events;
  if (!ev?.home?.name || !ev?.away?.name) return;
  // Descartar eventos con start inválido (NaN propagaría a eventKey)
  if (ev.start != null && !Number.isFinite(ev.start)) ev.start = null;
  // Dedup robusto: primero intentamos match exacto por start; si no encontramos
  // y el event llega con start=null (typical de SofaScore/ESPN sin hora),
  // re-intentamos contra un event existente con mismos teams y start≠null
  // (asumimos que es el mismo partido y enriquecemos en lugar de duplicar).
  let key = eventKey(ev.home.name, ev.away.name, ev.start);
  let existing = map.get(key);
  if (!existing && ev.start == null) {
    const teamHash = eventKey(ev.home.name, ev.away.name, null).split('|')[0];
    for (const [k, v] of map) {
      if (k.startsWith(teamHash) && v.start != null) {
        // Aceptamos como mismo evento si el match es razonablemente único
        // (mismo par de teams normalizados → probabilidad de colisión ínfima
        // dentro de la ventana del scraping cycle).
        key = k;
        existing = v;
        break;
      }
    }
  }
  if (!existing) {
    existing = {
      id: makeEventId(ev.home.name, ev.away.name, ev.start),
      home: normalizeTeam(ev.home.name),
      away: normalizeTeam(ev.away.name),
      league: ev.league || null,
      leagueName: ev.leagueName || null,
      sport: ev.sport || 'soccer',
      start: ev.start || null,
      markets: {
        h2h: {}, totals: {}, btts: {}, dc: {}, ah: {},
        // Markets extendidos 2026-05-17 (por ahora solo Bplay los popula,
        // pero el schema queda preparado para otros scrapers).
        dnb: {}, 'ht-result': {}, 'totals-ht': {},
        'exact-score': {}, 'corners-total': {}, 'cards-total': {}
      },
      bestOdds: null,
      lastUpdate: Date.now(),
      sources: []
    };
    map.set(key, existing);
  }
  if (ev.league && !existing.league) existing.league = ev.league;
  if (ev.leagueName && !existing.leagueName) existing.leagueName = ev.leagueName;
  if (ev.start && !existing.start) existing.start = ev.start;

  // contributor map para cross-validation
  if (!cycleContributors.has(key)) cycleContributors.set(key, new Map());
  const contrib = cycleContributors.get(key);

  const m = ev.markets || {};
  // Cada market viene en formato { bookKey: { ... } }
  for (const [marketName, marketByBook] of Object.entries(m)) {
    if (!marketByBook || typeof marketByBook !== 'object') continue;
    for (const [bookKey, marketData] of Object.entries(marketByBook)) {
      if (!marketData) continue;

      // Sanitizamos SIEMPRE antes de mergear/grabar. Esto garantiza que
      // isFinite2 se aplique sin importar la fuente (oddsapi o scraper).
      const sanitized = sanitizeMarket(marketName, marketData);
      const previousValue = existing.markets[marketName]?.[bookKey];
      if (previousValue) {
        // Cross-validation: registramos para detectar discrepancias entre fuentes
        registerContributors(contrib, sourceName, marketName, bookKey, sanitized);
        // Preservamos el primer valor para no introducir lag artificial
        existing.markets[marketName][bookKey] = mergeMarketData(previousValue, sanitized);
      } else {
        existing.markets[marketName][bookKey] = sanitized;
        registerContributors(contrib, sourceName, marketName, bookKey, sanitized);
      }
    }
  }

  if (!existing.sources.includes(sourceName)) existing.sources.push(sourceName);
  existing.lastUpdate = Date.now();
}

function registerContributors(contribMap, sourceName, marketName, bookKey, marketData) {
  if (!marketData) return;
  if (marketName === 'h2h') {
    ['home', 'draw', 'away'].forEach(o => recordContributor(contribMap, sourceName, marketName, bookKey, o, marketData[o]));
  } else if (marketName === 'btts') {
    ['yes', 'no'].forEach(o => recordContributor(contribMap, sourceName, marketName, bookKey, o, marketData[o]));
  } else if (marketName === 'totals') {
    for (const [line, sides] of Object.entries(marketData)) {
      if (!sides || typeof sides !== 'object') continue;
      recordContributor(contribMap, sourceName, marketName, bookKey, 'over', sides.over, line);
      recordContributor(contribMap, sourceName, marketName, bookKey, 'under', sides.under, line);
    }
  } else if (marketName === 'dc') {
    ['home_or_draw', 'draw_or_away', 'home_or_away'].forEach(o => recordContributor(contribMap, sourceName, marketName, bookKey, o, marketData[o]));
  } else if (marketName === 'ah') {
    // AH: si tiene line, lo incluimos como parte del outcome key
    const line = marketData.line != null ? marketData.line : 0;
    recordContributor(contribMap, sourceName, marketName, bookKey, 'home_minus', marketData.home_minus, line);
    recordContributor(contribMap, sourceName, marketName, bookKey, 'away_plus', marketData.away_plus, line);
  }
}

/* Combina dos market data del MISMO book preservando el valor más fresco
 * (asumimos que `b` es más reciente porque llegó después en el ciclo).
 * En el caso de objetos anidados (totals.{line}) se hace merge recursivo
 * shallow para no perder líneas que solo aparecen en una fuente.
 */
function mergeMarketData(a, b) {
  if (!b) return a;
  if (!a) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v == null) continue;
    if (typeof v === 'object' && typeof out[k] === 'object' && out[k] !== null) {
      // Objetos anidados (e.g. totals[line] = {over, under, line}): merge profundo
      out[k] = { ...out[k], ...v };
    } else {
      // Valores escalares: el más nuevo gana (B siempre prevalece)
      out[k] = v;
    }
  }
  return out;
}

function sanitizeMarket(marketName, data) {
  if (marketName === 'h2h') return sanitizeH2h(data);
  if (marketName === 'btts') return sanitizeBtts(data);
  if (marketName === 'totals') return sanitizeTotals(data);
  if (marketName === 'dc') return sanitizeDc(data);
  if (marketName === 'ah') return sanitizeAh(data);
  // Markets extendidos (2026-05-17): nuevo grupo de mercados reales scrapeados
  if (marketName === 'dnb') return sanitizeDnb(data);
  if (marketName === 'ht-result') return sanitizeH2h(data);              // mismo shape {home, draw?, away}
  if (marketName === 'totals-ht') return sanitizeTotals(data);           // mismo shape {line: {over, under}}
  if (marketName === 'exact-score') return sanitizeExactScore(data);
  if (marketName === 'corners-total') return sanitizeTotals(data);       // {line: {over, under}}
  if (marketName === 'cards-total') return sanitizeTotals(data);         // {line: {over, under}}
  return data;
}

function sanitizeDnb(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  if (isFinite2(o.home)) out.home = round2(o.home);
  if (isFinite2(o.away)) out.away = round2(o.away);
  return (out.home || out.away) ? out : null;
}

function sanitizeExactScore(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  for (const [score, odd] of Object.entries(o)) {
    // Validar formato "N-M" (ej "1-0", "2-1") y odd numérico
    if (/^\d{1,2}-\d{1,2}$/.test(score) && isFinite2(odd) && odd > 1.01) {
      out[score] = round2(odd);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/* AH puede llegar en dos formatos:
 *   1. Plano: { line, home_minus, away_plus }                         (Kambi, Codere)
 *   2. Por línea: { "-1.5": { line, home_minus, away_plus }, ... }    (raro)
 * Normalizamos a formato 1 (única línea principal por book) preservando solo
 * datos finitos. Si llegan varias líneas se preserva la primera válida.
 */
function sanitizeAh(o) {
  if (!o || typeof o !== 'object') return null;
  // Formato 1
  if ('line' in o || 'home_minus' in o || 'away_plus' in o) {
    const out = {};
    if (Number.isFinite(o.line)) out.line = o.line;
    if (isFinite2(o.home_minus)) out.home_minus = round2(o.home_minus);
    if (isFinite2(o.away_plus))  out.away_plus  = round2(o.away_plus);
    return (out.home_minus || out.away_plus) ? out : null;
  }
  // Formato 2: tomar la primera línea con ambas patas válidas
  for (const [line, sides] of Object.entries(o)) {
    const n = Number(line);
    if (!Number.isFinite(n) || !sides) continue;
    if (isFinite2(sides.home_minus) && isFinite2(sides.away_plus)) {
      return { line: n, home_minus: round2(sides.home_minus), away_plus: round2(sides.away_plus) };
    }
  }
  return null;
}
function sanitizeH2h(o) {
  const out = {};
  if (isFinite2(o.home)) out.home = round2(o.home);
  if (isFinite2(o.draw)) out.draw = round2(o.draw);
  if (isFinite2(o.away)) out.away = round2(o.away);
  return out;
}
function sanitizeBtts(o) {
  const out = {};
  if (isFinite2(o.yes)) out.yes = round2(o.yes);
  if (isFinite2(o.no))  out.no  = round2(o.no);
  return out;
}
function sanitizeDc(o) {
  const out = {};
  if (isFinite2(o.home_or_draw)) out.home_or_draw = round2(o.home_or_draw);
  if (isFinite2(o.draw_or_away)) out.draw_or_away = round2(o.draw_or_away);
  if (isFinite2(o.home_or_away)) out.home_or_away = round2(o.home_or_away);
  return out;
}
function sanitizeTotals(o) {
  const out = {};
  for (const [line, sides] of Object.entries(o)) {
    const numLine = Number(line);
    if (!Number.isFinite(numLine)) continue;
    const s = {};
    if (sides && isFinite2(sides.over)) s.over = round2(sides.over);
    if (sides && isFinite2(sides.under)) s.under = round2(sides.under);
    if (s.over || s.under) {
      s.line = numLine;
      out[numLine] = s;
    }
  }
  return out;
}
function round2(n) { return Math.round(n * 100) / 100; }

// ── Compute "best odds" cross-book ─────────────────────────────────────────
function computeBest(eventsIterable) {
  for (const ev of eventsIterable) {
    const bestH = bestSide(ev.markets.h2h, 'home');
    const bestA = bestSide(ev.markets.h2h, 'away');
    const bestD = bestSide(ev.markets.h2h, 'draw');
    const bestYes = bestSide(ev.markets.btts, 'yes');
    const bestNo = bestSide(ev.markets.btts, 'no');
    const totals = {};
    const linesUnion = new Set();
    Object.values(ev.markets.totals).forEach(byLine => Object.keys(byLine).forEach(l => linesUnion.add(Number(l))));
    linesUnion.forEach(line => {
      let bo = 0, boBook = null, bu = 0, buBook = null;
      Object.entries(ev.markets.totals).forEach(([book, byLine]) => {
        const s = byLine[line];
        if (!s) return;
        if (s.over > bo) { bo = s.over; boBook = book; }
        if (s.under > bu) { bu = s.under; buBook = book; }
      });
      if (bo || bu) totals[line] = { line, over: bo || null, overBook: boBook, under: bu || null, underBook: buBook };
    });
    ev.bestOdds = {
      h2h: (bestH.v || bestA.v) ? {
        home: bestH.v || null, homeBook: bestH.book,
        draw: bestD.v || null, drawBook: bestD.book,
        away: bestA.v || null, awayBook: bestA.book
      } : null,
      btts: (bestYes.v || bestNo.v) ? {
        yes: bestYes.v || null, yesBook: bestYes.book,
        no:  bestNo.v || null,  noBook:  bestNo.book
      } : null,
      totals: Object.keys(totals).length ? totals : null
    };
    if (ev.bestOdds?.h2h) {
      const odds = [ev.bestOdds.h2h.home, ev.bestOdds.h2h.draw, ev.bestOdds.h2h.away].filter(Boolean);
      ev.overround = odds.reduce((a, b) => a + 1 / b, 0);
    }
  }
}
function bestSide(byBook, side) {
  let bv = 0, bk = null;
  Object.entries(byBook).forEach(([book, m]) => {
    if (m[side] && m[side] > bv) { bv = m[side]; bk = book; }
  });
  return { v: bv || null, book: bk };
}

// ── Surebet detection ──────────────────────────────────────────────────────
/* Sanity caps (mismos que arbEngine):
 *   - ROI > 25%  → data error puro, no emitir
 *   - ROI > 12%  → "palpable error" — la casa lo anularía. Excluido del feed.
 *   - ROI < 0.1% → ruido numérico, no emitir
 *
 * Además, descartamos surebets donde TODAS las patas son del mismo book
 * (no es arb real — la misma casa cerraría una pata al instante o son
 * cuotas stale del mismo snapshot). El motor `arbEngine` ya filtra esto en
 * los detectores específicos, pero este path simple del orchestrator
 * (que computa h2h sobre bestOdds.h2h) carecía del check. */
const ROI_MIN = 0.001;
const ROI_PALPABLE_CAP = 0.12;
const ROI_SUSPICIOUS_CAP = 0.25;

function detectSurebets(eventsIterable) {
  const out = [];
  const seen = new Set();        // dedup intra-ciclo por eventId+market
  for (const ev of eventsIterable) {
    if (!ev.bestOdds?.h2h) continue;
    // Solo surebets de ligas relevantes para nuestra audiencia AR.
    // Sin esto, el feed de surebets se llenaba de LMB mexicano + semipro.
    if (!isRelevantLeague(ev.leagueName)) continue;
    const h = ev.bestOdds.h2h.home, d = ev.bestOdds.h2h.draw, a = ev.bestOdds.h2h.away;
    const odds = d ? [h, d, a] : [h, a];
    if (odds.some(o => !Number.isFinite(o) || o <= 1.01)) continue;

    const books = d ? [ev.bestOdds.h2h.homeBook, ev.bestOdds.h2h.drawBook, ev.bestOdds.h2h.awayBook]
                     : [ev.bestOdds.h2h.homeBook, ev.bestOdds.h2h.awayBook];

    // Requerimos AL MENOS 2 books distintos en las patas. Si las 2/3 patas
    // vienen del mismo book, no es arb real — la casa nunca pagaría ambas.
    const uniqueBooks = new Set(books.filter(Boolean));
    if (uniqueBooks.size < 2) continue;

    const sum = odds.reduce((s, o) => s + 1 / o, 0);
    if (sum >= 1) continue;
    const roi = 1 / sum - 1;
    if (roi < ROI_MIN) continue;
    // Filtra outliers: data error o palpable error que la casa anularía.
    if (roi > ROI_SUSPICIOUS_CAP) continue;
    const palpableErrorRisk = roi > ROI_PALPABLE_CAP;

    const dedupKey = `${ev.id}|h2h`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    out.push({
      eventId: ev.id,
      event: `${ev.home.name} vs ${ev.away.name}`,
      sport: ev.sport,
      league: ev.league,
      leagueName: ev.leagueName,
      start: ev.start,
      market: 'h2h',
      outcomes: d ? ['home','draw','away'] : ['home','away'],
      odds,
      books,
      roi: Number((roi * 100).toFixed(3)),
      palpableErrorRisk,
      ts: Date.now()
    });
  }
  out.sort((a, b) => b.roi - a.roi);
  return out;
}

// ── Steam move detection ──────────────────────────────────────────────────
function detectSteam(prev, current) {
  const out = [];
  current.forEach((ev, key) => {
    const old = prev.get(key);
    if (!old?.bestOdds?.h2h || !ev.bestOdds?.h2h) return;
    ['home','draw','away'].forEach(side => {
      const o1 = old.bestOdds.h2h[side];
      const o2 = ev.bestOdds.h2h[side];
      if (!o1 || !o2) return;
      const deltaPct = ((o2 - o1) / o1) * 100;
      const absDelta = Math.abs(deltaPct);
      if (absDelta >= 5) {
        out.push({
          eventId: ev.id,
          event: `${ev.home.name} vs ${ev.away.name}`,
          market: 'h2h',
          side,
          from: o1,
          to: o2,
          deltaPct: Number(deltaPct.toFixed(2)),
          // 'sharp' real: solo movimientos grandes (>=8%) son indicios fuertes
          // de sharp money. Entre 5-8% es ruido de mercado normal.
          sharp: absDelta >= 8,
          ts: Date.now()
        });
      }
    });
  });
  return out;
}

// ── API pública del orchestrator ──────────────────────────────────────────

/* Whitelist de ligas — STRICT.
 * AI Picks + Generator analizan eventos a través de este helper. Sin filtro
 * estricto la IA traía "Premier League Egipto", "Ucraniana Premier", "Saudi",
 * "Israelí", "A-League Australia" — basura para audiencia AR.
 *
 * Estrategia: matchear PATRONES POSITIVOS + EXCLUIR países/regiones obscuros
 * por NEGATIVE list. Si la liga matchea positive Y no matchea negative → pasa.
 * Pasar `{ all: true }` para bypass (debug). */
const RELEVANT_LEAGUE_PATTERNS = [
  // Argentina + Sudamérica (LO MÁS RELEVANTE para audiencia AR)
  /\b(liga profesional|primera nacional|primera division)\b/i,
  /\b(libertadores|sudamericana|recopa)\b/i,
  /\b(brasileir.o|copa do brasil|serie b.*brasil)\b/i,
  /\b(copa argentina|liga profesional argentina)\b/i,
  /\b(liga betplay|liga ?pro|liga ?1|categoria primera)\b/i,
  /\b(copa america|copa mundial|world cup|mundial 2026)\b/i,
  // Top 5 europeas — WHITELIST permisiva; el blocklist excluye Egipto/Ucrania/etc.
  /\b(premier league|championship|fa cup|carabao cup|efl)\b/i,
  /\b(la ?liga|primera division|copa del rey)\b/i,
  /\b(serie a|serie b|coppa italia)\b/i,
  /\b(bundesliga|dfb pokal|dfb-pokal)\b/i,
  /\b(ligue 1|ligue 2|coupe de france)\b/i,
  /\b(primeira liga|liga portuguesa|primeira divisao)\b/i,
  /\b(eredivisie|netherlands|holanda)\b/i,
  // UEFA + selecciones
  /\b(champions league|uefa champions|europa league|uefa europa|conference league|uefa nations)\b/i,
  /\b(eurocopa|euro 2024|euro 2028|euro qualif|world cup qualif)\b/i,
  // USA top + MLS (no NLF / NWSL / lower divisions)
  /\b(\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bmls\b|major league soccer)\b/i,
  // Tennis Grand Slam / ATP / WTA
  /\b(\batp\b|\bwta\b|grand slam|wimbledon|us open|australian open|french open|roland garros)\b/i,
  // MMA/UFC + Boxing top
  /\b(\bufc\b|\bmma\b|\bpfl\b|bellator|world boxing|wba|wbc|wbo|ibf)\b/i,
  // Top basketball Europa
  /\b(euroleague|eurocup)\b/i,
  /\b(liga nacional.*basket|argentina.*basket|liga nacional argentina)\b/i,
  // Mexico Liga MX (top tier solamente)
  /\b(mexico liga mx|liga mx\b|primera division.*mex)\b/i,
  // eSports — torneos top que se ofertan en casas argentinas
  /\b(csgo|cs2|cs:go|counter-?strike|iem|esl pro|blast premier|epl s\d|major)\b/i,
  /\b(league of legends|\blol\b|worlds|lec|lck|lcs|lpl|lla|lja|msi)\b/i,
  /\b(dota ?2?|the international|dpc)\b/i,
  /\b(valorant|vct|vlr)\b/i,
  /\b(esports?|e-sports?)\b/i,
  /\b(efootball pro|fifa esports|king of glory)\b/i
];

/* NEGATIVE list — countries/regions que vetamos aunque matcheen positive.
 * Cubre los partidos basura que el user reportó: Egipto, Ucrania, Saudi,
 * Israel, semipro australiano, ligas obscuras asiáticas, etc.
 *
 * AGRESIVO ahora: matchea TANTO el nombre del equipo como el nombre de la liga.
 * Importante: "Premier League" matchea el whitelist genérico, así que
 * necesitamos blocklist específico por país para excluir Ukrainian Premier
 * League, Egyptian Premier League, Israeli Premier League, etc. */
const BLOCKED_LEAGUE_PATTERNS = [
  // ── Países completos (bloqueados de cualquier deporte) ──
  /\b(egipto|egypt|egyptian|egyptien)\b/i,
  /\b(ucrani[ao]|ukrain[eai])\b/i,
  /\b(arabia|saudi|saudi arabia|saudita)\b/i,
  /\b(israel|israel[ií]|israeli)\b/i,
  // Sudamerica: dejamos pasar (Bplay/Betano cubren Libertadores, Sudamericana, ligas top)
  /\b(australia[no]?|a-league|aleague|a[-\s]?league)\b/i,
  /\b(canberra|canad[áa]|canadian|canadien|canadiense|cpl)\b/i,
  /\b(quebec|que[bs]ec)\b/i,
  /\b(japan|jap[óo]n|j-?league|j1|j2|j3)\b/i,
  /\b(china|chinese|csl|cba)\b/i,
  /\b(korea|south korea|coreano|coreana|k-?league)\b/i,
  /\b(india|indian|\bisl\b)\b/i,
  /\b(thailand|thai|\bt1\b)\b/i,
  /\b(iran|iranian|persian)\b/i,
  /\b(uae|emirate|emiratos|qatar|qatari|kuwait|bahrain|oman|om[áa]n|omani)\b/i,
  /\b(africa cup|caf|tunisia|tunis|tunisian|tunecino|morocco|moroccan|algeria|algerian|nigeria|south africa|kenia|kenya|kenyan|ghana|ghanaian)\b/i,
  /\b(scandinav|finland|finnish|sweden|swedish|norway|norweg|denmark|danish|iceland|icelandic)\b/i,
  /\b(poland|polish|polski|czech|romanian|hungar|bulgar|serbia|serbian|croatia|croatian|slovak|bosnia|bosnian)\b/i,
  /\b(belarus|bielo|kazakh|moldov|georgia|georgian|armenian|azerb)\b/i,
  /\b(greece|greek|cyprus|cypriot|stoiximan|super league.*gre|turkey|turkish|super lig\b)\b/i,
  /\b(belgium|belgian|jupiler|swiss|switzerland|austria|austrian|bundesliga.*aut)\b/i,
  /\b(scotland|scottish|spfl|spl|premiership.*scot|cymru|welsh|northern ireland)\b/i,
  /\b(eire|ireland|irish|league of ireland)\b/i,
  // ── Categorías que vetamos siempre ──
  /\b(reserve|reserves|youth|sub-?\d+|under-?\d+|primavera|u\d+|juvenil|cadete)\b/i,
  /\b(cibacopa|lnbp|mexicano basket)\b/i,
  /\b(lmb|liga mexicana de beisbol|mexican baseball)\b/i,
  // ── Tennis qualifying / clasificación (low-tier matches con poca cobertura) ──
  // ATP/WTA Challengers en fase de clasificación tienen partidos con jugadores
  // muy obscuros que solo aparecen en 1 casa. Excluimos para evitar partidos
  // que el user "no encuentra en ninguna casa" cuando consulta una específica.
  /\bclasificaci[oó]n\b/i,
  /\bqualifying\b/i,
  /\bqualifier(s)?\b/i,
  /\bqualification\b/i,
  // ── Teams específicos que vetamos (Israel/Egipto/Ucrania/Tunisia/Oman/Kenya) ──
  /\b(maccabi|hapoel|\bhapo[a-z]+\b)\b/i,
  /\b(zed|ghazl|ismaili|el gouna|al-?ahly|zamalek|al ?nasr|al ?nassr|al ?hilal)\b/i,
  /\b(dynamo kyiv|shakhtar|oleksandri[ya]|zoria|metalist|karpaty|kryvbas|polissya|veres|epicentr|kudrivka|rukh)\b/i,
  /\b(js omrane|avenir sportif|stade tunisien|bizertin|zarzis|gabes)\b/i,
  /\b(saham|oman fc|bahla|al-?nasr\b)\b/i,
  /\b(ulinzi|afc leopards)\b/i,
  /\b(csk[as] sofia|first professional league|professional football league.*bulg|bulgarian professional)\b/i,
  /\b(forge fc|supra|fc supra)\b/i
];

function isRelevantLeague(leagueName) {
  if (!leagueName) return false;
  if (BLOCKED_LEAGUE_PATTERNS.some(re => re.test(leagueName))) return false;
  return RELEVANT_LEAGUE_PATTERNS.some(re => re.test(leagueName));
}

/* Detección defensiva de esports — algunos scrapers podrían clasificar mal
 * un partido de eFootball/eCricket/CS2/Valorant como 'soccer' u 'other' si
 * no matchearon la regex específica. Acá lo detectamos por nombre de liga
 * y FORZAMOS sport='esports' para que nunca contamine los filtros normales. */
const ESPORTS_LEAGUE_PATTERNS = [
  /\b(esports?|e-sports?|gaming)\b/i,
  /\b(csgo|cs2|cs:go|counter-?strike)\b/i,
  /\b(league of legends|\blol\b|worlds|lec|lck|lcs|lpl|lla|lja|msi)\b/i,
  /\b(dota ?2?|the international|dpc)\b/i,
  /\b(valorant|vct|vlr)\b/i,
  /\b(rocket league|rlcs)\b/i,
  /\b(efootball|e-football|e-fútbol|efutbol|ebasket|fifa esports)\b/i,
  /\b(overwatch|owl|ow2)\b/i,
  /\b(call of duty|\bcod\b|cdl)\b/i,
  /\b(starcraft|sc2)\b/i,
  /\b(rainbow six|r6)\b/i,
  /\b(king of glory|honor of kings)\b/i,
  /\b(iem|esl pro|blast premier|epl s\d+|major)\b/i,
  // Simulaciones esports tipo "NBA H2H GG League 4x5 minutes" o "Battle - X - 4 minutos"
  /\b(gg league|h2h gg|battle league|battle esports)\b/i,
  /\bbattle\s*-\s*\w+\s*-\s*\d+\s*(minutos?|minutes?)/i,
  /\d+\s*x\s*\d+\s*(minutos?|minutes?)/i,
  /\b\d+\s*minutos?\s*(de juego|playing|match)\b/i
];

const ESPORTS_TEAM_PATTERNS = [
  /\(esports?\)/i,          // "Leipzig (Esports)" → esports
  /\((frenzy|fury|titanium|hyper|zion|tornado|cyber|lumix|dragon|phoenix|ninja|wolf|gladiator|champion|legend|elite|pro|master)\)/i,   // player handles
  /\(\w{3,8}\)\s*\(esports?\)/i,
  /\(\w{2,5}\)\s+vs\s+\w+/i // common esports format "TEAM (HANDLE) vs..."
];

function looksLikeEsports(ev) {
  if (typeof ev === 'string') {
    // legacy call con solo leagueName
    return ESPORTS_LEAGUE_PATTERNS.some(re => re.test(ev));
  }
  if (!ev) return false;
  if (ev.leagueName && ESPORTS_LEAGUE_PATTERNS.some(re => re.test(ev.leagueName))) return true;
  const teamsBlob = `${ev.home?.name || ''} ${ev.away?.name || ''}`;
  if (ESPORTS_TEAM_PATTERNS.some(re => re.test(teamsBlob))) return true;
  return false;
}

function effectiveSport(ev) {
  if (ev.sport !== 'esports' && looksLikeEsports(ev)) return 'esports';
  return ev.sport;
}

// Top teams pattern para priorizar partidos relevantes (mismo que frontend)
const TOP_TEAMS_PATTERN = /\b(boca|river|racing|independiente|san lorenzo|estudiantes|velez|talleres|argentinos|gimnasia|huracan|lanus|banfield|tigre|defensa|newells|rosario central|colon|union|godoy|barracas|liverpool|arsenal|manchester city|manchester united|chelsea|tottenham|newcastle|aston villa|west ham|real madrid|barcelona|atletico|sevilla|villarreal|valencia|athletic|real sociedad|betis|napoli|juventus|inter|milan|roma|lazio|atalanta|fiorentina|bayern|dortmund|leipzig|leverkusen|psg|marseille|monaco|lyon|nice|lille|porto|benfica|sporting|ajax|psv|feyenoord|flamengo|palmeiras|santos|sao paulo|corinthians|gremio|internacional|atletico mineiro|fluminense|botafogo|cruzeiro|vasco|liga de quito|barcelona sc|independiente del valle|peñaroll|nacional|olimpia|cerro porte|universidad catolica|colo|universidad de chile|alianza lima|universitario|sporting cristal|america de cali|junior|millonarios|santa fe|nacional med|club leon|america mex|monterrey|tigres|guadalajara|cruz azul|pumas|nfl|nba|mlb|nhl|nets|lakers|celtics|warriors|heat|nuggets|bucks|76ers|knicks|bulls|spurs|raptors|mavericks|suns|clippers|cowboys|patriots|eagles|chiefs|49ers|packers|steelers|yankees|dodgers|red sox|cubs|astros|rangers|atp|wta|federer|nadal|djokovic|alcaraz|sinner|medvedev)\b/i;

function eventPriority(ev) {
  let p = 0;
  if (isRelevantLeague(ev.leagueName)) p += 1;
  const teams = `${ev.home?.name || ''} ${ev.away?.name || ''}`;
  if (TOP_TEAMS_PATTERN.test(teams)) p += 2;
  if (TOP_TEAMS_PATTERN.test(ev.home?.name || '') && TOP_TEAMS_PATTERN.test(ev.away?.name || '')) p += 1;
  return p;
}

function events({ sport = 'all', league = null, all = false, sortByPriority = true, includePast = false } = {}) {
  const list = [];
  // CRITICAL: filtrar eventos pasados. Por default solo mostramos eventos
  // futuros (o en curso, hasta 2h después del kickoff).
  const now = Date.now();
  const pastThreshold = now - 2 * 60 * 60 * 1000;   // 2h después del kickoff = "en vivo o reciente"
  state.events.forEach(ev => {
    if (!includePast && Number.isFinite(ev.start) && ev.start < pastThreshold) return;
    const evSport = effectiveSport(ev);
    if (sport !== 'all' && evSport !== sport) return;
    if (league && ev.league !== league) return;
    // Filtro de relevancia por default — descarta LMB mexicano, CIBACOPA,
    // semipro australiano, etc. Pasar `all: true` para incluirlos (debug).
    if (!all && !isRelevantLeague(ev.leagueName)) return;
    list.push(ev);
  });
  if (sortByPriority) {
    // Priority: equipos top primero, después por start ascending.
    list.sort((a, b) => {
      const pdiff = eventPriority(b) - eventPriority(a);
      if (pdiff !== 0) return pdiff;
      return (a.start || Infinity) - (b.start || Infinity);
    });
  } else {
    list.sort((a, b) => (a.start || 0) - (b.start || 0));
  }
  return list;
}
function findEvent(id) {
  for (const ev of state.events.values()) if (ev.id === id) return ev;
  return null;
}
function sourceStatus() { return state.sourceStatus; }
function bookStatus() {
  // Backwards-compat: derivamos book-level status desde el source-status
  // de los scrapers (oddsapi no es una "casa" sino una fuente).
  const out = {};
  for (const s of state.sources) {
    if (s.name.startsWith('scraper:')) {
      const book = s.name.replace('scraper:', '');
      const st = state.sourceStatus[s.name] || {};
      out[book] = {
        ok: !!st.ok,
        lastOk: st.ok ? st.lastFetch : (out[book]?.lastOk || null),
        lastError: st.lastError,
        msEvents: st.count || 0,
        lastDurMs: st.durMs || 0
      };
    }
  }
  return out;
}
function surebets() { return state.surebets; }
function steamMoves() { return state.steam; }
function discrepancies(opts) { return state.discrepancyLog.snapshot(opts); }
function quota() { return state.oddsApiQuota; }
function health() {
  return {
    cycles: state.cycles,
    lastCycleMs: state.lastCycleMs,
    eventsTracked: state.events.size,
    surebets: state.surebets.length,
    steam: state.steam.length,
    sourcesOk: Object.values(state.sourceStatus).filter(s => s.ok).length,
    sourcesTotal: state.sources.length,
    booksOk: Object.values(bookStatus()).filter(b => b.ok).length,
    booksTotal: Object.keys(bookStatus()).length,
    discrepanciesTotal: state.discrepancyLog.stats.total,
    discrepanciesCritical: state.discrepancyLog.stats.critical,
    oddsApiQuotaRemaining: state.oddsApiQuota.remaining,
    startedAt: state.startedAt
  };
}

// ── Ciclo principal ────────────────────────────────────────────────────────
async function cycle() {
  // Mutex: si ya hay un ciclo corriendo, saltamos este. Evita carreras donde
  // dos ciclos clearean state.events simultáneamente y se pierden eventos.
  if (state._cycleRunning) {
    log(`[orchestrator] skip ciclo solapado (anterior aún corriendo)`);
    return;
  }
  state._cycleRunning = true;
  const t0 = Date.now();
  state.cycles += 1;

  const prevSnap = new Map(state.events);
  const newEvents = new Map();
  cycleContributors.clear();

  // 5 sources en paralelo. APIs públicas (priority 0) terminan en <5s y se
  // commitean inmediatamente. Scrapers AR pueden tardar más pero agregan
  // events incrementalmente.
  const limit = pLimit(5);

  // Progressive commit: cada source que termina hace que state.events refleje
  // SOLO esa source (incremental). El usuario ve events de SofaScore/ESPN
  // mientras los scrapers todavía corren.
  let progressiveSwapDone = false;

  // Debounce de `odds-update`: en lugar de emitir por cada source que termina
  // (4–5 broadcasts/ciclo de payload pesado → flood al WS), agrupamos en una
  // ventana de 1.2s. Si llegan más sources la programación se renueva.
  let oddsUpdateTimer = null;
  const scheduleOddsUpdate = () => {
    if (oddsUpdateTimer) return;
    oddsUpdateTimer = setTimeout(() => {
      oddsUpdateTimer = null;
      try {
        bus.emit('odds-update', { events: events({ sport: 'all' }), ts: Date.now() });
      } catch (e) {
        log(`[orchestrator] odds-update emit err: ${e.message?.slice(0, 80)}`);
      }
    }, 1200);
  };

  await Promise.allSettled(state.sources.map(src =>
    limit(async () => {
      const t = Date.now();
      const evs = await src.safeFetch(['soccer', 'basketball', 'tennis', 'amfootball', 'baseball', 'hockey', 'mma']);
      evs.forEach(ev => mergeEventFromSource(src.name, ev, newEvents));
      const status = src.status();
      status.durMs = Date.now() - t;
      const previousStatus = state.sourceStatus[src.name];
      if (!status.ok && previousStatus?.ok) {
        status.lastOk = previousStatus.lastOk || previousStatus.lastFetch;
      } else if (status.ok) {
        status.lastOk = status.lastFetch;
      }
      state.sourceStatus[src.name] = status;
      bus.emit('source-status', { source: src.name, ...status });
      log(`[source:${src.name}] ${status.ok ? 'OK' : 'ERR'} · ${status.count} eventos · ${status.durMs}ms${status.lastError ? ' · ' + status.lastError.slice(0,80) : ''}`);

      // PROGRESSIVE SWAP: la primera vez que tenemos events, los exponemos
      // a la UI inmediatamente. Las siguientes sources solo agregan al state
      // existente sin pisar lo ya tenemos.
      if (evs.length > 0 && !progressiveSwapDone) {
        state.events = newEvents;
        progressiveSwapDone = true;
        computeBest(state.events.values());
        scheduleOddsUpdate();
      } else if (evs.length > 0 && progressiveSwapDone) {
        computeBest(state.events.values());
        scheduleOddsUpdate();
      }

      if (src.name === 'oddsapi' && src.quota) {
        state.oddsApiQuota = src.quota;
      }
    })
  ));

  // Flush final del debounce si hubo algo pendiente (garantiza un broadcast
  // siempre que el ciclo aporte data).
  if (oddsUpdateTimer) {
    clearTimeout(oddsUpdateTimer);
    bus.emit('odds-update', { events: events({ sport: 'all' }), ts: Date.now() });
  }

  // Si NINGUNA source devolvió events, igual hacemos el swap para que el
  // estado refleje "ciclo terminado".
  if (!progressiveSwapDone) {
    state.events = newEvents;
  }

  // Detectar discrepancias entre fuentes (cross-validation)
  let cycleDiscrepancies = 0;
  for (const [evKey, contribMap] of cycleContributors.entries()) {
    const ev = newEvents.get(evKey);
    if (!ev) continue;
    const found = findDiscrepancies(ev, contribMap);
    if (found.length) {
      state.discrepancyLog.add(found);
      cycleDiscrepancies += found.length;
      // Loguear las críticas en stdout para que admins vean en logs de Render
      found.filter(d => d.level === 'critical').forEach(d => {
        log(`[discrepancy:CRITICAL] ${d.eventName} · ${d.bookKey}/${d.market}/${d.outcome} · ${d.sourceA.name}=${d.sourceA.value} vs ${d.sourceB.name}=${d.sourceB.value} · Δ${d.deltaPct}%`);
      });
    }
  }

  // Final pass: computar best/surebets/steam con TODO mergeado
  computeBest(state.events.values());
  const newSure = detectSurebets(state.events.values());
  const newSteam = detectSteam(prevSnap, state.events);

  if (newSure.length) {
    // Dedup cross-ciclo: si una surebet del mismo evento+market ya está en
    // state.surebets, la actualizamos en lugar de duplicarla. Esto evita el
    // bug donde el mismo partido aparecía 4× en la UI al refrescar varias
    // veces por ciclo.
    const newKeys = new Set(newSure.map(sb => `${sb.eventId}|${sb.market}`));
    const filtered = state.surebets.filter(sb => !newKeys.has(`${sb.eventId}|${sb.market}`));
    state.surebets = newSure.concat(filtered).slice(0, 200);
    newSure.forEach(sb => bus.emit('surebet', sb));
  }
  if (newSteam.length) {
    state.steam = newSteam.concat(state.steam).slice(0, 200);
    newSteam.forEach(st => bus.emit('steam', st));
  }

  state.lastCycleMs = Date.now() - t0;
  bus.emit('cycle', {
    n: state.cycles,
    durMs: state.lastCycleMs,
    events: state.events.size,
    sureNew: newSure.length,
    steamNew: newSteam.length,
    discrepanciesNew: cycleDiscrepancies,
    ts: Date.now()
  });
  bus.emit('odds-update', {
    events: events({ sport: 'all' }),
    ts: Date.now()
  });

  log(`[orchestrator] ciclo #${state.cycles} · ${state.events.size} eventos · ${newSure.length} sure · ${newSteam.length} steam · ${cycleDiscrepancies} discr · ${state.lastCycleMs}ms`);
  state._cycleRunning = false;
}

// ── Inicialización de sources ─────────────────────────────────────────────
function buildSources(cfg) {
  const sources = [];

  // 1) The Odds API si hay key (fuente PRIMARIA)
  const oddsKey = process.env.THE_ODDS_API_KEY || process.env.BS_ODDS_API_KEY || '';
  if (oddsKey) {
    // Sports más relevantes para AR — mantener bajo límite de quota
    const sportsKeys = (process.env.ODDSAPI_SPORTS || [
      'soccer_argentina_primera_division',
      'soccer_conmebol_copa_libertadores',
      'soccer_conmebol_copa_sudamericana',
      'soccer_epl',
      'soccer_spain_la_liga',
      'soccer_italy_serie_a',
      'soccer_germany_bundesliga',
      'soccer_uefa_champs_league',
      'basketball_nba',
      'americanfootball_nfl',
      'baseball_mlb',
      'icehockey_nhl',
      'tennis_atp',
      'mma_mixed_martial_arts'
    ].join(',')).split(',').map(s => s.trim()).filter(Boolean);
    sources.push(new OddsApiSource({
      apiKey: oddsKey,
      sportsKeys,
      region: process.env.ODDSAPI_REGION || 'eu'
    }));
    log(`[orchestrator] OddsAPI source habilitado · ${sportsKeys.length} sports · region=${process.env.ODDSAPI_REGION || 'eu'}`);
  } else {
    log('[orchestrator] WARNING: THE_ODDS_API_KEY no seteada — sin fuente primaria');
  }

  // 2) Scrapers (fuente secundaria para casas AR-only)
  const scraperSources = createAllScraperSources(cfg.enabledBooks);
  sources.push(...scraperSources);
  log(`[orchestrator] ${scraperSources.length} scraper sources habilitados`);

  // 3) Fuentes públicas suplementarias (fixtures sin odds, pero útiles
  //    para no dejar partidos "ausentes" cuando ningún scraper los capturó).
  //
  // SofaScore: en hosts cloud Cloudflare bloquea native HTTPS. Se habilita
  // automáticamente si tenemos SCRAPINGBEE_KEY (bypassa Cloudflare) o si el
  // user lo fuerza con ENABLE_SOFASCORE=true. Si querés DESACTIVARLO incluso
  // teniendo sbee (para ahorrar créditos), setear ENABLE_SOFASCORE=false.
  const sofaEnabled = process.env.ENABLE_SOFASCORE === 'true'
    || (process.env.SCRAPINGBEE_KEY && process.env.ENABLE_SOFASCORE !== 'false');
  if (sofaEnabled) {
    sources.push(new SofaScoreSource());
    const via = process.env.SCRAPINGBEE_KEY ? 'scrapingbee' : 'native-https';
    log(`[orchestrator] SofaScore source habilitado (via ${via})`);
  }
  if (process.env.ENABLE_ESPN !== 'false') {
    sources.push(new EspnSource());
    log('[orchestrator] ESPN source habilitado');
  }

  // 4) GitHub Actions cache (ULTIMATE FALLBACK)
  // Lee public/data/scraped-events.json del repo via raw.githubusercontent.com.
  // Refresh hourly (cron de .github/workflows/scrape-cache.yml).
  // Habilitado por default; desactivar con DISABLE_GITHUB_CACHE=true.
  if (process.env.DISABLE_GITHUB_CACHE !== 'true') {
    try {
      const { GithubCacheSource } = require('../sources/github-cache');
      sources.push(new GithubCacheSource());
      log('[orchestrator] GitHub cache source habilitado (ultimate fallback)');
    } catch (e) {
      log(`[orchestrator] GitHub cache source error: ${e.message?.slice(0, 80)}`);
    }
  }

  // Ordenar por priority
  sources.sort((a, b) => a.priority - b.priority);
  return sources;
}

function start(cfg) {
  if (state.running) return;
  state.cfg = cfg;
  state.running = true;
  state.sources = buildSources(cfg);
  // Wrapper que libera el mutex si cycle() lanza, además de loguear
  const safeCycle = () => cycle().catch(e => {
    log('[cycle] err', e?.message || e);
    state._cycleRunning = false;
  });
  setTimeout(safeCycle, 1500);
  state.timer = setInterval(safeCycle, cfg.interval);
}
function stop() {
  if (!state.running) return;
  state.running = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

/* Estado de los circuit breakers de cada source.
 * Los breakers pueden estar attacheados a:
 *   - `src.scrape.breaker`  (scrapers basados en función, e.g. bplay)
 *   - `src.scrape.breakers` (scrapers con múltiples paths, e.g. betano direct+playwright+sbee)
 *   - `src.breakers`        (sources basados en clase, e.g. SofaScoreSource)
 * Permite a /api/breakers ver si Cloudflare nos baneó y cuándo va a reintentar. */
function breakers() {
  const out = {};
  const addBreaker = (key, br) => {
    if (br && typeof br.status === 'function') out[key] = br.status();
  };
  const addBreakers = (prefix, obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [subKey, br] of Object.entries(obj)) addBreaker(`${prefix}:${subKey}`, br);
  };

  for (const src of state.sources) {
    const scraper = src.scrape;
    if (scraper?.breaker) addBreaker(src.name, scraper.breaker);
    addBreakers(src.name, scraper?.breakers);
    addBreakers(src.name, src.breakers);
  }
  return out;
}

/* Reset manual de breakers. Útil cuando sabés que Cloudflare aflojó y querés
 * forzar reintento sin esperar el cooldown exponencial.
 * Si `name` está dado, solo resetea ese; si no, resetea todos. */
function resetBreakers(name = null) {
  const reset = [];
  const resetOne = (br, key) => {
    if (!br || typeof br.status !== 'function') return;
    br.state = 'CLOSED';
    br.consecutiveFails = 0;
    br.cooldownAttempts = 0;
    reset.push(key);
  };

  for (const src of state.sources) {
    const scraper = src.scrape;
    if (scraper?.breaker && (!name || name === src.name)) {
      resetOne(scraper.breaker, src.name);
    }
    const subBreakers = [
      ...Object.entries(scraper?.breakers || {}).map(([k, b]) => [`${src.name}:${k}`, b, src.name]),
      ...Object.entries(src.breakers || {}).map(([k, b]) => [`${src.name}:${k}`, b, src.name])
    ];
    for (const [fullKey, br, srcName] of subBreakers) {
      if (!name || name === fullKey || name === srcName) {
        resetOne(br, fullKey);
      }
    }
  }
  return reset;
}

/* Reset manual del cache de un scraper específico. Util cuando querés
 * forzar refresh sin esperar el TTL (e.g., antes de un partido grande).
 *
 * Los scrapers que cachean a nivel módulo exponen `scrape.clearCache()`. */
function clearScraperCache(name = null) {
  const cleared = [];
  for (const src of state.sources) {
    const scraper = src.scrape;
    if (scraper?.clearCache && typeof scraper.clearCache === 'function') {
      if (!name || name === src.name) {
        try { scraper.clearCache(); cleared.push(src.name); } catch {}
      }
    }
    // Sources basados en clase (SofaScoreSource) pueden exponer su propio clearCache
    if (typeof src.clearCache === 'function') {
      if (!name || name === src.name) {
        try { src.clearCache(); cleared.push(src.name); } catch {}
      }
    }
  }
  return cleared;
}

module.exports = {
  start, stop,
  events, findEvent,
  surebets, steamMoves, bookStatus, sourceStatus, discrepancies, quota, health, breakers, resetBreakers, clearScraperCache,
  looksLikeEsports, effectiveSport, isRelevantLeague, eventPriority,
  on: bus.on.bind(bus),
  off: bus.off.bind(bus),
  _mergeEventFromSource: mergeEventFromSource
};
