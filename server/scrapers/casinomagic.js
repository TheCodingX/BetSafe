/* Scraper: casinomagic (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'casinomagic',
  urls: [
    'https://www.casinomagiconline.com.ar/apuestas-deportivas',
    'https://www.casinomagiconline.com.ar/sports',
    'https://www.casinomagiconline.com.ar/'
  ],
  timeoutMs: 35000,
  scrollPasses: 3
});
