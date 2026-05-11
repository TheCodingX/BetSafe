/* Scraper: Betfun (LOTBA AR) */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'betfun',
  pageUrl: 'https://www.betfun.bet.ar/sport',
  xhrPattern: /\/(api|sb|sportsbook)\/(events?|fixtures?|markets?|odds|live|prematch)/i,
  extractor: 'generic',
  settleMs: 3000,
  htmlSelectors: {
    card: '[class*="event"], [class*="match"]',
    team: '[class*="team"], [class*="participant"]',
    odd: '[class*="odd"], [class*="price"]'
  }
});
