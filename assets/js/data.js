/* BetSafe — Static data: books, sports, leagues, teams, players, World Cup */
(function (global) {
  'use strict';

  // 12 Argentine legal books (LOTBA / IPLyC). International books removed
  // to keep the platform AR-only legal scope.
  const BOOKS_AR = [
    { key: 'bplay',       name: 'Bplay',        license: 'LOTBA', color: '#0066ff' },
    { key: 'betano',      name: 'Betano',       license: 'LOTBA', color: '#ff6900' },
    { key: 'betwarrior',  name: 'BetWarrior',   license: 'LOTBA', color: '#1a1a1a' },
    { key: 'bet365ar',    name: 'Bet365 AR',    license: 'LOTBA', color: '#14805e' },
    { key: 'codere',      name: 'Codere',       license: 'LOTBA', color: '#00a651' },
    { key: 'caliente',    name: 'Caliente',     license: 'LOTBA', color: '#e30000' },
    { key: 'casinomagic', name: 'Magic',        license: 'LOTBA', color: '#7e3aa6' },
    { key: 'betsson',     name: 'Betsson',      license: 'LOTBA', color: '#003a70' },
    { key: 'jugabet',     name: 'JugaBet',      license: 'LOTBA', color: '#1aaf5d' },
    { key: '24bet',       name: '24bet',        license: 'LOTBA', color: '#191919' },
    { key: 'playcity',    name: 'PlayCity',     license: 'LOTBA', color: '#00b3a4' },
    { key: 'megapuesta',  name: 'MegaPuesta',   license: 'LOTBA', color: '#ff2d55' }
  ];
  const BOOKS_INTL = []; // intentionally empty
  const ALL_BOOKS = [...BOOKS_AR];

  const SPORTS = [
    { key: 'soccer',     name: 'Fútbol',          icon: 'soccer'    },
    { key: 'basketball', name: 'Básquet',         icon: 'basketball' },
    { key: 'tennis',     name: 'Tenis',           icon: 'tennis'    },
    { key: 'amfootball', name: 'Football Amer.',  icon: 'football'  },
    { key: 'hockey',     name: 'Hockey',          icon: 'hockey'    },
    { key: 'baseball',   name: 'Béisbol',         icon: 'baseball'  },
    { key: 'mma',        name: 'MMA / UFC',       icon: 'mma'       },
    { key: 'boxing',     name: 'Boxeo',           icon: 'boxing'    },
    { key: 'rugby',      name: 'Rugby',           icon: 'rugby'     },
    { key: 'golf',       name: 'Golf',            icon: 'golf'      },
    { key: 'volleyball', name: 'Vóley',           icon: 'volleyball' },
    { key: 'esports',    name: 'eSports',         icon: 'esports'   },
    { key: 'cricket',    name: 'Cricket',         icon: 'cricket'   },
    { key: 'f1',         name: 'F1',              icon: 'f1'        }
  ];

  const LEAGUES = [
    { key: 'epl', name: 'Premier League', sport: 'soccer', country: 'Inglaterra' },
    { key: 'laliga', name: 'La Liga', sport: 'soccer', country: 'España' },
    { key: 'seriea', name: 'Serie A', sport: 'soccer', country: 'Italia' },
    { key: 'bundesliga', name: 'Bundesliga', sport: 'soccer', country: 'Alemania' },
    { key: 'ligue1', name: 'Ligue 1', sport: 'soccer', country: 'Francia' },
    { key: 'ucl', name: 'Champions League', sport: 'soccer', country: 'Europa' },
    { key: 'uel', name: 'Europa League', sport: 'soccer', country: 'Europa' },
    { key: 'lpf', name: 'Liga Profesional Argentina', sport: 'soccer', country: 'Argentina' },
    { key: 'libertadores', name: 'Copa Libertadores', sport: 'soccer', country: 'Sudamérica' },
    { key: 'nba', name: 'NBA', sport: 'basketball', country: 'EE.UU.' },
    { key: 'euroleague', name: 'EuroLeague', sport: 'basketball', country: 'Europa' },
    { key: 'nfl', name: 'NFL', sport: 'amfootball', country: 'EE.UU.' },
    { key: 'nhl', name: 'NHL', sport: 'hockey', country: 'EE.UU.' },
    { key: 'mlb', name: 'MLB', sport: 'baseball', country: 'EE.UU.' },
    { key: 'mls', name: 'MLS', sport: 'soccer', country: 'EE.UU.' },
    { key: 'ufc', name: 'UFC', sport: 'mma', country: 'Mundial' }
  ];

  // Argentine clubs (30) + international top
  const TEAMS = [
    // Argentina
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
    { id:'sanmiguel', name:'San Miguel', country:'AR', league:'lpf', color:'#D9192C' },
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
    { id:'atletico', name:'Atlético Madrid', country:'ES', league:'laliga', color:'#CB3524' },
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
    // NBA (top)
    { id:'lakers', name:'LA Lakers', league:'nba', color:'#552583' },
    { id:'celtics', name:'Boston Celtics', league:'nba', color:'#007A33' },
    { id:'warriors', name:'Golden State Warriors', league:'nba', color:'#1D428A' },
    { id:'heat', name:'Miami Heat', league:'nba', color:'#98002E' },
    { id:'bucks', name:'Milwaukee Bucks', league:'nba', color:'#00471B' },
    { id:'nuggets', name:'Denver Nuggets', league:'nba', color:'#0E2240' }
  ];

  // Confederations & 48 selections (Mundial 2026)
  const CONFEDERATIONS = [
    { key: 'UEFA',       name: 'UEFA',       slots: 16 },
    { key: 'CONMEBOL',   name: 'CONMEBOL',   slots: 6  },
    { key: 'CONCACAF',   name: 'CONCACAF',   slots: 6  },
    { key: 'AFC',        name: 'AFC',        slots: 8  },
    { key: 'CAF',        name: 'CAF',        slots: 9  },
    { key: 'OFC',        name: 'OFC',        slots: 1  },
    { key: 'PLAYOFF',    name: 'Repechaje',  slots: 2  }
  ];

  const NATIONS = [
    // Anfitriones
    { code:'CA', name:'Canadá',         conf:'CONCACAF', host:true,  flag:'🇨🇦' },
    { code:'MX', name:'México',         conf:'CONCACAF', host:true,  flag:'🇲🇽' },
    { code:'US', name:'Estados Unidos', conf:'CONCACAF', host:true,  flag:'🇺🇸' },
    // CONMEBOL
    { code:'AR', name:'Argentina',  conf:'CONMEBOL', flag:'🇦🇷' },
    { code:'BR', name:'Brasil',     conf:'CONMEBOL', flag:'🇧🇷' },
    { code:'UY', name:'Uruguay',    conf:'CONMEBOL', flag:'🇺🇾' },
    { code:'CO', name:'Colombia',   conf:'CONMEBOL', flag:'🇨🇴' },
    { code:'EC', name:'Ecuador',    conf:'CONMEBOL', flag:'🇪🇨' },
    { code:'PY', name:'Paraguay',   conf:'CONMEBOL', flag:'🇵🇾' },
    // UEFA top contendientes
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
    // CONCACAF
    { code:'CR', name:'Costa Rica', conf:'CONCACAF', flag:'🇨🇷' },
    { code:'PA', name:'Panamá',     conf:'CONCACAF', flag:'🇵🇦' },
    { code:'JM', name:'Jamaica',    conf:'CONCACAF', flag:'🇯🇲' },
    // AFC
    { code:'JP', name:'Japón',      conf:'AFC', flag:'🇯🇵' },
    { code:'KR', name:'Corea Sur',  conf:'AFC', flag:'🇰🇷' },
    { code:'AU', name:'Australia',  conf:'AFC', flag:'🇦🇺' },
    { code:'IR', name:'Irán',       conf:'AFC', flag:'🇮🇷' },
    { code:'SA', name:'Arabia Saudita', conf:'AFC', flag:'🇸🇦' },
    { code:'QA', name:'Qatar',      conf:'AFC', flag:'🇶🇦' },
    { code:'IQ', name:'Irak',       conf:'AFC', flag:'🇮🇶' },
    { code:'UZ', name:'Uzbekistán', conf:'AFC', flag:'🇺🇿' },
    // CAF
    { code:'MA', name:'Marruecos',  conf:'CAF', flag:'🇲🇦' },
    { code:'SN', name:'Senegal',    conf:'CAF', flag:'🇸🇳' },
    { code:'EG', name:'Egipto',     conf:'CAF', flag:'🇪🇬' },
    { code:'NG', name:'Nigeria',    conf:'CAF', flag:'🇳🇬' },
    { code:'CI', name:'Costa Marfil', conf:'CAF', flag:'🇨🇮' },
    { code:'GH', name:'Ghana',      conf:'CAF', flag:'🇬🇭' },
    { code:'CM', name:'Camerún',    conf:'CAF', flag:'🇨🇲' },
    { code:'TN', name:'Túnez',      conf:'CAF', flag:'🇹🇳' },
    { code:'DZ', name:'Argelia',    conf:'CAF', flag:'🇩🇿' },
    // OFC
    { code:'NZ', name:'Nueva Zelanda', conf:'OFC', flag:'🇳🇿' },
    // Playoff
    { code:'P1', name:'Playoff Asia/Sudamérica', conf:'PLAYOFF', flag:'🏳️' },
    { code:'P2', name:'Playoff África/Oceanía',  conf:'PLAYOFF', flag:'🏳️' }
  ];

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

  const TOP_SCORERS = [
    { name:'Kylian Mbappé',     country:'FR', team:'Real Madrid',   odds:5.50 },
    { name:'Erling Haaland',    country:'NO', team:'Manchester City', odds:9.00 },
    { name:'Harry Kane',        country:'EN', team:'Bayern Munich', odds:7.50 },
    { name:'Lionel Messi',      country:'AR', team:'Inter Miami',   odds:11.0 },
    { name:'Lautaro Martínez',  country:'AR', team:'Inter Milan',   odds:13.0 },
    { name:'Vinícius Jr.',      country:'BR', team:'Real Madrid',   odds:12.0 },
    { name:'Lamine Yamal',      country:'ES', team:'Barcelona',     odds:18.0 }
  ];

  const WC_FAVORITES = [
    { code:'AR', odds:5.5  }, { code:'FR', odds:6.0 }, { code:'BR', odds:6.5 },
    { code:'ES', odds:7.0  }, { code:'EN', odds:8.0 }, { code:'PT', odds:11.0 },
    { code:'DE', odds:13.0 }
  ];

  const TIMELINE = [
    { date:'2026-05-30', name:'UEFA Champions League — Final',  loc:'Budapest', tag:'UCL' },
    { date:'2026-05-20', name:'UEFA Europa League — Final',     loc:'Estambul', tag:'UEL' },
    { date:'2026-02-08', name:'Super Bowl LX',                  loc:'Santa Clara', tag:'NFL' },
    { date:'2026-06-04', name:'NBA Finals (game 1)',            loc:'TBD', tag:'NBA' },
    { date:'2026-06-11', name:'Mundial 2026 — Apertura',        loc:'Estadio Azteca, México', tag:'WC' },
    { date:'2026-07-19', name:'Mundial 2026 — Final',           loc:'MetLife, Nueva York', tag:'WC' }
  ];

  // Synthetic match generator (deterministic, no Math.random in critical paths)
  function makeMatches() {
    const teamsByLeague = {};
    TEAMS.forEach(t => { (teamsByLeague[t.league] ||= []).push(t); });
    const list = [];
    let id = 1;
    const startBase = Date.now() + 2 * 3600 * 1000;
    LEAGUES.forEach((lg, lgi) => {
      const ts = teamsByLeague[lg.key] || [];
      if (ts.length < 2) return;
      for (let i = 0; i < Math.min(8, Math.floor(ts.length / 2)); i++) {
        const home = ts[i*2 % ts.length];
        const away = ts[(i*2+1) % ts.length];
        if (!home || !away || home === away) continue;
        const seed = (id * 9301 + 49297) % 233280;
        const r = seed / 233280;
        const homeOdd = 1.45 + r * 3.5;
        const awayOdd = 1.6 + (1 - r) * 3.0;
        const drawOdd = 2.9 + (Math.abs(0.5 - r)) * 2.4;
        const isSoccer = lg.sport === 'soccer';
        const isBasket = lg.sport === 'basketball';
        // Diverse markets — each leagues sport supports a different subset
        const ouLine = isSoccer ? 2.5 : (isBasket ? 220.5 : 8.5);
        list.push({
          id: 'm' + (id++),
          league: lg.key,
          leagueName: lg.name,
          sport: lg.sport,
          home, away,
          start: startBase + lgi * 3600 * 1000 + i * 1800 * 1000,
          status: 'scheduled',
          markets: {
            h2h:    bookMatrix(homeOdd, drawOdd, awayOdd, isSoccer),
            // Doble oportunidad (1X / X2 / 12)
            dc:     isSoccer ? bookMatrixDC(homeOdd, drawOdd, awayOdd) : null,
            // Over/Under total goles/puntos
            totals: bookMatrixOU(ouLine, 1.85 + r * 0.3, 1.95 - r * 0.2),
            // Both Teams To Score
            btts:   isSoccer ? bookMatrixBTTS(1.65 + r * 0.4, 2.10 - r * 0.3) : null,
            // Asian handicap
            ah:     bookMatrixAH(homeOdd, awayOdd),
            // Corners total (soccer)
            corners: isSoccer ? bookMatrixOU(9.5, 1.85, 1.95) : null,
            // Cards total (soccer)
            cards:   isSoccer ? bookMatrixOU(4.5, 1.92, 1.88) : null
          }
        });
      }
    });
    return list;
  }

  // Generate odds matrix per book with overround
  function bookMatrix(home, draw, away, withDraw) {
    const out = {};
    ALL_BOOKS.forEach((b, idx) => {
      const factor = 1 + ((idx % 7) - 3) * 0.012; // ±3.6%
      const h = round2(home * factor);
      const a = round2(away * (2 - factor));
      const d = withDraw ? round2(draw * (1 + ((idx % 5) - 2) * 0.008)) : null;
      out[b.key] = { home: h, draw: d, away: a };
    });
    return out;
  }
  // Doble oportunidad: 1X (home or draw), X2 (draw or away), 12 (no draw)
  function bookMatrixDC(home, draw, away) {
    const out = {};
    const px1 = (1/home) + (1/draw);
    const p2x = (1/draw) + (1/away);
    const p12 = (1/home) + (1/away);
    const dc1x = 1/px1, dcx2 = 1/p2x, dc12 = 1/p12;
    ALL_BOOKS.forEach((b, idx) => {
      const f = 1 + ((idx % 6) - 2) * 0.010;
      out[b.key] = {
        home_or_draw: round2(dc1x * f),
        draw_or_away: round2(dcx2 / f),
        home_or_away: round2(dc12 * (1 + ((idx%5)-2)*0.008))
      };
    });
    return out;
  }
  // Over/Under sobre una línea (goles, corners, cards, puntos)
  function bookMatrixOU(line, overBase, underBase) {
    const out = {};
    ALL_BOOKS.forEach((b, idx) => {
      const f = 1 + ((idx % 7) - 3) * 0.011;
      out[b.key] = {
        line,
        over:  round2(overBase * f),
        under: round2(underBase / f)
      };
    });
    return out;
  }
  // BTTS — Both Teams To Score (sí / no)
  function bookMatrixBTTS(yesBase, noBase) {
    const out = {};
    ALL_BOOKS.forEach((b, idx) => {
      const f = 1 + ((idx % 6) - 2) * 0.013;
      out[b.key] = {
        yes: round2(yesBase * f),
        no:  round2(noBase  / f)
      };
    });
    return out;
  }
  // Hándicap asiático -0.5 / +0.5
  function bookMatrixAH(home, away) {
    const out = {};
    ALL_BOOKS.forEach((b, idx) => {
      const f = 1 + ((idx % 7) - 3) * 0.010;
      out[b.key] = {
        line: 0.5,
        home_minus: round2(home * 1.18 * f),       // home -0.5 (más exigente)
        away_plus:  round2(Math.max(1.20, away * 0.78 / f))   // away +0.5
      };
    });
    return out;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* Each AR book lists which markets they REALLY support. Used by AI Picks
     to verify that the top-3 books-that-pay-best actually offer the markets
     used in the combinada. Mirrors what each operator publishes today. */
  const BOOK_MARKET_COVERAGE = {
    bplay:       { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    betano:      { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    betwarrior:  { h2h: true, dc: true,  totals: true,  btts: true,  ah: false, corners: true,  cards: false },
    bet365ar:    { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    codere:      { h2h: true, dc: true,  totals: true,  btts: true,  ah: false, corners: false, cards: false },
    caliente:    { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: false, cards: false },
    casinomagic: { h2h: true, dc: false, totals: true,  btts: false, ah: false, corners: false, cards: false },
    betsson:     { h2h: true, dc: true,  totals: true,  btts: true,  ah: true,  corners: true,  cards: true  },
    jugabet:     { h2h: true, dc: true,  totals: true,  btts: true,  ah: false, corners: false, cards: false },
    '24bet':     { h2h: true, dc: false, totals: true,  btts: false, ah: false, corners: false, cards: false },
    playcity:    { h2h: true, dc: true,  totals: true,  btts: true,  ah: false, corners: false, cards: false },
    megapuesta:  { h2h: true, dc: false, totals: true,  btts: false, ah: false, corners: false, cards: false }
  };

  // Argentine tax rates
  const TAX_RATES_AR = {
    CABA: 0.0625,
    BSAS: 0.05,
    Cordoba: 0.05,
    SantaFe: 0.0475,
    Mendoza: 0.05
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ENRICHED MATCH LOADER: API real → engine pipeline → fallback determinístico
  // ─────────────────────────────────────────────────────────────────────────
  // Mapeo de keys internas a sport keys de The Odds API
  const SPORT_KEY_MAP = {
    soccer:     'soccer',           // genérico
    basketball: 'basketball_nba',
    tennis:     'tennis_atp',
    amfootball: 'americanfootball_nfl',
    hockey:     'icehockey_nhl',
    baseball:   'baseball_mlb',
    mma:        'mma_mixed_martial_arts'
  };
  const ODDS_API_LEAGUE_KEYS = {
    epl: 'soccer_epl', laliga: 'soccer_spain_la_liga', seriea: 'soccer_italy_serie_a',
    bundes: 'soccer_germany_bundesliga', ligue1: 'soccer_france_ligue_one',
    ucl: 'soccer_uefa_champs_league', uel: 'soccer_uefa_europa_league',
    lpfar: 'soccer_argentina_primera_division',
    nba: 'basketball_nba', nfl: 'americanfootball_nfl', mlb: 'baseball_mlb',
    nhl: 'icehockey_nhl', mls: 'soccer_usa_mls', ufc: 'mma_mixed_martial_arts'
  };
  function leagueToOddsKey(leagueKey) { return ODDS_API_LEAGUE_KEYS[leagueKey] || null; }

  /** Carga matches enriquecidos:
   *   1) Intenta The Odds API (vía BSApi.getEnrichedMatches) por liga/deporte
   *   2) Si falla, usa makeMatches() sintético y le aplica BSEngine.modelMatch
   *   3) Cachea resultados en memoria por 60s para no martillar la API
   */
  const _matchCache = { data: null, t: 0, TTL: 60 * 1000 };

  async function loadEnrichedMatches(opts = {}) {
    if (_matchCache.data && Date.now() - _matchCache.t < _matchCache.TTL && !opts.fresh) {
      return _matchCache.data;
    }
    // Si BSApi no está disponible, devolver mock+engine inmediatamente
    if (!global.BSApi || !global.BSApi.getEnrichedMatches) {
      const out = enrichSyntheticMatches();
      _matchCache.data = out; _matchCache.t = Date.now();
      return out;
    }
    // Estrategia: traer EPL como liga principal (más coverage en plan free).
    // Más adelante el motor de la app puede paginar otras ligas si configurás
    // tu plan de The Odds API.
    try {
      const sportKey = opts.sportKey || 'soccer_epl';
      const live = await global.BSApi.getEnrichedMatches(sportKey, opts);
      if (live && live.length) {
        // Merge: API live + sintético para ligas no soportadas (no perdemos UI)
        const synthetic = enrichSyntheticMatches();
        const liveKeys = new Set(live.map(m => `${m.home?.id}|${m.away?.id}`));
        const filler = synthetic.filter(m => !liveKeys.has(`${m.home?.id}|${m.away?.id}`));
        const out = [...live, ...filler];
        _matchCache.data = out; _matchCache.t = Date.now();
        return out;
      }
    } catch (e) {
      console.warn('[data] live odds failed, falling back to synthetic+engine:', e?.message);
    }
    const out = enrichSyntheticMatches();
    _matchCache.data = out; _matchCache.t = Date.now();
    return out;
  }

  function enrichSyntheticMatches() {
    const raw = makeMatches();
    if (!global.BSEngine) return raw;
    return raw.map(m => {
      // Convertir el formato actual de odds-per-book a bestOdds (lo que espera el engine)
      const bestOdds = {};
      if (m.markets.h2h) {
        bestOdds.h2h = bestOf(m.markets.h2h, ['home', 'draw', 'away']);
      }
      if (m.markets.btts) bestOdds.btts = bestOf(m.markets.btts, ['yes', 'no']);
      if (m.markets.totals) {
        // BTTS de totales (un solo line)
        const sample = Object.values(m.markets.totals)[0];
        if (sample?.line) {
          bestOdds.totals = {};
          bestOdds.totals[sample.line] = {
            over: Math.max(...Object.values(m.markets.totals).map(t => t.over).filter(Boolean)),
            under: Math.max(...Object.values(m.markets.totals).map(t => t.under).filter(Boolean))
          };
        }
      }
      if (m.markets.dc) bestOdds.dc = bestOf(m.markets.dc, ['home_or_draw', 'draw_or_away', 'home_or_away']);
      // Estimar λ a partir del 1X2 (ratio implícito) y la línea de totales
      let lambdaH = 1.4, lambdaA = 1.1;
      if (bestOdds.h2h) {
        const [pH, pD, pA] = global.BSEngine.removeMarginShin(
          [bestOdds.h2h.home, bestOdds.h2h.draw, bestOdds.h2h.away].filter(Boolean)
        );
        // estimación grosera: equipo más probable → λ más alto
        const totalMu = m.sport === 'soccer' ? 2.6 : (m.sport === 'basketball' ? 220 : 8.5);
        const homeShare = (pH + (pD||0) * 0.5) / Math.max(0.01, pH + (pD||0) + pA);
        lambdaH = totalMu * Math.max(0.35, Math.min(0.75, homeShare));
        lambdaA = totalMu - lambdaH;
        // Para deportes no-soccer, escalamos a un λ "fútbol equivalente" para que
        // el Poisson goal-grid haga sentido sobre la grilla 8x8.
        if (m.sport !== 'soccer') {
          lambdaH = 1 + (homeShare - 0.5) * 1.4;
          lambdaA = 1 + ((1 - homeShare) - 0.5) * 1.4;
        }
      }
      return global.BSEngine.modelMatch({ ...m, bestOdds, odds: bestOdds, lambdaH, lambdaA });
    });
  }

  function bestOf(bookMatrix, outcomes) {
    const out = {};
    outcomes.forEach(o => {
      let best = 0;
      Object.values(bookMatrix).forEach(b => { if (b[o] && b[o] > best) best = b[o]; });
      if (best > 0) out[o] = best;
    });
    return Object.keys(out).length ? out : null;
  }

  global.BSData = {
    BOOKS_AR, BOOKS_INTL, ALL_BOOKS,
    SPORTS, LEAGUES, TEAMS,
    CONFEDERATIONS, NATIONS, VENUES,
    TOP_SCORERS, WC_FAVORITES, TIMELINE,
    makeMatches, TAX_RATES_AR,
    BOOK_MARKET_COVERAGE,
    // Pipeline real
    loadEnrichedMatches,
    enrichSyntheticMatches,
    leagueToOddsKey,
    SPORT_KEY_MAP,
    ODDS_API_LEAGUE_KEYS
  };
})(window);
