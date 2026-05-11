/* Scraper: caliente (LOTBA AR) — usa deepCapture (shape-agnostic) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'caliente',
  urls: [
    'https://www.caliente.bet/sports/',
    'https://www.caliente.bet/sports/soccer',
    'https://www.caliente.bet/'
  ],
  timeoutMs: 35000,
  scrollPasses: 3
});
