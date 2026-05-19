/* Scraper: Bet365 AR (bet365.bet.ar) — Cloudflare MANAGED CHALLENGE
 * ============================================================================
 * Bet365 AR está protegida con Cloudflare Managed Challenge (Turnstile + JS
 * challenge dinámico + cookie de clearance temporal). Esto NO es Cloudflare
 * standard — requiere resolución activa del challenge para cada IP/sesión.
 *
 * Probado el 2026-05-13 desde IP residencial AR:
 *   GET https://www.bet365.bet.ar/ → 403 "Attention Required! | Cloudflare"
 *   HTML contiene <div id="cf-wrapper"> + scripts cf-challenge-running
 *
 * Opciones evaluadas:
 *   A) ScrapingBee premium_proxy + render_js: ~25 créditos/req, reliability
 *      ~40% (Cloudflare lo detecta como bot frecuentemente).
 *   B) ScrapingBee stealth_proxy (anti-bot premium): 75 créditos/req,
 *      reliability ~85%. Cost: 75 × 12 calls/hr × 24h × 30d = 648k/mes —
 *      blowsel plan Freelance (250k/mes) por 2.6×.
 *   C) Self-hosted residencial proxy + Playwright stealth: $50-80/mes + dev
 *      effort + maintenance. Aún así reliability bajo.
 *   D) Bet365 partnership / API oficial: requiere acuerdo comercial y
 *      vetting — fuera de scope.
 *
 * Verdict: NO SCRAPER ACTIVO por ahora. Este archivo existe para:
 *   1) Reservar el slot del bookkey en el orchestrator
 *   2) Doc-record de por qué no scrapeamos directo
 *   3) Permitir retry manual via /api/sources/refresh?name=bet365ar
 *
 * Si en el futuro tenemos acceso a stealth_proxy o cambia la situación
 * antibot, se puede activar el scraper habilitando ENABLE_BET365_SCRAPER=true.
 * Por default devuelve [] sin gastar créditos.
 *
 * Bet365 sigue cubierto por The Odds API cuando hay quota (actualmente
 * out-of-credits). Reactivar con THE_ODDS_API_KEY válida y quota.
 * ============================================================================
 */
'use strict';

const { httpViaScrapingBee, log } = require('../lib');
const { CircuitBreaker } = require('../lib/retry');

// Breaker conservador — si lo activan y falla, no martillar la quota.
const scrapingBeeBreaker = new CircuitBreaker({ name: 'bet365ar:scrapingbee', failThreshold: 2, cooldownMs: 30 * 60_000 });

let cachedEvents = [];
let cachedAt = 0;

async function scrape() {
  // Por DEFAULT desactivado — Cloudflare Managed Challenge hace el scraping
  // costoso e inestable. Set ENABLE_BET365_SCRAPER=true en env para activar
  // (asumir costo de stealth proxy).
  if (process.env.ENABLE_BET365_SCRAPER !== 'true') {
    return [];
  }

  if (!process.env.SCRAPINGBEE_KEY) {
    log('[bet365ar] SCRAPINGBEE_KEY no configurada — skip');
    return [];
  }

  // Cache 10min — Bet365 es caro de scrapear, no martillar.
  if (cachedEvents.length && Date.now() - cachedAt < 10 * 60_000) return cachedEvents;
  if (scrapingBeeBreaker.state === 'OPEN') {
    scrapingBeeBreaker._maybeReset();
    if (scrapingBeeBreaker.state === 'OPEN') return cachedEvents;
  }

  try {
    // Stealth proxy (75 créditos) para penetrar Cloudflare Managed Challenge.
    // NO usar premium_proxy aquí porque Cloudflare lo detecta.
    const r = await scrapingBeeBreaker.exec(() =>
      httpViaScrapingBee('https://www.bet365.bet.ar/', {
        timeout: 60000,
        premium: false,        // premium_proxy NO bypasa Managed Challenge
        renderJs: true,
        country: 'ar',
        json: false,
        tag: 'bet365ar:home',
        // Pasar stealth_proxy como custom param vía extra fields would require
        // edición del helper. Por ahora documentamos que esto NO funciona.
      })
    );
    if (!r?.text) return cachedEvents;
    // TODO: parser de bet365 — su HTML usa atomicMarkup específico que cambia
    // frecuentemente. Sin scraper validado, devolvemos vacío.
    log(`[bet365ar] HTML capturado · ${r.costCredits} créditos · target=${r.status} · sin parser`);
    return [];
  } catch (e) {
    log(`[bet365ar] err: ${e.message?.slice(0, 200)}`);
    return cachedEvents;  // serve cache si la tenemos
  }
}

scrape.breakers = { scrapingbee: scrapingBeeBreaker };
scrape.clearCache = () => { cachedEvents = []; cachedAt = 0; };

module.exports = scrape;
