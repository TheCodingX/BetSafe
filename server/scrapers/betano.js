/* Scraper: Betano AR (Kaizen Gaming — betano.bet.ar) */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'betano',
  urls: [
    'https://www.betano.bet.ar/sport/futbol/partidos-de-hoy/',
    'https://www.betano.bet.ar/sport/futbol/',
    'https://www.betano.bet.ar/'
  ],
  timeoutMs: 30000,
  scrollPasses: 3
});
