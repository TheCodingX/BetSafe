/* BetSafe — Source: The Odds API (https://the-odds-api.com)
 * ============================================================================
 * Fuente PRIMARIA. Cubre cuotas oficiales sin scraping.
 *
 * Plan free: 500 requests/mes. Plan $30: 50.000/mes (cubre ciclo 30s
 * continuo). API estable, sin Cloudflare, sin selectores frágiles.
 *
 * Regions usadas:
 *   - eu  → Betano, Bet365, Betsson, Unibet, Pinnacle, William Hill, 1xBet
 *   - uk  → Bet365, William Hill, Coral, Ladbrokes (suplementario)
 *   - us  → DraftKings, FanDuel, BetMGM, Caesars (NBA/NFL/MLB)
 *   - au  → Sportsbet, TAB, Ladbrokes AU (Cricket/Rugby/AFL)
 *
 * Endpoint:
 *   GET /v4/sports/{sport_key}/odds/?apiKey&regions&markets&oddsFormat&dateFormat
 *
 * Cada (region × market) cuesta 1 request. Para optimizar:
 *   - Pedimos region=eu (cubre Betano + Bet365 + Betsson, las que coinciden con AR)
 *   - markets=h2h,totals,spreads,btts (los 4 más relevantes)
 *
 * MAPEO de keys: The Odds API usa sus propios bookmaker keys. Los mapeamos
 * a las keys de BetSafe para que el frontend muestre las casas que reconoce.
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');
const { httpJson, log, sleep } = require('../lib');

// Mapeo: bookmaker key de The Odds API → key interna de BetSafe.
// Solo incluimos las casas que MATCHEAN con las legales argentinas (LOTBA).
// El resto de las casas que devuelve The Odds API (Pinnacle, William Hill, etc.)
// las ignoramos porque el usuario AR no puede apostar ahí legalmente.
const BOOK_MAP = {
  // Coinciden directamente con casas AR LOTBA
  'betano':         'betano',
  'betsson':        'betsson',
  'bet365':         'bet365ar',         // mismas cuotas globales que la AR
  // Internacionales con presencia AR limitada (algunas redirigen a sus versiones AR)
  'unibet_eu':      null,               // no es AR
  'pinnacle':       null,               // no opera en AR legal
  '1xbet':          null,               // .ag no es legal en AR
  'williamhill':    null,               // no AR legal
  // US books — solo aparecen en sports US, no relevantes para AR-LOTBA
  'draftkings':     null,
  'fanduel':        null,
  'betmgm':         null,
  // AU
  'sportsbet':      null
};

// Mapeo sport_key → sport interno de BetSafe
const SPORT_MAP = {
  'soccer_epl':                    { sport: 'soccer',     league: 'epl',          name: 'Premier League' },
  'soccer_spain_la_liga':          { sport: 'soccer',     league: 'laliga',       name: 'La Liga' },
  'soccer_italy_serie_a':          { sport: 'soccer',     league: 'seriea',       name: 'Serie A' },
  'soccer_germany_bundesliga':     { sport: 'soccer',     league: 'bundesliga',   name: 'Bundesliga' },
  'soccer_france_ligue_one':       { sport: 'soccer',     league: 'ligue1',       name: 'Ligue 1' },
  'soccer_uefa_champs_league':     { sport: 'soccer',     league: 'ucl',          name: 'Champions League' },
  'soccer_uefa_europa_league':     { sport: 'soccer',     league: 'uel',          name: 'Europa League' },
  'soccer_argentina_primera_division': { sport: 'soccer', league: 'lpf',          name: 'Liga Profesional Argentina' },
  'soccer_conmebol_copa_libertadores': { sport: 'soccer', league: 'libertadores', name: 'Copa Libertadores' },
  'soccer_conmebol_copa_sudamericana': { sport: 'soccer', league: 'sudamericana', name: 'Copa Sudamericana' },
  'soccer_usa_mls':                { sport: 'soccer',     league: 'mls',          name: 'MLS' },
  'basketball_nba':                { sport: 'basketball', league: 'nba',          name: 'NBA' },
  'basketball_euroleague':         { sport: 'basketball', league: 'euroleague',   name: 'EuroLeague' },
  'americanfootball_nfl':          { sport: 'amfootball', league: 'nfl',          name: 'NFL' },
  'baseball_mlb':                  { sport: 'baseball',   league: 'mlb',          name: 'MLB' },
  'icehockey_nhl':                 { sport: 'hockey',     league: 'nhl',          name: 'NHL' },
  'tennis_atp':                    { sport: 'tennis',     league: 'atp',          name: 'ATP' },
  'tennis_wta':                    { sport: 'tennis',     league: 'wta',          name: 'WTA' },
  'mma_mixed_martial_arts':        { sport: 'mma',        league: 'ufc',          name: 'UFC / MMA' }
};

/* Sports siempre presentes en cada ciclo (deportes "anchor" con flujo AR).
 * El resto entra por round-robin para preservar quota.
 */
