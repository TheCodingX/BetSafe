# BetSafe — Setup pre-deploy

Esta guía te lleva de **demo en local** → **producción con datos reales**.
Lo que hay que hacer es **crear cuentas, copiar keys, deployar**. Todo el código ya está enchufable.

---

## TL;DR (15 min)

1. Crear cuenta en **The Odds API** → copiar key
2. Crear cuenta en **Groq** → copiar key
3. Crear proyecto en **Supabase** → correr SQL → copiar URL + anon key
4. Push del repo a **GitHub**
5. Conectar a **Render** → pegar env vars → deploy

Después de eso la app corre con datos reales: cuotas live, IA generativa, auth multi-device, slip sincronizado.

---

## Paso 1 — Cuotas: The Odds API

**Free tier: 500 requests/mes.** Cubre EPL, La Liga, Serie A, Bundesliga, Champions, NBA, NFL, MLB, NHL, MMA y más.

1. Andá a https://the-odds-api.com
2. Sign up → confirmá email
3. Dashboard → copiá tu API key
4. Guardala como `BS_ODDS_API_KEY` en `.env` (o en Render vars)

**Mercados disponibles en plan free:** `h2h` (1X2), `spreads` (hándicap), `totals` (más/menos).
**Plan paid** ($25/mes en adelante) suma BTTS, alternate spreads/totals, más requests.

---

## Paso 2 — IA generativa (Groq, Gemini, OpenRouter)

La app usa cascada: prueba Groq primero (más rápido), si falla pasa a Gemini, después OpenRouter.
Con que tengas **una** te alcanza para que la IA ande. Configurá las 3 para redundancia.

### Groq (recomendado primero)
1. https://console.groq.com → Sign up
2. API Keys → Create API Key
3. `BS_GROQ_API_KEY=gsk_...`
- Free tier: ~30 req/min, llama-3.3-70b-versatile + llama-3.1-8b-instant.

### Google Gemini
1. https://aistudio.google.com/app/apikey → Get API Key
2. `BS_GEMINI_API_KEY=AIza...`
- Free tier generoso con `gemini-flash-latest`.

### OpenRouter
1. https://openrouter.ai/keys → Create Key
2. `BS_OPENROUTER_API_KEY=sk-or-v1-...`
- Acceso a varios modelos free (Llama, GLM).

---

## Paso 3 — Supabase (auth + DB + realtime)

**Free tier:** 500 MB DB, 50k usuarios, 2 GB bandwidth.

1. https://supabase.com → New project
2. Anotá la **password** del DB (no la vas a necesitar para la app, pero la pide al crear)
3. Esperá ~2 min a que provisione
4. **SQL Editor** → New Query → pegá TODO el contenido de [`SUPABASE_SCHEMA.sql`](./SUPABASE_SCHEMA.sql) → Run
   Esto crea: `profiles`, `bankroll`, `bet_history`, `slips`, `saved_picks`, `tracker_notes`, `arb_history` + RLS + triggers + view `v_user_stats`.
5. **Authentication → Providers** → Email está habilitado por default. Si querés Google/Apple, configurálos acá.
6. **Settings → API**:
   - Copiá **Project URL** → `BS_SUPABASE_URL`
   - Copiá **anon public key** → `BS_SUPABASE_ANON_KEY`

### Realtime para slips
El SQL ya ejecuta `alter publication supabase_realtime add table public.slips`.
Verificá: **Database → Replication** → la tabla `slips` debe aparecer con Realtime ON.

### Email templates (opcional)
**Authentication → Email Templates** — personalizá el email de verificación con el branding BetSafe.

---

## Paso 4 — Football-data.org (opcional, suma fixtures)

Free tier: 10 req/min, fixtures + standings + scorers para top leagues europeas.

1. https://www.football-data.org/client/register
2. Copiá el token → `BS_FOOTBALL_DATA_API_KEY=...`

Sin esto la app sigue andando — solo no carga datos de fixtures detallados.

---

## Paso 5 — Variables de entorno

Copiá `.env.example` a `.env` y completá:

```bash
BS_ODDS_API_KEY=tu_key
BS_GROQ_API_KEY=tu_key
BS_GEMINI_API_KEY=tu_key
BS_OPENROUTER_API_KEY=tu_key
BS_FOOTBALL_DATA_API_KEY=tu_key

BS_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
BS_SUPABASE_ANON_KEY=eyJ...
```

`.env` está en `.gitignore` — **nunca lo pushees al repo**.

---

## Paso 6 — Probar en local

```bash
node build/inject-env.js   # genera assets/js/env.js con tus keys
python3 -m http.server 8080
# abrí http://localhost:8080
```

Validá en la consola del browser:
```js
window.__BS_CONFIG          // → { odds: '...', groq: '...', supabaseUrl: '...' }
BSApi.STATUS                 // → { odds: 'live', ai: 'idle' }
BSData.loadEnrichedMatches().then(m => console.log('Matches:', m.length, m[0]))
BSSupabase.isConfigured()    // → true
```

Si todo da los valores esperados, andás bien.

---

## Paso 7 — Deploy a Render

### 7.1 Push a GitHub

```bash
git init
git add .
git commit -m "BetSafe — production-ready release"
git remote add origin https://github.com/<tu-usuario>/betsafe.git
git push -u origin main
```

### 7.2 Render

1. https://render.com → New + → **Blueprint**
2. Connect repository → seleccioná `betsafe`
3. Render detecta `render.yaml` y propone crear el static site
4. Pegá las env vars (las mismas que en `.env`)
5. **Apply**

