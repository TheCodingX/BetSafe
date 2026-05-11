/* BetSafe — Source: ESPN (API pública)
 * ============================================================================
 * ESPN expone endpoints públicos sin auth:
 *   /apis/site/v2/sports/{sport}/{league}/scoreboard  → eventos del día
 *   /apis/site/v2/sports/{sport}/{league}/teams       → IDs de equipos
 *
 * Cubre principalmente sports US (NBA, NFL, MLB, NHL) y soccer.
 * Como SofaScore: aporta fixtures + equipos pero NO odds (priority 8).
 *
 * Para soccer/Argentina específicamente, ESPN tiene cobertura limitada de
 * LPF — la mejor fuente sigue siendo The Odds API + scrapers AR.
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');
const { httpJson, log } = require('../lib');

const ESPN_LEAGUES = {
  soccer: [
    { path: 'soccer/eng.1',           league: 'epl',         name: 'Premier League' },
    { path: 'soccer/esp.1',           league: 'laliga',      name: 'La Liga' },
    { path: 'soccer/ita.1',           league: 'seriea',      name: 'Serie A' },
    { path: 'soccer/ger.1',           league: 'bundesliga',  name: 'Bundesliga' },
    { path: 'soccer/fra.1',           league: 'ligue1',      name: 'Ligue 1' },
    { path: 'soccer/uefa.champions',  league: 'ucl',         name: 'Champions League' },
    { path: 'soccer/arg.1',           league: 'lpf',         name: 'Liga Profesional Argentina' },
    { path: 'soccer/conmebol.libertadores', league: 'libertadores', name: 'Copa Libertadores' }
  ],
  basketball: [{ path: 'basketball/nba',  league: 'nba',  name: 'NBA' }],
  amfootball: [{ path: 'football/nfl',    league: 'nfl',  name: 'NFL' }],
  baseball:   [{ path: 'baseball/mlb',    league: 'mlb',  name: 'MLB' }],
  hockey:     [{ path: 'hockey/nhl',      league: 'nhl',  name: 'NHL' }]
};

class EspnSource extends SourceBase {
  constructor() {
    // priority 0 — corre primero, API estable sin protección
    super({ name: 'espn', priority: 0, timeoutMs: 30000 });
  }

  covers(sport) {
    return !!ESPN_LEAGUES[sport];
  }

  async fetch(sports) {
    const out = [];
    for (const sp of (sports || ['soccer'])) {
      const leagues = ESPN_LEAGUES[sp];
      if (!leagues) continue;
      for (const lg of leagues) {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${lg.path}/scoreboard`;
          const data = await httpJson(url, { timeout: 10000 });
          const events = data.events || [];
          for (const ev of events) {
            const mapped = this.normalize(ev, sp, lg);
            if (mapped) out.push(mapped);
          }
        } catch (e) {
          log(`[espn:${lg.league}] err ${e?.message?.slice(0, 80)}`);
        }
      }
    }
    return out;
  }

  normalize(ev, sport, lg) {
    const comps = ev.competitions?.[0]?.competitors || [];
    const home = comps.find(c => c.homeAway === 'home');
    const away = comps.find(c => c.homeAway === 'away');
    if (!home || !away) return null;
    const homeName = home.team?.displayName || home.team?.name;
    const awayName = away.team?.displayName || away.team?.name;
    if (!homeName || !awayName) return null;
    const start = ev.date ? new Date(ev.date).getTime() : null;
    if (!start) return null;
    return {
      home: { name: homeName },
      away: { name: awayName },
      start,
      league: lg.league,
      leagueName: lg.name,
      sport,
      markets: {}
    };
  }
}

module.exports = { EspnSource };
