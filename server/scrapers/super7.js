/* Scraper: super7 (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'super7',
  urls: [
    'https://www.super7.bet.ar/sportsbook',
    'https://www.super7.bet.ar/apuestas',
    'https://www.super7.bet.ar/'
  ],
  timeoutMs: 30000,
  scrollPasses: 3
});
