# BetSafe — Arquitectura

## Stack
- **Vanilla HTML/CSS/JS** sin build step. Drag-and-drop deploy a Netlify.
- **Web Audio API** (audio alerts).
- **Intersection Observer** (reveal, count-up).
- **Service Worker** (PWA, offline-first cache).
- **Manifest v3** (instalable).
- APIs externas client-side (luego se mueven a backend Render/Supabase):
  - The Odds API (`061ccf6ca289dbd26ced3c05517c7cd9`)
  - Groq Llama 3.1 (`gsk_…`)
  - Gemini, OpenRouter, Hugging Face (fallbacks).

## Estructura de archivos

```
/
├─ index.html          (landing)
├─ login.html          (login con admin/admin · vip/vip)
├─ signup.html         (multi-step + +18)
├─ dashboard.html      (SPA shell, 12 tabs)
├─ features.html       (155 funciones filtrables)
├─ tools.html          (80+ tools, 4 categorías)
├─ pricing.html        (Standard / VIP)
├─ learn.html          (6 cursos)
├─ responsable.html    (compliance + auto-test)
├─ terminos.html
├─ privacidad.html
├─ cookies.html
├─ 404.html
├─ manifest.webmanifest
├─ sw.js
├─ sitemap.xml · robots.txt
├─ netlify.toml · _redirects
├─ DESIGN-SYSTEM.md · ARCHITECTURE.md
└─ assets/
   ├─ css/main.css   (todo el design system)
   ├─ img/icon-192.svg, icon-512.svg, og.svg
   └─ js/
      ├─ data.js          (BOOKS, SPORTS, LEAGUES, TEAMS, NATIONS, makeMatches)
      ├─ icons.js         (BSIcons.svg/bookLogo/teamLogo/flagSvg)
      ├─ store.js         (BSStore: localStorage + event bus)
      ├─ auth.js          (BSAuth: login/logout/isVip — admin/vip hardcoded)
      ├─ api.js           (BSApi: Odds API + Groq + fallbacks, 30s cache)
      ├─ math.js          (BSMath: Kelly, EV, Poisson, Monte Carlo, Elo, Sharpe…)
      ├─ ui.js            (BSUI: theme, toast, modal, drawer, tooltip, palette, format)
      ├─ shell.js         (header/footer injector)
      ├─ app.js           (boot global: theme, hooks, shortcuts, ⌘K)
      ├─ onboarding.js    (BSOnboarding.start)
      ├─ dashboard.js     (BSDash: router, slip, locks)
      ├─ features-data.js (FEATURES_DATA — 155 entries)
      └─ tabs-*.js        (12 archivos, uno por tab; usan BSDash.register)
```

## Routing
- Páginas separadas (no SPA cross-page).
- Dashboard SPA via `location.hash` (`#overview`, `#arbitrage`, etc.).
- `_redirects` mapea rutas amigables (`/app` → `/dashboard.html`).

## Auth
- 100% client-side, hardcoded para demo.
- `admin / admin` → Standard.
- `vip / vip` → VIP (gold accents, todos los tabs).
- Botón "Probar VIP demo" en cualquier tab bloqueado upgrade in-session.

## Storage (claves del contrato)
Definidas en `BSStore.KEYS`:
- `betsafe.session` · `bs:theme` · `bs:slip` · `bs:favorites`
- `bs:watchlist` · `bs:watchlists` · `bs:recent` · `bs:pinned_bets`
- `bs:linehist` · `bs:elo` · `bs:vip:alerts` · `bs:arb:history`
- `bs:filters` · `bs:promos` · `bs:accounts` · `bs:api_key`
- `bs:course_progress` · `bs:token` · `bs:onboarding`
- `bs:age_verified` · `bs:cookie_consent` · `bs:bankroll`
- `bs:history` · `bs:notifications` · `bs:settings`

## Tabs del dashboard
1. `overview` — KPIs animados, equity curve, sport switcher, quick actions
2. `builder` — combinada manual + best-book finder
3. `ai` — 3 picks por partido + análisis Llama (8B/70B)
4. `comparator` — tabla 25 casas con auto-refresh 30s + risk slider
5. `calc` — 9 calculadoras Standard
6. `calcpro` — 24 herramientas VIP cuantitativas
7. `arbitrage` — motor en vivo + calc 2-way/3-way + middling + audio
8. `smartmoney` — alertas custom + stream sharp/public
9. `whatif` — 2^N enumeration + Monte Carlo
10. `worldcup` — Mundial 2026 hub completo
11. `tracker` — historial filtrable + KPIs + bars chart + worst-trade rule
12. `settings` — apariencia, datos, atajos

## Datos sintéticos vs reales
- `BSData.makeMatches()` genera matches deterministas (LCG seed) con 25 books.
- `BSApi.getOdds()` intenta The Odds API; si falla o el sport está bloqueado → `getMockOdds()`.
- `BSApi.aiAnalyze()` llama a Groq; si falla → texto de fallback prearmado (no Math.random en respuestas).
- Todo el motor de cálculos vive en `BSMath` (Kelly, Sharpe, Sortino, Poisson, Monte Carlo con LCG, Elo, Markov, hedge, lay, dutch, surebet, no-vig, CLV, Pythagorean).

## Performance
- CSS gzip: ~22KB. JS gzip total: ~45KB (split por uso).
- Defer/async no necesarios — scripts al final del body.
- Service Worker precachea las páginas principales.
- Sin layout shifts (dimensiones explícitas, sparkline con viewBox fijo).

## Accesibilidad
- WCAG 2.2 AA, focus-visible, skip-link, ARIA, live regions.
- Touch targets 44px+. Zoom 200% sin pérdida.
- `prefers-reduced-motion` respetado en todas las animaciones.

## Compliance argentina
- Banner de juego responsable persistente.
- Sellos LOTBA / IPLyC / +18 en footer.
- Verificación +18 modal al primer ingreso.
- Cookie banner granular (necesarias / analíticas / marketing) que respeta DNT.
- Política de privacidad bajo Ley 25.326.
- Mensaje de tilt cuando `bs:history` muestra 4+ pérdidas + stake creciente.

## Roadmap backend (luego)
- Supabase: auth, perfiles, histórico de picks, suscripciones VIP.
- Render + Playwright: scraping de cuotas live AR (Bplay / Betano / Betwarrior / 1xBet).
- Worker para cron de surebets server-side.
- FCM para push notifications.
- Webhooks Discord/Telegram (alertas).
