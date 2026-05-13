/* BetSafe — Data layer
 * ============================================================================
 * Catálogos estáticos (casas, deportes, ligas, equipos AR + intl, Mundial 2026)
 * + acceso a eventos en VIVO desde el backend de scraping (BSLive).
 *
 * REGLA: este módulo NO genera datos sintéticos. Si BSLive todavía no tiene
 * eventos, devolvemos [] y la UI muestra "cargando…" hasta que el backend
 * empuje el primer snapshot.
 *
 * Catálogos = configuración estática auditable (casas AR legales, ligas,
 * códigos de país, escudos de equipos para el rendering del frontend).
 * ============================================================================
 */
(function (global) {
  'use strict';

  // Casas AR legales (LOTBA / IPLyC) — IDs coinciden con server/scrapers/<id>.js
  // y con BOOK_MAP de server/sources/oddsapi.js (bet365ar y betsson via Odds API).
  const BOOKS_AR = [
    { key: 'bplay',       name: 'Bplay',        license: 'LOTBA', color: '#0066ff' },
    { key: 'betano',      name: 'Betano',       license: 'LOTBA', color: '#ff6900' },
    { key: 'betwarrior',  name: 'BetWarrior',   license: 'LOTBA', color: '#1a1a1a' },
    { key: 'bet365ar',    name: 'Bet365 AR',    license: 'LOTBA', color: '#14805e' },
    { key: 'codere',      name: 'Codere',       license: 'LOTBA', color: '#00a651' },
    { key: 'betsson',     name: 'Betsson',      license: 'LOTBA', color: '#003a70' }
  ];
  const BOOKS_INTL = [];
  const ALL_BOOKS = BOOKS_AR.slice();

  /* SPORTS — `accent: 'esports'` aplica clase visual distintiva (neon gaming).
   * esports se reordenó al medio (no al final) para que aparezca SIEMPRE en
   * slices(0,8) usados por chips de filtros. Sin esto, esports quedaba
   * invisible en AI Picks + Generator y los usuarios no podían filtrar. */
  const SPORTS = [
    { key: 'soccer',     name: 'Fútbol',          icon: 'soccer'    },
    { key: 'basketball', name: 'Básquet',         icon: 'basketball' },
    { key: 'tennis',     name: 'Tenis',           icon: 'tennis'    },
    { key: 'esports',    name: 'eSports',         icon: 'esports',   accent: 'esports' },
    { key: 'amfootball', name: 'Football Amer.',  icon: 'football'  },
    { key: 'hockey',     name: 'Hockey',          icon: 'hockey'    },
    { key: 'baseball',   name: 'Béisbol',         icon: 'baseball'  },
    { key: 'mma',        name: 'MMA / UFC',       icon: 'mma'       },
    { key: 'boxing',     name: 'Boxeo',           icon: 'boxing'    },
    { key: 'rugby',      name: 'Rugby',           icon: 'rugby'     },
    { key: 'golf',       name: 'Golf',            icon: 'golf'      },
    { key: 'volleyball', name: 'Vóley',           icon: 'volleyball' },
    { key: 'cricket',    name: 'Cricket',         icon: 'cricket'   },
    { key: 'f1',         name: 'F1',              icon: 'f1'        }
  ];

  const LEAGUES = [
    { key: 'epl',         name: 'Premier League',          sport: 'soccer',     country: 'Inglaterra' },
    { key: 'laliga',      name: 'La Liga',                 sport: 'soccer',     country: 'España' },
    { key: 'seriea',      name: 'Serie A',                 sport: 'soccer',     country: 'Italia' },
    { key: 'bundesliga',  name: 'Bundesliga',              sport: 'soccer',     country: 'Alemania' },
    { key: 'ligue1',      name: 'Ligue 1',                 sport: 'soccer',     country: 'Francia' },
    { key: 'ucl',         name: 'Champions League',        sport: 'soccer',     country: 'Europa' },
    { key: 'uel',         name: 'Europa League',           sport: 'soccer',     country: 'Europa' },
    { key: 'lpf',         name: 'Liga Profesional Argentina', sport: 'soccer',  country: 'Argentina' },
    { key: 'libertadores',name: 'Copa Libertadores',       sport: 'soccer',     country: 'Sudamérica' },
    { key: 'sudamericana',name: 'Copa Sudamericana',       sport: 'soccer',     country: 'Sudamérica' },
    { key: 'nba',         name: 'NBA',                     sport: 'basketball', country: 'EE.UU.' },
    { key: 'euroleague',  name: 'EuroLeague',              sport: 'basketball', country: 'Europa' },
    { key: 'nfl',         name: 'NFL',                     sport: 'amfootball', country: 'EE.UU.' },
    { key: 'nhl',         name: 'NHL',                     sport: 'hockey',     country: 'EE.UU.' },
    { key: 'mlb',         name: 'MLB',                     sport: 'baseball',   country: 'EE.UU.' },
    { key: 'mls',         name: 'MLS',                     sport: 'soccer',     country: 'EE.UU.' },
    { key: 'ufc',         name: 'UFC',                     sport: 'mma',        country: 'Mundial' }
  ];

  // Equipos AR + selectos intl (para renderizar escudos en la UI; los nombres
  // reales que vienen del scraper se mapean a estos IDs via normalizeTeam).
  const TEAMS = [
    // Argentina — Liga Profesional
    { id:'boca', name:'Boca Juniors', country:'AR', league:'lpf', color:'#003F87' },
    { id:'river', name:'River Plate', country:'AR', league:'lpf', color:'#FF0000' },
    { id:'racing', name:'Racing Club', country:'AR', league:'lpf', color:'#00A0E1' },
    { id:'independiente', name:'Independiente', country:'AR', league:'lpf', color:'#E10600' },
    { id:'sanlorenzo', name:'San Lorenzo', country:'AR', league:'lpf', color:'#006FCC' },
    { id:'velez', name:'Vélez', country:'AR', league:'lpf', color:'#1B69B4' },
    { id:'estudiantes', name:'Estudiantes', country:'AR', league:'lpf', color:'#D9192C' },
    { id:'gimnasia', name:'Gimnasia LP', country:'AR', league:'lpf', color:'#1E62A6' },
    { id:'huracan', name:'Huracán', country:'AR', league:'lpf', color:'#D9192C' },
    { id:'newells', name:"Newell's", country:'AR', league:'lpf', color:'#E10600' },
    { id:'rosario', name:'Rosario Central', country:'AR', league:'lpf', color:'#003F87' },
    { id:'lanus', name:'Lanús', country:'AR', league:'lpf', color:'#760E13' },
    { id:'banfield', name:'Banfield', country:'AR', league:'lpf', color:'#118C42' },
    { id:'argentinos', name:'Argentinos Jrs', country:'AR', league:'lpf', color:'#D9192C' },
    { id:'colon', name:'Colón', country:'AR', league:'lpf', color:'#D9192C' },
    { id:'union', name:'Unión SF', country:'AR', league:'lpf', color:'#D9192C' },
    { id:'godoy', name:'Godoy Cruz', country:'AR', league:'lpf', color:'#003B6F' },
    { id:'talleres', name:'Talleres', country:'AR', league:'lpf', color:'#003F87' },
    { id:'belgrano', name:'Belgrano', country:'AR', league:'lpf', color:'#003F87' },
    { id:'instituto', name:'Instituto', country:'AR', league:'lpf', color:'#D9192C' },
    { id:'tigre', name:'Tigre', country:'AR', league:'lpf', color:'#003F87' },
    { id:'platense', name:'Platense', country:'AR', league:'lpf', color:'#7E3F2E' },
    { id:'defensa', name:'Defensa y Justicia', country:'AR', league:'lpf', color:'#1A8E2A' },
    { id:'sarmiento', name:'Sarmiento', country:'AR', league:'lpf', color:'#118C42' },
    { id:'aldosivi', name:'Aldosivi', country:'AR', league:'lpf', color:'#118C42' },
    { id:'centralcba', name:'Central Córdoba', country:'AR', league:'lpf', color:'#000000' },
    { id:'atletico', name:'Atlético Tucumán', country:'AR', league:'lpf', color:'#003F87' },
    { id:'barracas', name:'Barracas Central', country:'AR', league:'lpf', color:'#A06B2C' },
    { id:'riestra', name:'Deportivo Riestra', country:'AR', league:'lpf', color:'#FFD300' },
    // EPL
    { id:'mancity', name:'Manchester City', country:'GB', league:'epl', color:'#6CABDD' },
    { id:'manunited', name:'Manchester United', country:'GB', league:'epl', color:'#DA020E' },
    { id:'liverpool', name:'Liverpool', country:'GB', league:'epl', color:'#C8102E' },
    { id:'arsenal', name:'Arsenal', country:'GB', league:'epl', color:'#EF0107' },
    { id:'chelsea', name:'Chelsea', country:'GB', league:'epl', color:'#034694' },
    { id:'tottenham', name:'Tottenham', country:'GB', league:'epl', color:'#132257' },
    { id:'newcastle', name:'Newcastle', country:'GB', league:'epl', color:'#241F20' },
    // La Liga
    { id:'realmadrid', name:'Real Madrid', country:'ES', league:'laliga', color:'#FEBE10' },
    { id:'barcelona', name:'Barcelona', country:'ES', league:'laliga', color:'#A50044' },
    { id:'atleticomadrid', name:'Atlético Madrid', country:'ES', league:'laliga', color:'#CB3524' },
    // Serie A
    { id:'juventus', name:'Juventus', country:'IT', league:'seriea', color:'#000000' },
    { id:'inter', name:'Inter Milan', country:'IT', league:'seriea', color:'#0066B2' },
    { id:'milan', name:'AC Milan', country:'IT', league:'seriea', color:'#FB090B' },
    { id:'napoli', name:'Napoli', country:'IT', league:'seriea', color:'#12A0D7' },
    { id:'roma', name:'Roma', country:'IT', league:'seriea', color:'#8E1F2F' },
    // Bundesliga
    { id:'bayern', name:'Bayern Munich', country:'DE', league:'bundesliga', color:'#DC052D' },
    { id:'dortmund', name:'Borussia Dortmund', country:'DE', league:'bundesliga', color:'#FDE100' },
    // Ligue 1
    { id:'psg', name:'PSG', country:'FR', league:'ligue1', color:'#004170' },
    // NBA top
    { id:'lakers', name:'LA Lakers', league:'nba', color:'#552583' },
    { id:'celtics', name:'Boston Celtics', league:'nba', color:'#007A33' },
    { id:'warriors', name:'Golden State Warriors', league:'nba', color:'#1D428A' },
    { id:'heat', name:'Miami Heat', league:'nba', color:'#98002E' },
    { id:'bucks', name:'Milwaukee Bucks', league:'nba', color:'#00471B' },
    { id:'nuggets', name:'Denver Nuggets', league:'nba', color:'#0E2240' }
  ];

  // Mundial 2026 — datos oficiales (host countries, confederaciones, sedes).
  // NO incluyen cuotas: las cuotas live se obtienen del backend (mercado de
  // futures cuando esté disponible).
  const CONFEDERATIONS = [
    { key: 'UEFA',     name: 'UEFA',      slots: 16 },
    { key: 'CONMEBOL', name: 'CONMEBOL',  slots: 6  },
    { key: 'CONCACAF', name: 'CONCACAF',  slots: 6  },
    { key: 'AFC',      name: 'AFC',       slots: 8  },
    { key: 'CAF',      name: 'CAF',       slots: 9  },
    { key: 'OFC',      name: 'OFC',       slots: 1  },
    { key: 'PLAYOFF',  name: 'Repechaje', slots: 2  }
  ];

  const NATIONS = [
    { code:'CA', name:'Canadá',         conf:'CONCACAF', host:true,  flag:'🇨🇦' },
    { code:'MX', name:'México',         conf:'CONCACAF', host:true,  flag:'🇲🇽' },
    { code:'US', name:'Estados Unidos', conf:'CONCACAF', host:true,  flag:'🇺🇸' },
    { code:'AR', name:'Argentina',  conf:'CONMEBOL', flag:'🇦🇷' },
    { code:'BR', name:'Brasil',     conf:'CONMEBOL', flag:'🇧🇷' },
    { code:'UY', name:'Uruguay',    conf:'CONMEBOL', flag:'🇺🇾' },
    { code:'CO', name:'Colombia',   conf:'CONMEBOL', flag:'🇨🇴' },
    { code:'EC', name:'Ecuador',    conf:'CONMEBOL', flag:'🇪🇨' },
    { code:'PY', name:'Paraguay',   conf:'CONMEBOL', flag:'🇵🇾' },
    { code:'FR', name:'Francia',    conf:'UEFA',     flag:'🇫🇷' },
    { code:'ES', name:'España',     conf:'UEFA',     flag:'🇪🇸' },
    { code:'EN', name:'Inglaterra', conf:'UEFA',     flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { code:'PT', name:'Portugal',   conf:'UEFA',     flag:'🇵🇹' },
    { code:'DE', name:'Alemania',   conf:'UEFA',     flag:'🇩🇪' },
    { code:'NL', name:'Países Bajos', conf:'UEFA',   flag:'🇳🇱' },
    { code:'IT', name:'Italia',     conf:'UEFA',     flag:'🇮🇹' },
    { code:'BE', name:'Bélgica',    conf:'UEFA',     flag:'🇧🇪' },
    { code:'HR', name:'Croacia',    conf:'UEFA',     flag:'🇭🇷' },
    { code:'CH', name:'Suiza',      conf:'UEFA',     flag:'🇨🇭' },
    { code:'AT', name:'Austria',    conf:'UEFA',     flag:'🇦🇹' },
    { code:'DK', name:'Dinamarca',  conf:'UEFA',     flag:'🇩🇰' },
    { code:'PL', name:'Polonia',    conf:'UEFA',     flag:'🇵🇱' },
    { code:'NO', name:'Noruega',    conf:'UEFA',     flag:'🇳🇴' },
    { code:'TR', name:'Turquía',    conf:'UEFA',     flag:'🇹🇷' },
    { code:'CZ', name:'Chequia',    conf:'UEFA',     flag:'🇨🇿' },
    { code:'SE', name:'Suecia',     conf:'UEFA',     flag:'🇸🇪' },
    { code:'CR', name:'Costa Rica', conf:'CONCACAF', flag:'🇨🇷' },
    { code:'PA', name:'Panamá',     conf:'CONCACAF', flag:'🇵🇦' },
    { code:'JM', name:'Jamaica',    conf:'CONCACAF', flag:'🇯🇲' },
    { code:'JP', name:'Japón',      conf:'AFC',      flag:'🇯🇵' },
    { code:'KR', name:'Corea Sur',  conf:'AFC',      flag:'🇰🇷' },
    { code:'AU', name:'Australia',  conf:'AFC',      flag:'🇦🇺' },
    { code:'IR', name:'Irán',       conf:'AFC',      flag:'🇮🇷' },
    { code:'SA', name:'Arabia Saudita', conf:'AFC',  flag:'🇸🇦' },
    { code:'QA', name:'Qatar',      conf:'AFC',      flag:'🇶🇦' },
    { code:'IQ', name:'Irak',       conf:'AFC',      flag:'🇮🇶' },
    { code:'UZ', name:'Uzbekistán', conf:'AFC',      flag:'🇺🇿' },
    { code:'MA', name:'Marruecos',  conf:'CAF',      flag:'🇲🇦' },
    { code:'SN', name:'Senegal',    conf:'CAF',      flag:'🇸🇳' },
    { code:'EG', name:'Egipto',     conf:'CAF',      flag:'🇪🇬' },
    { code:'NG', name:'Nigeria',    conf:'CAF',      flag:'🇳🇬' },
    { code:'CI', name:'Costa Marfil', conf:'CAF',    flag:'🇨🇮' },
    { code:'GH', name:'Ghana',      conf:'CAF',      flag:'🇬🇭' },
    { code:'CM', name:'Camerún',    conf:'CAF',      flag:'🇨🇲' },
    { code:'TN', name:'Túnez',      conf:'CAF',      flag:'🇹🇳' },
    { code:'DZ', name:'Argelia',    conf:'CAF',      flag:'🇩🇿' },
    { code:'NZ', name:'Nueva Zelanda', conf:'OFC',   flag:'🇳🇿' },
    { code:'P1', name:'Playoff Asia/Sudamérica', conf:'PLAYOFF', flag:'🏳️' },
    { code:'P2', name:'Playoff África/Oceanía',  conf:'PLAYOFF', flag:'🏳️' }
  ];

  // Sedes oficiales FIFA 2026 (datos públicos del organizador)
  const VENUES = [
    { city:'Ciudad de México', country:'MX', stadium:'Estadio Azteca', cap:87000 },
    { city:'Guadalajara',      country:'MX', stadium:'Estadio Akron',  cap:48071 },
    { city:'Monterrey',        country:'MX', stadium:'Estadio BBVA',   cap:53500 },
    { city:'Toronto',          country:'CA', stadium:'BMO Field',      cap:45000 },
    { city:'Vancouver',        country:'CA', stadium:'BC Place',       cap:54000 },
    { city:'Atlanta',          country:'US', stadium:'Mercedes-Benz Stadium', cap:75000 },
    { city:'Boston',           country:'US', stadium:'Gillette Stadium', cap:65000 },
    { city:'Dallas',           country:'US', stadium:'AT&T Stadium',   cap:80000 },
    { city:'Houston',          country:'US', stadium:'NRG Stadium',    cap:72220 },
    { city:'Kansas City',      country:'US', stadium:'Arrowhead',      cap:76416 },
    { city:'Los Ángeles',      country:'US', stadium:'SoFi Stadium',   cap:70000 },
    { city:'Miami',            country:'US', stadium:'Hard Rock',      cap:65000 },
    { city:'Nueva York',       country:'US', stadium:'MetLife',        cap:82500 },
    { city:'Filadelfia',       country:'US', stadium:'Lincoln Financial', cap:69796 },
    { city:'San Francisco',    country:'US', stadium:"Levi's Stadium", cap:68500 },
    { city:'Seattle',          country:'US', stadium:'Lumen Field',    cap:69000 }
  ];

  // Calendario oficial (datos públicos)
  const TIMELINE = [
    { date:'2026-05-30', name:'UEFA Champions League — Final',  loc:'Budapest', tag:'UCL' },
    { date:'2026-05-20', name:'UEFA Europa League — Final',     loc:'Estambul', tag:'UEL' },
    { date:'2026-02-08', name:'Super Bowl LX',                  loc:'Santa Clara', tag:'NFL' },
    { date:'2026-06-04', name:'NBA Finals (game 1)',            loc:'TBD', tag:'NBA' },
    { date:'2026-06-11', name:'Mundial 2026 — Apertura',        loc:'Estadio Azteca, México', tag:'WC' },
    { date:'2026-07-19', name:'Mundial 2026 — Final',           loc:'MetLife, Nueva York', tag:'WC' }
  ];

  // Cobertura real de mercados por casa (verificada empíricamente con los
  // scrapers dedicados / Odds API en mayo 2026).
  const BOOK_MARKET_COVERAGE = {
    bplay:       { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    betano:      { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    betwarrior:  { h2h: true, dc: true,  totals: true,  btts: true,  ah: false, corners: true,  cards: false },
    bet365ar:    { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    codere:      { h2h: true, dc: true,  totals: true,  btts: true,  ah: false, corners: false, cards: false },
    betsson:     { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  }
  };

  // Tasa real impuesto a apuestas online por jurisdicción (LOTBA / IPLyC / etc)
  const TAX_RATES_AR = {
    CABA:     0.0625,
    BSAS:     0.05,
    Cordoba:  0.05,
    SantaFe:  0.0475,
    Mendoza:  0.05
  };

  // ── ACCESO A EVENTOS REALES ───────────────────────────────────────────
  // Todas las funciones de matches delegan a BSLive. NO hay generación
  // sintética. Si el backend aún no entregó snapshot, devolvemos [].

  /** Eventos en vivo con cuotas reales del backend.
   *  Filtro opcional: { sport, league } */
  function liveEvents(filter) {
    if (!global.BSLive) return [];
    return global.BSLive.events(filter || {});
  }

  /** Status: true si el backend nos entregó al menos N eventos. */
  function liveReady(min) { return !!(global.BSLive && global.BSLive.ready(min || 1)); }

  /** Frescura legible del último update */
  function liveFreshness() { return global.BSLive ? global.BSLive.freshnessLabel() : 'sin conexión'; }

  /** Espera (con timeout) a que el snapshot inicial llegue. Útil para tabs
   *  que necesitan datos antes de renderizar. */
  function awaitLive(opts = {}) {
    return new Promise((resolve) => {
      if (liveReady(opts.min || 1)) return resolve(liveEvents(opts.filter));
      const timeout = opts.timeoutMs || 8000;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        global.removeEventListener('bs:live-snapshot', onSnap);
        global.removeEventListener('bs:live-update', onSnap);
        resolve(liveEvents(opts.filter));
      };
      const onSnap = () => { if (liveReady(opts.min || 1)) finish(); };
      global.addEventListener('bs:live-snapshot', onSnap);
      global.addEventListener('bs:live-update', onSnap);
      setTimeout(finish, timeout);
    });
  }

  /** Surebets en vivo (detectadas por el backend cruzando las casas legales AR). */
  function liveSurebets() { return global.BSLive ? global.BSLive.surebets() : []; }

  /** Steam moves (movimientos sharp >5%) detectados en el último ciclo. */
  function liveSteam() { return global.BSLive ? global.BSLive.steamMoves() : []; }

  /** Estado de cada casa scrapeada — para mostrar "operativo" / "caído" en UI. */
  function liveBookStatus() { return global.BSLive ? global.BSLive.books() : {}; }

  global.BSData = {
    // Catálogos estáticos
    BOOKS_AR, BOOKS_INTL, ALL_BOOKS,
    SPORTS, LEAGUES, TEAMS,
    CONFEDERATIONS, NATIONS, VENUES, TIMELINE,
    BOOK_MARKET_COVERAGE, TAX_RATES_AR,

    // Datos en vivo (del backend de scraping)
    liveEvents, liveReady, liveFreshness, awaitLive,
    liveSurebets, liveSteam, liveBookStatus
  };
})(window);
