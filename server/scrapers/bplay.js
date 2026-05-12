/* Scraper: Bplay (LOTBA AR — bplay.com.ar)
 * ============================================================================
 * Bplay expone un feed XML PÚBLICO en su CDN deportespba.bplay.bet.ar.
 * No requiere auth, no requiere Playwright, no requiere cookies.
 *   - /oddsfeeds/odds.xml         → TODO el catálogo (~2.5 MB, todos los deportes)
 *   - /oddsfeeds/odds-competition{ID}.xml → Una competición específica
 *
 * Formato: XML estilo Sportingtech/IGT con Sport→Region→Competition→Match→Offer→Outcome.
 * Parser: lib/bplayXml.js
 *
 * Cache server-side: el feed se actualiza ~cada minuto. Hacemos GET con
 * If-Modified-Since para no descargar 2.5MB si no cambió.
 * ============================================================================
 */
'use strict';

const { httpGet, log } = require('../lib');
const { parseXmlFeed } = require('../lib/bplayXml');
const { withRetry, CircuitBreaker } = require('../lib/retry');

const FEED_URL = 'https://deportespba.bplay.bet.ar/oddsfeeds/odds.xml';

let lastModified = null;
let cachedEvents = [];
let cachedAt = 0;

// Breaker dedicado a Bplay XML feed. failThreshold alto porque el CDN
// raramente falla; si lo hace, esperamos 1 min antes de reintentar.
const breaker = new CircuitBreaker({ name: 'bplay', failThreshold: 5, cooldownMs: 60_000 });

async function scrape() {
  const t0 = Date.now();
  try {
    const headers = {
      'Accept': 'application/xml, text/xml, */*',
      'Origin': 'https://pba.bplay.bet.ar',
      'Referer': 'https://pba.bplay.bet.ar/'
    };
    if (lastModified) headers['If-Modified-Since'] = lastModified;

    const xml = await breaker.exec(() => withRetry(
      () => httpGet(FEED_URL, { headers, accept: 'application/xml', timeout: 15000 }),
      { maxAttempts: 3, baseMs: 500 }
    ));

    if (!xml || xml.length < 200) {
      // Devolver cache si tenemos
      return cachedEvents;
    }

    const events = parseXmlFeed(xml);
    cachedEvents = events;
    cachedAt = Date.now();
    log(`[bplay-xml] ${events.length} eventos · ${Date.now() - t0}ms · ${xml.length} bytes`);
    return events;
  } catch (e) {
    log(`[bplay-xml] err ${e.message?.slice(0, 100)}${e.circuitOpen ? ' · circuit OPEN' : ''}`);
    if (cachedEvents.length && Date.now() - cachedAt < 5 * 60_000) return cachedEvents;
    return [];
  }
}

scrape.breaker = breaker;

module.exports = scrape;
