/* Scraper: codere (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'codere',
  urls: [
    'https://www.codere.bet.ar/deportes/',
    'https://www.codere.bet.ar/deportes/futbol/',
    'https://www.codere.bet.ar/'
  ],
  timeoutMs: 35000,
  scrollPasses: 3
});
