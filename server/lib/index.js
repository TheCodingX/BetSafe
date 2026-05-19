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
  // Si opts.bodyTimeout viene set, usa ese directo (sin cap) — útil para
  // descargas grandes desde redes lentas (e.g. bplay XML 1.5MB desde Render).
  const timeout = Number(opts.timeout) || 12000;
  const headersTimeout = opts.headersTimeout != null
    ? Number(opts.headersTimeout)
    : Math.min(8000, timeout);
  const bodyTimeout = opts.bodyTimeout != null
    ? Number(opts.bodyTimeout)
    : Math.min(15000, timeout);
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

/* ── Native https GET (fallback para sitios con TLS fingerprinting) ──────────
 * Algunos CDNs (Cloudflare en especial) detectan el TLS fingerprint de undici
 * y devuelven 403/Splash en lugar de la respuesta real. Para esos casos
 * usamos el módulo `https` nativo de Node, cuyo ClientHello coincide con
 * el de un cliente legítimo.
 */
const httpsModule = require('https');
const { URL } = require('url');

function httpGetNative(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const timeout = Number(opts.timeout) || 12000;
    const headers = {
      'User-Agent': UA,
      'Accept': opts.accept || 'application/json, text/html, */*',
      'Accept-Language': ACCEPT_LANG,
      'Cache-Control': 'no-cache',
      ...(opts.headers || {})
    };
    const req = httpsModule.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    }, (res) => {
      // Follow redirects (max 3)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (opts._redirects || 0) < 3) {
        res.destroy();
        const next = res.headers.location.startsWith('http') ? res.headers.location : `${u.protocol}//${u.host}${res.headers.location}`;
        return httpGetNative(next, { ...opts, _redirects: (opts._redirects || 0) + 1 }).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        let err = '';
        res.on('data', d => { err += d; });
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode} for ${url} :: ${err.slice(0, 200)}`)));
        return;
      }
      let buf = '';
      res.on('data', d => { buf += d.toString('utf8'); });
      res.on('end', () => {
        clearTimeout(timer);
        if (opts.json) {
          try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
        } else {
          resolve(buf);
        }
      });
    });
    req.on('error', err => { clearTimeout(timer); reject(err); });
    const timer = setTimeout(() => { req.destroy(new Error(`timeout ${timeout}ms`)); }, timeout);
    req.end();
  });
}

async function httpJsonNative(url, opts = {}) { return httpGetNative(url, { ...opts, json: true }); }

/* Stats globales de uso ScrapingBee. Acumulan créditos consumidos durante
 * el lifetime del proceso. Se reportan en /api/sbee/usage para que el user
 * vea el ritmo de consumo en vivo (más fino que el dashboard de sbee, que
 * actualiza con delay).
 *
 * `lastUsage` se llena vía getScrapingBeeUsage() que pega contra el endpoint
 * /usage de scrapingbee (esa call es gratis, 0 créditos). */
const scrapingBeeStats = {
  totalCreditsUsed: 0,    // créditos gastados desde el boot del proceso
  callsTotal: 0,
  callsFailed: 0,
  callsByPath: {},        // { 'betano': N, 'sofascore': N, ... }
  creditsByPath: {},      // { 'betano': N créditos, 'sofascore': N, ... }
  lastUsage: null,        // { max_api_credit, used_api_credit, ts } — desde /usage
  lastUsageCheckAt: 0
};

/* Consulta endpoint /usage de ScrapingBee (no consume créditos).
 * Cachea 5 minutos para no abusar. */
async function getScrapingBeeUsage(forceRefresh = false) {
  const key = process.env.SCRAPINGBEE_KEY;
  if (!key) return null;
  if (!forceRefresh && scrapingBeeStats.lastUsage && Date.now() - scrapingBeeStats.lastUsageCheckAt < 5 * 60_000) {
    return scrapingBeeStats.lastUsage;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const { body, statusCode } = await request(`https://app.scrapingbee.com/api/v1/usage?api_key=${encodeURIComponent(key)}`, {
      method: 'GET',
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (statusCode !== 200) {
      log(`[sbee:usage] HTTP ${statusCode}`);
      return null;
    }
    const json = await body.json();
    scrapingBeeStats.lastUsage = { ...json, ts: Date.now() };
    scrapingBeeStats.lastUsageCheckAt = Date.now();
    return scrapingBeeStats.lastUsage;
  } catch (e) {
    log(`[sbee:usage] err ${e.message?.slice(0, 80)}`);
    return null;
  }
}

