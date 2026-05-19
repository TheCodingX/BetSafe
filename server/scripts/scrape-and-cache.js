/* BetSafe — Scrape & cache standalone script
 * ============================================================================
 * Corre cada scraper UNA vez, junta los eventos y dumpea a JSON.
 *
 * Usado por:
 *   - .github/workflows/scrape-cache.yml (cron hourly)
 *   - Trigger manual: `node server/scripts/scrape-and-cache.js`
 *
 * Output: public/data/scraped-events.json (consumido por el backend como
 * ultimate fallback cuando todos los scrapers en Render fallan).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BOOKS = ['bplay', 'betano', 'betwarrior', 'codere', 'betsson'];
const OUTPUT_DIR = path.resolve(__dirname, '../../public/data');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'scraped-events.json');
const OUTPUT_META = path.join(OUTPUT_DIR, 'scraped-events.meta.json');

async function main() {
  console.log(`[scrape-cache] starting · ${new Date().toISOString()}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const start = Date.now();
  const results = {};
  const errors = {};

  // Correr scrapers en paralelo. Cada uno tiene su propio cache + breaker.
  await Promise.all(BOOKS.map(async (book) => {
    const t0 = Date.now();
    try {
      const scrape = require(`../scrapers/${book}`);
      // Timeout 90s por scraper (Betano Playwright + multi-page puede ser lento)
      const events = await Promise.race([
        scrape(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout-90s')), 90_000))
      ]);
      const dur = Date.now() - t0;
      const count = (events || []).length;
      results[book] = events || [];
      console.log(`[scrape-cache] ${book}: ${count} events · ${dur}ms`);
    } catch (e) {
      const dur = Date.now() - t0;
      errors[book] = String(e.message || e).slice(0, 200);
      results[book] = [];
      console.log(`[scrape-cache] ${book}: ERROR · ${dur}ms · ${errors[book]}`);
    }
  }));

  // Merge events de todas las casas (dedup por home|away|start)
  const merged = {};
  for (const [book, events] of Object.entries(results)) {
    for (const ev of events) {
      const key = `${(ev.home?.name || '').toLowerCase()}|${(ev.away?.name || '').toLowerCase()}|${ev.start}`;
      if (!merged[key]) {
        merged[key] = { ...ev, sources: [book], markets: ev.markets || {} };
      } else {
        merged[key].sources.push(book);
        // Merge markets (preferiendo el primer book si conflict)
        for (const [mk, mdata] of Object.entries(ev.markets || {})) {
          if (!merged[key].markets[mk]) merged[key].markets[mk] = mdata;
        }
      }
    }
  }

  const allEvents = Object.values(merged);
  const totalSec = Math.round((Date.now() - start) / 1000);

  // Output: array de events con structure común a /api/odds
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allEvents));
  console.log(`[scrape-cache] wrote ${allEvents.length} events to ${OUTPUT_JSON} · ${totalSec}s total`);

  // Meta: para que el backend pueda saber qué tan vieja es la data + qué falló
  const meta = {
    ts: Date.now(),
    iso: new Date().toISOString(),
    totalEvents: allEvents.length,
    perBook: Object.fromEntries(Object.entries(results).map(([b, evs]) => [b, evs.length])),
    errors,
    durSec: totalSec
  };
  fs.writeFileSync(OUTPUT_META, JSON.stringify(meta, null, 2));
  console.log(`[scrape-cache] meta: ${JSON.stringify(meta.perBook)}`);

  // Cerrar el pool del browser si quedó abierto
  try {
    const { browserPool } = require('../lib');
    await browserPool.closeAll();
  } catch {}

  process.exit(0);
}

main().catch(e => {
  console.error('[scrape-cache] FATAL:', e.message, e.stack);
  process.exit(1);
});
