# BetSafe — Setup y deploy

> Plataforma argentina de análisis cuantitativo de apuestas legales.
> **NO somos casa de apuestas.** Vos operás en las 12 casas LOTBA / IPLyC y
> nosotros te damos comparador en vivo (scraping real cada 30s), IA, banca y
> arbitraje.

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│              FRONTEND (HTML/CSS/JS vanilla)          │
│   • Sin frameworks, sin build step pesado            │
│   • Consume backend via REST + WebSocket             │
│   • CERO datos sintéticos: si el backend no entregó  │
│     snapshot, la UI muestra "cargando" honesto       │
└──────────────────────────────────────────────────────┘
                         ▲
                         │  REST /api/* + WS /api/live
                         ▼
┌──────────────────────────────────────────────────────┐
│              BACKEND (Node 20 + Playwright)          │
│   • 12 scrapers (server/scrapers/*.js)               │
│   • Orquestador: ciclo cada SCRAPE_INTERVAL_MS       │
│   • Detector de surebets (cruza las 12 casas)        │
│   • Detector de steam moves (snapshots consecutivos) │
│   • Sirve también el frontend estático en /          │
└──────────────────────────────────────────────────────┘
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
   Bplay, Betano,    Bet365 AR,         Codere, Caliente,
   BetWarrior       Betsson, …          PlayCity, …
   (Kaizen)         (varios SPAs)       (varios SPAs)
```

## Las 12 casas argentinas legales (LOTBA / IPLyC)

| Key           | Nombre        | License | URL pública                              |
| ------------- | ------------- | ------- | ---------------------------------------- |
| `bplay`       | Bplay         | LOTBA   | https://www.bplay.com.ar                 |
| `betano`      | Betano        | LOTBA   | https://www.betano.com.ar                |
| `betwarrior`  | BetWarrior    | LOTBA   | https://www.betwarrior.bet.ar            |
| `bet365ar`    | Bet365 AR     | LOTBA   | https://www.bet365.com.ar                |
| `codere`      | Codere        | LOTBA   | https://www.codere.bet.ar                |
| `caliente`    | Caliente      | LOTBA   | https://www.caliente.bet                 |
| `casinomagic` | Magic         | LOTBA   | https://www.casinomagiconline.com.ar     |
| `betsson`     | Betsson AR    | LOTBA   | https://www.betsson.bet.ar               |
| `jugabet`     | JugaBet       | LOTBA   | https://www.jugabet.com.ar               |
| `24bet`       | 24bet         | LOTBA   | https://www.24bet.ar                     |
| `playcity`    | PlayCity      | LOTBA   | https://www.playcity.com.ar              |
| `megapuesta`  | MegaPuesta    | LOTBA   | https://www.megapuesta.com.ar            |

## Cómo arranca el backend (local)

```bash
cd server
npm install
npx playwright install chromium    # solo la primera vez
PORT=8787 SCRAPE_INTERVAL_MS=30000 npm start
```

Logs esperados:
```
[14:02:11] [server] listening on :8787
[14:02:11] [server] enabled books: bplay,betano,…,megapuesta
[14:02:11] [server] scrape interval: 30s
[14:02:13] [scrape] bplay OK · 18 eventos · 2147ms
[14:02:14] [scrape] betano OK · 22 eventos · 2820ms
[14:02:14] [scrape] betwarrior OK · 15 eventos · 1980ms
...
[14:02:18] [orchestrator] ciclo #1 · 41 eventos · 0 surebets nuevas · 0 steam · 6920ms
```

Una vez funcionando, abrí `http://localhost:8787/` — el frontend conecta solo
via WebSocket y empezás a ver cuotas reales en vivo.

## Endpoints API

| Método | Path                  | Descripción                                  |
| ------ | --------------------- | -------------------------------------------- |
| GET    | `/api/health`         | Uptime, ciclos completados, estado por casa  |
| GET    | `/api/books`          | Status detallado de cada scraper             |
| GET    | `/api/odds?sport=X`   | Eventos en vivo, filtrables                  |
| GET    | `/api/odds/match/:id` | Un evento específico                         |
| GET    | `/api/surebets`       | Surebets detectadas (últimas 200)            |
| GET    | `/api/steam`          | Steam moves recientes (últimos 200)          |
| GET    | `/api/snapshot`       | Estado completo en un solo response          |
| WS     | `/api/live`           | Push de updates en tiempo real               |

## Por qué no scrapeamos "cada segundo"

Tres razones técnicas:

1. **Anti-bot ban**: las casas usan Cloudflare / DataDome. Si pegás 12 sitios
   distintos cada segundo desde la misma IP, todas te bloquean en <10 min.
2. **Latencia natural**: cada casa tarda 1-3s en cargar su SPA y exponer los
   datos. 12 casas en paralelo ≈ 6-8s por ciclo. Físicamente no se puede ir
   más rápido sin saltarte casas.
3. **Movimiento real del mercado**: las cuotas se mueven en 5-30s, no en 1s.
   Hacer scraping cada segundo es desperdicio puro.

**Lo que SÍ hacemos: 30s + push en vivo via WebSocket.** Cuando el backend
detecta un cambio, lo pushea al frontend en milisegundos. El usuario ve el
movimiento "en vivo" aunque el scraping sea cada 30s.

## Deploy a Render

```
render.com → New + → Blueprint → conectar este repo → Apply
```

`render.yaml` define:
- 1 Web Service Node 20 (plan **Standard** recomendado — el Free hiberna)
- Build: `npm install && npx playwright install chromium --with-deps`
- Start: `npm start`
- Health check: `/api/health`

Después, en **Environment**, cargar las API keys de `.env.example` (las de
IA + Supabase + Football-Data opcional).

## Sobre la legalidad del scraping

Las cuotas en casas legales argentinas son **ofertas públicas de contrato**
expuestas sin autenticación. El acceso sin login + sin bypass de medidas de
seguridad + con rate limiting respetuoso (30s/ciclo) cae bajo lectura de
interfaz pública. No usamos las cuotas para "republicar competitivamente",
sino como insumo estadístico para análisis IA — obra derivada protegida.

Marco legal aplicado: Ley 25.326 (Habeas Data), LOTBA, IPLyC, principios de
interoperabilidad y buena fe contractual. Disclaimer completo en
`/terminos.html` y `/privacidad.html`.

## Cómo se manejan datos faltantes

> **Regla de oro**: si no tenemos el dato real, mostramos empty state honesto.
> NUNCA datos sintéticos.

| Situación                              | Qué ve el usuario                           |
| -------------------------------------- | ------------------------------------------- |
| Backend caído                          | "Conectando con el scraper…"                |
| Primer ciclo aún corriendo             | "Esperando primer snapshot…"                |
| Una casa devolvió error                | Esa casa no aparece en el comparador        |
| Mercado todavía no abierto (WC futures)| "Pendiente apertura — se publicará pronto"  |
| Tracker sin operaciones del usuario    | "Cargá tu primera apuesta" + import CSV     |

## Frontend — archivos clave

| Archivo                            | Responsabilidad                              |
| ---------------------------------- | -------------------------------------------- |
| `assets/js/live.js`                | Cliente REST + WebSocket hacia el backend    |
| `assets/js/data.js`                | Catálogos estáticos + `liveEvents/awaitLive` |
| `assets/js/api.js`                 | IA cascada + delega odds en BSLive           |
| `assets/js/tabs-comparator.js`     | Comparador 12 casas — push en vivo           |
| `assets/js/tabs-arbitrage.js`      | Surebets del backend                         |
| `assets/js/tabs-smartmoney.js`     | Steam moves del backend                      |
| `assets/js/tabs-tracker.js`        | Historial REAL del usuario (no fake)         |

## Próximos pasos sugeridos

1. **Tests E2E** de cada scraper individualmente.
2. **Cache Redis** entre instancias si escalás horizontalmente.
3. **Supabase persistence** para tracker — actualmente vive en localStorage.
4. **Push notifications FCM** cuando aparece una surebet ROI > umbral.
