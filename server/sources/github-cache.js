/* BetSafe — Source: GitHub Actions JSON cache
 * ============================================================================
 * ULTIMATE FALLBACK cuando todos los scrapers directos fallan en Render.
 *
 * GitHub Actions corre `scrape-and-cache.js` cada hora y pushea el JSON a
 * `public/data/scraped-events.json`. Este source lee esa URL desde raw.github
 * y la usa para popular eventos cuando los scrapers locales no devolvieron data.
 *
 * Por qué funciona:
 *   - GH Actions corre en runners US con IPs distintas a Render
 *   - No están baneados por CF de Betano
 *   - Puede usar Playwright sin restricciones de CPU
 *
 * Trade-offs:
 *   - Latencia: 1h refresh (vs ~30s real-time)
 *   - Solo activo si scrapers directos fallan (priority alta = fallback)
 *
 * Config (opcional, defaults OK):
 *   - GH_CACHE_URL: URL del raw JSON (default usa el repo TheCodingX/BetSafe)
 *   - GH_CACHE_MAX_AGE_HOURS: max edad aceptable (default 6h)
 * ============================================================================
 */
'use strict';

const { SourceBase } = require('./_adapter');
const { httpJson, log } = require('../lib');
const { CircuitBreaker } = require('../lib/retry');

const DEFAULT_URL = 'https://raw.githubusercontent.com/TheCodingX/BetSafe/main/public/data/scraped-events.json';
const META_URL_SUFFIX = '/scraped-events.meta.json';

class GithubCacheSource extends SourceBase {
  constructor() {
    super({
      name: 'github-cache',
      // Priority 5 = ULTIMATE fallback. Solo usado cuando scrapers directos no
      // dieron eventos. El orchestrator merge priorities elige scraper directo
      // (priority 2) sobre github-cache (5) cuando ambos tienen el evento.
      priority: 5,
      timeoutMs: 15000
    });
    this.url = process.env.GH_CACHE_URL || DEFAULT_URL;
    this.maxAgeMs = Number(process.env.GH_CACHE_MAX_AGE_HOURS || 6) * 3600_000;
    this.breaker = new CircuitBreaker({ name: 'github-cache', failThreshold: 3, cooldownMs: 5 * 60_000 });
    this.cachedEvents = [];
    this.cachedAt = 0;
    this.localCacheTtlMs = 25 * 60_000;  // 25min (medio del refresh hourly)
  }

  covers(sport) {
    return ['soccer', 'basketball', 'tennis', 'mma'].includes(sport);
  }

  async fetch(/* sports */) {
    // Si está disabled explícitamente, skip
    if (process.env.DISABLE_GITHUB_CACHE === 'true') return [];

    // Local cache: si ya bajamos hace <25min, devolver lo mismo
    if (this.cachedEvents.length && Date.now() - this.cachedAt < this.localCacheTtlMs) {
      return this.cachedEvents;
    }

    try {
      const events = await this.breaker.exec(() => this._fetchFromGithub());
      if (Array.isArray(events) && events.length > 0) {
        this.cachedEvents = events;
        this.cachedAt = Date.now();
        log(`[github-cache] ${events.length} events loaded from GH raw`);
        return events;
      }
    } catch (e) {
      // No es crítico — es solo un fallback
      log(`[github-cache] err: ${e.message?.slice(0, 100)}`);
    }
    // Si fallamos pero teníamos cache local viejo (<2h), devolvémoslo
    if (this.cachedEvents.length && Date.now() - this.cachedAt < 2 * 3600_000) {
      return this.cachedEvents;
    }
    return [];
  }

  async _fetchFromGithub() {
    // Cache-bust con timestamp pa que GH no nos sirva versión vieja del CDN
    const url = `${this.url}?t=${Math.floor(Date.now() / 60_000)}`;
    const events = await httpJson(url, {
      timeout: this.timeoutMs,
      headers: { 'Accept': 'application/json' }
    });
    if (!Array.isArray(events)) {
      throw new Error(`unexpected format: ${typeof events}`);
    }

    // Verificar edad del cache via meta file
    try {
      const metaUrl = this.url.replace('scraped-events.json', 'scraped-events.meta.json');
      const meta = await httpJson(`${metaUrl}?t=${Math.floor(Date.now() / 60_000)}`, {
        timeout: 8000
      });
      const ageHours = (Date.now() - (meta?.ts || 0)) / 3600_000;
      if (ageHours > this.maxAgeMs / 3600_000) {
        log(`[github-cache] cache too old: ${ageHours.toFixed(1)}h > ${this.maxAgeMs/3600000}h max — skip`);
        return [];
      }
    } catch (_) {
      // Meta opcional, si falla seguimos con los events
    }

    // Re-wrap en formato de orchestrator (markets ya vienen con sub-key bookKey)
    return events
      .filter(ev => ev && ev.home && ev.away && ev.start)
      .map(ev => ({
        home: ev.home,
        away: ev.away,
        start: ev.start,
        league: ev.league,
        leagueName: ev.leagueName,
        sport: ev.sport,
        markets: ev.markets || {}
      }));
  }

  // Expose breaker para /api/breakers
  get breakers() { return { 'github-cache': this.breaker }; }
}

module.exports = { GithubCacheSource };
