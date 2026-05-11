/* Scraper: 24bet (LOTBA AR) */
'use strict';
module.exports = require('./_genericSpa')({
  name: '24bet',
  pageUrl: 'https://www.24bet.ar/sport',
  xhrPattern: /\/(api|sb|sportsbook)\/(events?|fixtures?|markets?|odds|live|prematch)/i,
  extractor: 'generic',
  settleMs: 3000,
  htmlSelectors: {
    card: '[class*="event"], [class*="match"]',
    team: '[class*="team"], [class*="participant"]',
    odd: '[class*="odd"], [class*="price"], button[class*="quota"]'
  }
});
