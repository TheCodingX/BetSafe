/* Scraper: Super7 (LOTBA AR - Casino + apuestas deportivas) */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'super7',
  pageUrl: 'https://www.super7.bet.ar/sportbook',
  xhrPattern: /\/(api|sb|sportsbook)\/(events?|fixtures?|markets?|odds)/i,
  extractor: 'generic',
  settleMs: 3000,
  htmlSelectors: {
    card: '[class*="event"], [class*="match"]',
    team: '[class*="team"], [class*="participant"]',
    odd: '[class*="odd"], [class*="price"]'
  }
});