/* Devuelve un multiplicador a aplicar al cache TTL en base a créditos
 * remaining. Cuando el budget está bajo, extendemos el cache para no
 * quemar la cuota antes de fin de mes.
 *   - >= 15% remaining → 1x (TTL normal)
 *   - 5-15% remaining → 2x (cache dobla)
 *   - < 5% remaining → 4x (cache cuadruplica)
 *   - 0 remaining → 99x (efectivamente desactivado hasta refill)
 */
function getCreditBudgetMultiplier() {
  const u = scrapingBeeStats.lastUsage;
  if (!u || !u.max_api_credit) return 1;
  const remaining = u.max_api_credit - (u.used_api_credit || 0);
  if (remaining <= 0) return 99;
  const pct = remaining / u.max_api_credit;
  if (pct < 0.05) return 4;
  if (pct < 0.15) return 2;
  return 1;
}

/* httpJsonViaScrapingBee — proxy genérico via ScrapingBee para bypass de Cloudflare
 * desde IPs cloud (Render, Fly, Railway, etc.) que están blackholeadas.
 *
 * Activado solo si `SCRAPINGBEE_KEY` está seteada. Si no, lanza error que el
 * caller debe manejar haciendo fallback al método directo.
 *
 * Cost (en créditos ScrapingBee):
 *   - render_js=false + premium_proxy=true:   10 créditos / request
 *   - render_js=false + premium_proxy=false:  1 crédito (datacenter, suele dar 403 igual)
 *
 * El header `Spb-Cost` del response dice cuánto gastó. Lo logueamos para
 * monitorear quota.
 *
 * @param {string} url - URL target (e.g. betano endpoint)
 * @param {object} opts - { timeout, premium=true, renderJs=false, country='ar', json=true, tag='betano' }
 * @returns {Promise<{ json|text, costCredits, status }>}
 */
/* Global flag: cuando SBee devuelve 401 una vez, marcamos la key como inválida
 * y skipeamos todas las requests subsiguientes (devuelven el mismo error sin
 * esperar 30s al timeout). Re-intentamos cada 30min por si el usuario fija el
 * key en Render env vars en medio de una sesión.
 *
 * Esto ahorra MASIVAMENTE tiempo CPU/network cuando la SBee key está rota:
 * sin esto, cada scrape de Betano/Sofascore espera 30s × 3 endpoints = 90s
 * por ciclo SOLO en SBee. Con esto, 1 ciclo malo y después 0ms hasta retry.
 *
 * Settable to bypass via env: BS_SBEE_DISABLE_AUTODETECT=1. */
let _sbeeInvalidSince = 0;
const SBEE_RETRY_INTERVAL_MS = 30 * 60_000;  // 30min entre re-intentos auto

function _isSbeeMarkedInvalid() {
  if (!_sbeeInvalidSince) return false;
  // Tras 30min, reseteamos el flag para reintentar (usuario quizá actualizó key)
  if (Date.now() - _sbeeInvalidSince > SBEE_RETRY_INTERVAL_MS) {
    _sbeeInvalidSince = 0;
    return false;
  }
  return true;
}

function _markSbeeInvalid() {
  _sbeeInvalidSince = Date.now();
}

function getSbeeStatus() {
  return {
    invalidSince: _sbeeInvalidSince,
    isInvalid: _isSbeeMarkedInvalid(),
    msUntilRetry: _sbeeInvalidSince ? Math.max(0, SBEE_RETRY_INTERVAL_MS - (Date.now() - _sbeeInvalidSince)) : 0
  };
}

