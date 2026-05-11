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

class OddsApiSource extends SourceBase {
  constructor({ apiKey, sportsKeys, region = 'eu', markets } = {}) {
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
  }

  covers(sport) {
    // The Odds API cubre todos los deportes principales
    return ['soccer', 'basketball', 'amfootball', 'baseball', 'hockey', 'tennis', 'mma'].includes(sport);
  }

  async fetch(/* sports */) {
    if (!this.apiKey) {
      throw new Error('THE_ODDS_API_KEY no configurada');
    }

    const allEvents = [];
    // Pedimos cada sport por separado (la API es sport-by-sport).
    // Con 19 sports y region=eu, son 19 requests por ciclo = ~1.1M/mes
    // a 30s/ciclo. Con region=eu+uk = 2.2M (plan paid). Sin paid: bajar a
    // 5-6 sports principales = 175k/mes (plan $30/mes alcanza).
    for (const sportKey of this.sportsKeys) {
      try {
        const events = await this.fetchSport(sportKey);
        allEvents.push(...events);
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

  async fetchSport(sportKey) {
    const url = `${this.endpoint}/sports/${encodeURIComponent(sportKey)}/odds/`
              + `?apiKey=${this.apiKey}`
              + `&regions=${this.region}`
              + `&markets=${this.markets.join(',')}`
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
