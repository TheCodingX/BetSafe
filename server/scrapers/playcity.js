/* Scraper: playcity (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'playcity',
  urls: [
    'https://www.playcity.com.ar/apuestas-deportivas',
    'https://www.playcity.com.ar/sports',
    'https://www.playcity.com.ar/'
  ],
  timeoutMs: 30000,
  scrollPasses: 3
});
