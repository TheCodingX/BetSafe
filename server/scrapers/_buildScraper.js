/* BetSafe — Constructor unificado de scrapers usando deepCapture
 * ============================================================================
 * Reemplaza al viejo _genericSpa. Cada scraper individual ahora se reduce a:
 *
 *   module.exports = require('./_buildScraper')({
 *     bookKey: 'bplay',
 *     urls: ['https://www.bplay.com.ar/apuestas-deportivas',
 *            'https://www.bplay.com.ar/sportbook/futbol'],
 *     waitForSelector: '[class*="event"]',   // opcional
 *     timeoutMs: 30000
 *   });
 *
 * El scraper itera las URLs hasta que una devuelve eventos. Esto da
 * resiliencia: si una URL específica está caída, prueba la siguiente.
 * ============================================================================
 */
'use strict';

const { deepCaptureWithRetry } = require('./_deepCapture');
const { log, sleep } = require('../lib');

module.exports = function buildScraper(cfg) {
  const { bookKey, urls, waitForSelector, timeoutMs = 30000, scrollPasses = 3 } = cfg;

  return async function scrape() {
    const tried = [];
    const urlList = Array.isArray(urls) ? urls : [urls];

    for (const url of urlList) {
      const t0 = Date.now();
      try {
        const result = await deepCaptureWithRetry({
          url,
          bookKey,
          waitForSelector,
          navTimeoutMs: timeoutMs,
          scrollPasses,
          settleMs: 2500
        }, { retries: 1, backoffMs: 3000 });

        const dur = Date.now() - t0;
        tried.push({ url, dur, ...result.stats });

        if (result.events.length > 0) {
          log(`[${bookKey}] OK · ${url} · ${result.events.length} ev · ${dur}ms · xhr=${result.stats.jsonResponses}`);
          return result.events;
        }
        log(`[${bookKey}] empty · ${url} · ${dur}ms · xhr=${result.stats.jsonResponses}`);
      } catch (e) {
        const dur = Date.now() - t0;
        log(`[${bookKey}] error · ${url} · ${dur}ms · ${e.message?.slice(0, 80)}`);
        tried.push({ url, dur, error: e.message });
      }
      // Pequeño respiro entre URLs
      await sleep(500);
    }

    // Si llegamos acá, ninguna URL devolvió data. Loguear resumen para
    // que el admin pueda diagnosticar qué pasa con este bookmaker.
    log(`[${bookKey}] sin datos tras ${urlList.length} intentos: ${JSON.stringify(tried.map(t => ({ url: t.url, dur: t.dur, xhr: t.jsonResponses || 0 })))}`);
    return [];
  };
};
