#!/usr/bin/env node
/* BetSafe — Live test runner para los 12 scrapers AR
 * ============================================================================
 * Corre cada scraper contra el sitio REAL y reporta:
 *   - Cuántos eventos retornó
 *   - Tiempo de respuesta
 *   - Error (si hubo)
 *   - Sample del primer evento (para validar parsing)
 *
 * Uso:
 *   node lib/test-scrapers.js                 # todos
 *   node lib/test-scrapers.js bplay betano    # solo estos
 *   TIMEOUT_MS=30000 node lib/test-scrapers.js
 *
 * NO modifica nada. Solo lee.
 * ============================================================================
 */
'use strict';

const { browserPool } = require('./index');

const SCRAPERS = {
  bplay:        require('../scrapers/bplay'),
  betano:       require('../scrapers/betano'),
  betwarrior:   require('../scrapers/betwarrior'),
  bet365ar:     require('../scrapers/bet365ar'),
  codere:       require('../scrapers/codere'),
  caliente:     require('../scrapers/caliente'),
  casinomagic:  require('../scrapers/casinomagic'),
  betsson:      require('../scrapers/betsson'),
  playcity:     require('../scrapers/playcity'),
  super7:       require('../scrapers/super7'),
  betfun:       require('../scrapers/betfun'),
  jugadon:      require('../scrapers/jugadon')
};

const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 30000);

async function testScraper(key) {
  const scrape = SCRAPERS[key];
  if (!scrape) return { key, ok: false, error: 'scraper-not-found' };
  const t0 = Date.now();
  try {
    const result = await Promise.race([
      scrape({ sports: ['soccer'] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS))
    ]);
    const events = Array.isArray(result) ? result : [];
    const dur = Date.now() - t0;
    return {
      key,
      ok: true,
      dur,
      count: events.length,
      sample: events[0] || null,
      // Calidad: tiene markets parseados?
      withMarkets: events.filter(e => e?.markets && Object.keys(e.markets).length > 0).length,
      withH2h: events.filter(e => e?.markets?.h2h).length
    };
  } catch (e) {
    return {
      key,
      ok: false,
      dur: Date.now() - t0,
      error: e?.message || String(e),
      stack: e?.stack?.split('\n').slice(0, 3).join(' | ')
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const keys = args.length ? args : Object.keys(SCRAPERS);
  console.log(`Testing ${keys.length} scrapers (timeout ${TIMEOUT_MS}ms each)...`);
  console.log('═'.repeat(80));

  const results = [];
  for (const key of keys) {
    process.stdout.write(`[${key.padEnd(13)}] running... `);
    const r = await testScraper(key);
    results.push(r);
    if (r.ok) {
      const flag = r.count > 0 ? '✓' : '○';
      console.log(`${flag} ${String(r.count).padStart(3)} ev · ${String(r.withH2h).padStart(3)} h2h · ${r.dur}ms`);
      if (r.sample && r.count > 0) {
        console.log(`  └─ Sample: ${r.sample.home?.name} vs ${r.sample.away?.name}${r.sample.league ? ' (' + r.sample.league + ')' : ''}`);
        if (r.sample.markets?.h2h) {
          const h = r.sample.markets.h2h;
          console.log(`     h2h: ${h.home || '-'} / ${h.draw || '-'} / ${h.away || '-'}`);
        }
      }
    } else {
      console.log(`✗ ${r.error}`);
      if (r.stack) console.log(`     ${r.stack}`);
    }
  }

  // Resumen
  console.log('═'.repeat(80));
  const okCount = results.filter(r => r.ok).length;
  const withData = results.filter(r => r.ok && r.count > 0).length;
  const totalEvents = results.reduce((s, r) => s + (r.count || 0), 0);
  console.log(`Resultado: ${okCount}/${keys.length} sin error · ${withData}/${keys.length} con datos · ${totalEvents} eventos totales`);

  // Categorización
  const broken = results.filter(r => !r.ok).map(r => r.key);
  const empty = results.filter(r => r.ok && r.count === 0).map(r => r.key);
  const working = results.filter(r => r.ok && r.count > 0).map(r => r.key);
  if (broken.length) console.log(`✗ Errors:      ${broken.join(', ')}`);
  if (empty.length)  console.log(`○ Empty:       ${empty.join(', ')}`);
  if (working.length)console.log(`✓ Working:     ${working.join(', ')}`);

  // Cleanup
  await browserPool.closeAll().catch(() => {});
  process.exit(broken.length === keys.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