async function httpViaScrapingBee(url, opts = {}) {
  const key = process.env.SCRAPINGBEE_KEY;
  if (!key) throw new Error('SCRAPINGBEE_KEY no configurada');

  // Fast-fail si ya sabemos que la key es inválida (evita 30s timeout × N llamadas).
  if (process.env.BS_SBEE_DISABLE_AUTODETECT !== '1' && _isSbeeMarkedInvalid()) {
    scrapingBeeStats.callsFailed++;
    throw new Error(`sbee-skip: key marcada inválida (retry in ${Math.ceil((SBEE_RETRY_INTERVAL_MS - (Date.now() - _sbeeInvalidSince)) / 60_000)}min)`);
  }

  const params = new URLSearchParams({
    api_key: key,
    url,
    premium_proxy: String(opts.premium !== false),    // default true (Cloudflare bypass)
    render_js: String(opts.renderJs === true),        // default false (JSON endpoints)
    country_code: opts.country || 'ar',
    // No followear redirects de scrapingbee (ya los maneja él internamente)
  });
  const apiUrl = `https://app.scrapingbee.com/api/v1/?${params.toString()}`;
  const timeout = Number(opts.timeout) || 30000;
  const tag = opts.tag || 'unknown';

  scrapingBeeStats.callsTotal++;
  scrapingBeeStats.callsByPath[tag] = (scrapingBeeStats.callsByPath[tag] || 0) + 1;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`sbee-timeout ${timeout}ms`)), timeout);
  try {
    const { body, headers, statusCode } = await request(apiUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headersTimeout: Math.min(20000, timeout),
      bodyTimeout: Math.min(25000, timeout)
    });
    const text = await body.text();
    const costCredits = Number(headers['spb-cost'] || headers['Spb-Cost'] || 0);
    const targetStatus = Number(headers['spb-initial-status-code'] || 0);
    // Acumular siempre lo gastado (incluso si después tiramos error — sbee
    // cobra los créditos por intento, no por éxito).
    scrapingBeeStats.totalCreditsUsed += costCredits;
    scrapingBeeStats.creditsByPath[tag] = (scrapingBeeStats.creditsByPath[tag] || 0) + costCredits;

    if (statusCode === 401) {
      scrapingBeeStats.callsFailed++;
      _markSbeeInvalid();  // marca global → siguientes llamadas fast-fail
      throw new Error(`sbee-auth: API key inválida`);
    }
    if (statusCode === 402) {
      scrapingBeeStats.callsFailed++;
      _markSbeeInvalid();  // créditos agotados también desactiva temporalmente
      throw new Error(`sbee-quota: créditos agotados`);
    }
    if (statusCode === 422 || statusCode >= 500) {
      scrapingBeeStats.callsFailed++;
      throw new Error(`sbee ${statusCode}: target=${targetStatus} :: ${text.slice(0, 200)}`);
    }
    if (statusCode >= 400) {
      scrapingBeeStats.callsFailed++;
      throw new Error(`sbee HTTP ${statusCode} :: ${text.slice(0, 200)}`);
    }
    const result = { costCredits, status: targetStatus };
    if (opts.json !== false) {
      try { result.json = JSON.parse(text); }
      catch (e) {
        scrapingBeeStats.callsFailed++;
        throw new Error(`sbee-parse: ${e.message?.slice(0, 80)} :: ${text.slice(0, 200)}`);
      }
    } else {
      result.text = text;
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function httpJsonViaScrapingBee(url, opts = {}) {
  return httpViaScrapingBee(url, { ...opts, json: true });
}

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
  'tottenham':'tottenham','tottenham hotspur':'tottenham','arsenal':'arsenal','arsenal fc':'arsenal',
  // Italian teams — múltiples formatos posibles
  'inter':'inter','inter milan':'inter','inter milán':'inter','internazionale':'inter','fc internazionale':'inter','internazionale milano':'inter','ss inter':'inter',
  'ac milan':'milan','milan':'milan',
  'juventus':'juventus','juventus fc':'juventus','juve':'juventus',
  'as roma':'roma','roma':'roma',
  'ss lazio':'lazio','lazio':'lazio',
  'napoli':'napoli','ssc napoli':'napoli',
  'fiorentina':'fiorentina','acf fiorentina':'fiorentina',
  // Spanish — common formats
  'sevilla':'sevilla','sevilla fc':'sevilla','sevilla cf':'sevilla',
  'villarreal':'villarreal','villarreal cf':'villarreal',
  'valencia':'valencia','valencia cf':'valencia',
  'real betis':'betis','betis':'betis',
  'real sociedad':'realsociedad','rsociedad':'realsociedad',
  'athletic':'athletic','athletic club':'athletic','athletic bilbao':'athletic',
  // English — extended
  'newcastle':'newcastle','newcastle united':'newcastle',
  'manchester city':'mancity','man city':'mancity','manchester united':'manunited','man united':'manunited','man utd':'manunited',
  'aston villa':'astonvilla','astonvilla':'astonvilla',
  'west ham':'westham','west ham united':'westham',
  'crystal palace':'crystalpalace','crystal palace fc':'crystalpalace',
  // Sudamericanos comunes
  'gimnasia y esgrima':'gimnasia','gimnasia y esgrima la plata':'gimnasia','gimnasia la plata':'gimnasia',
  'palmeiras':'palmeiras','palmeiras sp':'palmeiras','sociedade esportiva palmeiras':'palmeiras',
  'corinthians':'corinthians','corinthians sp':'corinthians',
  'flamengo':'flamengo','flamengo rj':'flamengo','clube de regatas do flamengo':'flamengo',
  'fluminense':'fluminense','fluminense fc':'fluminense','fluminense rj':'fluminense',
  'botafogo':'botafogo','botafogo rj':'botafogo','botafogo fr':'botafogo',
  'vasco':'vasco','vasco da gama':'vasco','vasco da gama rj':'vasco',
  'sao paulo':'saopaulo','são paulo':'saopaulo','sao paulo fc':'saopaulo',
  'santos':'santos','santos fc':'santos',
  'internacional':'internacional','sc internacional':'internacional','internacional pa':'internacional','internacional p a':'internacional',
  'atletico mineiro':'atleticomineiro','atletico mg':'atleticomineiro','atlético mineiro':'atleticomineiro','atlético mg':'atleticomineiro',
  'cruzeiro':'cruzeiro','cruzeiro ec':'cruzeiro','cruzeiro mg':'cruzeiro',
  'gremio':'gremio','grêmio':'gremio','gremio fbpa':'gremio',
  // Mexicanos
  'cruz azul':'cruzazul','club cruz azul':'cruzazul',
  'chivas':'chivas','chivas guadalajara':'chivas','guadalajara':'chivas','cd guadalajara':'chivas',
  'america':'america','club america':'america','club américa':'america',
  // PSG variantes
  'paris saint-germain':'psg','paris saint germain':'psg','paris sg':'psg','psg':'psg','paris':'psg'
};

