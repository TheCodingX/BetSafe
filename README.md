# BetSafe

Plataforma argentina **legal** de análisis cuantitativo de apuestas deportivas.

> **No somos casa de apuestas.** Te damos comparador de cuotas, IA para picks, banca y arbitraje. Vos operás en las 6 casas legales argentinas: **Bplay, Betano, BetWarrior, Bet365 AR, Codere y Betsson** (LOTBA / IPLyC).

## Stack

- **Frontend**: HTML/CSS/JS vanilla (sin framework, sin build step pesado)
- **Backend**: Node.js 20+ Express + WebSocket + Playwright
- **Sources**: 4 scrapers dedicados (Bplay XML / Betano Kaizen JSON / BetWarrior Kambi / Codere .NET) + The Odds API (Bet365 + Betsson)

## Deploy a Render (recomendado)

El repo trae `render.yaml` listo para Blueprint deploy. Plan recomendado: **Standard ($25/mes)** — el plan Free hibernará el scraper cada 15 min de inactividad.

```bash
# 1) Pushear este repo a GitHub
# 2) En render.com → New + → Blueprint → conectar el repo
# 3) Render lee render.yaml y crea el Web Service
# 4) Cargar env vars en Dashboard → Environment (ver .env.example)
# 5) Manual Deploy → Latest commit
```

**Env vars críticas** (configurar como secrets):
- `THE_ODDS_API_KEY` — fuente primaria (Bet365 AR + Betsson + cross-validation)
- `BS_GROQ_API_KEY` o `BS_GEMINI_API_KEY` o `BS_OPENROUTER_API_KEY` — LLM cascade para AI Picks
- `OPENWEATHER_API_KEY` — clima en factors (opcional)
- `APISPORTS_KEY` o `RAPIDAPI_KEY` — lesiones (opcional, fallback ESPN scrape)
- `BS_SUPABASE_URL` + `BS_SUPABASE_ANON_KEY` — auth real (opcional, fallback demo local)

## Dev local

```bash
cd server
npm install
npx playwright install chromium    # solo la primera vez
PORT=8787 npm start
# Abrir http://localhost:8787/
```

## Demo

## Demo

- **Standard:** `admin / admin`
- **VIP (gold tier):** `vip / vip`

## Estructura

Ver [ARCHITECTURE.md](./ARCHITECTURE.md) y [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md).

## Páginas

- `index.html` — landing
- `dashboard.html` — SPA con 12 tabs
- `features.html` — 155 funciones filtrables
- `tools.html` — 80+ herramientas
- `pricing.html` — Standard / VIP
- `learn.html` — Academia
- `responsable.html` — Juego responsable + auto-test
- `terminos.html`, `privacidad.html`, `cookies.html`
- `404.html`

## APIs

Conectadas client-side (luego mover a backend Render/Supabase):

- The Odds API
- Groq (Llama 3.1 8B / 70B)
- Gemini, OpenRouter, HuggingFace (fallbacks)

## Compliance

- LOTBA / IPLyC, verificación +18, juego responsable, Ley 25.326.
- 0800-222-1133 (SEDRONAR), juegoresponsable.com.ar.
