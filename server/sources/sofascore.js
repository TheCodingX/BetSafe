/* BetSafe — Source: SofaScore (API pública)
 * ============================================================================
 * SofaScore tiene una API pública no documentada que sirve para complementar
 * fixtures. NO trae cuotas (de eso se encargan The Odds API + scrapers AR),
 * pero sí trae:
 *   - Calendarios oficiales de partidos
 *   - Equipos con nombres canónicos
 *   - Resultados live (para tracker)
 *
 * Uso: source priority 7 (suplementaria). Si las casas AR no exponen un
 * partido pero SofaScore sí, le damos al usuario al menos la info del
 * partido aunque sin cuota (UI muestra "sin cuota disponible").
 *
 * Endpoint base: api.sofascore.com/api/v1/sport/{sport}/scheduled-events/{date}
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');
const { httpJsonNative, log, sleep } = require('../lib');
const { CircuitBreaker } = require('../lib/retry');

// SofaScore Cloudflare es agresivo sobre IPs de cloud (Render). Si nos
// devuelve 403 sostenidamente abrimos breaker para no quemar requests
// (no aporta odds, solo fixtures — failure es tolerable).
const breaker = new CircuitBreaker({ name: 'sofascore', failThreshold: 3, cooldownMs: 5 * 60_000, maxCooldownMs: 30 * 60_000 });

class SofaScoreSource extends SourceBase {
  constructor() {
    // priority 0 (más alta) — corre primero porque es API rápida y confiable
    super({ name: 'sofascore', priority: 0, timeoutMs: 20000 });
  }

  covers(sport) {
    return ['soccer', 'basketball', 'tennis', 'amfootball', 'baseball', 'hockey'].includes(sport);
  }

  async fetch(sports) {
    const out = [];
    const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
    const sportPaths = {
      soccer:     'football',
      basketball: 'basketball',
      tennis:     'tennis',
      amfootball: 'american-football',
      baseball:   'baseball',
      hockey:     'ice-hockey'
    };
    for (const sp of (sports || ['soccer'])) {
      const path = sportPaths[sp];
      if (!path) continue;
      // 1 sport por iteración, 1 request, sleep 800ms entre sports.
      // SofaScore tiene anti-abuse: requests rapid-fire dan 403 ~5 min.
      const url = `https://api.sofascore.com/api/v1/sport/${path}/scheduled-events/${today}`;
      try {
        // httpJsonNative usa el módulo `https` nativo (TLS fingerprint
        // distinto de undici) → mejor chance de pasar Cloudflare en Render.
        const data = await breaker.exec(() => httpJsonNative(url, {
          timeout: 12000,
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
            'Referer': 'https://www.sofascore.com/',
            'Origin': 'https://www.sofascore.com',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }));
        const events = data?.events || [];
        for (const ev of events) {
          const mapped = this.normalize(ev, sp);
          if (mapped) out.push(mapped);
        }
      } catch (e) {
        // En modo OPEN del breaker no spammear logs
        if (!e?.circuitOpen) log(`[sofascore:${sp}] err ${e?.message?.slice(0, 80)}`);
        if (e?.circuitOpen) break;   // si breaker abrió, parar el loop entero
      }
      // Respiro entre sports para no triggear rate limit
      await sleep(800);
    }
    return out;
  }

  normalize(ev, sport) {
    const home = ev.homeTeam?.name;
    const away = ev.awayTeam?.name;
    if (!home || !away) return null;
    const start = ev.startTimestamp ? ev.startTimestamp * 1000 : null;
    if (!start) return null;
    return {
      home: { name: home },
      away: { name: away },
      start,
      league: null,
      leagueName: ev.tournament?.name || ev.season?.name || null,
      sport,
      markets: {}   // SofaScore no expone odds en este endpoint
    };
  }
}

module.exports = { SofaScoreSource };
