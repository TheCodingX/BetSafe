# BetSafe

Plataforma argentina **legal** de análisis cuantitativo de apuestas deportivas.

> **No somos casa de apuestas.** Te damos comparador de cuotas, IA para picks, banca y arbitraje. Vos operás en las casas legales de Argentina.

## Deploy a Netlify (drag-and-drop)

1. Comprimir esta carpeta en un .zip o subirla directamente.
2. Ir a https://app.netlify.com/drop
3. Arrastrar.

Listo — el sitio queda online.

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
