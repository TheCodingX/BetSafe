# BetSafe — Design System

## Filosofía
Mesa cuantitativa fintech-grade, no app de casino. Calma visual en reposo, dinamismo total en interacción. Light mode por defecto, dark mode como toggle. Cero CSS antiguo, cero emojis del SO en UI, cero nativos sin estilizar, cero letras griegas como iconografía.

## Tokens (en `assets/css/main.css`)

### Marca
- `--brand-50…900` — verde institucional (LOTBA-friendly).
- `--gold-50…700` — accent VIP.

### Superficies
- `--bg-0/1/2`, `--surface`, `--surface-2/3` (4 niveles de elevación).
- `--border`, `--border-strong`.

### Texto
- `--text-primary/secondary/tertiary/inverse`.

### Semánticos
- success / danger / warning / info, con bg + color.

### Sombras
- `--shadow-sm/md/lg/xl` — sutiles en light, profundas en dark.

### Radios
- 4 / 6 / 10 / 14 / 20 / 28 / pill.

### Espaciado
- escala 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24 (px).

### Tipografía
- Sans: Inter (sistema fallback). Mono: JetBrains Mono (sistema fallback).
- `feature-settings: ss01, cv11, tnum` global → tabular-nums por default.
- Escala: `.h1` (clamp 2-3.5rem), `.h2`, `.h3`, `.h4`, `.lead`, `.eyebrow`, `.tiny`.

### Motion
- Easings: `ease`, `ease-out`, `ease-in`, `ease-spring`.
- Durations: 140ms / 220ms / 360ms.
- Respeta `prefers-reduced-motion`.

## Modos
- `data-theme="light|dark"` en `<html>`.
- `data-vip="true"` swap a paleta dorada.

## Componentes

### Buttons (`.btn`)
- `.btn-primary` (verde), `.btn-outline`, `.btn-ghost`, `.btn-gold` (VIP), `.btn-danger`, `.btn-success`.
- Tamaños: `.btn-sm`, `.btn-lg`, `.btn-icon`, `.btn-block`.
- Hover lift `-1px`, shimmer sweep, magnetic con `.mag`.

### Cards
- `.card` base, `.card-hover`, `.card-elev`, `.card-tinted`, `.card-vip` (gradient gold edge), `.card-pad-lg/sm`.

### Forms
- `.input`, `.select`, `.textarea` 100% custom.
- `.check` (checkbox), `.radio`, `.toggle`, `.slider` (con `.slider-risk` colored).

### Tablas
- `.table-wrap` + `.table`. Mobile: `.table-cards` convierte filas a cards (<720px).

### KPIs
- `.kpi`, `.kpi-label`, `.kpi-value`, `.kpi-delta` (con `.up`/`.down`).

### Tabs
- `.tabs` underline-style. `.seg` segmented pill-style.

### Modal / Drawer / Toast / Tooltip
- `.modal` con focus trap. `.drawer` left/right. Toasts tipo Sonner con barra de progreso.

### Risk pills, badges, chips
- `.risk-pill.low/mid/high`, `.badge-*`, `.badge-vip` (gold gradient).

### Charts
- `.spark` SVG con stroke-dasharray draw-on-mount.
- `.bar-chart` flex-based.
- `.ring-progress` con conic-gradient.

### Animaciones / motion
- `.reveal`, `.reveal-stagger` (IO observer).
- `.flash-up` / `.flash-down` (cambio de cuotas).
- `.shimmer`, `.skel` (loaders).
- `.confetti-host` (al ganar VIP).
- Marquee `.marquee` (cuotas live).

### Layout
- `.container` (1200px), `.container-wide` (1320px).
- `.grid grid-2/3/4/auto/auto-lg`.
- `.app-shell` para dashboard (260px sidebar + main).
- `.bottom-nav` mobile fixed con safe-area.

## Accesibilidad
- WCAG 2.2 AA. Contraste mínimo 4.5:1 normal, 3:1 grande.
- `:focus-visible` outline custom 2px brand-600 con offset 2px.
- Skip link `.skip-link`.
- `lang="es-AR"`, `dir="ltr"`.
- Touch targets ≥44px.
- ARIA labels en iconos, live regions para datos en tiempo real.

## Localización
- `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` para todos los montos.
- `Intl.DateTimeFormat('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })` para fechas.

## Logos / Iconografía
- Brand mark inline SVG con gradient `bs-g`.
- Iconografía vía `BSIcons.svg(name)` (Lucide-inspired path set).
- Book/Team logos generados por `BSIcons.bookLogo/teamLogo` (initials con color de marca).
- Bandera por `BSIcons.flagSvg(code)` con paleta por país.

## Branding VIP
- Cuando `BSAuth.isVip()` → `BSUI.applyVip(true)` setea `data-vip="true"`.
- `--brand-600` se reemplaza por `--gold-600`. Botones `.btn-gold` mantienen su gradient.

## Performance
- Bundle CSS objetivo <60KB gzip. JS inicial <80KB gzip (landing).
- Will-change estratégico (solo durante animación), GPU-only (transform/opacity).
- Service Worker con cache-first para assets, network-first para HTML.
