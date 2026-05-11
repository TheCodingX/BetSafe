/* Scraper: betfun (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'betfun',
  urls: [
    'https://www.betfun.bet.ar/sports',
    'https://www.betfun.bet.ar/apuestas',
    'https://www.betfun.bet.ar/'
  ],
  timeoutMs: 30000,
  scrollPasses: 3
});
