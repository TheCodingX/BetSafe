/* Scraper: BetWarrior AR (LOTBA) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'betwarrior',
  urls: [
    'https://www.betwarrior.bet.ar/sports/futbol/',
    'https://www.betwarrior.bet.ar/sports/',
    'https://www.betwarrior.bet.ar/'
  ],
  timeoutMs: 30000,
  scrollPasses: 3
});
