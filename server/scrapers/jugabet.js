/* Scraper: JugaBet (LOTBA) */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'jugabet',
  pageUrl: 'https://www.jugabet.com.ar/deportes',
  xhrPattern: /\/(api|sb|sportsbook)\/(events?|fixtures?|markets?|odds)/i,
  extractor: 'generic',
  settleMs: 3000,
  htmlSelectors: {
    card: '[class*="event"], [class*="match-card"]',
    team: '[class*="team"], [class*="participant"]',
    odd: '[class*="odd"], [class*="price"]'
  }
});