const ANCHOR_SPORTS = ['soccer_argentina_primera_division', 'soccer_epl', 'soccer_spain_la_liga'];

class OddsApiSource extends SourceBase {
  constructor({ apiKey, sportsKeys, region = 'eu', markets, sportsPerCycle } = {}) {
    super({ name: 'oddsapi', priority: 1 });
    this.apiKey = apiKey;
    this.sportsKeys = sportsKeys || Object.keys(SPORT_MAP);
    this.region = region;
    // Default markets seguros para plan free: h2h siempre OK.
    // 'totals' es OK pero algunas sports lo rechazan.
    // 'btts' NO está disponible en plan free + region=eu → 422.
    // Solo pedimos h2h por default; el usuario puede agregar más via env.
    this.markets = markets && markets.length ? markets : ['h2h'];
    this.endpoint = 'https://api.the-odds-api.com/v4';
    this.quota = { remaining: null, used: null };
    // Round-robin: por defecto 6 sports/ciclo. Con ciclo de 30s y 19 sports
    // configurados, cada sport se actualiza ~cada 1.5 min (suficiente para
    // prematch + arbs). Quota mensual estimada: 6 × 2880 ciclos/día × 30 días
    // = ~520k/mes en el peor caso; con plan $30 (1M req/mes) sobra.
    this.sportsPerCycle = Number(sportsPerCycle ?? process.env.ODDS_API_SPORTS_PER_CYCLE ?? 6);
    // Sports que devolvieron 0 events recientemente: los penalizamos en el
    // round-robin para no quemar quota en deportes fuera de calendario.
    this._sportEmptyHits = new Map();
    this._rrIndex = 0;
  }

  covers(sport) {
    // The Odds API cubre todos los deportes principales
    return ['soccer', 'basketball', 'amfootball', 'baseball', 'hockey', 'tennis', 'mma'].includes(sport);
  }

  /* Selecciona qué sports correr en este ciclo:
   *   - ANCHORS siempre (si están configurados)
   *   - Resto: round-robin saltando los marcados como "empty" recientemente
   *   - Si la quota remaining es muy baja, recortar a anchors solamente
   */
  pickSportsForCycle() {
    const want = this.sportsPerCycle;
    const allKeys = this.sportsKeys.slice();

    // Modo defensivo: si remaining < 100 y nos quedan 24h del mes, anchors only
    if (Number.isFinite(this.quota.remaining) && this.quota.remaining < 100) {
      return allKeys.filter(k => ANCHOR_SPORTS.includes(k)).slice(0, 3);
    }

    const anchors = allKeys.filter(k => ANCHOR_SPORTS.includes(k));
    const rest = allKeys.filter(k => !ANCHOR_SPORTS.includes(k));

    // Ordenar rest poniendo primero los que NO han sido marcados como vacíos
    // y luego rotando por round-robin desde _rrIndex
    rest.sort((a, b) => (this._sportEmptyHits.get(a) || 0) - (this._sportEmptyHits.get(b) || 0));
    const idx = this._rrIndex % rest.length;
    const rotated = rest.slice(idx).concat(rest.slice(0, idx));
    this._rrIndex = (this._rrIndex + want) % Math.max(1, rest.length);

    const chosen = [...anchors];
    for (const k of rotated) {
      if (chosen.length >= want) break;
      chosen.push(k);
    }
    return chosen;
  }

  async fetch(/* sports */) {
    if (!this.apiKey) {
      throw new Error('THE_ODDS_API_KEY no configurada');
    }

    const allEvents = [];
    const cycleSports = this.pickSportsForCycle();
    for (const sportKey of cycleSports) {
      try {
        const events = await this.fetchSport(sportKey);
        allEvents.push(...events);
        // Trackear si el sport está "vacío" para penalizarlo en próximos ciclos.
        if (!events.length) {
          const n = (this._sportEmptyHits.get(sportKey) || 0) + 1;
          this._sportEmptyHits.set(sportKey, Math.min(10, n));
        } else {
          this._sportEmptyHits.delete(sportKey);
        }
      } catch (e) {
        log(`[oddsapi:${sportKey}] err ${e?.message}`);
        // Si hit quota, abortar resto del ciclo
        if (/usage limit|quota/i.test(e?.message || '')) break;
      }
      // Pequeño respiro entre sports para no saturar
      await sleep(200);
    }
    return allEvents;
  }

