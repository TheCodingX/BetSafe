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
      markets: { h2h: {}, totals: {}, btts: {}, dc: {}, ah: {} },
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
  return data;
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
function detectSurebets(eventsIterable) {
  const out = [];
  for (const ev of eventsIterable) {
    if (!ev.bestOdds?.h2h) continue;
    const h = ev.bestOdds.h2h.home, d = ev.bestOdds.h2h.draw, a = ev.bestOdds.h2h.away;
    const odds = d ? [h, d, a] : [h, a];
    if (odds.some(o => !o)) continue;
    const sum = odds.reduce((s, o) => s + 1 / o, 0);
    if (sum < 1) {
      const roi = (1 / sum - 1) * 100;
      const books = d ? [ev.bestOdds.h2h.homeBook, ev.bestOdds.h2h.drawBook, ev.bestOdds.h2h.awayBook]
                       : [ev.bestOdds.h2h.homeBook, ev.bestOdds.h2h.awayBook];
      out.push({
        eventId: ev.id,
        event: `${ev.home.name} vs ${ev.away.name}`,
        sport: ev.sport,
        league: ev.league,
        start: ev.start,
        market: 'h2h',
        outcomes: d ? ['home','draw','away'] : ['home','away'],
        odds,
        books,
        roi: Number(roi.toFixed(3)),
        ts: Date.now()
      });
    }
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
function events({ sport = 'all', league = null } = {}) {
  const list = [];
  state.events.forEach(ev => {
    if (sport !== 'all' && ev.sport !== sport) return;
    if (league && ev.league !== league) return;
    list.push(ev);
  });
  list.sort((a, b) => (a.start || 0) - (b.start || 0));
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
    state.surebets = newSure.concat(state.surebets).slice(0, 200);
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
  // SofaScore: por DEFAULT desactivado en hosts cloud porque Cloudflare
  // bloquea sistemáticamente las IPs de Render/Fly/Railway con 403. ESPN
  // ya cubre el mismo rol (fixtures sin odds) y SÍ responde a cloud IPs.
  // Para reactivarlo si tenés una IP "limpia" (e.g. residential proxy),
  // setear ENABLE_SOFASCORE=true.
  if (process.env.ENABLE_SOFASCORE === 'true') {
    sources.push(new SofaScoreSource());
    log('[orchestrator] SofaScore source habilitado (opt-in)');
  }
  if (process.env.ENABLE_ESPN !== 'false') {
    sources.push(new EspnSource());
    log('[orchestrator] ESPN source habilitado');
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

/* Estado de los circuit breakers de cada scraper.
 * El módulo de scraper expone `scrape.breaker` (si lo definió). Permite a
 * /api/breakers ver si Cloudflare nos baneó y cuándo va a reintentar. */
function breakers() {
  const out = {};
  for (const src of state.sources) {
    const scraper = src.scrape;
    if (scraper?.breaker && typeof scraper.breaker.status === 'function') {
      out[src.name] = scraper.breaker.status();
    }
  }
  return out;
}

module.exports = {
  start, stop,
  events, findEvent,
  surebets, steamMoves, bookStatus, sourceStatus, discrepancies, quota, health, breakers,
  on: bus.on.bind(bus),
  off: bus.off.bind(bus),
  _mergeEventFromSource: mergeEventFromSource
};
