/* BetSafe — lib utilitarias compartidas por todos los scrapers
 * ============================================================================
 * Exporta:
 *   - browserPool: pool de páginas Playwright reutilizables (1 browser, N pages).
 *   - fetch helpers con UA real + headers convincentes.
 *   - normalizadores (team names, números, fechas).
 *   - utilidades de logging consistentes.
 * ============================================================================
 */
'use strict';

const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ACCEPT_LANG = 'es-AR,es;q=0.9,en-US;q=0.6,en;q=0.4';

// ── Logging ────────────────────────────────────────────────────────────────
function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...args);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HTTP helper (undici) — para endpoints que NO requieren JS rendering ────
const { request } = require('undici');

async function httpGet(url, opts = {}) {
  const { body, headers, statusCode } = await request(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Accept': opts.accept || 'application/json, text/html, */*',
      'Accept-Language': ACCEPT_LANG,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...(opts.headers || {})
    },
    headersTimeout: 8000,
    bodyTimeout: 15000,
    maxRedirections: 4
  });
  if (statusCode >= 400) {
    const text = await body.text().catch(() => '');
    throw new Error(`HTTP ${statusCode} for ${url} :: ${text.slice(0, 200)}`);
  }
  return opts.json ? body.json() : body.text();
}

async function httpJson(url, opts = {}) { return httpGet(url, { ...opts, json: true }); }

// ── Browser pool (Playwright) ──────────────────────────────────────────────
const browserPool = (() => {
  let browser = null;
  let launching = null;

  async function ensure() {
    if (browser) return browser;
    if (launching) return launching;
    launching = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    }).then(b => { browser = b; launching = null; return b; });
    return launching;
  }

  async function newPage({ blockResources = true } = {}) {
    const b = await ensure();
    const ctx = await b.newContext({
      userAgent: UA,
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { 'Accept-Language': ACCEPT_LANG }
    });
    // Bloquear assets pesados — solo HTML/JS/XHR/CSS necesarios para parse
    if (blockResources) {
      await ctx.route('**/*', (route) => {
        const t = route.request().resourceType();
        if (['image', 'media', 'font'].includes(t)) return route.abort();
        return route.continue();
      });
    }
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    return { page, ctx };
  }

  async function closeAll() {
    if (browser) { try { await browser.close(); } catch {} browser = null; }
  }

  return { ensure, newPage, closeAll };
})();

// ── Normalización de equipos AR ────────────────────────────────────────────
const TEAM_ALIASES = {
  // AR
  'boca juniors':'boca','boca jrs':'boca','ca boca juniors':'boca','club atletico boca juniors':'boca',
  'river plate':'river','club atletico river plate':'river','ca river plate':'river','ca river':'river',
  'racing club':'racing','racing club avellaneda':'racing','racing':'racing',
  'club atletico independiente':'independiente','independiente':'independiente','c.a. independiente':'independiente',
  'san lorenzo':'sanlorenzo','san lorenzo de almagro':'sanlorenzo','casla':'sanlorenzo',
  'velez sarsfield':'velez','velez':'velez','ca velez sarsfield':'velez',
  'estudiantes':'estudiantes','estudiantes lp':'estudiantes','estudiantes de la plata':'estudiantes',
  'gimnasia':'gimnasia','gimnasia lp':'gimnasia','gimnasia y esgrima la plata':'gimnasia',
  'huracan':'huracan','ca huracan':'huracan',
  'newells':'newells',"newell's":'newells','newells old boys':'newells',
  'rosario central':'rosario','ca rosario central':'rosario',
  'lanus':'lanus','ca lanus':'lanus',
  'banfield':'banfield','ca banfield':'banfield',
  'argentinos juniors':'argentinos','argentinos jrs':'argentinos','aaaj':'argentinos',
  'colon':'colon','colon sf':'colon','colon santa fe':'colon',
  'union':'union','union sf':'union','union santa fe':'union',
  'godoy cruz':'godoy','godoy cruz antonio tomba':'godoy',
  'talleres':'talleres','talleres cordoba':'talleres','talleres c':'talleres',
  'belgrano':'belgrano','belgrano cordoba':'belgrano',
  'instituto':'instituto','instituto cordoba':'instituto','instituto ac':'instituto',
  'tigre':'tigre','ca tigre':'tigre',
  'platense':'platense','ca platense':'platense',
  'defensa y justicia':'defensa','defensa':'defensa',
  'sarmiento':'sarmiento','sarmiento junin':'sarmiento',
  'aldosivi':'aldosivi','ca aldosivi':'aldosivi',
  'central cordoba':'centralcba','central cordoba sde':'centralcba',
  'atletico tucuman':'atletico','at tucuman':'atletico',
  'barracas central':'barracas','barracas':'barracas',
  'deportivo riestra':'riestra','riestra':'riestra',
  // intl populares
  'manchester city':'mancity','man city':'mancity','manchester united':'manunited','man united':'manunited',
  'real madrid':'realmadrid','barcelona':'barcelona','fc barcelona':'barcelona','atletico madrid':'atleticomadrid',
  'paris saint germain':'psg','paris sg':'psg','psg':'psg',
  'bayern munich':'bayern','bayern munchen':'bayern','borussia dortmund':'dortmund','dortmund':'dortmund',
  'liverpool fc':'liverpool','liverpool':'liverpool','chelsea fc':'chelsea','chelsea':'chelsea',
  'tottenham':'tottenham','tottenham hotspur':'tottenham','arsenal':'arsenal','arsenal fc':'arsenal'
};

function normalizeTeam(name) {
  if (!name) return { id: '', name: '' };
  const trimmed = String(name).trim();
  const key = trimmed.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '');
  const id = TEAM_ALIASES[key] || key
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { id, name: trimmed };
}

function parseDecimal(text) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, '').replace(',', '.').replace(/[^\d.+\-]/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 1 && n < 1000 ? n : null;
}

function parseAmericanToDecimal(text) {
  const s = String(text).trim();
  const n = parseFloat(s.replace(/[^\d.+\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 1 + n / 100 : 1 - 100 / n;
}

function eventKey(home, away, start) {
  const h = normalizeTeam(home).id;
  const a = normalizeTeam(away).id;
  // Buckets de 30 min para tolerar diferencias menores de comienzo entre casas
  const t = Math.floor(new Date(start || 0).getTime() / 1800000);
  return `${h}|${a}|${t}`;
}

function isFinite2(n) { return typeof n === 'number' && Number.isFinite(n) && n > 1.01 && n < 1000; }

module.exports = {
  log, sleep, httpGet, httpJson, browserPool,
  normalizeTeam, parseDecimal, parseAmericanToDecimal, eventKey, isFinite2,
  UA, ACCEPT_LANG
};
