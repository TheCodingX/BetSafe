/* BetSafe — Funciones reales (sin fluff). 100 funciones operativas
 * ────────────────────────────────────────────────────────────────
 * Cada item es una función con valor concreto para el usuario.
 * Eliminadas: detalles de implementación (logos SVG, refresco 30s,
 * fallbacks de API, integraciones internas, accesibilidad, etc.).
 * Solo capacidades reales que el apostador usa.
 */
window.FEATURES_DATA = [
  {
    name: 'Comparador de cuotas', area: 'Core',
    items: [
      { name: 'Comparador en vivo de las casas legales AR', tier: 'standard', desc: 'Una sola vista con todas las cuotas legales AR' },
      { name: 'Resaltar la mejor cuota por outcome', tier: 'standard', desc: 'En verde, automáticamente' },
      { name: 'Diferencia % entre la mejor y la peor', tier: 'standard', desc: 'Cuánto valor estás dejando' },
      { name: 'Filtrar por deporte y por liga', tier: 'standard', desc: '14 deportes, 16 ligas top' },
      { name: 'Calcular el margen del libro (overround)', tier: 'standard', desc: 'Detectar libros caros vs baratos' },
      { name: 'Detección automática de surebets', tier: 'standard', desc: 'Banner cuando hay arbitraje gratis' },
      { name: 'Risk slider: filtrar cuotas por banda', tier: 'standard', desc: 'De conservador 1.10 a longshot 5.0+' },
      { name: 'Histórico de cuotas in-session', tier: 'vip',      desc: 'Ver cómo se movió la línea' }
    ]
  },
  {
    name: 'Picks con IA', area: 'Core',
    items: [
      { name: '3 picks por partido (cons / equilibrado / agresivo)', tier: 'standard' },
      { name: 'Análisis táctico explicado en 3 párrafos', tier: 'standard', desc: 'Probabilístico, contexto, riesgo' },
      { name: 'Justificación con datos: forma, lesiones, value', tier: 'standard' },
      { name: 'Generador IA de combinadas 2/3/4 legs', tier: 'standard' },
      { name: 'Detección de correlación entre legs', tier: 'vip', desc: 'Evitá combinadas trampa' },
      { name: 'Modelo Poisson xG (1X2, BTTS, Over 2.5)', tier: 'vip' },
      { name: 'Matriz de resultados exactos', tier: 'vip', desc: 'Hasta 5 goles' },
      { name: 'Análisis IA premium en cualquier partido', tier: 'vip' }
    ]
  },
  {
    name: 'Builder de combinadas', area: 'Core',
    items: [
      { name: 'Builder manual: arrastrá y combiná legs', tier: 'standard' },
      { name: 'Te dice qué casa paga más por tu combinada', tier: 'standard' },
      { name: 'Cuota total, payout y profit en tiempo real', tier: 'standard' },
      { name: 'Bet slip que sobrevive cierres de browser', tier: 'standard' },
      { name: 'Compartir slip por link único', tier: 'standard' }
    ]
  },
  {
    name: 'Calculadoras', area: 'Core',
    items: [
      { name: 'Valor (break-even probability)', tier: 'standard' },
      { name: 'Conversor decimal / americana / fraccional', tier: 'standard' },
      { name: 'Probabilidad implícita', tier: 'standard' },
      { name: 'Stake objetivo dado un profit target', tier: 'standard' },
      { name: 'ROI requerido para break-even', tier: 'standard' },
      { name: 'Combinada (cuotas + stake)', tier: 'standard' },
      { name: 'Stake plano (% de banca)', tier: 'standard' },
      { name: 'Stake progresivo anti-tilt', tier: 'standard' },
      { name: 'Stake por unidades', tier: 'standard' },
      { name: 'Quick arb check 2-way', tier: 'standard' }
    ]
  },
  {
    name: 'Tracker & Banca', area: 'Core',
    items: [
      { name: 'Curva de evolución de banca día a día', tier: 'standard' },
      { name: 'Win rate, ROI y Yield', tier: 'standard' },
      { name: 'Racha actual y récord histórico', tier: 'standard' },
      { name: 'Historial filtrable por fecha/deporte/resultado', tier: 'standard' },
      { name: 'Worst-trade rule (verde si el peor es positivo)', tier: 'standard' },
      { name: 'Export del histórico a CSV', tier: 'standard' },
      { name: 'Cuota promedio (te dice tu estilo)', tier: 'standard' },
      { name: 'Total invertido vs total ganado', tier: 'standard' }
    ]
  },
  {
    name: 'Mundial 2026', area: 'Hub',
    items: [
      { name: 'Hub dedicado con countdown live al kickoff', tier: 'standard' },
      { name: '48 selecciones agrupadas por confederación', tier: 'standard' },
      { name: 'Top 7 favoritos al título con cuotas', tier: 'standard' },
      { name: 'Top scorers para el Botín de Oro', tier: 'standard' },
      { name: 'Timeline de eventos clave 2026', tier: 'standard' },
      { name: 'Hot/Cold trends de selecciones', tier: 'standard' }
    ]
  },
  // ────────────── VIP ──────────────
  {
    name: 'Arbitraje profesional', area: 'VIP',
    items: [
      { name: 'Motor de arbitraje en vivo (5 deportes)', tier: 'vip' },
      { name: 'Calculadora surebet 2-way y 3-way', tier: 'vip' },
      { name: 'Slippage protection con margen seguridad', tier: 'vip' },
      { name: 'Sugerencias Kelly automáticas por bet', tier: 'vip' },
      { name: 'Filtros: profit mínimo, banca, stake máximo', tier: 'vip' },
      { name: 'Whitelist y blacklist de books', tier: 'vip' },
      { name: 'Histórico de las últimas 500 surebets', tier: 'vip' },
      { name: 'Audio alerts cuando aparece una surebet', tier: 'vip' },
      { name: 'Copy-stakes formateados para pegar', tier: 'vip' },
      { name: 'Middling calculator (over/under en líneas distintas)', tier: 'vip' }
    ]
  },
  {
    name: 'Money management Pro', area: 'VIP',
    items: [
      { name: 'Kelly Criterion fractional (½, ¼, ⅛)', tier: 'vip' },
      { name: 'Kelly portfolio: sizing combinado multi-bet', tier: 'vip' },
      { name: 'Drawdown estimator con 95% confianza', tier: 'vip' },
      { name: 'Bankroll growth con compounding', tier: 'vip' },
      { name: 'Sharpe Ratio y Sortino Ratio', tier: 'vip' },
      { name: 'Max drawdown observado', tier: 'vip' },
      { name: 'Hedge calculator', tier: 'vip' },
      { name: 'Lay betting calculator', tier: 'vip' },
      { name: 'Free bet conversion (SNR / SR)', tier: 'vip' },
      { name: 'Dutching calculator', tier: 'vip' }
    ]
  },
  {
    name: 'Simulación cuantitativa', area: 'VIP',
    items: [
      { name: 'Monte Carlo 1000+ runs', tier: 'vip' },
      { name: 'Percentiles de outcome (P5/P25/P50/P75/P95)', tier: 'vip' },
      { name: 'What-If: enumeración de escenarios 2^N', tier: 'vip' },
      { name: 'Elo rating update con K-factor configurable', tier: 'vip' },
      { name: 'Markov streak projection', tier: 'vip' },
      { name: 'Bayesian Probability Updater', tier: 'vip' }
    ]
  },
  {
    name: 'Value & EV', area: 'VIP',
    items: [
      { name: 'EV calculator single y multi/combinada', tier: 'vip' },
      { name: 'Value Index (Probabilidad × Cuota)', tier: 'vip' },
      { name: 'No-Vig Fair Odds (línea sin margen)', tier: 'vip' },
      { name: 'CLV individual y agregado histórico', tier: 'vip', desc: 'Closing Line Value' },
      { name: 'Detector de value bets en vivo', tier: 'vip' },
      { name: 'Risk Score 0-100 por pick', tier: 'vip' },
      { name: 'Recomendación de book óptimo por outcome', tier: 'vip' }
    ]
  },
  {
    name: 'Market Intelligence', area: 'VIP',
    items: [
      { name: 'Steam moves detector (movimientos sharp)', tier: 'vip' },
      { name: 'Reverse Line Movement analyzer', tier: 'vip' },
      { name: 'Sharp / Square indicator', tier: 'vip' },
      { name: 'Smart Money Alerts (>5% / hora)', tier: 'vip' },
      { name: 'Aggregated public bet %', tier: 'vip' },
      { name: 'News Impact Detector', tier: 'vip' }
    ]
  },
  {
    name: 'Performance analytics', area: 'VIP',
    items: [
      { name: 'ROI por deporte / liga / mercado / book', tier: 'vip' },
      { name: 'Profit por mes y por día de la semana', tier: 'vip' },
      { name: 'Mejor y peor pick histórico', tier: 'vip' },
      { name: 'Cuota promedio ganadora vs perdedora', tier: 'vip' },
      { name: 'Stake promedio por nivel de confianza', tier: 'vip' },
      { name: 'Skill vs Luck index basado en CLV', tier: 'vip' }
    ]
  },
  {
    name: 'Alertas en tiempo real', area: 'VIP',
    items: [
      { name: 'Alertas custom por ROI mínimo', tier: 'vip' },
      { name: 'Alertas por deporte / liga', tier: 'vip' },
      { name: 'Price alerts (avisame si una cuota llega a X)', tier: 'vip' },
      { name: 'Detección de tilt automática', tier: 'vip', desc: '4+ pérdidas + stake +50%' },
      { name: 'Push notifications a dispositivo', tier: 'vip', pending: true },
      { name: 'Webhook a Discord / Telegram', tier: 'vip', pending: true }
    ]
  },
  {
    name: 'Herramientas pro adicionales', area: 'VIP',
    items: [
      { name: 'Tax calculator AR (5 jurisdicciones)', tier: 'vip', desc: 'CABA, BSAS, Córdoba, Santa Fe, Mendoza' },
      { name: 'Promo y Free Bet tracker', tier: 'vip' },
      { name: 'Watchlist persistente entre sesiones', tier: 'vip' },
      { name: 'Weather impact por sede del partido', tier: 'vip' },
      { name: 'Cash-Out optimizer (cuándo cerrar por EV)', tier: 'vip' },
      { name: 'Same-Game Parlay correlator', tier: 'vip' },
      { name: 'Player Props database (hit rate últimos 50)', tier: 'vip' },
      { name: 'Injury & Suspension feed', tier: 'vip' },
      { name: 'Referee Tendencies database', tier: 'vip' },
      { name: 'Pace-Adjusted Ratings (NBA)', tier: 'vip' },
      { name: 'EPA / Success Rate (NFL)', tier: 'vip' },
      { name: 'Pythagorean Win Expectancy', tier: 'vip' },
      { name: 'Strength of Schedule', tier: 'vip' },
      { name: 'B2B / Rest days impact', tier: 'vip' },
      { name: 'Power Rankings dinámicos', tier: 'vip' },
      { name: 'Heatmap de Value sobre el slate', tier: 'vip' },
      { name: 'Backtesting visual con estrategias guardables', tier: 'vip' },
      { name: 'Track Record verificable (hash criptográfico)', tier: 'vip' },
      { name: 'API REST con tu propia key', tier: 'vip' }
    ]
  },
  {
    name: 'Builder de combinadas Pro', area: 'VIP',
    items: [
      { name: 'Round Robin / System Bets', tier: 'standard', desc: 'Trixie, Yankee, Lucky 15/31/63, Heinz' },
      { name: 'Asian Handicap calculator', tier: 'standard' },
      { name: 'H2H histórico de 10 años', tier: 'standard' },
      { name: 'Bookmaker stake limits database', tier: 'standard' },
      { name: 'Bonus Bet Converter (free bet → cash)', tier: 'standard' },
      { name: 'Line History Chart (auto-tracking)', tier: 'standard' }
    ]
  }
];
