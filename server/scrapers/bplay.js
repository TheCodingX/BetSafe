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

const { httpGet, httpGetNative, httpViaScrapingBee, log } = require('../lib');
const { parseXmlFeed } = require('../lib/bplayXml');
const { withRetry, CircuitBreaker } = require('../lib/retry');

const FEED_URL = 'https://deportespba.bplay.bet.ar/oddsfeeds/odds.xml';

let cachedEvents = [];
let cachedAt = 0;

const breaker = new CircuitBreaker({ name: 'bplay', failThreshold: 5, cooldownMs: 60_000 });

async function scrape() {
  const t0 = Date.now();
  try {
    const headers = {
      'Accept': 'application/xml, text/xml, */*',
      'Origin': 'https://pba.bplay.bet.ar',
      'Referer': 'https://pba.bplay.bet.ar/',
      'Cache-Control': 'no-cache'
    };

    // Intentamos primero con undici (httpGet). Si devuelve <200 bytes,
    // re-intentamos con httpGetNative (https module) que tiene TLS fingerprint
    // distinto. A veces CDNs como Cloudflare devuelven splash a undici.
    let xml = await breaker.exec(() => withRetry(
      () => httpGet(FEED_URL, { headers, accept: 'application/xml', timeout: 15000 }),
      { maxAttempts: 2, baseMs: 500 }
    )).catch(e => { log(`[bplay-xml] httpGet falló: ${e.message?.slice(0,100)}`); return null; });

    if (!xml || xml.length < 1000) {
      log(`[bplay-xml] respuesta corta (${xml?.length || 0} bytes), trying httpGetNative...`);
      try {
        xml = await httpGetNative(FEED_URL, { headers, timeout: 20000 });
      } catch (e) {
        log(`[bplay-xml] httpGetNative también falló: ${e.message?.slice(0,100)}`);
      }
    }

    // 3RD-TIER FALLBACK: ScrapingBee con IP AR (~5 créditos sin render_js)
    if ((!xml || xml.length < 1000) && process.env.SCRAPINGBEE_KEY) {
      log(`[bplay-xml] tirando ScrapingBee como último recurso`);
      try {
        const r = await httpViaScrapingBee(FEED_URL, {
          timeout: 30000,
          premium: true,
          renderJs: false,
          country: 'ar',
          json: false,
          tag: 'bplay:xml'
        });
        if (r?.text && r.text.length > 1000) xml = r.text;
      } catch (e) {
        log(`[bplay-xml] ScrapingBee también falló: ${e.message?.slice(0,100)}`);
      }
    }

    if (!xml || xml.length < 1000) {
      log(`[bplay-xml] no XML válido recibido (last: ${xml?.length || 0} bytes)`);
      if (cachedEvents.length && Date.now() - cachedAt < 5 * 60_000) return cachedEvents;
      return [];
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
scrape.clearCache = () => { cachedEvents = []; cachedAt = 0; lastModified = null; };

module.exports = scrape;
