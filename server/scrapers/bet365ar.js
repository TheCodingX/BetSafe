/* Scraper: Bet365 Argentina */
'use strict';
module.exports = require('./_genericSpa')({
  name: 'bet365ar',
  pageUrl: 'https://www.bet365.com.ar/#/AS/B1/',
  xhrPattern: /\/(api|public)\/(events?|fixture|odds|inplay|prematch|sportsbook)/i,
  extractor: 'generic',
  settleMs: 4000,
  htmlSelectors: {
    card: 'div[class*="ovm-Fixture"], div[class*="rcl-MatchLineParticipants"]',
    team: 'div[class*="ovm-FixtureDetailsTwoWay_Team"], span[class*="rcl-ParticipantFixture"]',
    odd: 'span[class*="ovm-Participant_Odds"], span[class*="gll-Participant_Odds"]'
  }
});
