# BetSafe — Cloudflare Worker Proxy

Worker que actúa como proxy para los scrapers cuando los IPs de Render están bloqueados por Cloudflare (Betano) o rate-limiteados por Kambi (Betsson).

## ¿Por qué funciona?

- Worker corre en la red de Cloudflare → su outbound IP es CF.
- Cuando el Worker hace `fetch()` a Betano (también en CF), CF **no devuelve el splash 403** porque "confía" en su propia red.
- Para Kambi, la IP del edge varía → evita el rate-limit por IP sostenido.

## Coste

**$0** con el plan Workers Free:
- 100,000 requests/día (~1.15 req/seg).
- Suficiente para 6 scrapers cada 30 segundos = 720 requests/hora = 17,280/día.

## Deploy (5 minutos)

### 1. Crear cuenta en Cloudflare (gratis)

Si no tenés: [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).

### 2. Crear el Worker

1. En el dashboard → **Workers & Pages** (sidebar izquierdo).
2. **Create application** → **Create Worker**.
3. Nombre: `betsafe-proxy` (o el que quieras).
4. **Deploy** (con el template "Hello World").

### 3. Pegar el código

1. Click en el Worker recién creado → **Edit code**.
2. Borrá todo y pegá el contenido de [`scraper-proxy.js`](./scraper-proxy.js).
3. **Save and deploy**.

### 4. Setear la API key (recomendado)

Sin esto, cualquiera con la URL puede usar tu Worker.

1. Worker dashboard → **Settings** → **Variables**.
2. **Add variable**:
   - Name: `PROXY_KEY`
   - Value: un string random largo. Generá uno con `openssl rand -hex 32` o usá [random.org](https://www.random.org/strings/?num=1&len=32&digits=on&upperalpha=on&loweralpha=on&unique=on&format=html&rnd=new).
3. **Save and deploy**.

### 5. Copiar la URL del Worker

En el header del Worker dashboard verás algo como:
```
betsafe-proxy.tu-nombre.workers.dev
```
Copiá esa URL.

### 6. Configurar Render

En tu service de Render → **Environment** → **Add Environment Variable**:

| Key | Value |
|-----|-------|
| `CF_PROXY_URL` | `https://betsafe-proxy.tu-nombre.workers.dev` |
| `CF_PROXY_KEY` | el mismo string que pusiste en `PROXY_KEY` |

**Save Changes** → Render auto-redeploy.

### 7. Verificar

Después del deploy, chequeá:

```bash
# Health check del Worker
curl https://betsafe-proxy.tu-nombre.workers.dev/health

# Test fetch via Worker (debería devolver el JSON de Betano)
curl "https://betsafe-proxy.tu-nombre.workers.dev/?url=https%3A%2F%2Fwww.betano.bet.ar%2Fapi%2Fhome%2Ftop-events" \
  -H "x-proxy-key: TU_PROXY_KEY"

# Estado del backend (debería mostrar eventos de betano > 0)
curl https://betsafe-5hf5.onrender.com/api/sources | python3 -m json.tool | grep -A2 "betano"
```

## Cómo lo usa el backend

El backend chequea `process.env.CF_PROXY_URL` al inicio de cada scrape. Si está set:

- **Betano**: el path `tryCloudflareProxy()` es **el PRIMARIO** (antes que direct/Playwright).
- **Betsson**: cuando el Kambi discovery rate-limitea, usa el proxy como fallback.

Si el proxy falla o no está configurado, los scrapers usan sus paths originales (Playwright, etc.).

## Troubleshooting

### Worker devuelve 401 unauthorized
- Confirmá que `CF_PROXY_KEY` en Render coincide exactamente con `PROXY_KEY` en el Worker.

### Worker devuelve 403 host not whitelisted
- Revisá `ALLOWED_HOSTS` en `scraper-proxy.js`. Si querés agregar dominios nuevos, edita el array y redeploy.

### Worker devuelve 502
- El target devolvió error. Mirá el header `x-origin-status` para ver el status real.
- Si es 403 persistente, CF también bloquea desde su propia red. Probá:
  - Cambiar la región del Worker (Settings → Triggers → Routes).
  - Usar otro endpoint en `ALLOWED_HOSTS`.

### Quota exceeded (100k/día)
- Tu plan Free agotó la cuota diaria. Reseteo a las 00:00 UTC.
- Opciones: upgrade a Workers Paid ($5/mes = 10M requests), o ajustar el cache TTL más alto en el Worker (`cacheTtl: 60` → menos requests al origen).
