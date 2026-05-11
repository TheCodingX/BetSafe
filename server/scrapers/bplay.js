/* Scraper: Bplay (LOTBA AR — https://bplay.com.ar)
 * Usa deepCapture: intercepta TODOS los XHR/Fetch responses y autodetecta
 * los eventos por shape. Más robusto que selectores específicos.
 */
'use strict';

module.exports = require('./_buildScraper')({
  bookKey: 'bplay',
  urls: [
    'https://www.bplay.com.ar/apuestas-deportivas',
    'https://www.bplay.com.ar/apuestas/futbol',
    'https://www.bplay.com.ar/'
  ],
  timeoutMs: 35000,
  scrollPasses: 4
});
