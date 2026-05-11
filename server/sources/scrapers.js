/* BetSafe — Source: scrapers wrapper
 * ============================================================================
 * Envuelve los 12 scrapers individuales (server/scrapers/<id>.js) en la
 * interfaz unificada SourceBase. Cada scraper queda como una "sub-source"
 * con su propia priority — las que The Odds API NO cubre tienen priority alta
 * (=fuente única, irreemplazable), las que sí cubre tienen priority baja
 * (=fallback, principal valor: cross-validation).
 *
 * Prioridades:
 *   - bplay, betwarrior, codere, caliente, casinomagic, jugabet, 24bet,
 *     playcity, megapuesta  →  priority 2 (fuente única para esas casas)
 *   - betano, bet365ar, betsson                                   →  priority 4 (fallback)
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');
const { log } = require('../lib');

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

const UNIQUE_BOOKS = new Set([
  'bplay', 'betwarrior', 'codere', 'caliente', 'casinomagic',
  'jugabet', '24bet', 'playcity', 'megapuesta'
]);

class ScraperSource extends SourceBase {
  constructor({ bookKey }) {
    super({
      name: 'scraper:' + bookKey,
      priority: UNIQUE_BOOKS.has(bookKey) ? 2 : 4
    });
    this.bookKey = bookKey;
    this.scrape = SCRAPERS[bookKey];
  }

  covers(sport) {
    // Los scrapers AR cubren principalmente soccer + algunos básquet/tennis.
    // No cubren NFL/MLB/NHL (sin presencia AR significativa).
    return ['soccer', 'basketball', 'tennis', 'mma'].includes(sport);
  }

  async fetch(sports) {
    if (!this.scrape) return [];
    const events = await this.scrape({ sports });
    if (!Array.isArray(events)) return [];

    // Envolver: cada evento agrega su mercado bajo this.bookKey
    return events.map(ev => {
      if (!ev) return null;
      const wrapped = {
        home: ev.home,
        away: ev.away,
        start: ev.start,
        league: ev.league,
        leagueName: ev.leagueName,
        sport: ev.sport,
        markets: {}
      };
      if (ev.markets) {
        for (const [marketName, marketData] of Object.entries(ev.markets)) {
          if (!wrapped.markets[marketName]) wrapped.markets[marketName] = {};
          wrapped.markets[marketName][this.bookKey] = marketData;
        }
      }
      return wrapped;
    }).filter(Boolean);
  }
}

/** Crea las 12 sources scraper, una por cada bookmaker AR. */
function createAllScraperSources(enabledBooks) {
  const keys = enabledBooks && enabledBooks.length ? enabledBooks : Object.keys(SCRAPERS);
  return keys.filter(k => SCRAPERS[k]).map(k => new ScraperSource({ bookKey: k }));
}

module.exports = { ScraperSource, createAllScraperSources, UNIQUE_BOOKS };
