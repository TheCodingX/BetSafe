/* BetSafe — Cloudflare Worker Proxy
 * ============================================================================
 * Worker que actúa como proxy para los scrapers del backend cuando los IPs de
 * Render están bloqueados por Cloudflare en Betano / rate-limiteados en Kambi.
 *
 * Cómo funciona:
 *   - El Worker corre en la red de Cloudflare → su outbound IP es CF
 *   - Cuando hace fetch() a Betano (también en CF), CF generalmente "confía"
 *     en su propia red y NO devuelve el splash screen 403
 *   - Para Kambi (us.offering-api.kambicdn.com), nuestra IP cambia con cada
 *     edge → evita el rate-limit por IP sostenido
 *
 * Coste: $0 con plan Workers Free (100k requests/día = ~1.15 req/seg).
 *
 * Endpoint:
 *   GET https://YOUR-WORKER.workers.dev/?url=<encoded-target-url>
 *   Header: x-proxy-key: <PROXY_KEY> (opcional pero recomendado)
 *
 * Returns:
 *   - Same status code as origin
 *   - Same body (JSON o text)
 *   - Headers: x-origin-status, content-type
 *
 * Deploy (5 min, gratis):
 *   1. Crear cuenta en dash.cloudflare.com (free)
 *   2. Workers & Pages → Create → Hello World template
 *   3. Pegar el contenido de este archivo
 *   4. Settings → Variables → Add: PROXY_KEY = <random string 32+ chars>
 *   5. Save & Deploy
 *   6. Copiar la URL del worker (ej: betsafe-proxy.tu-nombre.workers.dev)
 *   7. En Render env vars:
 *        CF_PROXY_URL = https://betsafe-proxy.tu-nombre.workers.dev
 *        CF_PROXY_KEY = <el mismo random string>
 *   8. Render → Manual Deploy (para re-arrancar con los env nuevos)
 *
 * El backend automáticamente usará el proxy en Betano + Betsson cuando estos
 * vars estén seteados. Si fallan, cae a los paths normales (Playwright, etc.)
 * ============================================================================
 */

// Whitelist de hosts que el proxy acepta. Cualquier otro retorna 403.
// Esto previene que terceros usen tu Worker como open proxy.
const ALLOWED_HOSTS = new Set([
  // Betano (Kaizen Gaming)
  'www.betano.bet.ar',
  'm.betano.bet.ar',
  'www.betano.com.ar',
  // Kambi (Betsson, BetWarrior, otros)
  'us.offering-api.kambicdn.com',
  'eu.offering-api.kambicdn.com',
  'offering-api.kambicdn.com',
  // Codere (por si hace falta)
  'm.caba.codere.bet.ar',
  'm.pba.codere.bet.ar',
  'm.cba.codere.bet.ar',
  'm.codere.com.ar',
  'apuestas.codere.com.ar'
]);

// Headers browser-like que enviamos a los targets. Coinciden con lo que
// usaría un Chrome real desde una IP residencial argentina.
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);

    // PROXY MODE — si la request trae ?url=..., siempre prioriza el proxy.
    // BUG fix 2026-05-21: antes el check de `/health` o `/` matcheaba ANTES
    // de mirar el query, así que requests a `/?url=...` caían en el health
    // response y los scrapers nunca recibían data real.
    const target = reqUrl.searchParams.get('url');

    // Health check endpoint (solo si NO se pidió un proxy)
    if (!target && (reqUrl.pathname === '/health' || reqUrl.pathname === '/')) {
      return new Response(JSON.stringify({
        ok: true,
        service: 'betsafe-scraper-proxy',
        ts: Date.now(),
        allowedHosts: [...ALLOWED_HOSTS]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Validate target URL
    if (!target) {
      return new Response('missing ?url param', { status: 400 });
    }
    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('invalid url param', { status: 400 });
    }

    // Anti-abuse: solo dominios whitelist
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return new Response(`host ${targetUrl.hostname} not whitelisted`, { status: 403 });
    }

    // Auth opcional: si PROXY_KEY está set en env vars del Worker, requiere header
    if (env.PROXY_KEY) {
      const auth = request.headers.get('x-proxy-key');
      if (auth !== env.PROXY_KEY) {
        return new Response('unauthorized', { status: 401 });
      }
    }

    // Headers del request: combinamos los DEFAULT_HEADERS con Origin/Referer del target
    const headers = {
      ...DEFAULT_HEADERS,
      'Origin': `https://${targetUrl.hostname}`,
      'Referer': `https://${targetUrl.hostname}/`
    };

    // Fetch al target con RETRY INTERNO. Cacheamos SOLO 2xx; 4xx/5xx no se
    // cachean. Si el origen tira 4xx/5xx (Betano hace splash anti-bot ocasional)
    // reintentamos hasta 3 veces con backoff 500ms. Cada retry sale de una IP
    // edge CF distinta (la red CF balancea), así que sube mucho el éxito sin
    // saturar al origen.
    let originRes = null;
    let lastErr = null;
    const MAX_TRIES = 3;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        originRes = await fetch(targetUrl.toString(), {
          method: 'GET',
          headers,
          cf: {
            cacheTtlByStatus: {
              '200-299': 30,
              '300-399': 5,
              '400-599': 0
            }
          }
        });
        // Éxito (2xx/3xx) → salir del retry loop
        if (originRes.status < 400) break;
        // 4xx/5xx → reintentamos si quedan attempts
        if (attempt < MAX_TRIES) {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
        }
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_TRIES) {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
        }
      }
    }
    if (!originRes) {
      return new Response(JSON.stringify({ error: 'fetch-fail', message: String(lastErr).slice(0, 200), attempts: MAX_TRIES }), {
        status: 502,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Streamear el body del origen al cliente. Conservamos status, content-type
    const body = await originRes.text();
    const ct = originRes.headers.get('content-type') || 'application/octet-stream';

    return new Response(body, {
      status: originRes.status,
      headers: {
        'content-type': ct,
        'x-origin-status': String(originRes.status),
        'x-target': targetUrl.hostname,
        'cache-control': 'no-store'
      }
    });
  }
};
