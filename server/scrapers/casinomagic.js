/* Scraper: Casino Magic (LOTBA / IPLyC, opera Magic) */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'casinomagic',
  pageUrl: 'https://www.casinomagiconline.com.ar/sports',
  xhrPattern: /\/(api|sportsbook|sb)\/(events?|fixtures?|markets?|odds)/i,
  extractor: 'generic',
  settleMs: 3500,
  htmlSelectors: {
    card: '[class*="event-card"], [class*="match"], [data-event-id]',
    team: '[class*="participant"], [class*="team-name"]',
    odd: '[class*="odd-value"], [class*="price-button"]'
  }
});
