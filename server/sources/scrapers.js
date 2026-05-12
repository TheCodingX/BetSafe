/* BetSafe — Source: scrapers wrapper
 * ============================================================================
 * Envuelve los scrapers individuales (server/scrapers/<id>.js) en la interfaz
 * unificada SourceBase. Cada scraper queda como una "sub-source" con su propia
 * priority — las que The Odds API NO cubre tienen priority alta (=fuente única,
 * irreemplazable), las que sí cubre tienen priority baja (=fallback / cross-val).
 *
 * Casas activas (4 scraping dedicado + 2 via Odds API):
 *   - bplay        → priority 2 (XML público — fuente única)
 *   - betwarrior   → priority 2 (Kambi API — fuente única)
 *   - codere       → priority 2 (NavigationService — fuente única)
 *   - betano       → priority 4 (Kaizen JSON + Playwright — fallback)
 *   - bet365 AR + betsson → cubiertos directamente por The Odds API
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');

const SCRAPERS = {
  bplay:        require('../scrapers/bplay'),
  betano:       require('../scrapers/betano'),
  betwarrior:   require('../scrapers/betwarrior'),
  codere:       require('../scrapers/codere')
};

// Casas cuyo scraper es la ÚNICA fuente (The Odds API no las cubre)
const UNIQUE_BOOKS = new Set(['bplay', 'betwarrior', 'codere']);

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

/** Crea las sources scraper para cada bookmaker AR activo. */
function createAllScraperSources(enabledBooks) {
  const keys = enabledBooks && enabledBooks.length ? enabledBooks : Object.keys(SCRAPERS);
  return keys.filter(k => SCRAPERS[k]).map(k => new ScraperSource({ bookKey: k }));
}

module.exports = { ScraperSource, createAllScraperSources, UNIQUE_BOOKS };
