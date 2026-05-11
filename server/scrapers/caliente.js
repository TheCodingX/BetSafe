/* Scraper: Caliente.bet (PlayCity Group, opera bajo licencia LOTBA en AR) */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'caliente',
  pageUrl: 'https://www.caliente.bet/sports/',
  xhrPattern: /\/(api|sb|sports?)\/(events?|fixtures?|markets?|odds|sportsbook)/i,
  extractor: 'generic',
  settleMs: 3000,
  htmlSelectors: {
    card: '[class*="event-row"], [class*="MatchCard"], [data-event]',
    team: '[class*="competitor"], [class*="team-name"]',
    odd: '[class*="odd"], [class*="OddValue"], [class*="price"]'
  }
});
