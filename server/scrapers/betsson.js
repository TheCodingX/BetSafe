/* Scraper: Betsson Argentina */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'betsson',
  pageUrl: 'https://www.betsson.bet.ar/sport/futbol',
  xhrPattern: /\/(api|sb|betting|sportsbook|odds-api)\/(events?|fixtures?|markets?|odds)/i,
  extractor: 'generic',
  settleMs: 3500,
  htmlSelectors: {
    card: '[class*="event-row"], [class*="match-row"], [data-test-id*="event"]',
    team: '[class*="participant"], [class*="team-name"], [data-test*="competitor"]',
    odd: '[class*="odd"], [data-test*="price"], button[class*="odds"]'
  }
});
