/* Scraper: MegaPuesta (LOTBA) */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'megapuesta',
  pageUrl: 'https://www.megapuesta.com.ar/sports',
  xhrPattern: /\/(api|sb|sportsbook)\/(events?|fixtures?|markets?|odds)/i,
  extractor: 'generic',
  settleMs: 3000,
  htmlSelectors: {
    card: '[class*="event"], [class*="match"]',
    team: '[class*="team"], [class*="participant"]',
    odd: '[class*="odd"], [class*="price"]'
  }
});
