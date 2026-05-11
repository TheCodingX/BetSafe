/* Scraper: Codere Argentina */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'codere',
  pageUrl: 'https://www.codere.bet.ar/deportes/#/HomePage',
  xhrPattern: /\/(api|graphql|sportsbook|fdr|orchestrator)\/(events?|fixtures?|markets?|odds|leagues?)/i,
  extractor: 'generic',
  settleMs: 3500,
  htmlSelectors: {
    card: '[class*="event"], [class*="match-row"], [data-event-id]',
    team: '[class*="team-name"], [class*="participant"]',
    odd: '[class*="odd"], [class*="quota"], [class*="price"]'
  }
});