function normalizeTeam(name) {
  if (!name) return { id: '', name: '' };
  const trimmed = String(name).trim();
  // ̀-ͯ = bloque Unicode "Combining Diacritical Marks" (acentos).
  // Usar el escape Unicode garantiza la portabilidad del regex sin importar
  // cómo se guarde el archivo.
  const baseKey = trimmed.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '');
  // Lookup alias del nombre completo primero (preserva precisi\u00f3n)
  if (TEAM_ALIASES[baseKey]) return { id: TEAM_ALIASES[baseKey], name: trimmed };
  // Strip noise patterns para dedup robusto entre casas que usan distintos
  // formatos: "Sevilla" vs "Sevilla FC", "Inter" vs "SS Inter de Mil\u00e1n",
  // "Villarreal" vs "Villarreal CF", "Lazio" vs "SS Lazio".
  let cleaned = baseKey;
  for (const re of TEAM_NOISE_PATTERNS) cleaned = cleaned.replace(re, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (TEAM_ALIASES[cleaned]) return { id: TEAM_ALIASES[cleaned], name: trimmed };
  const id = (cleaned || baseKey)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { id, name: trimmed };
}

/* Strip de sufijos/prefijos comunes \u2014 antes del lookup de aliases.
 * Resuelve dedup robusto entre casas que usan distintos formatos para el
 * mismo equipo. */
const TEAM_NOISE_PATTERNS = [
  // Iniciales corporativas f\u00fatbol
  /\b(fc|cf|sc|ac|ca|ss|as|ff|cd|sd|ksc|bsc|sv|tv|tsg|vfb|vfl|psv|usl|aaaj|aef)\b/g,
  /\b(club|ssd|usd)\b/g,
  // Disambiguadores de ciudad (con o sin "de") \u2014 incluye estados/sufijos brasile\u00f1os
  /\b(de\s+)?(mexico|milan|mil\u00e1n|la plata|avellaneda|buenos aires|santa fe|santa f\u00e9|guadalajara|sao paulo|s.o paulo|rio de janeiro|porto alegre|p\.?\s*a\.?|belo horizonte|montevideo|cordoba|c\u00f3rdoba|junin|tucuman|tucum\u00e1n)\b/g,
  // Sufijos brasile\u00f1os "-SP", "-RJ", etc.
  /-(sp|rj|mg|rs|pr|sc|ba|pe|ce|go|pa|al|ma|am|to|ms|mt|df|es|pi|pb|rn|se)\b/gi,
  // Conjunciones espec\u00edficas argentinas
  /\by esgrima\b/g,
  /\bold boys\b/g,
  // Gen\u00e9ricos
  /\bjrs?\b/g,
  /\b(united|utd|wanderers)\b/g
];

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
  log, sleep, httpGet, httpJson, httpGetNative, httpJsonNative,
  httpViaScrapingBee, httpJsonViaScrapingBee, browserPool,
  scrapingBeeStats, getScrapingBeeUsage, getCreditBudgetMultiplier, getSbeeStatus,
  normalizeTeam, parseDecimal, parseAmericanToDecimal, eventKey, isFinite2,
  UA, ACCEPT_LANG
};
