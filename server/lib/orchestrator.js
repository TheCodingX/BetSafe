/* BetSafe — Orquestador de scraping
 * ============================================================================
 * Responsable de:
 *   - Disparar los scrapers de cada casa cada SCRAPE_INTERVAL_MS.
 *   - Mantener el snapshot actual de eventos (mergeando por eventKey).
 *   - Detectar surebets cruzando las cuotas de las casas.
 *   - Detectar steam moves comparando snapshot anterior y actual.
 *   - Emitir eventos para que el server los broadcastee por WebSocket.
 *
 * Snapshot interno por evento:
 *   {
 *     id: <md5 estable>,
 *     home: { id, name }, away: { id, name },
 *     league: 'lpf' | 'epl' | ...,
 *     leagueName: 'Liga Profesional Argentina',
 *     sport: 'soccer' | ...,
 *     start: <ms>,
 *     markets: {
 *       h2h: { bplay: { home, draw, away }, betano: {...}, ... },
 *       totals: { bplay: { 2.5: { over, under } }, ... },
 *       btts: { bplay: { yes, no }, ... }
 *     },
 *     bestOdds: { h2h: { home, draw, away }, ... },
 *     lastUpdate: <ms>,
 *     sources: ['bplay','betano',...]
 *   }
 * ============================================================================
 */
'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');
const { log, eventKey, normalizeTeam, isFinite2, sleep } = require('./index');
const pLimit = require('p-limit').default;

const SCRAPERS = {
  bplay:        require('../scrapers/bplay'),
  betano:       require('../scrapers/betano'),
  betwarrior:   require('../scrapers/betwarrior'),
  bet365ar:     require('../scrapers/bet365ar'),
  codere:       require('../scrapers/codere'),
  caliente:     require('../scrapers/caliente'),
  casinomagic:  require('../scrapers/casinomagic'),
  betsson:      require('../scrapers/betsson'),
  jugabet:      require('../scrapers/jugabet'),
  '24bet':      require('../scrapers/24bet'),
  playcity:     require('../scrapers/playcity'),
  megapuesta:   require('../scrapers/megapuesta')
};

const SPORTS = ['soccer', 'basketball', 'tennis', 'amfootball', 'baseball', 'hockey', 'mma', 'tableTennis', 'volleyball'];

// Estado interno
const state = {
  events: new Map(),         // eventKey → event
  prev: new Map(),           // eventKey → event (snapshot anterior, para diff)
  surebets: [],              // últimas 200
  steam: [],                 // últimos 200 steam moves
  bookStatus: {},            // bookKey → { ok, lastOk, lastError, msEvents, lastDurMs }
  cycles: 0,
  lastCycleMs: 0,
  startedAt: Date.now(),
  running: false,
  timer: null,
  cfg: null
};

const bus = new EventEmitter();

// ── ID estable por evento ──────────────────────────────────────────────────
function makeEventId(home, away, start) {
  const k = eventKey(home, away, start);
  return crypto.createHash('md5').update(k).digest('hex').slice(0, 16);
}

// ── Merge de un evento que viene del scraper en el snapshot ────────────────
function mergeEvent(bookKey, ev) {
  if (!ev?.home?.name || !ev?.away?.name) return;
  const key = eventKey(ev.home.name, ev.away.name, ev.start);
  let existing = state.events.get(key);
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
    state.events.set(key, existing);
  }
  // Tomar mejor info disponible
  if (ev.league && !existing.league) existing.league = ev.league;
  if (ev.leagueName && !existing.leagueName) existing.leagueName = ev.leagueName;
  if (ev.start && !existing.start) existing.start = ev.start;

  // Mercados
  const m = ev.markets || {};
  if (m.h2h && (m.h2h.home || m.h2h.away)) {
    existing.markets.h2h[bookKey] = sanitizeH2h(m.h2h);
  }
  if (m.totals) existing.markets.totals[bookKey] = sanitizeTotals(m.totals);
  if (m.btts) existing.markets.btts[bookKey] = sanitizeBtts(m.btts);
  if (m.dc) existing.markets.dc[bookKey] = sanitizeDc(m.dc);
  if (m.ah) existing.markets.ah[bookKey] = m.ah;

  if (!existing.sources.includes(bookKey)) existing.sources.push(bookKey);
  existing.lastUpdate = Date.now();
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
    if (isFinite2(sides.over)) s.over = round2(sides.over);
    if (isFinite2(sides.under)) s.under = round2(sides.under);
    if (s.over || s.under) {
      s.line = numLine;
      out[numLine] = s;
    }
  }
  return out;
}
function round2(n) { return Math.round(n * 100) / 100; }

// ── Compute "best odds" cross-book ─────────────────────────────────────────
function computeBest(events) {
  events.forEach(ev => {
    const bestH = bestSide(ev.markets.h2h, 'home');
    const bestA = bestSide(ev.markets.h2h, 'away');
    const bestD = bestSide(ev.markets.h2h, 'draw');
    const bestYes = bestSide(ev.markets.btts, 'yes');
    const bestNo  = bestSide(ev.markets.btts, 'no');
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
    // Margen overround del 1X2 best line
    if (ev.bestOdds?.h2h) {
      const odds = [ev.bestOdds.h2h.home, ev.bestOdds.h2h.draw, ev.bestOdds.h2h.away].filter(Boolean);
      ev.overround = odds.reduce((a, b) => a + 1 / b, 0);
    }
  });
}
function bestSide(byBook, side) {
  let bv = 0, bk = null;
  Object.entries(byBook).forEach(([book, m]) => {
    if (m[side] && m[side] > bv) { bv = m[side]; bk = book; }
  });
  return { v: bv || null, book: bk };
}

