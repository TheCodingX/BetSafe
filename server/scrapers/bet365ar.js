/* Scraper: bet365ar (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'bet365ar',
  urls: [
    'https://www.bet365.bet.ar/#/AS/B1/',
    'https://www.bet365.bet.ar/#/HO/',
    'https://www.bet365.bet.ar/'
  ],
  timeoutMs: 45000,
  scrollPasses: 2
});
