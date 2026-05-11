/* Scraper: betsson (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'betsson',
  urls: [
    'https://www.betsson.bet.ar/sport/futbol',
    'https://www.betsson.bet.ar/sport/',
    'https://www.betsson.bet.ar/'
  ],
  timeoutMs: 35000,
  scrollPasses: 3
});