  /* Markets para CADA sport. The Odds API rechaza con 422 si pedís un market
   * que no aplica al sport (e.g. `btts` en NBA). Mapeo conservador: pedimos
   * `h2h,totals` a sports que lo soportan, `h2h` only al resto. La librería
   * de markets por sport puede ampliarse cuando confirmemos cuáles acepta
   * el plan actual (free vs paid). */
  marketsForSport(sportKey) {
    // override global vía env: si user setea ODDS_API_MARKETS=h2h,spreads,totals
    // usamos eso para TODOS los sports. Si fija ['h2h'] usamos solo h2h.
    if (this.markets.length > 1 || this.markets[0] !== 'h2h') return this.markets;
    // Defaults por sport: amplio donde sabemos que The Odds API soporta `totals`
    if (sportKey.startsWith('soccer_'))      return ['h2h', 'totals'];
    if (sportKey === 'basketball_nba')        return ['h2h', 'totals', 'spreads'];
    if (sportKey === 'baseball_mlb')          return ['h2h', 'totals', 'spreads'];
    if (sportKey === 'americanfootball_nfl')  return ['h2h', 'totals', 'spreads'];
    if (sportKey === 'icehockey_nhl')         return ['h2h', 'totals', 'spreads'];
    return ['h2h'];
  }

  async fetchSport(sportKey) {
    const markets = this.marketsForSport(sportKey);
    const url = `${this.endpoint}/sports/${encodeURIComponent(sportKey)}/odds/`
              + `?apiKey=${this.apiKey}`
              + `&regions=${this.region}`
              + `&markets=${markets.join(',')}`
              + `&oddsFormat=decimal&dateFormat=iso`;

    // Capturar headers de cuota
    const { request } = require('undici');
    const res = await request(url, {
      headers: { 'User-Agent': 'BetSafe/1.0' },
      headersTimeout: 8000,
      bodyTimeout: 12000
    });

    const remaining = res.headers['x-requests-remaining'];
    const used = res.headers['x-requests-used'];
    if (remaining != null) this.quota.remaining = Number(remaining);
    if (used != null) this.quota.used = Number(used);

    if (res.statusCode >= 400) {
      const text = await res.body.text().catch(() => '');
      throw new Error(`HTTP ${res.statusCode}: ${text.slice(0, 160)}`);
    }
    const data = await res.body.json().catch(() => null);
    if (!Array.isArray(data)) {
      // Posible respuesta de error en formato { message: "..." }
      log(`[oddsapi:${sportKey}] respuesta no-array · ${JSON.stringify(data).slice(0, 100)}`);
      return [];
    }

    const sportInfo = SPORT_MAP[sportKey];
    return data.map(ev => this.normalize(ev, sportInfo)).filter(Boolean);
  }

  normalize(ev, sportInfo) {
    const home = ev.home_team;
    const away = ev.away_team;
    if (!home || !away) return null;

    // Discard events without valid commence_time — produciría NaN al
    // calcular eventKey y colisionaría con otros events sin tiempo.
    const startMs = ev.commence_time ? new Date(ev.commence_time).getTime() : null;
    if (startMs != null && !Number.isFinite(startMs)) return null;

    // Comparación tolerante de nombres de equipos (acentos, mayúsculas, etc.)
    const norm = s => String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    const homeN = norm(home), awayN = norm(away);

    const markets = { h2h: {}, totals: {}, btts: {} };

    (ev.bookmakers || []).forEach(b => {
      const ourKey = BOOK_MAP[b.key];
      if (!ourKey) return;   // ignoramos casas que no son AR-LOTBA

      (b.markets || []).forEach(m => {
        const outcomes = m.outcomes || [];
        if (m.key === 'h2h') {
          // Match con normalización (no strict ===) para tolerar acentos/espacios
          const oHome = outcomes.find(o => norm(o.name) === homeN);
          const oAway = outcomes.find(o => norm(o.name) === awayN);
          const oDraw = outcomes.find(o => /^draw$|^empate$|^tie$/i.test(o.name));
          markets.h2h[ourKey] = {
            home: oHome?.price || null,
            draw: oDraw?.price || null,
            away: oAway?.price || null
          };
        } else if (m.key === 'totals') {
          outcomes.forEach(o => {
            const line = o.point;
            if (line == null) return;
            if (!markets.totals[ourKey]) markets.totals[ourKey] = {};
            if (!markets.totals[ourKey][line]) markets.totals[ourKey][line] = { line: Number(line) };
            if (/over/i.test(o.name)) markets.totals[ourKey][line].over = o.price;
            if (/under/i.test(o.name)) markets.totals[ourKey][line].under = o.price;
          });
        } else if (m.key === 'btts') {
          outcomes.forEach(o => {
            if (!markets.btts[ourKey]) markets.btts[ourKey] = {};
            if (/yes|sí/i.test(o.name)) markets.btts[ourKey].yes = o.price;
            if (/no/i.test(o.name)) markets.btts[ourKey].no = o.price;
          });
        }
      });
    });

    // Si ningún market quedó poblado por casas mapeadas, descartamos el evento
    const hasData = Object.keys(markets.h2h).length || Object.keys(markets.totals).length || Object.keys(markets.btts).length;
    if (!hasData) return null;

    return {
      home: { name: home },
      away: { name: away },
      start: startMs,
      league: sportInfo?.league || null,
      leagueName: sportInfo?.name || ev.sport_title,
      sport: sportInfo?.sport || 'soccer',
      markets
    };
  }
}

module.exports = { OddsApiSource, BOOK_MAP, SPORT_MAP };
