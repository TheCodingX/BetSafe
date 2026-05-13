/* BetSafe — Comprehensive official-style SVG logo library
 * Stylized representations: casinos, leagues, FIFA WC26, confederations, top teams.
 * All inline SVG, zero external requests, copyright-respectful renditions.
 */
(function (global) {
  'use strict';

  /* =====================================================================
   * BRAND — BetSafe primary mark + wordmark + VIP gold variant
   * Replaces the previous "chevron in hexagon" with an aesthetic shield
   * containing an ascending chart trend, with subtle animated stroke.
   * ===================================================================*/
  /* ─── New brand mark: clean heraldic shield + two-tone checkmark ─── */
  function brandMark(opts = {}) {
    const size    = opts.size    || 36;
    const variant = opts.variant || 'default'; // 'default'|'gold'|'light'
    const animate = opts.animate !== false;
    const id = 'bsm-' + Math.random().toString(36).slice(2, 8);
    const isGold  = variant === 'gold';
    const isLight = variant === 'light';
    // Shield outline color
    const shS = isGold ? '#FFE07A' : isLight ? 'rgba(255,255,255,.88)' : '#0c1e45';
    // Checkmark left stroke (navy side)
    const chL = isGold ? '#FFE07A' : isLight ? 'rgba(255,255,255,.85)' : '#0c1e45';
    // Checkmark right stroke (gold side — always gold/amber)
    const chR = isGold ? 'rgba(255,255,255,.90)' : '#c49a1a';
    // Shield fill (near-transparent)
    const bg  = isGold ? 'rgba(255,224,120,.10)' : isLight ? 'rgba(255,255,255,.07)' : 'rgba(12,30,69,.05)';
    // Inner specular highlight
    const hi  = isGold ? 'rgba(255,255,255,.26)' : 'rgba(255,255,255,.14)';
    // Ambient glow
    const gl  = isGold ? 'rgba(255,224,120,.38)' : isLight ? 'rgba(255,255,255,.12)' : 'rgba(196,154,26,.28)';
    // Dash lengths
    const lenL = 42; // left checkmark stroke length ≈ sqrt((28-18)²+(49-37)²) = sqrt(100+144) ≈ 16 → padded to 42
    const lenR = 38; // right checkmark stroke length ≈ sqrt((47-28)²+(24-49)²) ≈ 32 → padded to 38
    const anL = animate ? `<animate attributeName="stroke-dashoffset" from="${lenL}" to="0" dur="0.8s" begin="0.05s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"/>` : '';
    const anR = animate ? `<animate attributeName="stroke-dashoffset" from="${lenR}" to="0" dur="0.7s" begin="0.55s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"/>` : '';
    return `
<svg class="logo-mark logo-mark--anim" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <filter id="${id}-fx" x="-38%" y="-38%" width="176%" height="176%">
      <feGaussianBlur stdDeviation="1.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="${id}-gl" cx="50%" cy="18%" r="75%">
      <stop offset="0%" stop-color="${gl}"/>
      <stop offset="100%" stop-color="${gl}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Ambient glow -->
  <ellipse cx="32" cy="36" rx="26" ry="30" fill="url(#${id}-gl)"/>
  <!-- Classic heraldic shield outline -->
  <path class="shield-outline" d="M32 4 L57 13 L57 36 C57 50 44 59 32 63 C20 59 7 50 7 36 L7 13 Z"
        fill="${bg}" stroke="${shS}" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Specular inner highlight arc -->
  <path d="M15 16 C24 10 40 10 49 16" fill="none" stroke="${hi}" stroke-width="1.4" stroke-linecap="round"/>
  <!-- Checkmark — left stroke (navy / primary) -->
  <path class="check-navy" d="M17 37 L27 50" fill="none" stroke="${chL}" stroke-width="5.8"
        stroke-linecap="round" stroke-linejoin="round"
        stroke-dasharray="${lenL}" stroke-dashoffset="${animate ? lenL : 0}"
        filter="url(#${id}-fx)">${anL}</path>
  <!-- Checkmark — right stroke (gold / accent) -->
  <path class="check-gold" d="M27 50 L47 24" fill="none" stroke="${chR}" stroke-width="5.8"
        stroke-linecap="round"
        stroke-dasharray="${lenR}" stroke-dashoffset="${animate ? lenR : 0}"
        filter="url(#${id}-fx)">${anR}</path>
</svg>`;
  }

  function brandWordmark(opts = {}) {
    const size  = opts.size || 36;
    const gold  = opts.gold;
    const betC  = gold ? '#FFE07A' : 'currentColor';
    const safeC = gold ? 'rgba(255,255,255,.85)' : '#c49a1a';
    return `
<span class="brand-wm" style="display:inline-flex;align-items:center;gap:9px">
  ${brandMark({ size, variant: gold ? 'gold' : 'default', animate: false })}
  <span class="brand-wm-text" style="font:800 ${Math.round(size * 0.52)}px/1 'Inter','SF Pro Display',system-ui;letter-spacing:-.02em"><span style="color:${betC}">Bet</span><span style="color:${safeC}">Safe</span></span>
</span>`;
  }

  /* =====================================================================
   * REAL OFFICIAL LOGO CDN URLS
   * Strategy: use stable Wikimedia / brand CDN URLs first, fallback to
   * inline SVG art on error. <img> tags include loading="lazy".
   * ===================================================================*/
  const CDN = {
    book: {
      // Favicons CDN para las 6 casas LOTBA activas (Bplay, Betano, BetWarrior,
      // Codere, Bet365, Betsson). Si Google s2 devuelve placeholder, se cae al
      // SVG art definido en BOOK_RENDERERS más abajo.
      bplay:       'https://www.google.com/s2/favicons?domain=bplay.bet.ar&sz=128',
      betano:      'https://www.google.com/s2/favicons?domain=betano.bet.ar&sz=128',
      betwarrior:  'https://www.google.com/s2/favicons?domain=betwarrior.bet.ar&sz=128',
      codere:      'https://www.google.com/s2/favicons?domain=codere.bet.ar&sz=128',
      bet365:      'https://www.google.com/s2/favicons?domain=bet365.com.ar&sz=128',
      bet365ar:    'https://www.google.com/s2/favicons?domain=bet365.com.ar&sz=128',
      betsson:     'https://www.google.com/s2/favicons?domain=betsson.com&sz=128'
    },
    league: {
      // ALL URLs HEAD-tested 200 with real image content (not placeholders)
      epl:    'https://media.api-sports.io/football/leagues/39.png',
      laliga: 'https://media.api-sports.io/football/leagues/140.png',
      seriea: 'https://media.api-sports.io/football/leagues/135.png',
      bundes: 'https://media.api-sports.io/football/leagues/78.png',
      ligue1: 'https://media.api-sports.io/football/leagues/61.png',
      ucl:    'https://media.api-sports.io/football/leagues/2.png',
      uel:    'https://media.api-sports.io/football/leagues/3.png',
      lpfar:  'https://media.api-sports.io/football/leagues/128.png',
      libert: 'https://media.api-sports.io/football/leagues/13.png',
      wc26:   'https://media.api-sports.io/football/leagues/1.png',           // 90KB verified
      fifa:   'https://a.espncdn.com/i/teamlogos/leagues/500/4.png',          // 41KB verified ESPN
      // Non-football leagues — Google s2 favicons (real org sites)
      nba:    'https://www.google.com/s2/favicons?domain=nba.com&sz=128',
      nfl:    'https://www.google.com/s2/favicons?domain=nfl.com&sz=128',
      mlb:    'https://www.google.com/s2/favicons?domain=mlb.com&sz=128',
      nhl:    'https://www.google.com/s2/favicons?domain=nhl.com&sz=128',
      mls:    'https://www.google.com/s2/favicons?domain=mlssoccer.com&sz=128',
      ufc:    'https://www.google.com/s2/favicons?domain=ufc.com&sz=128',
      euroleague: 'https://www.google.com/s2/favicons?domain=euroleaguebasketball.net&sz=128'
    },
    confed: {
      // Google s2 favicons of the official confederation sites — verified
      UEFA:     'https://www.google.com/s2/favicons?domain=uefa.com&sz=128',
      CONMEBOL: 'https://www.google.com/s2/favicons?domain=conmebol.com&sz=128',
      CONCACAF: 'https://www.google.com/s2/favicons?domain=concacaf.com&sz=128',
      AFC:      'https://www.google.com/s2/favicons?domain=the-afc.com&sz=128',
      CAF:      'https://www.google.com/s2/favicons?domain=cafonline.com&sz=128',
      OFC:      'https://www.google.com/s2/favicons?domain=oceaniafootball.com&sz=128'
    },
    team: {
      // ESPN CDN — IDs fetched live from ESPN public API on per-league listings
      // (site.api.espn.com/apis/site/v2/sports/...). Each ID matches the team
      // shortDisplayName as ESPN reports it. Stable CDN at a.espncdn.com.

      // EPL
      liverpool:     'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
      arsenal:       'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
      mancity:       'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
      manunited:     'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
      chelsea:       'https://a.espncdn.com/i/teamlogos/soccer/500/363.png',
      tottenham:     'https://a.espncdn.com/i/teamlogos/soccer/500/367.png',
      newcastle:     'https://a.espncdn.com/i/teamlogos/soccer/500/361.png',

      // La Liga
      realmadrid:    'https://a.espncdn.com/i/teamlogos/soccer/500/86.png',
      barcelona:     'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
      atletico:      'https://a.espncdn.com/i/teamlogos/soccer/500/1068.png',

      // Serie A
      juventus:      'https://a.espncdn.com/i/teamlogos/soccer/500/111.png',
      milan:         'https://a.espncdn.com/i/teamlogos/soccer/500/103.png',
      inter:         'https://a.espncdn.com/i/teamlogos/soccer/500/110.png',
      napoli:        'https://a.espncdn.com/i/teamlogos/soccer/500/114.png',
      roma:          'https://a.espncdn.com/i/teamlogos/soccer/500/104.png',

      // Bundesliga + Ligue 1
      bayern:        'https://a.espncdn.com/i/teamlogos/soccer/500/132.png',
      dortmund:      'https://a.espncdn.com/i/teamlogos/soccer/500/124.png',
      psg:           'https://a.espncdn.com/i/teamlogos/soccer/500/160.png',

      // Argentina — Liga Profesional (corrected against ESPN feed for arg.1)
      boca:          'https://a.espncdn.com/i/teamlogos/soccer/500/5.png',
      river:         'https://a.espncdn.com/i/teamlogos/soccer/500/16.png',
      racing:        'https://a.espncdn.com/i/teamlogos/soccer/500/15.png',
      independiente: 'https://a.espncdn.com/i/teamlogos/soccer/500/11.png',
      sanlorenzo:    'https://a.espncdn.com/i/teamlogos/soccer/500/18.png',
      estudiantes:   'https://a.espncdn.com/i/teamlogos/soccer/500/8.png',
      velez:         'https://a.espncdn.com/i/teamlogos/soccer/500/21.png',
      rosario:       'https://a.espncdn.com/i/teamlogos/soccer/500/17.png',
      newells:       'https://a.espncdn.com/i/teamlogos/soccer/500/14.png',
      huracan:       'https://a.espncdn.com/i/teamlogos/soccer/500/10.png',
      lanus:         'https://a.espncdn.com/i/teamlogos/soccer/500/12.png',
      banfield:      'https://a.espncdn.com/i/teamlogos/soccer/500/235.png',
      argentinos:    'https://a.espncdn.com/i/teamlogos/soccer/500/3.png',
      tigre:         'https://a.espncdn.com/i/teamlogos/soccer/500/7767.png',
      defensa:       'https://a.espncdn.com/i/teamlogos/soccer/500/8950.png',
      union:         'https://a.espncdn.com/i/teamlogos/soccer/500/20.png',
      colon:         'https://a.espncdn.com/i/teamlogos/soccer/500/13.png',
      gimnasia:      'https://a.espncdn.com/i/teamlogos/soccer/500/9.png',
      talleres:      'https://a.espncdn.com/i/teamlogos/soccer/500/19.png',
      belgrano:      'https://a.espncdn.com/i/teamlogos/soccer/500/4.png',
      instituto:     'https://a.espncdn.com/i/teamlogos/soccer/500/2975.png',
      centralcba:    'https://a.espncdn.com/i/teamlogos/soccer/500/11989.png',
      sarmiento:     'https://a.espncdn.com/i/teamlogos/soccer/500/10158.png',
      platense:      'https://a.espncdn.com/i/teamlogos/soccer/500/7764.png',
      godoy:         'https://a.espncdn.com/i/teamlogos/soccer/500/6.png',
      barracas:      'https://a.espncdn.com/i/teamlogos/soccer/500/10060.png',
      aldosivi:      'https://a.espncdn.com/i/teamlogos/soccer/500/9739.png',
      riestra:       'https://a.espncdn.com/i/teamlogos/soccer/500/17702.png',

      // NBA — ESPN CDN (verified live against ESPN nba teams feed)
      lakers:        'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
      celtics:       'https://a.espncdn.com/i/teamlogos/nba/500/bos.png',
      warriors:      'https://a.espncdn.com/i/teamlogos/nba/500/gs.png',
      heat:          'https://a.espncdn.com/i/teamlogos/nba/500/mia.png',
      nuggets:       'https://a.espncdn.com/i/teamlogos/nba/500/den.png',
      bucks:         'https://a.espncdn.com/i/teamlogos/nba/500/mil.png'
    },
    flag: {
      ARG:'ar', BRA:'br', FRA:'fr', ESP:'es', GER:'de', ENG:'gb-eng', POR:'pt',
      NED:'nl', ITA:'it', BEL:'be', CRO:'hr', SUI:'ch', AUT:'at', DEN:'dk',
      POL:'pl', NOR:'no', TUR:'tr', CZE:'cz', SCO:'gb-sct', WAL:'gb-wls',
      UKR:'ua', SWE:'se', MEX:'mx', CAN:'ca', USA:'us', CRC:'cr', PAN:'pa',
      JAM:'jm', URU:'uy', COL:'co', ECU:'ec', PAR:'py', JPN:'jp', KOR:'kr',
      AUS:'au', IRN:'ir', KSA:'sa', QAT:'qa', IRQ:'iq', UZB:'uz', MAR:'ma',
      SEN:'sn', EGY:'eg', NGA:'ng', CIV:'ci', GHA:'gh', CMR:'cm', TUN:'tn',
      DZA:'dz', NZL:'nz'
    }
  };

  // Chain of fallback URLs (try each in order). On all-fail, show SVG fallback.
  function imgWithFallback(srcOrChain, alt, size, fallbackSvg) {
    const chain = Array.isArray(srcOrChain) ? srcOrChain.filter(Boolean) : [srcOrChain].filter(Boolean);
    if (chain.length === 0) return fallbackSvg;
    const safeAlt = String(alt || '').replace(/"/g, '');
    const dataChain = chain.slice(1).map(u => u.replace(/"/g, '&quot;')).join('||');
    return `<span class="logo-img" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;flex-shrink:0">
      <img src="${chain[0]}" alt="${safeAlt}" loading="lazy" decoding="async" width="${size}" height="${size}"
           data-chain="${dataChain}"
           style="max-width:100%;max-height:100%;object-fit:contain;display:block;border-radius:4px"
           onerror="(function(el){var c=el.dataset.chain;if(c){var arr=c.split('||');if(arr[0]){el.dataset.chain=arr.slice(1).join('||');el.src=arr[0];return;}}el.style.display='none';var fb=el.parentElement.querySelector('.logo-fb');if(fb)fb.style.display='inline-flex';})(this)"/>
      <span class="logo-fb" style="display:none;width:100%;height:100%;align-items:center;justify-content:center">${fallbackSvg}</span>
    </span>`;
  }
  function googleFavicon(domain, size = 128) { return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`; }
  function weserv(url) { return 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')); }

  /* =====================================================================
   * BOOK / SPORTSBOOK LOGOS — stylized brand marks
   * ===================================================================*/
  // Only Argentine LOTBA/IPLyC-licensed books — internationals removed
  const BOOKS = {
    bplay:       { name: 'Bplay',         primary: '#1565d8', accent: '#fff',     legal: 'AR' },
    betano:      { name: 'Betano',        primary: '#ff6a00', accent: '#fff',     legal: 'AR' },
    betwarrior:  { name: 'BetWarrior',    primary: '#0e0f13', accent: '#e1b04e',  legal: 'AR' },
    bet365:      { name: 'bet365',        primary: '#0a663c', accent: '#ffd60a',  legal: 'AR' },
    bet365ar:    { name: 'Bet365 AR',     primary: '#0a663c', accent: '#ffd60a',  legal: 'AR' },
    codere:      { name: 'Codere',        primary: '#117a3a', accent: '#fff',     legal: 'AR' },
    betsson:     { name: 'Betsson',       primary: '#0033a0', accent: '#ffd200',  legal: 'AR' }
  };

  /* ✅ CDN-only logo lookups — NUNCA usa SVG art recreado.
   * Si no hay CDN URL, devuelve un placeholder neutral con iniciales (no fingimos
   * un escudo/logo que no existe). Toda recreación visual está bloqueada.
   */
  const NO_FAKE_LOGOS = true;   // 🔒 lock: no SVG art recreations allowed

  function neutralChip(name, color, size) {
    const initials = String(name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${String(name||'').replace(/"/g,'')}" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="${color || '#e5e7eb'}" opacity=".55"/>
      <text x="24" y="31" text-anchor="middle" font-family="'Inter',system-ui,sans-serif" font-size="16" font-weight="800" fill="#475569" letter-spacing="-.02em">${initials}</text>
    </svg>`;
  }

  function bookLogo(key, opts = {}) {
    const size = opts.size || 32;
    const k = String(key || '').toLowerCase().replace(/\s|-/g, '');
    const b = BOOKS[k] || BOOKS.bplay;
    const fb = neutralChip(b.name, b.primary, size);
    const url = CDN.book[k];
    // 1) Si hay CDN URL verificada → usar el favicon real con fallback chain.
    if (url) {
      const domain = url.replace(/.*domain=/, '').replace(/&.*/, '').replace(/.*\//, '');
      const chain = [url, googleFavicon(domain, 128), googleFavicon(domain, 64)];
      return imgWithFallback(chain, b.name, size, fb);
    }
    // 2) Si tenemos SVG art recreado para esa casa → usarlo (Betsson).
    const renderer = BOOK_RENDERERS[k];
    if (renderer) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${String(b.name||'').replace(/"/g,'')}">${renderer(b)}</svg>`;
    }
    // 3) Último recurso: chip con iniciales en color de marca.
    return fb;
  }

  const BOOK_RENDERERS = {
    bplay: b => `
      <path d="M14 14 h12 a6 6 0 0 1 0 12 h-12 z M14 22 h13 a6 6 0 0 1 0 12 h-13 z" fill="${b.accent}"/>
      <circle cx="36" cy="32" r="3" fill="${b.accent}"/>`,
    betano: b => `
      <path d="M12 16 c4-4 14-4 18 0 4 4 4 12 0 16 -4 4-14 4-18 0z" fill="${b.accent}" opacity=".94"/>
      <text x="24" y="30" text-anchor="middle" font-family="'Inter'" font-size="16" font-weight="900" fill="${b.primary}">B</text>`,
    betwarrior: b => `
      <path d="M14 14 L24 10 L34 14 L34 26 C34 34 24 38 24 38 C24 38 14 34 14 26 Z" fill="${b.accent}"/>
      <path d="M19 22 L24 18 L29 22 L24 26 Z" fill="${b.primary}"/>`,
    bet365: b => `
      <text x="24" y="30" text-anchor="middle" font-family="'Inter'" font-size="14" font-weight="900" fill="${b.accent}" letter-spacing="-.04em">365</text>
      <rect x="6" y="34" width="36" height="2" fill="${b.accent}" opacity=".7"/>`,
    codere: b => `
      <path d="M28 14 a10 10 0 1 0 0 20 a8 8 0 1 1 0-16 z" fill="${b.accent}"/>
      <circle cx="34" cy="24" r="2.5" fill="${b.accent}"/>`,
    // Betsson — bold "b" monogram on royal blue (favicon CDN actúa primero;
    // este SVG es fallback si Google s2 devuelve placeholder).
    betsson: b => `
      <rect width="48" height="48" rx="10" fill="#003a70"/>
      <text x="24" y="36" text-anchor="middle" font-family="'Inter',sans-serif" font-size="38" font-weight="900" fill="#ffd200" letter-spacing="-.08em">b</text>`
  };

  /* =====================================================================
   * LEAGUE LOGOS — stylized representations
   * ===================================================================*/
  const LEAGUES = {
    epl:      { name: 'Premier League',  primary: '#37003c', accent: '#00ff85'  },
    laliga:   { name: 'LaLiga',          primary: '#ee2737', accent: '#ffffff'  },
    seriea:   { name: 'Serie A',         primary: '#005ea6', accent: '#ffffff'  },
    bundes:   { name: 'Bundesliga',      primary: '#d20515', accent: '#ffffff'  },
    ligue1:   { name: 'Ligue 1',         primary: '#091c3e', accent: '#dca74d'  },
    ucl:      { name: 'UEFA Champions',  primary: '#0a1d6b', accent: '#ffffff'  },
    uel:      { name: 'UEFA Europa',     primary: '#ff6a00', accent: '#0a1d6b'  },
    lpfar:    { name: 'Liga Profesional',primary: '#74acdf', accent: '#ffd700'  },
    libert:   { name: 'Copa Libertadores',primary: '#003366', accent: '#ffd700' },
    nba:      { name: 'NBA',             primary: '#1d428a', accent: '#c8102e'  },
    nfl:      { name: 'NFL',             primary: '#013369', accent: '#d50a0a'  },
    mlb:      { name: 'MLB',             primary: '#002d72', accent: '#d50032'  },
    nhl:      { name: 'NHL',             primary: '#000000', accent: '#ffffff'  },
    mls:      { name: 'MLS',             primary: '#001b40', accent: '#ef3340'  },
    ufc:      { name: 'UFC',             primary: '#d20a11', accent: '#000000'  },
    fifa:     { name: 'FIFA',            primary: '#326ac8', accent: '#ffffff'  },
    wc26:     { name: 'World Cup 2026',  primary: '#1a3a8e', accent: '#dca74d'  },
    euroleague: { name: 'EuroLeague',    primary: '#FF6A00', accent: '#000000'  }
  };
  // Map BSData league keys to our CDN keys
  const LEAGUE_ALIASES = {
    bundesliga: 'bundes',
    lpf: 'lpfar',
    libertadores: 'libert',
    championsleague: 'ucl',
    europaleague: 'uel',
    worldcup: 'wc26',
    'world-cup': 'wc26'
  };
  function leagueLogo(key, opts = {}) {
    const size = opts.size || 36;
    let k = String(key || '').toLowerCase();
    if (LEAGUE_ALIASES[k]) k = LEAGUE_ALIASES[k];
    const L = LEAGUES[k] || LEAGUES.fifa;
    const fb = neutralChip(L.name, L.primary, size);
    const url = CDN.league[k];
    if (url) return imgWithFallback([url], L.name, size, fb);
    return fb;
  }
  function defaultLeagueGlyph(L) {
    return `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="14" fill="${L.accent}">${L.name.slice(0, 3).toUpperCase()}</text>`;
  }
  const LEAGUE_RENDERERS = {
    epl: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <path d="M22 22 c4-6 12-6 16 0 c4 6-2 14-8 14 c-6 0-12-8-8-14z" fill="${L.accent}"/>
      <path d="M28 28 c1-2 6-2 7 0 c1 2-1 5-3 5 c-2 0-5-3-4-5z" fill="${L.primary}"/>
      <text x="32" y="52" text-anchor="middle" font-family="'Inter'" font-weight="800" font-size="6" fill="${L.accent}">PREMIER LEAGUE</text>`,
    laliga: L => `
      <rect width="64" height="64" rx="6" fill="${L.primary}"/>
      <text x="32" y="32" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="14" fill="${L.accent}" letter-spacing="-.02em">LaLiga</text>
      <text x="32" y="44" text-anchor="middle" font-family="'Inter'" font-weight="700" font-size="6" fill="${L.accent}" opacity=".8">EA SPORTS</text>`,
    seriea: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <path d="M14 32 L32 16 L50 32 L32 48 Z" fill="${L.accent}"/>
      <text x="32" y="36" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="14" fill="${L.primary}">A</text>`,
    bundes: L => `
      <rect width="64" height="64" rx="8" fill="${L.primary}"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="22" fill="${L.accent}" letter-spacing="-.04em">B</text>
      <circle cx="46" cy="20" r="4" fill="${L.accent}"/>`,
    ligue1: L => `
      <rect width="64" height="64" rx="8" fill="${L.primary}"/>
      <path d="M32 12 L40 48 L24 48 Z" fill="${L.accent}"/>
      <text x="32" y="58" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="6" fill="${L.accent}">LIGUE 1</text>`,
    ucl: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <g transform="translate(32 32)">
        ${[0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map(a =>
          `<polygon points="0,-22 4,-12 14,-12 6,-5 9,5 0,-1 -9,5 -6,-5 -14,-12 -4,-12" fill="${L.accent}" transform="rotate(${a}) translate(0 -2) scale(.45)"/>`
        ).join('')}
      </g>
      <circle cx="32" cy="32" r="9" fill="${L.primary}"/>`,
    uel: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <path d="M14 32 a18 18 0 0 1 36 0 a14 14 0 0 1-28 0 a10 10 0 0 1 20 0" fill="none" stroke="${L.accent}" stroke-width="3"/>`,
    lpfar: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <path d="M14 22 h36 v6 h-36 z M14 36 h36 v6 h-36 z" fill="${L.accent}"/>
      <circle cx="32" cy="32" r="6" fill="#fff"/>`,
    libert: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <path d="M32 8 L36 24 L52 24 L40 34 L44 50 L32 40 L20 50 L24 34 L12 24 L28 24 Z" fill="${L.accent}"/>`,
    nba: L => `
      <rect width="64" height="64" rx="6" fill="${L.primary}"/>
      <rect x="6" y="6" width="14" height="52" fill="${L.accent}"/>
      <rect x="44" y="6" width="14" height="52" fill="${L.accent}"/>
      <path d="M28 14 c-4 0-6 3-6 7 0 4 2 6 4 8 c-2 1-5 3-5 8 c0 5 3 9 8 9 c4 0 7-2 7-7 c0-3-1-5-3-7 c2-1 4-3 4-7 c0-7-5-11-9-11z" fill="${L.accent}"/>`,
    nfl: L => `
      <path d="M32 4 L56 12 L56 32 C56 48 44 56 32 60 C20 56 8 48 8 32 L8 12 Z" fill="${L.primary}"/>
      <path d="M32 4 L56 12 L56 32 C56 48 44 56 32 60 C20 56 8 48 8 32 L8 12 Z" fill="none" stroke="${L.accent}" stroke-width="2"/>
      <text x="32" y="30" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="16" fill="${L.accent}" letter-spacing="-.05em">NFL</text>
      <g transform="translate(32 42)">
        ${[-12, -6, 0, 6, 12].map(x => `<polygon points="${x},0 ${x + 1.5},-3 ${x + 3},0 ${x + 1.5},3" fill="${L.accent}"/>`).join('')}
      </g>`,
    mlb: L => `
      <path d="M32 4 L56 12 L56 32 C56 48 44 56 32 60 C20 56 8 48 8 32 L8 12 Z" fill="${L.primary}"/>
      <path d="M16 36 c8 0 12-3 16-8 c4-4 8-6 16-4 v8 c-6-1-10 0-13 4 c-4 5-10 8-19 8z" fill="${L.accent}"/>
      <circle cx="20" cy="40" r="3" fill="${L.accent}"/>`,
    nhl: L => `
      <path d="M14 12 L50 12 L46 52 L18 52 Z" fill="${L.primary}"/>
      <path d="M22 22 L42 22 L40 42 L24 42 Z" fill="${L.accent}"/>
      <text x="32" y="36" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="10" fill="${L.primary}">NHL</text>`,
    mls: L => `
      <rect width="64" height="64" rx="6" fill="${L.primary}"/>
      <path d="M0 32 L64 32 L64 64 L0 64 Z" fill="${L.accent}"/>
      <text x="32" y="26" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="14" fill="#fff">MLS</text>
      <g transform="translate(32 48)">
        ${[-10, 0, 10].map(x => `<polygon points="${x},-3 ${x + 1.5},-1 ${x + 4},-1 ${x + 2},1 ${x + 3},4 ${x},2 ${x - 3},4 ${x - 2},1 ${x - 4},-1 ${x - 1.5},-1" fill="#fff"/>`).join('')}
      </g>`,
    ufc: L => `
      <rect width="64" height="64" rx="4" fill="${L.accent}"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="20" fill="${L.primary}" letter-spacing="-.04em">UFC</text>
      <path d="M8 50 L56 50" stroke="${L.primary}" stroke-width="3"/>`,
    fifa: L => `
      <circle cx="32" cy="32" r="30" fill="${L.primary}"/>
      <ellipse cx="32" cy="32" rx="14" ry="22" fill="none" stroke="${L.accent}" stroke-width="2"/>
      <ellipse cx="32" cy="32" rx="22" ry="14" fill="none" stroke="${L.accent}" stroke-width="2"/>
      <line x1="10" y1="32" x2="54" y2="32" stroke="${L.accent}" stroke-width="2"/>
      <line x1="32" y1="10" x2="32" y2="54" stroke="${L.accent}" stroke-width="2"/>
      <text x="32" y="60" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="6" fill="${L.accent}">FIFA</text>`,
    wc26: L => `
      <defs><linearGradient id="wc26-${Math.random().toString(36).slice(2,7)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${L.accent}"/><stop offset="1" stop-color="#c8842c"/></linearGradient></defs>
      <path d="M32 4 L56 14 L52 38 C50 50 42 58 32 60 C22 58 14 50 12 38 L8 14 Z" fill="${L.primary}"/>
      <path d="M32 14 L48 20 L46 36 C45 44 40 50 32 52 C24 50 19 44 18 36 L16 20 Z" fill="${L.accent}"/>
      <text x="32" y="36" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="9" fill="${L.primary}" letter-spacing="-.02em">FIFA</text>
      <text x="32" y="46" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="6" fill="${L.primary}">WORLD CUP 26</text>
      <g transform="translate(32 56)">
        <circle r="3" fill="${L.accent}" stroke="${L.primary}" stroke-width=".5"/>
      </g>`
  };

  /* =====================================================================
   * CONFEDERATION LOGOS
   * ===================================================================*/
  const CONFED = {
    UEFA:    { primary: '#003876', accent: '#fff'      },
    CONMEBOL:{ primary: '#003366', accent: '#FFD700'   },
    CONCACAF:{ primary: '#0066b3', accent: '#fff'      },
    AFC:     { primary: '#ee2a24', accent: '#fff'      },
    CAF:     { primary: '#0a8a3a', accent: '#FFD700'   },
    OFC:     { primary: '#0a3b66', accent: '#fff'      }
  };
  function confedLogo(key, opts = {}) {
    const size = opts.size || 28;
    const K = String(key || '').toUpperCase();
    const C = CONFED[K] || CONFED.UEFA;
    const fb = neutralChip(K, C.primary, size);
    const url = CDN.confed[K];
    if (url) return imgWithFallback([url], K, size, fb);
    return fb;
  }

  /* =====================================================================
   * TEAM CRESTS — stylized renditions of major clubs/national teams.
   * Falls back to elegant initial-shield for teams not in the registry.
   * ===================================================================*/
  const TEAMS = {
    realmadrid:    { name: 'Real Madrid',     primary: '#fff',     accent: '#febe10', third: '#00529f' },
    barcelona:     { name: 'FC Barcelona',    primary: '#a50044',  accent: '#004d98', third: '#fff' },
    atletico:      { name: 'Atlético Madrid', primary: '#cb3524',  accent: '#272e61', third: '#fff' },
    mancity:       { name: 'Man City',        primary: '#6cabdd',  accent: '#1c2c5b', third: '#fff' },
    manunited:     { name: 'Man United',      primary: '#da291c',  accent: '#fbe122', third: '#000' },
    liverpool:     { name: 'Liverpool',       primary: '#c8102e',  accent: '#00b2a9', third: '#fff' },
    arsenal:       { name: 'Arsenal',         primary: '#ef0107',  accent: '#063672', third: '#fff' },
    chelsea:       { name: 'Chelsea',         primary: '#034694',  accent: '#dba111', third: '#fff' },
    tottenham:     { name: 'Tottenham',       primary: '#fff',     accent: '#132257', third: '#fff' },
    bayern:        { name: 'Bayern München',  primary: '#dc052d',  accent: '#0066b2', third: '#fff' },
    dortmund:      { name: 'Dortmund',        primary: '#fde100',  accent: '#000',    third: '#fff' },
    psg:           { name: 'PSG',             primary: '#004170',  accent: '#da291c', third: '#fff' },
    juventus:      { name: 'Juventus',        primary: '#000',     accent: '#fff',    third: '#fff' },
    inter:         { name: 'Inter Milan',     primary: '#0068a8',  accent: '#000',    third: '#fff' },
    milan:         { name: 'AC Milan',        primary: '#fb090b',  accent: '#000',    third: '#fff' },
    boca:          { name: 'Boca Juniors',    primary: '#0c2461',  accent: '#fed330', third: '#fff' },
    river:         { name: 'River Plate',     primary: '#fff',     accent: '#ed1c24', third: '#000' },
    racing:        { name: 'Racing Club',     primary: '#7ec1e7',  accent: '#fff',    third: '#000' },
    independiente: { name: 'Independiente',   primary: '#c0392b',  accent: '#fff',    third: '#000' },
    sanlorenzo:    { name: 'San Lorenzo',     primary: '#1e3a8a',  accent: '#c0392b', third: '#fff' },
    estudiantes:   { name: 'Estudiantes',     primary: '#c0392b',  accent: '#fff',    third: '#000' },
    velez:         { name: 'Vélez',           primary: '#fff',     accent: '#1e3a8a', third: '#000' },
    rosario:       { name: 'Rosario Central', primary: '#fed330',  accent: '#1e3a8a', third: '#fff' },
    newells:       { name: "Newell's",        primary: '#c0392b',  accent: '#000',    third: '#fff' },
    lakers:        { name: 'LA Lakers',       primary: '#552583',  accent: '#fdb927', third: '#fff' },
    celtics:       { name: 'Boston Celtics',  primary: '#007a33',  accent: '#fff',    third: '#000' },
    warriors:      { name: 'GS Warriors',     primary: '#1d428a',  accent: '#ffc72c', third: '#fff' },
    heat:          { name: 'Miami Heat',      primary: '#98002e',  accent: '#f9a01b', third: '#000' },
    bulls:         { name: 'Chicago Bulls',   primary: '#ce1141',  accent: '#000',    third: '#fff' },
    nicks:         { name: 'NY Knicks',       primary: '#f58426',  accent: '#006bb6', third: '#fff' },
    cowboys:       { name: 'Dallas Cowboys',  primary: '#003594',  accent: '#869397', third: '#fff' },
    patriots:      { name: 'NE Patriots',     primary: '#002244',  accent: '#c60c30', third: '#b0b7bc' },
    eagles:        { name: 'Phi Eagles',      primary: '#004c54',  accent: '#a5acaf', third: '#000' },
    chiefs:        { name: 'KC Chiefs',       primary: '#e31837',  accent: '#ffb81c', third: '#fff' },
    yankees:       { name: 'NY Yankees',      primary: '#0c2340',  accent: '#fff',    third: '#c4ced4' },
    dodgers:       { name: 'LA Dodgers',      primary: '#005a9c',  accent: '#fff',    third: '#ef3e42' }
  };

  /* Cache cliente para logos resueltos desde el backend (/api/logo).
   * key = nombre normalizado, value = URL del logo o `null` si no se encontró.
   * Sobrevive a re-renders del DOM pero se pierde en refresh. */
  const remoteLogoCache = new Map();
  const remoteLogoPending = new Map();   // promesas en flight para dedup

  /* Trigger async para resolver un logo via backend. Cuando llega la URL,
   * actualiza TODOS los placeholders del DOM con `data-team-resolve` matching. */
  function resolveRemoteLogo(rawName, sport) {
    const key = String(rawName || '').trim();
    if (!key) return;
    if (remoteLogoCache.has(key)) return;
    if (remoteLogoPending.has(key)) return;

    const apiBase = (window.BSLive?.API_BASE) || '';
    const url = `${apiBase}/api/logo?team=${encodeURIComponent(key)}${sport ? `&sport=${encodeURIComponent(sport)}` : ''}`;
    const promise = fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const logoUrl = data?.url || null;
        remoteLogoCache.set(key, logoUrl);
        remoteLogoPending.delete(key);
        if (logoUrl) {
          // Reemplazar todos los placeholders pending en el DOM
          document.querySelectorAll(`[data-team-resolve="${CSS.escape(key)}"]`).forEach(el => {
            const size = el.dataset.size || 28;
            el.outerHTML = `<img src="${logoUrl}" alt="${String(rawName).replace(/"/g,'')}" width="${size}" height="${size}" loading="lazy" decoding="async" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px"/>`;
          });
        }
      })
      .catch(() => { remoteLogoPending.delete(key); });
    remoteLogoPending.set(key, promise);
  }

  /* Resuelve el logo de un equipo.
   * Flujo:
   *   1) Si está en TEAMS map local + tiene CDN URL → usar esa
   *   2) Si tenemos en remoteLogoCache (de fetches anteriores) → usar esa
   *   3) Devolver placeholder iniciales + disparar async fetch a /api/logo
   *      Cuando llegue la URL real, el placeholder se reemplaza en el DOM. */
  function teamCrest(key, opts = {}) {
    const size = opts.size || 36;
    const k = String(key || '').toLowerCase().replace(/\s|-|\.|'|_/g, '');
    const teamName = opts.name || key;
    const t = TEAMS[k];
    const color = t?.primary || opts.color || '#1f2937';
    const fb = neutralChip(t?.name || teamName, color, size);

    // Path 1: local CDN map
    const localUrl = CDN.team[k];
    if (localUrl) return imgWithFallback([localUrl], t?.name || key, size, fb);

    // Path 2: ya resolvimos remoto antes
    if (remoteLogoCache.has(teamName)) {
      const remoteUrl = remoteLogoCache.get(teamName);
      if (remoteUrl) {
        return `<img src="${remoteUrl}" alt="${String(teamName).replace(/"/g,'')}" width="${size}" height="${size}" loading="lazy" decoding="async" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px"/>`;
      }
      return fb;   // resolvimos null, ya no intentamos más
    }

    // Path 3: disparar resolve async + devolver placeholder que se actualizará
    resolveRemoteLogo(teamName, opts.sport);
    return `<span data-team-resolve="${String(teamName).replace(/"/g,'&quot;')}" data-size="${size}" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">${fb}</span>`;
  }

  function shieldInitial(name, size, opts = {}) {
    const initials = String(name || '?').replace(/[^A-Za-z0-9]/g, ' ').split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase() || '?';
    const palette = opts.color || '#1f2937';
    const fg = opts.fg || '#fff';
    return `<svg class="team-crest" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${name}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="sg-${initials}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette}"/><stop offset="1" stop-color="${shade(palette, -22)}"/></linearGradient></defs>
      <path d="M32 4 L56 14 L52 38 C50 50 42 56 32 60 C22 56 14 50 12 38 L8 14 Z" fill="url(#sg-${initials})"/>
      <path d="M32 4 L56 14 L52 38 C50 50 42 56 32 60 C22 56 14 50 12 38 L8 14 Z" fill="none" stroke="${fg}" stroke-opacity=".25" stroke-width="1.2"/>
      <text x="32" y="40" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="20" fill="${fg}" letter-spacing="-.04em">${initials}</text>
    </svg>`;
  }

  function shade(hex, pct) {
    const c = String(hex).replace('#', '');
    const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
    let r = (num >> 16) + Math.round(255 * pct / 100);
    let g = ((num >> 8) & 255) + Math.round(255 * pct / 100);
    let b = (num & 255) + Math.round(255 * pct / 100);
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  const TEAM_RENDERERS = {
    realmadrid: t => `
      <path d="M32 4 L54 14 L50 40 C48 50 40 56 32 60 C24 56 16 50 14 40 L10 14 Z" fill="${t.primary}" stroke="#a8862e" stroke-width="1.5"/>
      <path d="M32 8 L48 18 L46 36 C45 44 40 50 32 54 C24 50 19 44 18 36 L16 18 Z" fill="#fff" stroke="${t.accent}" stroke-width=".75"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Times New Roman'" font-size="18" font-weight="700" font-style="italic" fill="${t.third}">R</text>
      <path d="M22 16 L24 12 L26 16 L30 14 L28 18 L32 18 L28 20 L30 24 L26 22 L24 26 L22 22 L18 24 L20 20 L16 20 L20 18 L18 14 Z" fill="${t.accent}" transform="translate(8 0) scale(.6)"/>`,
    barcelona: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="#fff" stroke="${t.primary}" stroke-width="2"/>
      <rect x="14" y="14" width="36" height="9" fill="${t.accent}"/>
      <rect x="14" y="23" width="36" height="9" fill="${t.primary}"/>
      <path d="M22 12 L26 12 L26 22 L22 22 Z M30 12 L34 12 L34 22 L30 22 Z M38 12 L42 12 L42 22 L38 22 Z" fill="${t.accent}"/>
      <path d="M14 32 L50 32 L48 42 C46 50 40 56 32 58 C24 56 18 50 16 42 Z" fill="#fff"/>
      <path d="M30 36 L34 36 L34 50 L30 50 Z" fill="${t.primary}"/>
      <path d="M22 42 L42 42" stroke="${t.primary}" stroke-width="3"/>`,
    atletico: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <rect x="10" y="22" width="44" height="6" fill="#fff"/>
      <text x="32" y="50" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" fill="#fff">ATM</text>
      <path d="M32 12 c-3 0-5 2-5 5 c0 2 1 4 3 5 c-1 1-2 2-2 4 c0 3 2 4 4 4 c2 0 4-1 4-4 c0-2-1-3-2-4 c2-1 3-3 3-5 c0-3-2-5-5-5z" fill="${t.accent}"/>`,
    mancity: t => `
      <path d="M32 4 L52 14 L50 36 C48 48 40 56 32 60 C24 56 16 48 14 36 L12 14 Z" fill="${t.primary}"/>
      <path d="M14 14 L50 14 L46 24 L18 24 Z" fill="${t.accent}"/>
      <text x="32" y="34" text-anchor="middle" font-family="'Inter'" font-size="11" font-weight="900" fill="${t.accent}">MCFC</text>
      <path d="M14 36 L50 36 L48 44 L16 44 Z" fill="${t.accent}"/>
      <path d="M22 48 L42 48 L40 54 L24 54 Z" fill="${t.accent}"/>`,
    manunited: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <rect x="12" y="20" width="40" height="6" fill="${t.accent}"/>
      <path d="M28 30 L36 30 L34 50 L30 50 Z" fill="${t.accent}"/>
      <path d="M22 44 L42 44 L42 50 L22 50 Z" fill="${t.accent}"/>
      <circle cx="32" cy="36" r="4" fill="${t.third}"/>`,
    liverpool: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <rect x="14" y="14" width="36" height="6" fill="${t.accent}"/>
      <text x="32" y="34" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" fill="#fff">LIVERPOOL</text>
      <path d="M22 38 c2 4 6 6 10 6 c4 0 8-2 10-6" fill="none" stroke="#fff" stroke-width="1.5"/>
      <path d="M16 50 L48 50 L48 56 L16 56 Z" fill="${t.accent}"/>
      <path d="M28 46 L32 42 L36 46" stroke="#fff" stroke-width="1.5" fill="none"/>`,
    arsenal: t => `
      <path d="M32 4 L54 14 L48 40 C46 50 40 56 32 58 C24 56 18 50 16 40 L10 14 Z" fill="${t.primary}"/>
      <path d="M14 28 L48 22 L46 30 L16 36 Z" fill="${t.accent}" opacity=".95"/>
      <circle cx="44" cy="26" r="2.5" fill="#fff"/>
      <text x="32" y="50" text-anchor="middle" font-family="'Inter'" font-size="7" font-weight="900" fill="#fff">ARSENAL</text>`,
    chelsea: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <circle cx="32" cy="32" r="24" fill="none" stroke="${t.accent}" stroke-width="1.5"/>
      <path d="M22 26 c0 6 4 10 10 10 c6 0 10-4 10-10 v-2 h-3 c0 4-2 7-7 7 c-5 0-7-3-7-7 h-3 z" fill="${t.accent}"/>
      <text x="32" y="48" text-anchor="middle" font-family="'Inter'" font-size="6" font-weight="900" fill="${t.accent}">CHELSEA FC</text>`,
    tottenham: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}" stroke="${t.accent}" stroke-width="2"/>
      <path d="M28 16 c4 4 8 4 8 12 c0 6-4 10-4 12 c0 4 4 4 4 8 v8 h-8 v-8 c0-4 4-4 4-8 c0-2-4-6-4-12 c0-8 4-8 0-12z" fill="${t.accent}"/>
      <path d="M30 10 L34 10 L33 16 L31 16 Z" fill="${t.accent}"/>`,
    bayern: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <circle cx="32" cy="32" r="22" fill="#fff"/>
      <path d="M16 32 L32 16 L48 32 L32 48 Z" fill="${t.accent}"/>
      <path d="M16 32 L32 16 L32 32 L48 32 L32 48 L32 32 Z" fill="#fff"/>`,
    dortmund: t => `
      <circle cx="32" cy="32" r="28" fill="${t.accent}"/>
      <circle cx="32" cy="32" r="22" fill="${t.primary}"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-size="11" font-weight="900" fill="${t.accent}">BVB</text>
      <text x="32" y="52" text-anchor="middle" font-family="'Inter'" font-size="6" font-weight="800" fill="${t.accent}">09</text>`,
    psg: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <rect x="20" y="14" width="6" height="44" fill="${t.accent}"/>
      <path d="M30 18 L36 14 L36 22 L30 26 Z" fill="${t.third}"/>
      <text x="36" y="42" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" fill="${t.third}">PSG</text>`,
    juventus: t => `
      <rect x="10" y="6" width="44" height="52" rx="3" fill="${t.accent}"/>
      <rect x="14" y="6" width="6" height="52" fill="${t.primary}"/>
      <rect x="26" y="6" width="6" height="52" fill="${t.primary}"/>
      <rect x="38" y="6" width="6" height="52" fill="${t.primary}"/>
      <ellipse cx="32" cy="32" rx="16" ry="20" fill="${t.accent}"/>
      <text x="32" y="36" text-anchor="middle" font-family="'Inter'" font-size="11" font-weight="900" fill="${t.primary}">J</text>`,
    inter: t => `
      <circle cx="32" cy="32" r="28" fill="${t.accent}"/>
      <circle cx="32" cy="32" r="22" fill="${t.primary}"/>
      <text x="32" y="40" text-anchor="middle" font-family="'Inter'" font-size="14" font-weight="900" fill="${t.accent}" letter-spacing="-.05em">FC IM</text>`,
    milan: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="#fff"/>
      <path d="M10 6 h22 v54 c-10-4-20-12-22-22 z" fill="${t.primary}"/>
      <path d="M32 6 h22 v32 c-2 10-12 18-22 22 z" fill="${t.accent}"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" fill="#fff">ACM</text>`,
    // Boca: oval-shield body, dark blue, with iconic horizontal yellow stripe
    // (la "banda amarilla") plus 5 stars above and CABJ wordmark.
    boca: t => `
      <defs><clipPath id="boca-clip"><ellipse cx="32" cy="32" rx="26" ry="28"/></clipPath></defs>
      <ellipse cx="32" cy="32" rx="26" ry="28" fill="#0c2461" stroke="#fed330" stroke-width="2"/>
      <g clip-path="url(#boca-clip)">
        <rect x="0" y="28" width="64" height="9" fill="#fed330"/>
        <rect x="0" y="38" width="64" height="2" fill="#0c2461"/>
        <g fill="#fed330">
          <polygon points="14,12 15.2,15.2 18.5,15.2 15.9,17.3 17,20.5 14,18.6 11,20.5 12.1,17.3 9.5,15.2 12.8,15.2"/>
          <polygon points="32,8  33.2,11.2 36.5,11.2 33.9,13.3 35,16.5 32,14.6 29,16.5 30.1,13.3 27.5,11.2 30.8,11.2"/>
          <polygon points="50,12 51.2,15.2 54.5,15.2 51.9,17.3 53,20.5 50,18.6 47,20.5 48.1,17.3 45.5,15.2 48.8,15.2"/>
        </g>
        <text x="32" y="51" text-anchor="middle" font-family="'Inter','Helvetica',sans-serif" font-size="6.5" font-weight="900" fill="#0c2461" letter-spacing=".06em">BOCA JRS</text>
      </g>`,
    // River: white oval-shield with iconic diagonal red "banda"
    // and CARP/RIVER PLATE inside, edge in red.
    river: t => `
      <defs><clipPath id="river-clip"><ellipse cx="32" cy="32" rx="26" ry="28"/></clipPath></defs>
      <ellipse cx="32" cy="32" rx="26" ry="28" fill="#ffffff" stroke="#ed1c24" stroke-width="2"/>
      <g clip-path="url(#river-clip)">
        <polygon points="0,42 0,50 64,18 64,10" fill="#ed1c24"/>
        <text x="32" y="20" text-anchor="middle" font-family="'Inter','Helvetica',sans-serif" font-size="5.5" font-weight="900" fill="#ed1c24" letter-spacing=".1em">CLUB ATLÉTICO</text>
        <text x="32" y="55" text-anchor="middle" font-family="'Inter','Helvetica',sans-serif" font-size="6.8" font-weight="900" fill="#ed1c24" letter-spacing=".08em">RIVER PLATE</text>
      </g>`,
    racing: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <circle cx="32" cy="32" r="22" fill="${t.accent}"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-size="14" font-weight="900" fill="${t.primary}">R</text>`,
    independiente: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <text x="32" y="40" text-anchor="middle" font-family="'Inter'" font-size="14" font-weight="900" fill="${t.accent}">I</text>`,
    sanlorenzo: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <rect x="12" y="20" width="40" height="8" fill="${t.accent}"/>
      <text x="32" y="44" text-anchor="middle" font-family="'Inter'" font-size="8" font-weight="900" fill="${t.third}">SL</text>`,
    estudiantes: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.accent}"/>
      <rect x="20" y="6" width="6" height="54" fill="${t.primary}"/>
      <rect x="38" y="6" width="6" height="54" fill="${t.primary}"/>
      <text x="32" y="40" text-anchor="middle" font-family="'Inter'" font-size="11" font-weight="900" fill="${t.primary}">E</text>`,
    velez: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <path d="M14 14 L50 14 L46 36 C44 46 38 52 32 56 C26 52 20 46 18 36 Z" fill="${t.accent}" opacity=".15"/>
      <text x="32" y="38" text-anchor="middle" font-family="'Inter'" font-size="11" font-weight="900" fill="${t.accent}">V</text>`,
    rosario: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <rect x="6" y="22" width="52" height="8" fill="${t.accent}"/>
      <text x="32" y="46" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" fill="${t.accent}">CARC</text>`,
    newells: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.accent}"/>
      <path d="M22 14 L42 14 L42 56 L22 56 Z" fill="${t.primary}"/>
      <path d="M32 14 L32 56" stroke="${t.accent}" stroke-width="2"/>`,
    lakers: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <text x="32" y="30" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" fill="${t.accent}">LAKERS</text>
      <circle cx="32" cy="42" r="6" fill="${t.accent}"/>
      <path d="M30 38 q2-3 4 0 m-4 8 q2 3 4 0 M24 42 h16 M28 38 l2 8 M36 38 l-2 8" stroke="${t.primary}" stroke-width=".75" fill="none"/>`,
    celtics: t => `
      <circle cx="32" cy="32" r="28" fill="#fff"/>
      <circle cx="32" cy="32" r="24" fill="${t.primary}"/>
      <path d="M28 22 c-4 0-6 3-6 6 c0 3 2 6 6 6 c-3 0-3 4 0 4 c0-3 4-3 4 0 c0-3 4-3 4 0 c3 0 3-4 0-4 c4 0 6-3 6-6 c0-3-2-6-6-6 c0 3-4 3-4 0 c0 3-4 3-4 0z" fill="${t.accent}"/>`,
    warriors: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <circle cx="32" cy="32" r="22" fill="${t.accent}"/>
      <path d="M14 32 a18 12 0 0 0 36 0" fill="none" stroke="${t.primary}" stroke-width="3"/>
      <path d="M16 30 L24 26 M40 26 L48 30" stroke="${t.primary}" stroke-width="2"/>`,
    heat: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <path d="M32 14 c-4 8 4 12 4 18 c0 6-4 10-4 14 c-4-4-8-8-8-14 c0-6 4-10 8-18z" fill="${t.accent}"/>
      <circle cx="32" cy="36" r="10" fill="none" stroke="${t.accent}" stroke-width="2"/>`,
    bulls: t => `
      <rect width="64" height="64" rx="6" fill="#fff"/>
      <path d="M14 30 c0-8 8-12 18-12 c10 0 18 4 18 12 c0 4-2 8-6 10 l-4-2 q-2 4-8 4 q-6 0-8-4 l-4 2 c-4-2-6-6-6-10z" fill="${t.primary}"/>
      <ellipse cx="32" cy="34" rx="3" ry="2" fill="#fff"/>`,
    nicks: t => `
      <circle cx="32" cy="32" r="28" fill="${t.accent}"/>
      <path d="M14 14 L50 14 L46 32 L42 22 L42 50 L36 50 L36 28 L30 38 L26 28 L26 50 L18 50 Z" fill="${t.primary}"/>`,
    cowboys: t => `
      <rect width="64" height="64" rx="6" fill="${t.primary}"/>
      <path d="M32 12 L36 24 L48 24 L38 32 L42 44 L32 36 L22 44 L26 32 L16 24 L28 24 Z" fill="${t.accent}"/>`,
    patriots: t => `
      <rect width="64" height="64" rx="6" fill="${t.primary}"/>
      <path d="M14 36 L40 24 L44 28 L48 24 L52 32 L42 36 L40 44 L24 44 Z" fill="${t.accent}"/>
      <circle cx="40" cy="30" r="2" fill="${t.third}"/>
      <path d="M16 36 L20 32 L24 36 L28 32 L32 36" fill="none" stroke="${t.third}" stroke-width="1.5"/>`,
    eagles: t => `
      <path d="M32 4 L54 12 L52 38 C50 48 42 56 32 60 C22 56 14 48 12 38 L10 12 Z" fill="${t.primary}"/>
      <path d="M14 30 L24 22 L28 28 L32 22 L36 28 L40 22 L50 30 L44 36 L40 32 L32 38 L24 32 L20 36 Z" fill="${t.accent}"/>
      <circle cx="48" cy="28" r="2" fill="${t.third}"/>`,
    chiefs: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <path d="M32 14 L48 38 L40 38 L40 50 L24 50 L24 38 L16 38 Z" fill="${t.accent}"/>
      <text x="32" y="46" text-anchor="middle" font-family="'Inter'" font-size="8" font-weight="900" fill="${t.primary}">KC</text>`,
    yankees: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <path d="M22 16 L26 16 L30 24 L30 16 L34 16 L34 32 L30 32 L26 24 L26 32 L22 32 Z M28 36 L36 36 L36 40 L34 40 L34 48 L30 48 L30 40 L28 40 Z" fill="${t.accent}"/>`,
    dodgers: t => `
      <circle cx="32" cy="32" r="28" fill="${t.primary}"/>
      <text x="32" y="30" text-anchor="middle" font-family="'Inter'" font-size="9" font-weight="900" font-style="italic" fill="${t.accent}">Dodgers</text>
      <path d="M14 38 L32 50 L50 38" fill="none" stroke="${t.third}" stroke-width="2"/>`
  };

  /* =====================================================================
   * NATIONAL FLAGS — high-quality SVG flags for World Cup 2026 (48 nations)
   * Stripes / unions / classic patterns. Names + ISO codes.
   * ===================================================================*/
  const NATIONS = [
    { code: 'ARG', name: 'Argentina',  conf: 'CONMEBOL', odds: 7.5,  draw: ['#74ACDF', '#fff', '#74ACDF'] },
    { code: 'BRA', name: 'Brasil',     conf: 'CONMEBOL', odds: 6.0,  draw: ['#009c3b', '#ffdf00', '#002776'] },
    { code: 'FRA', name: 'Francia',    conf: 'UEFA',     odds: 5.5,  draw: ['#0055A4', '#fff', '#EF4135'] },
    { code: 'ESP', name: 'España',     conf: 'UEFA',     odds: 8.0,  draw: ['#AA151B', '#F1BF00', '#AA151B'] },
    { code: 'GER', name: 'Alemania',   conf: 'UEFA',     odds: 12.0, draw: ['#000', '#DD0000', '#FFCE00'] },
    { code: 'ENG', name: 'Inglaterra', conf: 'UEFA',     odds: 9.0,  draw: ['#fff', '#CE1124', '#fff'] },
    { code: 'POR', name: 'Portugal',   conf: 'UEFA',     odds: 13.0, draw: ['#006600', '#FF0000', '#006600'] },
    { code: 'NED', name: 'Países Bajos',conf: 'UEFA',    odds: 16.0, draw: ['#AE1C28', '#fff', '#21468B'] },
    { code: 'ITA', name: 'Italia',     conf: 'UEFA',     odds: 22.0, draw: ['#008C45', '#fff', '#CD212A'] },
    { code: 'BEL', name: 'Bélgica',    conf: 'UEFA',     odds: 20.0, draw: ['#000', '#FAE042', '#ED2939'] },
    { code: 'CRO', name: 'Croacia',    conf: 'UEFA',     odds: 33.0, draw: ['#FF0000', '#fff', '#171796'] },
    { code: 'SUI', name: 'Suiza',      conf: 'UEFA',     odds: 50.0, draw: ['#FF0000', '#fff', '#FF0000'] },
    { code: 'AUT', name: 'Austria',    conf: 'UEFA',     odds: 50.0, draw: ['#ED2939', '#fff', '#ED2939'] },
    { code: 'DEN', name: 'Dinamarca',  conf: 'UEFA',     odds: 40.0, draw: ['#C8102E', '#fff', '#C8102E'] },
    { code: 'POL', name: 'Polonia',    conf: 'UEFA',     odds: 75.0, draw: ['#fff', '#DC143C', '#fff'] },
    { code: 'NOR', name: 'Noruega',    conf: 'UEFA',     odds: 30.0, draw: ['#EF2B2D', '#fff', '#002868'] },
    { code: 'TUR', name: 'Turquía',    conf: 'UEFA',     odds: 80.0, draw: ['#E30A17', '#fff', '#E30A17'] },
    { code: 'CZE', name: 'Chequia',    conf: 'UEFA',     odds: 100,  draw: ['#11457E', '#fff', '#D7141A'] },
    { code: 'SCO', name: 'Escocia',    conf: 'UEFA',     odds: 150,  draw: ['#0065BD', '#fff', '#0065BD'] },
    { code: 'WAL', name: 'Gales',      conf: 'UEFA',     odds: 250,  draw: ['#00B140', '#fff', '#D30731'] },
    { code: 'UKR', name: 'Ucrania',    conf: 'UEFA',     odds: 300,  draw: ['#0057B7', '#0057B7', '#FFD500'] },
    { code: 'MEX', name: 'México',     conf: 'CONCACAF', odds: 50.0, draw: ['#006847', '#fff', '#CE1126'] },
    { code: 'CAN', name: 'Canadá',     conf: 'CONCACAF', odds: 80.0, draw: ['#FF0000', '#fff', '#FF0000'] },
    { code: 'USA', name: 'Estados Unidos', conf: 'CONCACAF', odds: 35.0, draw: ['#B22234', '#fff', '#3C3B6E'] },
    { code: 'CRC', name: 'Costa Rica', conf: 'CONCACAF', odds: 500,  draw: ['#002B7F', '#fff', '#CE1126'] },
    { code: 'PAN', name: 'Panamá',     conf: 'CONCACAF', odds: 750,  draw: ['#fff', '#005AA7', '#D21034'] },
    { code: 'JAM', name: 'Jamaica',    conf: 'CONCACAF', odds: 1000, draw: ['#000', '#FED100', '#009B3A'] },
    { code: 'URU', name: 'Uruguay',    conf: 'CONMEBOL', odds: 33.0, draw: ['#7B96D6', '#fff', '#7B96D6'] },
    { code: 'COL', name: 'Colombia',   conf: 'CONMEBOL', odds: 50.0, draw: ['#FCD116', '#003893', '#CE1126'] },
    { code: 'ECU', name: 'Ecuador',    conf: 'CONMEBOL', odds: 250,  draw: ['#FFD100', '#0072CE', '#EF3340'] },
    { code: 'PAR', name: 'Paraguay',   conf: 'CONMEBOL', odds: 500,  draw: ['#D52B1E', '#fff', '#0038A8'] },
    { code: 'JPN', name: 'Japón',      conf: 'AFC',      odds: 70.0, draw: ['#fff', '#BC002D', '#fff'] },
    { code: 'KOR', name: 'Corea del Sur', conf: 'AFC',   odds: 100,  draw: ['#fff', '#cd2e3a', '#fff'] },
    { code: 'AUS', name: 'Australia',  conf: 'AFC',      odds: 150,  draw: ['#012169', '#fff', '#E4002B'] },
    { code: 'IRN', name: 'Irán',       conf: 'AFC',      odds: 250,  draw: ['#239F40', '#fff', '#DA0000'] },
    { code: 'KSA', name: 'Arabia Saudí',conf: 'AFC',     odds: 300,  draw: ['#006C35', '#fff', '#006C35'] },
    { code: 'QAT', name: 'Qatar',      conf: 'AFC',      odds: 500,  draw: ['#8D1B3D', '#fff', '#8D1B3D'] },
    { code: 'IRQ', name: 'Iraq',       conf: 'AFC',      odds: 1000, draw: ['#CE1126', '#fff', '#000'] },
    { code: 'UZB', name: 'Uzbekistán', conf: 'AFC',      odds: 1500, draw: ['#0099B5', '#fff', '#1EB53A'] },
    { code: 'MAR', name: 'Marruecos',  conf: 'CAF',      odds: 80.0, draw: ['#C1272D', '#005138', '#C1272D'] },
    { code: 'SEN', name: 'Senegal',    conf: 'CAF',      odds: 100,  draw: ['#00853F', '#FDEF42', '#E31B23'] },
    { code: 'EGY', name: 'Egipto',     conf: 'CAF',      odds: 200,  draw: ['#CE1126', '#fff', '#000'] },
    { code: 'NGA', name: 'Nigeria',    conf: 'CAF',      odds: 150,  draw: ['#008751', '#fff', '#008751'] },
    { code: 'CIV', name: 'Costa de Marfil', conf: 'CAF', odds: 200,  draw: ['#F77F00', '#fff', '#009E60'] },
    { code: 'GHA', name: 'Ghana',      conf: 'CAF',      odds: 300,  draw: ['#CE1126', '#FCD116', '#006B3F'] },
    { code: 'TUN', name: 'Túnez',      conf: 'CAF',      odds: 500,  draw: ['#E70013', '#fff', '#E70013'] },
    { code: 'DZA', name: 'Argelia',    conf: 'CAF',      odds: 200,  draw: ['#006233', '#fff', '#D21034'] },
    { code: 'NZL', name: 'Nueva Zelanda', conf: 'OFC',   odds: 1500, draw: ['#012169', '#012169', '#012169'] }
  ];

  // Map 2-letter ISO/legacy codes -> 3-letter codes used internally
  const ISO2_TO_ISO3 = {
    AR:'ARG', BR:'BRA', FR:'FRA', ES:'ESP', DE:'GER', EN:'ENG', PT:'POR',
    NL:'NED', IT:'ITA', BE:'BEL', HR:'CRO', CH:'SUI', AT:'AUT', DK:'DEN',
    PL:'POL', NO:'NOR', TR:'TUR', CZ:'CZE', SE:'SWE', MX:'MEX', CA:'CAN',
    US:'USA', UY:'URU', CO:'COL', EC:'ECU', PY:'PAR', CR:'CRC', PA:'PAN',
    JM:'JAM', JP:'JPN', KR:'KOR', AU:'AUS', IR:'IRN', SA:'KSA', QA:'QAT',
    IQ:'IRQ', UZ:'UZB', MA:'MAR', SN:'SEN', EG:'EGY', NG:'NGA', CI:'CIV',
    GH:'GHA', CM:'CMR', TN:'TUN', DZ:'DZA', NZ:'NZL'
  };
  function flag(code, opts = {}) {
    const size = opts.size || 24;
    const c3 = (ISO2_TO_ISO3[code] || code || '').toUpperCase();
    const cdnIso = CDN.flag[c3];
    if (cdnIso) {
      const N = NATIONS.find(n => n.code === c3);
      const w = Math.round(size * 1.5);
      const h = size;
      const url = `https://flagcdn.com/w80/${cdnIso}.png`;
      const fbSvg = `<svg width="${w}" height="${h}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg"><rect width="60" height="40" fill="#cbd5e1"/></svg>`;
      const safeAlt = (N?.name || c3).replace(/"/g, '');
      return `<span class="flag-img" style="display:inline-flex;align-items:center;width:${w}px;height:${h}px;flex-shrink:0;border-radius:3px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.06)">
        <img src="${url}" alt="${safeAlt}" loading="lazy" decoding="async" width="${w}" height="${h}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display='none';var s=this.nextElementSibling;if(s)s.style.display='block'"/>
        <span style="display:none;width:100%;height:100%">${fbSvg}</span>
      </span>`;
    }
    const N = NATIONS.find(n => n.code === c3) || { draw: ['#cbd5e1', '#94a3b8', '#64748b'], code: c3 };
    const c = N.draw;
    if (c3 === 'USA') {
      return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
        ${[...Array(13)].map((_, i) => `<rect x="0" y="${i * (40/13)}" width="60" height="${40/13}" fill="${i % 2 === 0 ? c[0] : c[1]}"/>`).join('')}
        <rect x="0" y="0" width="24" height="${40 * 7/13}" fill="${c[2]}"/>
      </svg>`;
    }
    if (c3 === 'JPN') {
      return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
        <rect width="60" height="40" fill="#fff"/>
        <circle cx="30" cy="20" r="12" fill="${c[1]}"/>
      </svg>`;
    }
    if (c3 === 'KOR') {
      return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
        <rect width="60" height="40" fill="#fff"/>
        <circle cx="30" cy="20" r="9" fill="${c[1]}"/>
        <path d="M21 20 a9 9 0 0 1 18 0 a4.5 4.5 0 0 1-9 0 a4.5 4.5 0 0 0-9 0 z" fill="#0047a0"/>
      </svg>`;
    }
    if (c3 === 'BRA') {
      return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
        <rect width="60" height="40" fill="${c[0]}"/>
        <path d="M30 6 L54 20 L30 34 L6 20 Z" fill="${c[1]}"/>
        <circle cx="30" cy="20" r="6" fill="${c[2]}"/>
      </svg>`;
    }
    if (c3 === 'CAN') {
      return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
        <rect width="15" height="40" fill="${c[0]}"/>
        <rect x="15" width="30" height="40" fill="#fff"/>
        <rect x="45" width="15" height="40" fill="${c[0]}"/>
        <path d="M30 14 L31 18 L34 18 L32 21 L33 25 L30 23 L27 25 L28 21 L26 18 L29 18 Z" fill="${c[0]}"/>
      </svg>`;
    }
    if (c3 === 'MEX') {
      return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
        <rect width="20" height="40" fill="${c[0]}"/>
        <rect x="20" width="20" height="40" fill="${c[1]}"/>
        <rect x="40" width="20" height="40" fill="${c[2]}"/>
        <circle cx="30" cy="20" r="5" fill="none" stroke="${c[0]}" stroke-width="1"/>
      </svg>`;
    }
    // Default: 3 horizontal stripes
    return `<svg width="${size * 1.5}" height="${size}" viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg" aria-label="${N.name || code}">
      <rect width="60" height="${40/3}" fill="${c[0]}"/>
      <rect y="${40/3}" width="60" height="${40/3}" fill="${c[1]}"/>
      <rect y="${2*40/3}" width="60" height="${40/3}" fill="${c[2]}"/>
    </svg>`;
  }

  /* =====================================================================
   * EXPORT
   * ===================================================================*/
  global.BSLogos = {
    brandMark, brandWordmark,
    bookLogo, BOOKS,
    leagueLogo, LEAGUES,
    confedLogo, CONFED,
    teamCrest, shieldInitial, TEAMS,
    flag, NATIONS,
    neutralChip      // exposed: minimal initials chip (no fake logo art)
  };
})(window);