// ── Surebet detection ──────────────────────────────────────────────────────
function detectSurebets(events) {
  const out = [];
  events.forEach(ev => {
    if (!ev.bestOdds?.h2h) return;
    const h = ev.bestOdds.h2h.home, d = ev.bestOdds.h2h.draw, a = ev.bestOdds.h2h.away;
    const odds = d ? [h, d, a] : [h, a];
    if (odds.some(o => !o)) return;
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
  });
  out.sort((a, b) => b.roi - a.roi);
  return out;
}

// ── Steam move detection (cuotas con movimiento >=5% vs snapshot anterior) ─
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
      if (Math.abs(deltaPct) >= 5) {
        out.push({
          eventId: ev.id,
          event: `${ev.home.name} vs ${ev.away.name}`,
          market: 'h2h',
          side,
          from: o1,
          to: o2,
          deltaPct: Number(deltaPct.toFixed(2)),
          sharp: Math.abs(deltaPct) >= 5,
          ts: Date.now()
        });
      }
    });
  });
  return out;
}

// ── Filtros API ────────────────────────────────────────────────────────────
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

function bookStatus() { return state.bookStatus; }
function surebets() { return state.surebets; }
function steamMoves() { return state.steam; }
function health() {
  return {
    cycles: state.cycles,
    lastCycleMs: state.lastCycleMs,
    eventsTracked: state.events.size,
    surebets: state.surebets.length,
    steam: state.steam.length,
    booksOk: Object.values(state.bookStatus).filter(b => b.ok).length,
    booksTotal: Object.keys(state.bookStatus).length,
    startedAt: state.startedAt
  };
}

// ── Ciclo principal ────────────────────────────────────────────────────────
async function cycle(cfg) {
  const t0 = Date.now();
  state.cycles += 1;

  // Snapshot anterior para diff de steam
  const prevSnap = new Map(state.events);

  // Resetear merging
  state.events.clear();

  // 4 scrapers en paralelo es el límite seguro (browser pool + memoria)
  const limit = pLimit(4);
  const scrapersToRun = cfg.enabledBooks
    .filter(k => SCRAPERS[k])
    .map(k => ({ key: k, scrape: SCRAPERS[k] }));

  await Promise.allSettled(scrapersToRun.map(({ key, scrape }) =>
    limit(async () => {
      const t = Date.now();
      try {
        const evs = await scrape({ sports: SPORTS });
        let count = 0;
        if (Array.isArray(evs)) {
          evs.forEach(ev => { mergeEvent(key, ev); count++; });
        }
        state.bookStatus[key] = {
          ok: true,
          lastOk: Date.now(),
          lastError: null,
          msEvents: count,
          lastDurMs: Date.now() - t
        };
        log(`[scrape] ${key} OK · ${count} eventos · ${Date.now() - t}ms`);
        bus.emit('book-status', { book: key, ...state.bookStatus[key] });
      } catch (e) {
        state.bookStatus[key] = {
          ok: false,
          lastOk: state.bookStatus[key]?.lastOk || null,
          lastError: e?.message || String(e),
          msEvents: state.bookStatus[key]?.msEvents || 0,
          lastDurMs: Date.now() - t
        };
        log(`[scrape] ${key} ERROR · ${state.bookStatus[key].lastError}`);
        bus.emit('book-status', { book: key, ...state.bookStatus[key] });
      }
    })
  ));

  // Computar best odds y surebets/steam
  computeBest(state.events.values());
  const newSure = detectSurebets(state.events.values());
  const newSteam = detectSteam(prevSnap, state.events);

  // Mantener histórico circular
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
    ts: Date.now()
  });
  bus.emit('odds-update', {
    events: events({ sport: 'all' }),
    ts: Date.now()
  });

  log(`[orchestrator] ciclo #${state.cycles} · ${state.events.size} eventos · ${newSure.length} surebets nuevas · ${newSteam.length} steam · ${state.lastCycleMs}ms`);
}

function start(cfg) {
  if (state.running) return;
  state.cfg = cfg;
  state.running = true;
  // Primer ciclo inmediato (con jitter chico para evitar cold start agresivo)
  setTimeout(() => cycle(cfg).catch(e => log('[cycle] err', e?.message || e)), 1500);
  // Loop
  state.timer = setInterval(() => {
    cycle(cfg).catch(e => log('[cycle] err', e?.message || e));
  }, cfg.interval);
}
function stop() {
  if (!state.running) return;
  state.running = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

module.exports = {
  start, stop,
  events, findEvent,
  surebets, steamMoves, bookStatus, health,
  on: bus.on.bind(bus),
  off: bus.off.bind(bus),
  // exposed for tests
  _mergeEvent: mergeEvent
};
