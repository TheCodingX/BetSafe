/* BetSafe — Source: SofaScore (API pública)
 * ============================================================================
 * SofaScore tiene una API pública no documentada que sirve para complementar
 * fixtures. NO trae cuotas (de eso se encargan The Odds API + scrapers AR),
 * pero sí trae:
 *   - Calendarios oficiales de partidos
 *   - Equipos con nombres canónicos
 *   - Resultados live (para tracker)
 *
 * Cloudflare blackholea las IPs cloud (Render) → si está SCRAPINGBEE_KEY
 * usamos ese path PRIMARIO. Fallback a native HTTPS para deploys
 * residenciales / dev local.
 *
 * Estrategia de costo (ScrapingBee):
 *   - Solo soccer (el deporte de mayor valor para nuestra audiencia AR).
 *   - Cache 10min × budget multiplier.
 *   - ~10 créditos/call × 6 calls/hr × 24h × 30d = 43k créditos/mes.
 *
 * Endpoint base: api.sofascore.com/api/v1/sport/{sport}/scheduled-events/{date}
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');
const { httpJsonNative, httpJsonViaScrapingBee, getCreditBudgetMultiplier, log, sleep } = require('../lib');
const { CircuitBreaker } = require('../lib/retry');

// Breaker para native HTTPS (Cloudflare-vulnerable).
const directBreaker = new CircuitBreaker({ name: 'sofascore:direct', failThreshold: 3, cooldownMs: 5 * 60_000, maxCooldownMs: 30 * 60_000 });
// Breaker para ScrapingBee (cuando hay quota/auth issues, no insistir cada ciclo).
const sbeeBreaker = new CircuitBreaker({ name: 'sofascore:sbee', failThreshold: 2, cooldownMs: 10 * 60_000 });

// Cache module-level. Sin esto cada ciclo (30s) consumiría créditos de balde.
// Con SCRAPINGBEE_KEY: TTL 10min × budget multiplier. Sin key: 60s.
let cachedEvents = [];
let cachedAt = 0;

const SPORT_PATHS = {
  soccer:     'football',
  basketball: 'basketball',
  tennis:     'tennis',
  amfootball: 'american-football',
  baseball:   'baseball',
  hockey:     'ice-hockey'
};

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Referer': 'https://www.sofascore.com/',
  'Origin': 'https://www.sofascore.com',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

class SofaScoreSource extends SourceBase {
  constructor() {
    super({ name: 'sofascore', priority: 0, timeoutMs: 30000 });
  }

  covers(sport) {
    return ['soccer', 'basketball', 'tennis', 'amfootball', 'baseball', 'hockey'].includes(sport);
  }

  async fetch(sports) {
    // Cache check primero — evita gastar créditos si hay data fresca.
    const baseCacheMs = process.env.SCRAPINGBEE_KEY
      ? Number(process.env.SOFASCORE_CACHE_MS) || 10 * 60_000
      : 60_000;
    const cacheTtl = process.env.SCRAPINGBEE_KEY
      ? baseCacheMs * getCreditBudgetMultiplier()
      : baseCacheMs;
    if (cachedEvents.length && Date.now() - cachedAt < cacheTtl) return cachedEvents;

    // Subset de sports a pegarle. Con sbee: por costo, solo soccer (es lo
    // más valioso para AR + el único que se va a usar en arbitrage). Con
    // native: todos los sports (es gratis).
    let activeSports;
    if (process.env.SCRAPINGBEE_KEY) {
      const wanted = (process.env.SOFASCORE_SBEE_SPORTS || 'soccer')
        .split(',').map(s => s.trim()).filter(Boolean);
      activeSports = (sports || ['soccer']).filter(sp => wanted.includes(sp));
    } else {
      activeSports = sports || ['soccer'];
    }

    const out = [];
    let fetchedFromSbee = false;

    for (const sp of activeSports) {
      const path = SPORT_PATHS[sp];
      if (!path) continue;
      const today = new Date().toISOString().slice(0, 10);
      const url = `https://api.sofascore.com/api/v1/sport/${path}/scheduled-events/${today}`;

      let data = null;

      // Path 1: ScrapingBee (si key seteada)
      if (process.env.SCRAPINGBEE_KEY) {
        if (sbeeBreaker.state !== 'OPEN' || (sbeeBreaker._maybeReset(), sbeeBreaker.state !== 'OPEN')) {
          try {
            const r = await sbeeBreaker.exec(() => httpJsonViaScrapingBee(url, {
              timeout: 30000, premium: true, renderJs: false, country: 'ar', tag: `sofascore:${sp}`
            }));
            data = r.json;
            fetchedFromSbee = true;
            log(`[sofascore:sbee:${sp}] ${(data?.events || []).length} eventos · ${r.costCredits} créditos`);
          } catch (e) {
            if (!e?.circuitOpen) log(`[sofascore:sbee:${sp}] err ${e.message?.slice(0, 120)}`);
          }
        }
      }

      // Path 2: Native HTTPS (fallback o single-path si no hay key)
      if (!data) {
        try {
          data = await directBreaker.exec(() => httpJsonNative(url, { timeout: 12000, headers: HEADERS }));
        } catch (e) {
          if (!e?.circuitOpen) log(`[sofascore:direct:${sp}] err ${e?.message?.slice(0, 80)}`);
          if (e?.circuitOpen && !process.env.SCRAPINGBEE_KEY) break;
        }
      }

      const events = data?.events || [];
      for (const ev of events) {
        const mapped = this.normalize(ev, sp);
        if (mapped) out.push(mapped);
      }

      // Respiro entre sports SOLO en native path (sbee tiene sus propios rate limits)
      if (!fetchedFromSbee) await sleep(800);
    }

    if (out.length) {
      cachedEvents = out;
      cachedAt = Date.now();
    }
    return out;
  }

  normalize(ev, sport) {
    const home = ev.homeTeam?.name;
    const away = ev.awayTeam?.name;
    if (!home || !away) return null;
    const start = ev.startTimestamp ? ev.startTimestamp * 1000 : null;
    if (!start) return null;
    return {
      home: { name: home },
      away: { name: away },
      start,
      league: null,
      leagueName: ev.tournament?.name || ev.season?.name || null,
      sport,
      markets: {}   // SofaScore no expone odds en este endpoint
    };
  }
}

// Expose breakers para /api/breakers
SofaScoreSource.prototype.breakers = { direct: directBreaker, sbee: sbeeBreaker };
SofaScoreSource.prototype.clearCache = function () { cachedEvents = []; cachedAt = 0; };

module.exports = { SofaScoreSource };