Render corre `node build/inject-env.js` antes de servir — eso genera `assets/js/env.js` con tus keys reales.

### 7.3 Custom domain (opcional)
**Settings → Custom Domains** → seguí el wizard de DNS.

---

## Seguridad post-deploy

### ⚠️ Rotar las keys hardcoded
En `assets/js/api.js` hay 4 keys hardcoded (las que ya estaban en el repo).
Como están en el git history público, **rotalas ahora**:

1. Groq → Console → Delete + Create new
2. Gemini → AI Studio → Delete + Create new
3. OpenRouter → Keys → Delete + Create new
4. The Odds API → Dashboard → Regenerate

Las nuevas las cargás en Render vars, no en el código.

### Variables sensibles que NUNCA van al frontend
La anon key de Supabase **sí puede** ir al frontend (es pública por diseño, RLS protege todo).
La service_role key **NUNCA** la pongas en el frontend — solo en backend serverless si vas a hacer admin tasks.

---

## Cómo funciona la arquitectura

```
┌───────────────────────────────────────────────────────────┐
│  Browser                                                  │
│  ┌──────────────────────────────────────────────┐        │
│  │  env.js → window.__BS_CONFIG                 │        │
│  │  engine.js → BSEngine (Poisson, Elo, Kelly, │        │
│  │              EV, surebet, Monte Carlo)       │        │
│  │  api.js → BSApi (cache + fallback cascade)  │        │
│  │  supabase-client.js → BSSupabase            │        │
│  │  auth.js → BSAuth (Supabase si configured,   │        │
│  │            local fallback si no)             │        │
│  │  store.js → BSStore + BSStore.cloud          │        │
│  │  data.js → loadEnrichedMatches (API+engine)  │        │
│  └──────────────────────────────────────────────┘        │
└────────────────┬──────────────────────────────────────────┘
                 │
        ┌────────┴────────┬─────────────┬──────────────┐
        ▼                 ▼             ▼              ▼
   The Odds API       Groq/Gemini    Supabase      football-data
   (cuotas live)      (IA texto)     (DB + auth)   (fixtures)
```

### Niveles de degradación
- **Sin Odds API key**: matches sintéticos enriquecidos con engine (Poisson + Elo).
- **Sin LLM keys**: análisis offline template-based (sigue mostrando EV/Kelly del engine).
- **Sin Supabase**: auth local (admin/admin, vip/vip), persistencia en localStorage.

La app **nunca crashea por una key faltante**.

---

## Motor cuantitativo (`engine.js`)

Implementaciones reales, no mocks:

| Función | Modelo |
|---|---|
| `bivariateGrid(λH, λA)` | Poisson independiente para goles |
| `deriveMarketsFromGrid()` | 1X2, BTTS, Over/Under, DC, DNB desde grilla |
| `removeMarginShin(odds)` | Remoción de margen Shin (corrige sesgo favorito-longshot) |
| `expectedValue(p, odd)` | EV real |
| `kellyFraction(p, odd, mult)` | Kelly fractional con cap |
| `detectSurebet(odds)` | Σ(1/odd) < 1 → ROI + stakes óptimos |
| `findBestSurebet(booksOdds)` | Best-of cross-book |
| `optimizeCombo(matches, n, risk)` | Branch-and-bound EV-maximizer con anti-correlación |
| `monteCarloCombo(legs, stake, runs)` | N simulaciones, percentiles P05–P95 |
| `whatIfCombo(legs, stake)` | Enumeración exacta 2^N escenarios |
| `sharpe / sortino / maxDrawdown` | Métricas de riesgo |
| `ELO.update(rH, rA, result)` | Rating dinámico |

Todo es **matemática pública** (Poisson, Elo, Kelly, Monte Carlo). Cualquier auditor cuantitativo puede revisar el código.

---

## Troubleshooting

**`BSApi.STATUS.odds === 'no-key'`** → No detectó la key. Verificá `window.__BS_CONFIG.odds` en consola. Si está vacío, no se ejecutó `inject-env.js`. Render → Manual Deploy.

**`BSSupabase.isConfigured() === false`** → Faltan URL o anon key. Mismo check de consola.

**Auth no persiste entre tabs** → Verificá que el navegador permite localStorage en el dominio.

**Surebets siempre 0** → Mercado real raras veces tiene Σ(1/odd) < 1. Lo normal es no encontrar ninguna en plan free (pocas casas). Plan paid de Odds API con más bookmakers sí encuentra.

**Rate limit Odds API agotado** → Check `BSApi.rateLimit.odds`. El cache de 5 min en localStorage te reduce mucho el consumo.

---

## Próximos pasos sugeridos

1. **Backtest histórico** — guardar `closing_odd` en `bet_history` te permite calcular CLV agregado vía `v_user_stats.avg_clv`.
2. **Modelo ML serio** — entrenar XGBoost / LightGBM sobre tu histórico de bets (cuando tengas 500+ resueltas) en un worker Python en Render Background Worker.
3. **Cron en Render** — Background Worker que rastrea cierre de mercado y guarda `closing_odd` automáticamente.
4. **Edge functions Supabase** — para llamadas que necesiten service_role (admin de usuarios, settlement automático).
5. **Webhooks Discord/Telegram** — alertas de surebets/smart-money desde un Background Worker, no desde el frontend.

---

## Soporte

Cualquier problema de integración: revisá la consola del browser (todos los errores se loggean con prefijo `[api]`, `[supabase]`, etc.).
