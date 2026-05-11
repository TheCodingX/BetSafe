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

// Playwright con stealth real: oculta navigator.webdriver, fakes WebGL,
// permissions, plugins, languages, hardwareConcurrency, etc.
const { chromium: chromiumBase } = require('playwright');
let chromiumStealth = null;
try {
  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth')();
  chromium.use(stealth);
  chromiumStealth = chromium;
} catch (e) {
  // si fallo el require de plugins, fallback a playwright nativo
  chromiumStealth = chromiumBase;
}
const chromium = chromiumStealth || chromiumBase;

let UserAgent;
try { UserAgent = require('user-agents'); } catch {}

// User agents reales rotativos. Si no está la lib, usa fallback estático.
function nextUA() {
  if (UserAgent) {
    try {
      const ua = new UserAgent({ deviceCategory: 'desktop' });
      return ua.toString();
    } catch {}
  }
  // Fallback: UAs reales de Chrome estables
  const POOL = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
  ];
  return POOL[Math.floor(Math.random() * POOL.length)];
}

const UA = nextUA();
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
  // `opts.timeout` (ms) limita el tiempo TOTAL del request (headers + body).
  // headersTimeout y bodyTimeout son los individuales internos de undici.
  const timeout = Number(opts.timeout) || 12000;
  const headersTimeout = Math.min(8000, timeout);
  const bodyTimeout = Math.min(15000, timeout);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout ${timeout}ms`)), timeout);
  try {
    const { body, headers, statusCode } = await request(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': opts.accept || 'application/json, text/html, */*',
        'Accept-Language': ACCEPT_LANG,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(opts.headers || {})
      },
      headersTimeout,
      bodyTimeout
      // NOTA: undici v7 removió `maxRedirections` como opción top-level.
      // El default ya sigue redirects. Si necesitamos control fino, usar
      // request-redirect-interceptor; para nuestros endpoints no es necesario.
    });
    if (statusCode >= 400) {
      const text = await body.text().catch(() => '');
      throw new Error(`HTTP ${statusCode} for ${url} :: ${text.slice(0, 200)}`);
    }
    return opts.json ? body.json() : body.text();
  } finally {
    clearTimeout(timer);
  }
}

async function httpJson(url, opts = {}) { return httpGet(url, { ...opts, json: true }); }

// ── Browser pool (Playwright + stealth) ───────────────────────────────────
// Estrategias de evasión aplicadas:
//   - playwright-extra-stealth plugin (oculta webdriver, WebGL, plugins, etc.)
//   - User-Agent rotativo desde lib `user-agents` o pool curado
//   - Headers Sec-CH-UA, sec-fetch-* coherentes con un navegador real
//   - Viewport y screen realistas
//   - Locale + timezone AR para parecer usuario argentino
//   - Init script extra que mata flags residuales de automation
//   - Block solo de resources pesados (imágenes, media, fonts) NO bloqueamos
//     fonts opcionalmente porque algunos sites detectan eso como bot
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
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process,AutomationControlled',
        '--disable-site-isolation-trials',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions-except',
        '--disable-component-extensions-with-background-pages'
      ]
    }).then(b => { browser = b; launching = null; return b; });
    return launching;
  }

  async function newPage({ blockResources = true, ua } = {}) {
    const b = await ensure();
    const userAgent = ua || nextUA();
    // Detectar mobile/desktop del UA
    const isMobile = /Mobile|Android|iPhone/.test(userAgent);
    const ctx = await b.newContext({
      userAgent,
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      viewport: isMobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
      screen: isMobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
      deviceScaleFactor: isMobile ? 3 : 1,
      isMobile,
      hasTouch: isMobile,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      geolocation: { latitude: -34.6037, longitude: -58.3816 },  // Buenos Aires
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': ACCEPT_LANG,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': isMobile ? '?1' : '?0',
        'sec-ch-ua-platform': '"macOS"',
        'Upgrade-Insecure-Requests': '1',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1'
      }
    });
    // Inyectar script anti-detección antes de cualquier page script
    await ctx.addInitScript(() => {
      // navigator.webdriver -> false
      Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
      // navigator.plugins -> simular plugins reales
      Object.defineProperty(navigator, 'plugins', {
        get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }]
      });
      // navigator.languages
      Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });
      // chrome runtime
      window.chrome = window.chrome || { runtime: {}, loadTimes: () => {}, csi: () => {} };
      // permissions API fake
      try {
        const origQuery = navigator.permissions.query;
        navigator.permissions.query = (params) =>
          params?.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery.call(navigator.permissions, params);
      } catch {}
      // WebGL vendor masking
      try {
        const getParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (p) {
          if (p === 37445) return 'Intel Inc.';      // UNMASKED_VENDOR_WEBGL
          if (p === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
          return getParam.call(this, p);
        };
      } catch {}
    });
    // Solo bloquear assets verdaderamente pesados que NO afecten anti-bot
    if (blockResources) {
      await ctx.route('**/*', (route) => {
        const t = route.request().resourceType();
        const url = route.request().url();
        // Bloquear imágenes/media/fonts solo de dominios no críticos
        // (algunos sites usan font loading como anti-bot signal)
        if (['image', 'media'].includes(t)) return route.abort();
        // Bloquear fonts de CDN ajenos al site main domain
        if (t === 'font') {
          try {
            const host = new URL(url).hostname;
            const refer = route.request().frame()?.url() || '';
            const refHost = refer ? new URL(refer).hostname : '';
            if (!refHost || host === refHost || host.endsWith('.' + refHost.split('.').slice(-2).join('.'))) {
              return route.continue();
            }
            return route.abort();
          } catch { return route.continue(); }
        }
        return route.continue();
      });
    }
    const page = await ctx.newPage();
    // Default timeouts más generosos para sites con Cloudflare challenge
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
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
  // ̀-ͯ = bloque Unicode "Combining Diacritical Marks" (acentos).
  // Usar el escape Unicode garantiza la portabilidad del regex sin importar
  // cómo se guarde el archivo.
  const key = trimmed.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
