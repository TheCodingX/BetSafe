/* Scraper: jugadon (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'jugadon',
  urls: [
    'https://www.jugadon.bet.ar/deportes',
    'https://www.jugadon.bet.ar/sports',
    'https://www.jugadon.bet.ar/'
  ],
  timeoutMs: 30000,
  scrollPasses: 3
});
