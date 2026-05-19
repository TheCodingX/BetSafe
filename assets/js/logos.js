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
      // ── Fútbol europeo top ──
      epl:           'https://media.api-sports.io/football/leagues/39.png',
      championship:  'https://media.api-sports.io/football/leagues/40.png',
      facup:         'https://media.api-sports.io/football/leagues/45.png',
      laliga:        'https://media.api-sports.io/football/leagues/140.png',
      laliga2:       'https://media.api-sports.io/football/leagues/141.png',
      copadelrey:    'https://media.api-sports.io/football/leagues/143.png',
      seriea:        'https://media.api-sports.io/football/leagues/135.png',
      serieb:        'https://media.api-sports.io/football/leagues/136.png',
      coppaitalia:   'https://media.api-sports.io/football/leagues/137.png',
      bundes:        'https://media.api-sports.io/football/leagues/78.png',
      bundes2:       'https://media.api-sports.io/football/leagues/79.png',
      ligue1:        'https://media.api-sports.io/football/leagues/61.png',
      ligue2:        'https://media.api-sports.io/football/leagues/62.png',
      eredivisie:    'https://media.api-sports.io/football/leagues/88.png',
      primeira:      'https://media.api-sports.io/football/leagues/94.png',
      // ── UEFA ──
      ucl:           'https://media.api-sports.io/football/leagues/2.png',
      uel:           'https://media.api-sports.io/football/leagues/3.png',
      conference:    'https://media.api-sports.io/football/leagues/848.png',
      // ── Argentina ──
      lpfar:         'https://media.api-sports.io/football/leagues/128.png',
      copaarg:       'https://media.api-sports.io/football/leagues/130.png',
      primeranacional:'https://media.api-sports.io/football/leagues/129.png',
      // ── Sudamérica ──
      libert:        'https://media.api-sports.io/football/leagues/13.png',
      sudamericana:  'https://media.api-sports.io/football/leagues/11.png',
      recopa:        'https://media.api-sports.io/football/leagues/14.png',
      brasileiraoa:  'https://media.api-sports.io/football/leagues/71.png',
      brasileiraob:  'https://media.api-sports.io/football/leagues/72.png',
      ligapro:       'https://media.api-sports.io/football/leagues/240.png',  // Liga Pro Ecuador
      primerachile:  'https://media.api-sports.io/football/leagues/265.png',
      ligabetplay:   'https://media.api-sports.io/football/leagues/239.png',
      ligaperu:      'https://media.api-sports.io/football/leagues/281.png',
      uruguayoprimera:'https://media.api-sports.io/football/leagues/268.png',
      paraguaprimera:'https://media.api-sports.io/football/leagues/284.png',
      // ── México / USA ──
      ligamx:        'https://media.api-sports.io/football/leagues/262.png',
      // ── Selecciones / Internacional ──
      wc26:          'https://media.api-sports.io/football/leagues/1.png',
      copaamerica:   'https://media.api-sports.io/football/leagues/9.png',
      euro:          'https://media.api-sports.io/football/leagues/4.png',
      fifa:          'https://a.espncdn.com/i/teamlogos/leagues/500/4.png',
      // ── Liga MLS y USA ──
      mls:           'https://www.google.com/s2/favicons?domain=mlssoccer.com&sz=128',
      // ── Basquet ──
      nba:           'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png',
      euroleague:    'https://www.google.com/s2/favicons?domain=euroleaguebasketball.net&sz=128',
      eurocup:       'https://www.google.com/s2/favicons?domain=euroleaguebasketball.net&sz=128',
      acb:           'https://www.google.com/s2/favicons?domain=acb.com&sz=128',         // Liga ACB Espana
      lnb:           'https://www.google.com/s2/favicons?domain=lnb.com.ar&sz=128',       // Liga Nacional Argentina
      // ── Otros sports USA ──
      nfl:           'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png',
      mlb:           'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png',
      nhl:           'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png',
      // ── Tenis (ATP/WTA/Grand Slams) ──
      atp:           'https://www.google.com/s2/favicons?domain=atptour.com&sz=128',
      wta:           'https://www.google.com/s2/favicons?domain=wtatennis.com&sz=128',
      atpchallenger: 'https://www.google.com/s2/favicons?domain=atptour.com&sz=128',
      grandslam:     'https://www.google.com/s2/favicons?domain=itftennis.com&sz=128',
      wimbledon:     'https://www.google.com/s2/favicons?domain=wimbledon.com&sz=128',
      usopen:        'https://www.google.com/s2/favicons?domain=usopen.org&sz=128',
      ausopen:       'https://www.google.com/s2/favicons?domain=ausopen.com&sz=128',
      rolandgarros:  'https://www.google.com/s2/favicons?domain=rolandgarros.com&sz=128',
      itf:           'https://www.google.com/s2/favicons?domain=itftennis.com&sz=128',
      // ── MMA / Boxing ──
      ufc:           'https://www.google.com/s2/favicons?domain=ufc.com&sz=128',
      mma:           'https://www.google.com/s2/favicons?domain=ufc.com&sz=128',
      pfl:           'https://www.google.com/s2/favicons?domain=pflmma.com&sz=128',
      bellator:      'https://www.google.com/s2/favicons?domain=bellator.com&sz=128',
      // ── Esports ──
      csgo:          'https://www.google.com/s2/favicons?domain=hltv.org&sz=128',
      cs2:           'https://www.google.com/s2/favicons?domain=hltv.org&sz=128',
      lol:           'https://www.google.com/s2/favicons?domain=lolesports.com&sz=128',
      dota2:         'https://www.google.com/s2/favicons?domain=dota2.com&sz=128',
      valorant:      'https://www.google.com/s2/favicons?domain=valorantesports.com&sz=128',
      esports:       'https://www.google.com/s2/favicons?domain=hltv.org&sz=128'
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
      // ESPN CDN — 713 teams pre-extracted from ESPN league listings
      // (arg.1/2, bra.1/2, chi.1, par.1, uru.1, col.1, per.1, ecu.1, bol.1,
      //  mex.1, usa.1, conmebol.libertadores/sudamericana, eng.1/2, esp.1,
      //  ita.1, ger.1, fra.1, por.1, ned.1, uefa.champions/europa).
      // Keys son nombres normalizados (sin acentos, sin spaces, lowercase).
      // Match flexible vía buildTeamLookup() en teamCrest().
    '1fcheidenheim1846': 'https://a.espncdn.com/i/teamlogos/soccer/500/6418.png',
    '1fcunionberlin': 'https://a.espncdn.com/i/teamlogos/soccer/500/598.png',
    '2demayo': 'https://a.espncdn.com/i/teamlogos/soccer/500/6097.png',
    abb: 'https://a.espncdn.com/i/teamlogos/soccer/500/130875.png',
    academiapuertocabello: 'https://a.espncdn.com/i/teamlogos/soccer/500/18995.png',
    acassuso: 'https://a.espncdn.com/i/teamlogos/soccer/500/10145.png',
    acmilan: 'https://a.espncdn.com/i/teamlogos/soccer/500/103.png',
    addicks: 'https://a.espncdn.com/i/teamlogos/soccer/500/372.png',
    adt: 'https://a.espncdn.com/i/teamlogos/soccer/500/21314.png',
    afcbournemouth: 'https://a.espncdn.com/i/teamlogos/soccer/500/349.png',
    agropecuario: 'https://a.espncdn.com/i/teamlogos/soccer/500/13913.png',
    aguilasdoradas: 'https://a.espncdn.com/i/teamlogos/soccer/500/9762.png',
    ajauxerre: 'https://a.espncdn.com/i/teamlogos/soccer/500/172.png',
    ajax: 'https://a.espncdn.com/i/teamlogos/soccer/500/139.png',
    ajaxamsterdam: 'https://a.espncdn.com/i/teamlogos/soccer/500/139.png',
    alaves: 'https://a.espncdn.com/i/teamlogos/soccer/500/96.png',
    albion: 'https://a.espncdn.com/i/teamlogos/soccer/500/21403.png',
    albionfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/21403.png',
    aldosivi: 'https://a.espncdn.com/i/teamlogos/soccer/500/9739.png',
    alianzaatl: 'https://a.espncdn.com/i/teamlogos/soccer/500/5267.png',
    alianzaatletico: 'https://a.espncdn.com/i/teamlogos/soccer/500/5267.png',
    alianzafc: 'https://a.espncdn.com/i/teamlogos/soccer/500/9761.png',
    alianzalima: 'https://a.espncdn.com/i/teamlogos/soccer/500/2680.png',
    allboys: 'https://a.espncdn.com/i/teamlogos/soccer/500/9786.png',
    almagro: 'https://a.espncdn.com/i/teamlogos/soccer/500/2.png',
    almirantebrown: 'https://a.espncdn.com/i/teamlogos/soccer/500/9740.png',
    altebrown: 'https://a.espncdn.com/i/teamlogos/soccer/500/9740.png',
    alverca: 'https://a.espncdn.com/i/teamlogos/soccer/500/21613.png',
    alwaysready: 'https://a.espncdn.com/i/teamlogos/soccer/500/19425.png',
    ameliano: 'https://a.espncdn.com/i/teamlogos/soccer/500/21313.png',
    america: 'https://a.espncdn.com/i/teamlogos/soccer/500/227.png',
    americacali: 'https://a.espncdn.com/i/teamlogos/soccer/500/8109.png',
    americadecali: 'https://a.espncdn.com/i/teamlogos/soccer/500/8109.png',
    americamg: 'https://a.espncdn.com/i/teamlogos/soccer/500/6154.png',
    americamineiro: 'https://a.espncdn.com/i/teamlogos/soccer/500/6154.png',
    angers: 'https://a.espncdn.com/i/teamlogos/soccer/500/7868.png',
    argentinos: 'https://a.espncdn.com/i/teamlogos/soccer/500/3.png',
    argentinosjuniors: 'https://a.espncdn.com/i/teamlogos/soccer/500/3.png',
    arouca: 'https://a.espncdn.com/i/teamlogos/soccer/500/15784.png',
    arsenal: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
    asmonaco: 'https://a.espncdn.com/i/teamlogos/soccer/500/174.png',
    asroma: 'https://a.espncdn.com/i/teamlogos/soccer/500/104.png',
    astonvilla: 'https://a.espncdn.com/i/teamlogos/soccer/500/362.png',
    atalanta: 'https://a.espncdn.com/i/teamlogos/soccer/500/105.png',
    athletic: 'https://a.espncdn.com/i/teamlogos/soccer/500/20851.png',
    athleticclub: 'https://a.espncdn.com/i/teamlogos/soccer/500/93.png',
    athleticoparanaense: 'https://a.espncdn.com/i/teamlogos/soccer/500/3458.png',
    athleticopr: 'https://a.espncdn.com/i/teamlogos/soccer/500/3458.png',
    atlanta: 'https://a.espncdn.com/i/teamlogos/soccer/500/10146.png',
    atlantaunitedfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/18418.png',
    atlas: 'https://a.espncdn.com/i/teamlogos/soccer/500/216.png',
    atletico: 'https://a.espncdn.com/i/teamlogos/soccer/500/1068.png',
    atleticodesanluis: 'https://a.espncdn.com/i/teamlogos/soccer/500/15720.png',
    atleticogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/10357.png',
    atleticogoianiense: 'https://a.espncdn.com/i/teamlogos/soccer/500/10357.png',
    atleticograu: 'https://a.espncdn.com/i/teamlogos/soccer/500/20293.png',
    atleticojunior: 'https://a.espncdn.com/i/teamlogos/soccer/500/4815.png',
    atleticomadrid: 'https://a.espncdn.com/i/teamlogos/soccer/500/1068.png',
    atleticomg: 'https://a.espncdn.com/i/teamlogos/soccer/500/7632.png',
    atleticonacional: 'https://a.espncdn.com/i/teamlogos/soccer/500/5264.png',
    atleticorafaela: 'https://a.espncdn.com/i/teamlogos/soccer/500/9747.png',
    atleticotucuman: 'https://a.espncdn.com/i/teamlogos/soccer/500/9785.png',
    atljunior: 'https://a.espncdn.com/i/teamlogos/soccer/500/4815.png',
    atlnacional: 'https://a.espncdn.com/i/teamlogos/soccer/500/5264.png',
    atlsanluis: 'https://a.espncdn.com/i/teamlogos/soccer/500/15720.png',
    atltucuman: 'https://a.espncdn.com/i/teamlogos/soccer/500/9785.png',
    aucas: 'https://a.espncdn.com/i/teamlogos/soccer/500/6017.png',
    audaxitaliano: 'https://a.espncdn.com/i/teamlogos/soccer/500/4138.png',
    augsburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/3841.png',
    aurora: 'https://a.espncdn.com/i/teamlogos/soccer/500/6046.png',
    austin: 'https://a.espncdn.com/i/teamlogos/soccer/500/20906.png',
    austinfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/20906.png',
    auxerre: 'https://a.espncdn.com/i/teamlogos/soccer/500/172.png',
    avai: 'https://a.espncdn.com/i/teamlogos/soccer/500/9966.png',
    avs: 'https://a.espncdn.com/i/teamlogos/soccer/500/22064.png',
    azalkmaar: 'https://a.espncdn.com/i/teamlogos/soccer/500/140.png',
    bahia: 'https://a.espncdn.com/i/teamlogos/soccer/500/9967.png',
    banfield: 'https://a.espncdn.com/i/teamlogos/soccer/500/235.png',
    barca: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
    barcelona: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',          // FC Barcelona (España) — id 83
    fcbarcelona: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',        // FC Barcelona alias
    barcelonafc: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
    barcelonasc: 'https://a.espncdn.com/i/teamlogos/soccer/500/2686.png',      // Barcelona SC (Ecuador) — id 2686
    barcelonaecuador: 'https://a.espncdn.com/i/teamlogos/soccer/500/2686.png',
    barracas: 'https://a.espncdn.com/i/teamlogos/soccer/500/10060.png',
    barracascentral: 'https://a.espncdn.com/i/teamlogos/soccer/500/10060.png',
    bayerleverkusen: 'https://a.espncdn.com/i/teamlogos/soccer/500/131.png',
    bayern: 'https://a.espncdn.com/i/teamlogos/soccer/500/132.png',
    bayernmunich: 'https://a.espncdn.com/i/teamlogos/soccer/500/132.png',
    belgrano: 'https://a.espncdn.com/i/teamlogos/soccer/500/4.png',
    belgranocordoba: 'https://a.espncdn.com/i/teamlogos/soccer/500/4.png',
    benfica: 'https://a.espncdn.com/i/teamlogos/soccer/500/1929.png',
    betis: 'https://a.espncdn.com/i/teamlogos/soccer/500/244.png',
    birmingham: 'https://a.espncdn.com/i/teamlogos/soccer/500/392.png',
    birminghamcity: 'https://a.espncdn.com/i/teamlogos/soccer/500/392.png',
    blackburn: 'https://a.espncdn.com/i/teamlogos/soccer/500/365.png',
    blackburnrovers: 'https://a.espncdn.com/i/teamlogos/soccer/500/365.png',
    blackcatswearsiders: 'https://a.espncdn.com/i/teamlogos/soccer/500/366.png',
    blooming: 'https://a.espncdn.com/i/teamlogos/soccer/500/6047.png',
    blues: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png',
    boca: 'https://a.espncdn.com/i/teamlogos/soccer/500/5.png',
    bocajuniors: 'https://a.espncdn.com/i/teamlogos/soccer/500/5.png',
    bodoglimt: 'https://a.espncdn.com/i/teamlogos/soccer/500/2980.png',
    bolivar: 'https://a.espncdn.com/i/teamlogos/soccer/500/2681.png',
    bologna: 'https://a.espncdn.com/i/teamlogos/soccer/500/107.png',
    boro: 'https://a.espncdn.com/i/teamlogos/soccer/500/369.png',
    borussiadortmund: 'https://a.espncdn.com/i/teamlogos/soccer/500/124.png',
    borussiamnchengladbach: 'https://a.espncdn.com/i/teamlogos/soccer/500/268.png',
    bostonriver: 'https://a.espncdn.com/i/teamlogos/soccer/500/9999.png',
    botafogo: 'https://a.espncdn.com/i/teamlogos/soccer/500/6086.png',
    botafogosp: 'https://a.espncdn.com/i/teamlogos/soccer/500/10281.png',
    bournemouth: 'https://a.espncdn.com/i/teamlogos/soccer/500/349.png',
    boyacachico: 'https://a.espncdn.com/i/teamlogos/soccer/500/5480.png',
    braga: 'https://a.espncdn.com/i/teamlogos/soccer/500/2994.png',
    bragantino: 'https://a.espncdn.com/i/teamlogos/soccer/500/6079.png',
    bremen: 'https://a.espncdn.com/i/teamlogos/soccer/500/137.png',
    brentford: 'https://a.espncdn.com/i/teamlogos/soccer/500/337.png',
    brest: 'https://a.espncdn.com/i/teamlogos/soccer/500/6997.png',
    brighton: 'https://a.espncdn.com/i/teamlogos/soccer/500/331.png',
    brightonhovealbion: 'https://a.espncdn.com/i/teamlogos/soccer/500/331.png',
    bristolcity: 'https://a.espncdn.com/i/teamlogos/soccer/500/333.png',
    bucaramanga: 'https://a.espncdn.com/i/teamlogos/soccer/500/6137.png',
    bulobulo: 'https://a.espncdn.com/i/teamlogos/soccer/500/22137.png',
    burnley: 'https://a.espncdn.com/i/teamlogos/soccer/500/379.png',
    cagliari: 'https://a.espncdn.com/i/teamlogos/soccer/500/2925.png',
    cajamarca: 'https://a.espncdn.com/i/teamlogos/soccer/500/131655.png',
    cali: 'https://a.espncdn.com/i/teamlogos/soccer/500/2672.png',
    carabobo: 'https://a.espncdn.com/i/teamlogos/soccer/500/6037.png',
    caracas: 'https://a.espncdn.com/i/teamlogos/soccer/500/4811.png',
    caracasfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/4811.png',
    casapia: 'https://a.espncdn.com/i/teamlogos/soccer/500/21581.png',
    ccordobase: 'https://a.espncdn.com/i/teamlogos/soccer/500/11989.png',
    cdnacional: 'https://a.espncdn.com/i/teamlogos/soccer/500/3472.png',
    ceara: 'https://a.espncdn.com/i/teamlogos/soccer/500/9969.png',
    celtavigo: 'https://a.espncdn.com/i/teamlogos/soccer/500/85.png',
    celtic: 'https://a.espncdn.com/i/teamlogos/soccer/500/256.png',
    central: 'https://a.espncdn.com/i/teamlogos/soccer/500/131688.png',
    centralcordobasantiagodelestero: 'https://a.espncdn.com/i/teamlogos/soccer/500/11989.png',
    centralespanol: 'https://a.espncdn.com/i/teamlogos/soccer/500/131688.png',
    centralespanolfutbolclub: 'https://a.espncdn.com/i/teamlogos/soccer/500/131688.png',
    centralnorte: 'https://a.espncdn.com/i/teamlogos/soccer/500/11993.png',
    cerro: 'https://a.espncdn.com/i/teamlogos/soccer/500/5490.png',
    cerrolargo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9902.png',
    cerroporteno: 'https://a.espncdn.com/i/teamlogos/soccer/500/2671.png',
    cfmontreal: 'https://a.espncdn.com/i/teamlogos/soccer/500/9720.png',
    chacarita: 'https://a.espncdn.com/i/teamlogos/soccer/500/6.png',
    chacaritajuniors: 'https://a.espncdn.com/i/teamlogos/soccer/500/6.png',
    chaco: 'https://a.espncdn.com/i/teamlogos/soccer/500/11963.png',
    chacoforever: 'https://a.espncdn.com/i/teamlogos/soccer/500/11963.png',
    chapecoense: 'https://a.espncdn.com/i/teamlogos/soccer/500/9318.png',
    charlotte: 'https://a.espncdn.com/i/teamlogos/soccer/500/21300.png',
    charlottefc: 'https://a.espncdn.com/i/teamlogos/soccer/500/21300.png',
    charlton: 'https://a.espncdn.com/i/teamlogos/soccer/500/372.png',
    charltonathletic: 'https://a.espncdn.com/i/teamlogos/soccer/500/372.png',
    chelsea: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png',
    chicago: 'https://a.espncdn.com/i/teamlogos/soccer/500/182.png',
    chicagofirefc: 'https://a.espncdn.com/i/teamlogos/soccer/500/182.png',
    chicofc: 'https://a.espncdn.com/i/teamlogos/soccer/500/5480.png',
    chivas: 'https://a.espncdn.com/i/teamlogos/soccer/500/219.png',
    cienciano: 'https://a.espncdn.com/i/teamlogos/soccer/500/3372.png',
    ciencianodelcusco: 'https://a.espncdn.com/i/teamlogos/soccer/500/3372.png',
    cincinnati: 'https://a.espncdn.com/i/teamlogos/soccer/500/18267.png',
    cipetrolero: 'https://a.espncdn.com/i/teamlogos/soccer/500/20889.png',
    ciudadbolivar: 'https://a.espncdn.com/i/teamlogos/soccer/500/21799.png',
    ciudaddebolivar: 'https://a.espncdn.com/i/teamlogos/soccer/500/21799.png',
    clubbrugge: 'https://a.espncdn.com/i/teamlogos/soccer/500/570.png',
    clubolimpia: 'https://a.espncdn.com/i/teamlogos/soccer/500/2675.png',
    cobresal: 'https://a.espncdn.com/i/teamlogos/soccer/500/4133.png',
    colegiales: 'https://a.espncdn.com/i/teamlogos/soccer/500/10149.png',
    colocolo: 'https://a.espncdn.com/i/teamlogos/soccer/500/2688.png',
    cologne: 'https://a.espncdn.com/i/teamlogos/soccer/500/122.png',
    colonsantafe: 'https://a.espncdn.com/i/teamlogos/soccer/500/7.png',
    colonsf: 'https://a.espncdn.com/i/teamlogos/soccer/500/7.png',
    colorado: 'https://a.espncdn.com/i/teamlogos/soccer/500/184.png',
    coloradorapids: 'https://a.espncdn.com/i/teamlogos/soccer/500/184.png',
    columbus: 'https://a.espncdn.com/i/teamlogos/soccer/500/183.png',
    columbuscrew: 'https://a.espncdn.com/i/teamlogos/soccer/500/183.png',
    comerciantesunidos: 'https://a.espncdn.com/i/teamlogos/soccer/500/18153.png',
    comerunid: 'https://a.espncdn.com/i/teamlogos/soccer/500/18153.png',
    como: 'https://a.espncdn.com/i/teamlogos/soccer/500/2572.png',
    concepcion: 'https://a.espncdn.com/i/teamlogos/soccer/500/8110.png',
    coquimbo: 'https://a.espncdn.com/i/teamlogos/soccer/500/8186.png',
    coquimbounido: 'https://a.espncdn.com/i/teamlogos/soccer/500/8186.png',
    corinthians: 'https://a.espncdn.com/i/teamlogos/soccer/500/874.png',
    coritiba: 'https://a.espncdn.com/i/teamlogos/soccer/500/3456.png',
    coventry: 'https://a.espncdn.com/i/teamlogos/soccer/500/388.png',
    coventrycity: 'https://a.espncdn.com/i/teamlogos/soccer/500/388.png',
    cpalace: 'https://a.espncdn.com/i/teamlogos/soccer/500/384.png',
    crb: 'https://a.espncdn.com/i/teamlogos/soccer/500/9970.png',
    cremonese: 'https://a.espncdn.com/i/teamlogos/soccer/500/4050.png',
    crew: 'https://a.espncdn.com/i/teamlogos/soccer/500/183.png',
    criciuma: 'https://a.espncdn.com/i/teamlogos/soccer/500/9971.png',
    cruzazul: 'https://a.espncdn.com/i/teamlogos/soccer/500/218.png',
    cruzeiro: 'https://a.espncdn.com/i/teamlogos/soccer/500/2022.png',
    crystalpalace: 'https://a.espncdn.com/i/teamlogos/soccer/500/384.png',
    cucuta: 'https://a.espncdn.com/i/teamlogos/soccer/500/6101.png',
    cucutadeportivo: 'https://a.espncdn.com/i/teamlogos/soccer/500/6101.png',
    cuenca: 'https://a.espncdn.com/i/teamlogos/soccer/500/4812.png',
    cuiaba: 'https://a.espncdn.com/i/teamlogos/soccer/500/17313.png',
    cusco: 'https://a.espncdn.com/i/teamlogos/soccer/500/11995.png',
    cuscofc: 'https://a.espncdn.com/i/teamlogos/soccer/500/11995.png',
    dallas: 'https://a.espncdn.com/i/teamlogos/soccer/500/185.png',
    danubio: 'https://a.espncdn.com/i/teamlogos/soccer/500/4817.png',
    dcunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/193.png',
    defensayjusticia: 'https://a.espncdn.com/i/teamlogos/soccer/500/8950.png',
    defensor: 'https://a.espncdn.com/i/teamlogos/soccer/500/1007.png',
    defensores: 'https://a.espncdn.com/i/teamlogos/soccer/500/10151.png',
    defensoresdebelgrano: 'https://a.espncdn.com/i/teamlogos/soccer/500/10151.png',
    defensorsporting: 'https://a.espncdn.com/i/teamlogos/soccer/500/1007.png',
    defyjus: 'https://a.espncdn.com/i/teamlogos/soccer/500/8950.png',
    delfin: 'https://a.espncdn.com/i/teamlogos/soccer/500/1011.png',
    depmadryn: 'https://a.espncdn.com/i/teamlogos/soccer/500/18260.png',
    depmetropolitano: 'https://a.espncdn.com/i/teamlogos/soccer/500/13481.png',
    deportesconcepcion: 'https://a.espncdn.com/i/teamlogos/soccer/500/8110.png',
    deporteslimache: 'https://a.espncdn.com/i/teamlogos/soccer/500/19195.png',
    deportestolima: 'https://a.espncdn.com/i/teamlogos/soccer/500/5489.png',
    deportivocali: 'https://a.espncdn.com/i/teamlogos/soccer/500/2672.png',
    deportivocuenca: 'https://a.espncdn.com/i/teamlogos/soccer/500/4812.png',
    deportivogarcilaso: 'https://a.espncdn.com/i/teamlogos/soccer/500/21819.png',
    deportivolaguaira: 'https://a.espncdn.com/i/teamlogos/soccer/500/17090.png',
    deportivomadryn: 'https://a.espncdn.com/i/teamlogos/soccer/500/18260.png',
    deportivomaipu: 'https://a.espncdn.com/i/teamlogos/soccer/500/11978.png',
    deportivomaldonado: 'https://a.espncdn.com/i/teamlogos/soccer/500/10000.png',
    deportivomoquegua: 'https://a.espncdn.com/i/teamlogos/soccer/500/131654.png',
    deportivomoron: 'https://a.espncdn.com/i/teamlogos/soccer/500/10154.png',
    deportivopasto: 'https://a.espncdn.com/i/teamlogos/soccer/500/5485.png',
    deportivopereira: 'https://a.espncdn.com/i/teamlogos/soccer/500/5486.png',
    deportivorecoleta: 'https://a.espncdn.com/i/teamlogos/soccer/500/22517.png',
    deportivoriestra: 'https://a.espncdn.com/i/teamlogos/soccer/500/17702.png',
    deportivotachira: 'https://a.espncdn.com/i/teamlogos/soccer/500/4818.png',
    deprecoleta: 'https://a.espncdn.com/i/teamlogos/soccer/500/22517.png',
    derby: 'https://a.espncdn.com/i/teamlogos/soccer/500/374.png',
    derbycounty: 'https://a.espncdn.com/i/teamlogos/soccer/500/374.png',
    dinamozagreb: 'https://a.espncdn.com/i/teamlogos/soccer/500/597.png',
    dortmund: 'https://a.espncdn.com/i/teamlogos/soccer/500/124.png',
    dynamo: 'https://a.espncdn.com/i/teamlogos/soccer/500/6077.png',
    eagles: 'https://a.espncdn.com/i/teamlogos/soccer/500/384.png',
    earthquakes: 'https://a.espncdn.com/i/teamlogos/soccer/500/191.png',
    eintrachtfrankfurt: 'https://a.espncdn.com/i/teamlogos/soccer/500/125.png',
    elche: 'https://a.espncdn.com/i/teamlogos/soccer/500/3751.png',
    emelec: 'https://a.espncdn.com/i/teamlogos/soccer/500/2668.png',
    espanyol: 'https://a.espncdn.com/i/teamlogos/soccer/500/88.png',
    estoril: 'https://a.espncdn.com/i/teamlogos/soccer/500/12216.png',
    estrela: 'https://a.espncdn.com/i/teamlogos/soccer/500/21610.png',
    estudiantes: 'https://a.espncdn.com/i/teamlogos/soccer/500/8.png',
    estudiantesbuenosaires: 'https://a.espncdn.com/i/teamlogos/soccer/500/17352.png',
    estudiantesdelaplata: 'https://a.espncdn.com/i/teamlogos/soccer/500/8.png',
    estudiantesderiocuarto: 'https://a.espncdn.com/i/teamlogos/soccer/500/19685.png',
    estudiantesrc: 'https://a.espncdn.com/i/teamlogos/soccer/500/19685.png',
    everton: 'https://a.espncdn.com/i/teamlogos/soccer/500/368.png',
    evertoncd: 'https://a.espncdn.com/i/teamlogos/soccer/500/4129.png',
    excelsior: 'https://a.espncdn.com/i/teamlogos/soccer/500/2566.png',
    fcaugsburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/3841.png',
    fcbasel: 'https://a.espncdn.com/i/teamlogos/soccer/500/989.png',
    fccajamarca: 'https://a.espncdn.com/i/teamlogos/soccer/500/131655.png',
    fccincinnati: 'https://a.espncdn.com/i/teamlogos/soccer/500/18267.png',
    fccologne: 'https://a.espncdn.com/i/teamlogos/soccer/500/122.png',
    fcdallas: 'https://a.espncdn.com/i/teamlogos/soccer/500/185.png',
    fcfamalicao: 'https://a.espncdn.com/i/teamlogos/soccer/500/12698.png',
    fcgroningen: 'https://a.espncdn.com/i/teamlogos/soccer/500/145.png',
    fcjuarez: 'https://a.espncdn.com/i/teamlogos/soccer/500/17851.png',
    fckbenhavn: 'https://a.espncdn.com/i/teamlogos/soccer/500/909.png',
    fcmidtjylland: 'https://a.espncdn.com/i/teamlogos/soccer/500/572.png',
    fcporto: 'https://a.espncdn.com/i/teamlogos/soccer/500/437.png',
    fcsb: 'https://a.espncdn.com/i/teamlogos/soccer/500/484.png',
    fctwente: 'https://a.espncdn.com/i/teamlogos/soccer/500/152.png',
    fcutrecht: 'https://a.espncdn.com/i/teamlogos/soccer/500/153.png',
    fcvolendam: 'https://a.espncdn.com/i/teamlogos/soccer/500/2727.png',
    fenerbahce: 'https://a.espncdn.com/i/teamlogos/soccer/500/436.png',
    ferencvaros: 'https://a.espncdn.com/i/teamlogos/soccer/500/622.png',
    ferro: 'https://a.espncdn.com/i/teamlogos/soccer/500/9743.png',
    ferrocarriloeste: 'https://a.espncdn.com/i/teamlogos/soccer/500/9743.png',
    feyenoord: 'https://a.espncdn.com/i/teamlogos/soccer/500/142.png',
    feyenoordrotterdam: 'https://a.espncdn.com/i/teamlogos/soccer/500/142.png',
    fiorentina: 'https://a.espncdn.com/i/teamlogos/soccer/500/109.png',
    fire: 'https://a.espncdn.com/i/teamlogos/soccer/500/182.png',
    fkqarabag: 'https://a.espncdn.com/i/teamlogos/soccer/500/10414.png',
    flamengo: 'https://a.espncdn.com/i/teamlogos/soccer/500/819.png',
    fluminense: 'https://a.espncdn.com/i/teamlogos/soccer/500/3445.png',
    fortaleza: 'https://a.espncdn.com/i/teamlogos/soccer/500/6272.png',
    fortalezaceif: 'https://a.espncdn.com/i/teamlogos/soccer/500/4928.png',
    fortuna: 'https://a.espncdn.com/i/teamlogos/soccer/500/143.png',
    fortunasittard: 'https://a.espncdn.com/i/teamlogos/soccer/500/143.png',
    foxes: 'https://a.espncdn.com/i/teamlogos/soccer/500/375.png',
    frankfurt: 'https://a.espncdn.com/i/teamlogos/soccer/500/125.png',
    freiburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/126.png',
    fulham: 'https://a.espncdn.com/i/teamlogos/soccer/500/370.png',
    galatasaray: 'https://a.espncdn.com/i/teamlogos/soccer/500/432.png',
    galaxy: 'https://a.espncdn.com/i/teamlogos/soccer/500/187.png',
    garcilaso: 'https://a.espncdn.com/i/teamlogos/soccer/500/21819.png',
    gemes: 'https://a.espncdn.com/i/teamlogos/soccer/500/18284.png',
    genk: 'https://a.espncdn.com/i/teamlogos/soccer/500/938.png',
    genoa: 'https://a.espncdn.com/i/teamlogos/soccer/500/3263.png',
    getafe: 'https://a.espncdn.com/i/teamlogos/soccer/500/2922.png',
    gilvicente: 'https://a.espncdn.com/i/teamlogos/soccer/500/3699.png',
    gimnasiaj: 'https://a.espncdn.com/i/teamlogos/soccer/500/5263.png',
    gimnasialaplata: 'https://a.espncdn.com/i/teamlogos/soccer/500/9.png',
    gimnasialp: 'https://a.espncdn.com/i/teamlogos/soccer/500/9.png',
    gimnasiam: 'https://a.espncdn.com/i/teamlogos/soccer/500/11972.png',
    gimnasiamendoza: 'https://a.espncdn.com/i/teamlogos/soccer/500/11972.png',
    gimnasiayesgrimajujuy: 'https://a.espncdn.com/i/teamlogos/soccer/500/5263.png',
    gimnasiaytirosalta: 'https://a.espncdn.com/i/teamlogos/soccer/500/10743.png',
    girona: 'https://a.espncdn.com/i/teamlogos/soccer/500/9812.png',
    gladbach: 'https://a.espncdn.com/i/teamlogos/soccer/500/268.png',
    goaheadeagles: 'https://a.espncdn.com/i/teamlogos/soccer/500/3706.png',
    godoycruz: 'https://a.espncdn.com/i/teamlogos/soccer/500/6756.png',
    godoycruzantoniotomba: 'https://a.espncdn.com/i/teamlogos/soccer/500/6756.png',
    goias: 'https://a.espncdn.com/i/teamlogos/soccer/500/3395.png',
    grmio: 'https://a.espncdn.com/i/teamlogos/soccer/500/6273.png',
    guabira: 'https://a.espncdn.com/i/teamlogos/soccer/500/9497.png',
    guadalajara: 'https://a.espncdn.com/i/teamlogos/soccer/500/219.png',
    guarani: 'https://a.espncdn.com/i/teamlogos/soccer/500/7385.png',
    guayaquil: 'https://a.espncdn.com/i/teamlogos/soccer/500/11124.png',
    guayaquilcityfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/11124.png',
    gunners: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
    gvsanjose: 'https://a.espncdn.com/i/teamlogos/soccer/500/22174.png',
    gytsalta: 'https://a.espncdn.com/i/teamlogos/soccer/500/10743.png',
    hamburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/127.png',
    hamburgsv: 'https://a.espncdn.com/i/teamlogos/soccer/500/127.png',
    hammersiron: 'https://a.espncdn.com/i/teamlogos/soccer/500/371.png',
    heerenveen: 'https://a.espncdn.com/i/teamlogos/soccer/500/146.png',
    heidenheim: 'https://a.espncdn.com/i/teamlogos/soccer/500/6418.png',
    hellasverona: 'https://a.espncdn.com/i/teamlogos/soccer/500/119.png',
    heracles: 'https://a.espncdn.com/i/teamlogos/soccer/500/3708.png',
    heraclesalmelo: 'https://a.espncdn.com/i/teamlogos/soccer/500/3708.png',
    hoffenheim: 'https://a.espncdn.com/i/teamlogos/soccer/500/7911.png',
    houston: 'https://a.espncdn.com/i/teamlogos/soccer/500/6077.png',
    houstondynamofc: 'https://a.espncdn.com/i/teamlogos/soccer/500/6077.png',
    huachipato: 'https://a.espncdn.com/i/teamlogos/soccer/500/4134.png',
    huancayo: 'https://a.espncdn.com/i/teamlogos/soccer/500/10318.png',
    hull: 'https://a.espncdn.com/i/teamlogos/soccer/500/306.png',
    hullcity: 'https://a.espncdn.com/i/teamlogos/soccer/500/306.png',
    huracan: 'https://a.espncdn.com/i/teamlogos/soccer/500/10.png',
    impact: 'https://a.espncdn.com/i/teamlogos/soccer/500/9720.png',
    inddelvalle: 'https://a.espncdn.com/i/teamlogos/soccer/500/17086.png',
    independiente: 'https://a.espncdn.com/i/teamlogos/soccer/500/11.png',
    independientedelvalle: 'https://a.espncdn.com/i/teamlogos/soccer/500/17086.png',
    independientemedellin: 'https://a.espncdn.com/i/teamlogos/soccer/500/2690.png',
    independientepetrolero: 'https://a.espncdn.com/i/teamlogos/soccer/500/20889.png',
    independienterivadavia: 'https://a.espncdn.com/i/teamlogos/soccer/500/9744.png',
    independientesantafe: 'https://a.espncdn.com/i/teamlogos/soccer/500/5488.png',
    indmedellin: 'https://a.espncdn.com/i/teamlogos/soccer/500/2690.png',
    indrivadavia: 'https://a.espncdn.com/i/teamlogos/soccer/500/9744.png',
    instituto: 'https://a.espncdn.com/i/teamlogos/soccer/500/2975.png',
    institutocordoba: 'https://a.espncdn.com/i/teamlogos/soccer/500/2975.png',
    interbogota: 'https://a.espncdn.com/i/teamlogos/soccer/500/7445.png',
    intermiamicf: 'https://a.espncdn.com/i/teamlogos/soccer/500/20232.png',
    intermilan: 'https://a.espncdn.com/i/teamlogos/soccer/500/110.png',
    internacional: 'https://a.espncdn.com/i/teamlogos/soccer/500/1936.png',
    internacionaldebogota: 'https://a.espncdn.com/i/teamlogos/soccer/500/7445.png',
    internazionale: 'https://a.espncdn.com/i/teamlogos/soccer/500/110.png',
    ipswich: 'https://a.espncdn.com/i/teamlogos/soccer/500/373.png',
    ipswichtown: 'https://a.espncdn.com/i/teamlogos/soccer/500/373.png',
    jaguares: 'https://a.espncdn.com/i/teamlogos/soccer/500/10309.png',
    jaguaresdecordoba: 'https://a.espncdn.com/i/teamlogos/soccer/500/10309.png',
    juanpabloii: 'https://a.espncdn.com/i/teamlogos/soccer/500/22534.png',
    juarez: 'https://a.espncdn.com/i/teamlogos/soccer/500/17851.png',
    juventud: 'https://a.espncdn.com/i/teamlogos/soccer/500/8416.png',
    juventude: 'https://a.espncdn.com/i/teamlogos/soccer/500/6270.png',
    juventus: 'https://a.espncdn.com/i/teamlogos/soccer/500/111.png',
    kairatalmaty: 'https://a.espncdn.com/i/teamlogos/soccer/500/2528.png',
    kansascity: 'https://a.espncdn.com/i/teamlogos/soccer/500/186.png',
    kbenhavn: 'https://a.espncdn.com/i/teamlogos/soccer/500/909.png',
    lafc: 'https://a.espncdn.com/i/teamlogos/soccer/500/18966.png',
    lafranja: 'https://a.espncdn.com/i/teamlogos/soccer/500/231.png',
    lagalaxy: 'https://a.espncdn.com/i/teamlogos/soccer/500/187.png',
    laguaira: 'https://a.espncdn.com/i/teamlogos/soccer/500/17090.png',
    lanus: 'https://a.espncdn.com/i/teamlogos/soccer/500/12.png',
    laserena: 'https://a.espncdn.com/i/teamlogos/soccer/500/4137.png',
    lazio: 'https://a.espncdn.com/i/teamlogos/soccer/500/112.png',
    ldu: 'https://a.espncdn.com/i/teamlogos/soccer/500/4816.png',
    lecce: 'https://a.espncdn.com/i/teamlogos/soccer/500/113.png',
    leeds: 'https://a.espncdn.com/i/teamlogos/soccer/500/357.png',
    leedsunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/357.png',
    lehavreac: 'https://a.espncdn.com/i/teamlogos/soccer/500/3236.png',
    leicester: 'https://a.espncdn.com/i/teamlogos/soccer/500/375.png',
    leicestercity: 'https://a.espncdn.com/i/teamlogos/soccer/500/375.png',
    lens: 'https://a.espncdn.com/i/teamlogos/soccer/500/175.png',
    leon: 'https://a.espncdn.com/i/teamlogos/soccer/500/228.png',
    leones: 'https://a.espncdn.com/i/teamlogos/soccer/500/131702.png',
    levante: 'https://a.espncdn.com/i/teamlogos/soccer/500/1538.png',
    leverkusen: 'https://a.espncdn.com/i/teamlogos/soccer/500/131.png',
    libertad: 'https://a.espncdn.com/i/teamlogos/soccer/500/2670.png',
    libertadecuador: 'https://a.espncdn.com/i/teamlogos/soccer/500/21843.png',
    ligadequito: 'https://a.espncdn.com/i/teamlogos/soccer/500/4816.png',
    lille: 'https://a.espncdn.com/i/teamlogos/soccer/500/166.png',
    lilywhites: 'https://a.espncdn.com/i/teamlogos/soccer/500/394.png',
    limache: 'https://a.espncdn.com/i/teamlogos/soccer/500/19195.png',
    lions: 'https://a.espncdn.com/i/teamlogos/soccer/500/391.png',
    liverpool: 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
    liverpoolfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
    lfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
    llaneros: 'https://a.espncdn.com/i/teamlogos/soccer/500/7915.png',
    londrina: 'https://a.espncdn.com/i/teamlogos/soccer/500/17333.png',
    lorient: 'https://a.espncdn.com/i/teamlogos/soccer/500/273.png',
    losandes: 'https://a.espncdn.com/i/teamlogos/soccer/500/13.png',
    loschankas: 'https://a.espncdn.com/i/teamlogos/soccer/500/22168.png',
    ludogorets: 'https://a.espncdn.com/i/teamlogos/soccer/500/13018.png',
    ludogoretsrazgrad: 'https://a.espncdn.com/i/teamlogos/soccer/500/13018.png',
    luqueno: 'https://a.espncdn.com/i/teamlogos/soccer/500/5583.png',
    lyon: 'https://a.espncdn.com/i/teamlogos/soccer/500/167.png',
    macara: 'https://a.espncdn.com/i/teamlogos/soccer/500/18439.png',
    maccabitelaviv: 'https://a.espncdn.com/i/teamlogos/soccer/500/524.png',
    magpiestoon: 'https://a.espncdn.com/i/teamlogos/soccer/500/361.png',
    mainz: 'https://a.espncdn.com/i/teamlogos/soccer/500/2950.png',
    maipu: 'https://a.espncdn.com/i/teamlogos/soccer/500/11978.png',
    maldonado: 'https://a.espncdn.com/i/teamlogos/soccer/500/10000.png',
    mallorca: 'https://a.espncdn.com/i/teamlogos/soccer/500/84.png',
    malm: 'https://a.espncdn.com/i/teamlogos/soccer/500/2720.png',
    malmff: 'https://a.espncdn.com/i/teamlogos/soccer/500/2720.png',
    manchestercity: 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
    manchesterunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
    mancity: 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
    mantafc: 'https://a.espncdn.com/i/teamlogos/soccer/500/10307.png',
    manunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
    marseille: 'https://a.espncdn.com/i/teamlogos/soccer/500/176.png',
    mazatlan: 'https://a.espncdn.com/i/teamlogos/soccer/500/20702.png',
    mazatlanfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/20702.png',
    mctorque: 'https://a.espncdn.com/i/teamlogos/soccer/500/19002.png',
    melgar: 'https://a.espncdn.com/i/teamlogos/soccer/500/7312.png',
    metropolitanos: 'https://a.espncdn.com/i/teamlogos/soccer/500/13481.png',
    metropolitanosfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/13481.png',
    metz: 'https://a.espncdn.com/i/teamlogos/soccer/500/177.png',
    miami: 'https://a.espncdn.com/i/teamlogos/soccer/500/20232.png',
    middlesbrough: 'https://a.espncdn.com/i/teamlogos/soccer/500/369.png',
    midland: 'https://a.espncdn.com/i/teamlogos/soccer/500/10109.png',
    midtjylland: 'https://a.espncdn.com/i/teamlogos/soccer/500/572.png',
    milan: 'https://a.espncdn.com/i/teamlogos/soccer/500/103.png',
    millonarios: 'https://a.espncdn.com/i/teamlogos/soccer/500/5484.png',
    millwall: 'https://a.espncdn.com/i/teamlogos/soccer/500/391.png',
    minnesota: 'https://a.espncdn.com/i/teamlogos/soccer/500/17362.png',
    minnesotaunitedfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/17362.png',
    mirassol: 'https://a.espncdn.com/i/teamlogos/soccer/500/9169.png',
    mitresantiagodelestero: 'https://a.espncdn.com/i/teamlogos/soccer/500/11990.png',
    mitrese: 'https://a.espncdn.com/i/teamlogos/soccer/500/11990.png',
    monaco: 'https://a.espncdn.com/i/teamlogos/soccer/500/174.png',
    monagas: 'https://a.espncdn.com/i/teamlogos/soccer/500/6041.png',
    monagassc: 'https://a.espncdn.com/i/teamlogos/soccer/500/6041.png',
    monterrey: 'https://a.espncdn.com/i/teamlogos/soccer/500/220.png',
    montevideocitytorque: 'https://a.espncdn.com/i/teamlogos/soccer/500/19002.png',
    montevideowanderers: 'https://a.espncdn.com/i/teamlogos/soccer/500/5501.png',
    moquegua: 'https://a.espncdn.com/i/teamlogos/soccer/500/131654.png',
    moreirense: 'https://a.espncdn.com/i/teamlogos/soccer/500/3696.png',
    moron: 'https://a.espncdn.com/i/teamlogos/soccer/500/10154.png',
    mushucruna: 'https://a.espncdn.com/i/teamlogos/soccer/500/17176.png',
    nacbreda: 'https://a.espncdn.com/i/teamlogos/soccer/500/141.png',
    nacional: 'https://a.espncdn.com/i/teamlogos/soccer/500/2684.png',
    nacionalpotosi: 'https://a.espncdn.com/i/teamlogos/soccer/500/10311.png',
    nantes: 'https://a.espncdn.com/i/teamlogos/soccer/500/165.png',
    napoli: 'https://a.espncdn.com/i/teamlogos/soccer/500/114.png',
    nashville: 'https://a.espncdn.com/i/teamlogos/soccer/500/18986.png',
    nashvillesc: 'https://a.espncdn.com/i/teamlogos/soccer/500/18986.png',
    nautico: 'https://a.espncdn.com/i/teamlogos/soccer/500/7633.png',
    nchicago: 'https://a.espncdn.com/i/teamlogos/soccer/500/236.png',
    nec: 'https://a.espncdn.com/i/teamlogos/soccer/500/147.png',
    necaxa: 'https://a.espncdn.com/i/teamlogos/soccer/500/229.png',
    necnijmegen: 'https://a.espncdn.com/i/teamlogos/soccer/500/147.png',
    newcastle: 'https://a.espncdn.com/i/teamlogos/soccer/500/361.png',
    newcastleunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/361.png',
    newells: 'https://a.espncdn.com/i/teamlogos/soccer/500/14.png',
    newellsoldboys: 'https://a.espncdn.com/i/teamlogos/soccer/500/14.png',
    newengland: 'https://a.espncdn.com/i/teamlogos/soccer/500/189.png',
    newenglandrevolution: 'https://a.espncdn.com/i/teamlogos/soccer/500/189.png',
    newyorkcityfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/17606.png',
    nice: 'https://a.espncdn.com/i/teamlogos/soccer/500/2502.png',
    norwichcity: 'https://a.espncdn.com/i/teamlogos/soccer/500/381.png',
    nottinghamf: 'https://a.espncdn.com/i/teamlogos/soccer/500/393.png',
    nottinghamforest: 'https://a.espncdn.com/i/teamlogos/soccer/500/393.png',
    nottmforest: 'https://a.espncdn.com/i/teamlogos/soccer/500/393.png',
    novorizontino: 'https://a.espncdn.com/i/teamlogos/soccer/500/18127.png',
    npotosi: 'https://a.espncdn.com/i/teamlogos/soccer/500/10311.png',
    nublense: 'https://a.espncdn.com/i/teamlogos/soccer/500/7427.png',
    nuevachicago: 'https://a.espncdn.com/i/teamlogos/soccer/500/236.png',
    nycfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/17606.png',
    ohiggins: 'https://a.espncdn.com/i/teamlogos/soccer/500/6072.png',
    olimpia: 'https://a.espncdn.com/i/teamlogos/soccer/500/2675.png',
    olympiacos: 'https://a.espncdn.com/i/teamlogos/soccer/500/435.png',
    oncecaldas: 'https://a.espncdn.com/i/teamlogos/soccer/500/2919.png',
    operariopr: 'https://a.espncdn.com/i/teamlogos/soccer/500/18187.png',
    orense: 'https://a.espncdn.com/i/teamlogos/soccer/500/20695.png',
    oriente: 'https://a.espncdn.com/i/teamlogos/soccer/500/2682.png',
    orientepetrolero: 'https://a.espncdn.com/i/teamlogos/soccer/500/2682.png',
    orlando: 'https://a.espncdn.com/i/teamlogos/soccer/500/12011.png',
    orlandocitysc: 'https://a.espncdn.com/i/teamlogos/soccer/500/12011.png',
    osasuna: 'https://a.espncdn.com/i/teamlogos/soccer/500/97.png',
    owls: 'https://a.espncdn.com/i/teamlogos/soccer/500/399.png',
    oxfordunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/311.png',
    oxfordutd: 'https://a.espncdn.com/i/teamlogos/soccer/500/311.png',
    pachuca: 'https://a.espncdn.com/i/teamlogos/soccer/500/234.png',
    pafos: 'https://a.espncdn.com/i/teamlogos/soccer/500/22281.png',
    palestino: 'https://a.espncdn.com/i/teamlogos/soccer/500/4422.png',
    palmeiras: 'https://a.espncdn.com/i/teamlogos/soccer/500/2029.png',
    panathinaikos: 'https://a.espncdn.com/i/teamlogos/soccer/500/443.png',
    panzasverdes: 'https://a.espncdn.com/i/teamlogos/soccer/500/228.png',
    paok: 'https://a.espncdn.com/i/teamlogos/soccer/500/605.png',
    paoksalonika: 'https://a.espncdn.com/i/teamlogos/soccer/500/605.png',
    parisfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/6851.png',
    parissaintgermain: 'https://a.espncdn.com/i/teamlogos/soccer/500/160.png',
    parma: 'https://a.espncdn.com/i/teamlogos/soccer/500/115.png',
    pasto: 'https://a.espncdn.com/i/teamlogos/soccer/500/5485.png',
    patronato: 'https://a.espncdn.com/i/teamlogos/soccer/500/10374.png',
    peczwolle: 'https://a.espncdn.com/i/teamlogos/soccer/500/2565.png',
    penarol: 'https://a.espncdn.com/i/teamlogos/soccer/500/2683.png',
    pereira: 'https://a.espncdn.com/i/teamlogos/soccer/500/5486.png',
    philadelphia: 'https://a.espncdn.com/i/teamlogos/soccer/500/10739.png',
    philadelphiaunion: 'https://a.espncdn.com/i/teamlogos/soccer/500/10739.png',
    pisa: 'https://a.espncdn.com/i/teamlogos/soccer/500/3956.png',
    platense: 'https://a.espncdn.com/i/teamlogos/soccer/500/7764.png',
    pompey: 'https://a.espncdn.com/i/teamlogos/soccer/500/385.png',
    pontepreta: 'https://a.espncdn.com/i/teamlogos/soccer/500/3459.png',
    portland: 'https://a.espncdn.com/i/teamlogos/soccer/500/9723.png',
    portlandtimbers: 'https://a.espncdn.com/i/teamlogos/soccer/500/9723.png',
    portsmouth: 'https://a.espncdn.com/i/teamlogos/soccer/500/385.png',
    potters: 'https://a.espncdn.com/i/teamlogos/soccer/500/336.png',
    preston: 'https://a.espncdn.com/i/teamlogos/soccer/500/394.png',
    prestonnorthend: 'https://a.espncdn.com/i/teamlogos/soccer/500/394.png',
    progreso: 'https://a.espncdn.com/i/teamlogos/soccer/500/6866.png',
    psg: 'https://a.espncdn.com/i/teamlogos/soccer/500/160.png',
    psv: 'https://a.espncdn.com/i/teamlogos/soccer/500/148.png',
    psveindhoven: 'https://a.espncdn.com/i/teamlogos/soccer/500/148.png',
    puebla: 'https://a.espncdn.com/i/teamlogos/soccer/500/231.png',
    puertocabello: 'https://a.espncdn.com/i/teamlogos/soccer/500/18995.png',
    pumas: 'https://a.espncdn.com/i/teamlogos/soccer/500/233.png',
    pumasunam: 'https://a.espncdn.com/i/teamlogos/soccer/500/233.png',
    qpr: 'https://a.espncdn.com/i/teamlogos/soccer/500/334.png',
    queensparkrangers: 'https://a.espncdn.com/i/teamlogos/soccer/500/334.png',
    queretaro: 'https://a.espncdn.com/i/teamlogos/soccer/500/222.png',
    quilmes: 'https://a.espncdn.com/i/teamlogos/soccer/500/2741.png',
    racing: 'https://a.espncdn.com/i/teamlogos/soccer/500/15.png',
    racingclub: 'https://a.espncdn.com/i/teamlogos/soccer/500/15.png',
    racingcordoba: 'https://a.espncdn.com/i/teamlogos/soccer/500/19145.png',
    racinggenk: 'https://a.espncdn.com/i/teamlogos/soccer/500/938.png',
    racingm: 'https://a.espncdn.com/i/teamlogos/soccer/500/9903.png',
    racingmontevideo: 'https://a.espncdn.com/i/teamlogos/soccer/500/9903.png',
    rafaela: 'https://a.espncdn.com/i/teamlogos/soccer/500/9747.png',
    rangers: 'https://a.espncdn.com/i/teamlogos/soccer/500/334.png',
    rapids: 'https://a.espncdn.com/i/teamlogos/soccer/500/184.png',
    rayados: 'https://a.espncdn.com/i/teamlogos/soccer/500/220.png',
    rayo: 'https://a.espncdn.com/i/teamlogos/soccer/500/101.png',
    rayos: 'https://a.espncdn.com/i/teamlogos/soccer/500/229.png',
    rayovallecano: 'https://a.espncdn.com/i/teamlogos/soccer/500/101.png',
    rbleipzig: 'https://a.espncdn.com/i/teamlogos/soccer/500/11420.png',
    rbsalzburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/2790.png',
    realbetis: 'https://a.espncdn.com/i/teamlogos/soccer/500/244.png',
    realmadrid: 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png',
    realoruro: 'https://a.espncdn.com/i/teamlogos/soccer/500/22523.png',
    realoviedo: 'https://a.espncdn.com/i/teamlogos/soccer/500/92.png',
    realpotosi: 'https://a.espncdn.com/i/teamlogos/soccer/500/6051.png',
    realsaltlake: 'https://a.espncdn.com/i/teamlogos/soccer/500/4771.png',
    realsociedad: 'https://a.espncdn.com/i/teamlogos/soccer/500/89.png',
    realtomayapo: 'https://a.espncdn.com/i/teamlogos/soccer/500/20890.png',
    redbullbragantino: 'https://a.espncdn.com/i/teamlogos/soccer/500/6079.png',
    redbullnewyork: 'https://a.espncdn.com/i/teamlogos/soccer/500/190.png',
    redbullny: 'https://a.espncdn.com/i/teamlogos/soccer/500/190.png',
    redbulls: 'https://a.espncdn.com/i/teamlogos/soccer/500/190.png',
    reddevils: 'https://a.espncdn.com/i/teamlogos/soccer/500/360.png',
    reds: 'https://a.espncdn.com/i/teamlogos/soccer/500/364.png',
    redstar: 'https://a.espncdn.com/i/teamlogos/soccer/500/2290.png',
    redstarbelgrade: 'https://a.espncdn.com/i/teamlogos/soccer/500/2290.png',
    remo: 'https://a.espncdn.com/i/teamlogos/soccer/500/4936.png',
    rennes: 'https://a.espncdn.com/i/teamlogos/soccer/500/169.png',
    revolution: 'https://a.espncdn.com/i/teamlogos/soccer/500/189.png',
    riestra: 'https://a.espncdn.com/i/teamlogos/soccer/500/17702.png',
    rioave: 'https://a.espncdn.com/i/teamlogos/soccer/500/3822.png',
    rivere: 'https://a.espncdn.com/i/teamlogos/soccer/500/11124.png',
    riverplate: 'https://a.espncdn.com/i/teamlogos/soccer/500/16.png',
    robins: 'https://a.espncdn.com/i/teamlogos/soccer/500/333.png',
    rojos: 'https://a.espncdn.com/i/teamlogos/soccer/500/223.png',
    rosariocentral: 'https://a.espncdn.com/i/teamlogos/soccer/500/17.png',
    rovers: 'https://a.espncdn.com/i/teamlogos/soccer/500/365.png',
    rubionu: 'https://a.espncdn.com/i/teamlogos/soccer/500/10080.png',
    saints: 'https://a.espncdn.com/i/teamlogos/soccer/500/376.png',
    saltlake: 'https://a.espncdn.com/i/teamlogos/soccer/500/4771.png',
    sanantoniobulobulo: 'https://a.espncdn.com/i/teamlogos/soccer/500/22137.png',
    sandiego: 'https://a.espncdn.com/i/teamlogos/soccer/500/22529.png',
    sandiegofc: 'https://a.espncdn.com/i/teamlogos/soccer/500/22529.png',
    sanjose: 'https://a.espncdn.com/i/teamlogos/soccer/500/191.png',
    sanjoseearthquakes: 'https://a.espncdn.com/i/teamlogos/soccer/500/191.png',
    sanlorenzo: 'https://a.espncdn.com/i/teamlogos/soccer/500/18.png',
    sanmartinsanjuan: 'https://a.espncdn.com/i/teamlogos/soccer/500/7845.png',
    sanmartinsj: 'https://a.espncdn.com/i/teamlogos/soccer/500/7845.png',
    sanmartint: 'https://a.espncdn.com/i/teamlogos/soccer/500/17814.png',
    sanmartintucuman: 'https://a.espncdn.com/i/teamlogos/soccer/500/17814.png',
    sanmiguel: 'https://a.espncdn.com/i/teamlogos/soccer/500/10058.png',
    santaclara: 'https://a.espncdn.com/i/teamlogos/soccer/500/12215.png',
    santafe: 'https://a.espncdn.com/i/teamlogos/soccer/500/5488.png',
    santelmo: 'https://a.espncdn.com/i/teamlogos/soccer/500/10157.png',
    santos: 'https://a.espncdn.com/i/teamlogos/soccer/500/2674.png',
    santoslaguna: 'https://a.espncdn.com/i/teamlogos/soccer/500/225.png',
    saobernardo: 'https://a.espncdn.com/i/teamlogos/soccer/500/11268.png',
    sarmientoj: 'https://a.espncdn.com/i/teamlogos/soccer/500/10158.png',
    sarmientojunin: 'https://a.espncdn.com/i/teamlogos/soccer/500/10158.png',
    sassuolo: 'https://a.espncdn.com/i/teamlogos/soccer/500/3997.png',
    scfreiburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/126.png',
    seagulls: 'https://a.espncdn.com/i/teamlogos/soccer/500/331.png',
    seattle: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png',
    seattlesoundersfc: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png',
    sevilla: 'https://a.espncdn.com/i/teamlogos/soccer/500/243.png',
    sheffieldunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/398.png',
    sheffieldutd: 'https://a.espncdn.com/i/teamlogos/soccer/500/398.png',
    sheffieldwed: 'https://a.espncdn.com/i/teamlogos/soccer/500/399.png',
    sheffieldwednesday: 'https://a.espncdn.com/i/teamlogos/soccer/500/399.png',
    skbrann: 'https://a.espncdn.com/i/teamlogos/soccer/500/620.png',
    sksturmgraz: 'https://a.espncdn.com/i/teamlogos/soccer/500/3746.png',
    skyblues: 'https://a.espncdn.com/i/teamlogos/soccer/500/382.png',
    slaviaprague: 'https://a.espncdn.com/i/teamlogos/soccer/500/494.png',
    sobernardo: 'https://a.espncdn.com/i/teamlogos/soccer/500/11268.png',
    sopaulo: 'https://a.espncdn.com/i/teamlogos/soccer/500/2026.png',
    sounders: 'https://a.espncdn.com/i/teamlogos/soccer/500/9726.png',
    southampton: 'https://a.espncdn.com/i/teamlogos/soccer/500/376.png',
    sparta: 'https://a.espncdn.com/i/teamlogos/soccer/500/151.png',
    spartarotterdam: 'https://a.espncdn.com/i/teamlogos/soccer/500/151.png',
    sport: 'https://a.espncdn.com/i/teamlogos/soccer/500/7635.png',
    sportboys: 'https://a.espncdn.com/i/teamlogos/soccer/500/5570.png',
    sporthuancayo: 'https://a.espncdn.com/i/teamlogos/soccer/500/10318.png',
    sporting: 'https://a.espncdn.com/i/teamlogos/soccer/500/2250.png',
    sportingcp: 'https://a.espncdn.com/i/teamlogos/soccer/500/2250.png',
    sportingcristal: 'https://a.espncdn.com/i/teamlogos/soccer/500/2673.png',
    sportingkansascity: 'https://a.espncdn.com/i/teamlogos/soccer/500/186.png',
    sportivoameliano: 'https://a.espncdn.com/i/teamlogos/soccer/500/21313.png',
    sportivoluqueno: 'https://a.espncdn.com/i/teamlogos/soccer/500/5583.png',
    sportivosanlorenzo: 'https://a.espncdn.com/i/teamlogos/soccer/500/17671.png',
    spurs: 'https://a.espncdn.com/i/teamlogos/soccer/500/367.png',
    staderennais: 'https://a.espncdn.com/i/teamlogos/soccer/500/169.png',
    stlouis: 'https://a.espncdn.com/i/teamlogos/soccer/500/21812.png',
    stlouiscitysc: 'https://a.espncdn.com/i/teamlogos/soccer/500/21812.png',
    stoke: 'https://a.espncdn.com/i/teamlogos/soccer/500/336.png',
    stokecity: 'https://a.espncdn.com/i/teamlogos/soccer/500/336.png',
    stpauli: 'https://a.espncdn.com/i/teamlogos/soccer/500/270.png',
    strasbourg: 'https://a.espncdn.com/i/teamlogos/soccer/500/180.png',
    strongest: 'https://a.espncdn.com/i/teamlogos/soccer/500/2687.png',
    sturmgraz: 'https://a.espncdn.com/i/teamlogos/soccer/500/3746.png',
    stuttgart: 'https://a.espncdn.com/i/teamlogos/soccer/500/134.png',
    sunderland: 'https://a.espncdn.com/i/teamlogos/soccer/500/366.png',
    swans: 'https://a.espncdn.com/i/teamlogos/soccer/500/318.png',
    swansea: 'https://a.espncdn.com/i/teamlogos/soccer/500/318.png',
    swanseacity: 'https://a.espncdn.com/i/teamlogos/soccer/500/318.png',
    tachira: 'https://a.espncdn.com/i/teamlogos/soccer/500/4818.png',
    talleres: 'https://a.espncdn.com/i/teamlogos/soccer/500/19.png',
    tallerescordoba: 'https://a.espncdn.com/i/teamlogos/soccer/500/19.png',
    tecnicou: 'https://a.espncdn.com/i/teamlogos/soccer/500/9292.png',
    tecnicouniversitario: 'https://a.espncdn.com/i/teamlogos/soccer/500/9292.png',
    telstar: 'https://a.espncdn.com/i/teamlogos/soccer/500/3735.png',
    temperley: 'https://a.espncdn.com/i/teamlogos/soccer/500/10162.png',
    thestrongest: 'https://a.espncdn.com/i/teamlogos/soccer/500/2687.png',
    tigers: 'https://a.espncdn.com/i/teamlogos/soccer/500/306.png',
    tigre: 'https://a.espncdn.com/i/teamlogos/soccer/500/7767.png',
    tigres: 'https://a.espncdn.com/i/teamlogos/soccer/500/232.png',
    tigresuanl: 'https://a.espncdn.com/i/teamlogos/soccer/500/232.png',
    tijuana: 'https://a.espncdn.com/i/teamlogos/soccer/500/10125.png',
    timbers: 'https://a.espncdn.com/i/teamlogos/soccer/500/9723.png',
    toffees: 'https://a.espncdn.com/i/teamlogos/soccer/500/368.png',
    tolima: 'https://a.espncdn.com/i/teamlogos/soccer/500/5489.png',
    toluca: 'https://a.espncdn.com/i/teamlogos/soccer/500/223.png',
    tomayapo: 'https://a.espncdn.com/i/teamlogos/soccer/500/20890.png',
    tondela: 'https://a.espncdn.com/i/teamlogos/soccer/500/12706.png',
    torino: 'https://a.espncdn.com/i/teamlogos/soccer/500/239.png',
    toronto: 'https://a.espncdn.com/i/teamlogos/soccer/500/7318.png',
    torontofc: 'https://a.espncdn.com/i/teamlogos/soccer/500/7318.png',
    tottenhamhotspur: 'https://a.espncdn.com/i/teamlogos/soccer/500/367.png',
    toulouse: 'https://a.espncdn.com/i/teamlogos/soccer/500/179.png',
    tractorboys: 'https://a.espncdn.com/i/teamlogos/soccer/500/373.png',
    trinidense: 'https://a.espncdn.com/i/teamlogos/soccer/500/7466.png',
    tristansuarez: 'https://a.espncdn.com/i/teamlogos/soccer/500/10163.png',
    tsghoffenheim: 'https://a.espncdn.com/i/teamlogos/soccer/500/7911.png',
    tsuarez: 'https://a.espncdn.com/i/teamlogos/soccer/500/10163.png',
    ucatolica: 'https://a.espncdn.com/i/teamlogos/soccer/500/885.png',
    uconcepcion: 'https://a.espncdn.com/i/teamlogos/soccer/500/5362.png',
    ucv: 'https://a.espncdn.com/i/teamlogos/soccer/500/10094.png',
    udechile: 'https://a.espncdn.com/i/teamlogos/soccer/500/4139.png',
    udinese: 'https://a.espncdn.com/i/teamlogos/soccer/500/118.png',
    unam: 'https://a.espncdn.com/i/teamlogos/soccer/500/233.png',
    union: 'https://a.espncdn.com/i/teamlogos/soccer/500/10739.png',
    unionberlin: 'https://a.espncdn.com/i/teamlogos/soccer/500/598.png',
    unionlacalera: 'https://a.espncdn.com/i/teamlogos/soccer/500/10144.png',
    unionsantafe: 'https://a.espncdn.com/i/teamlogos/soccer/500/20.png',
    unionsf: 'https://a.espncdn.com/i/teamlogos/soccer/500/20.png',
    unionsg: 'https://a.espncdn.com/i/teamlogos/soccer/500/5807.png',
    unionstgilloise: 'https://a.espncdn.com/i/teamlogos/soccer/500/5807.png',
    united: 'https://a.espncdn.com/i/teamlogos/soccer/500/193.png',
    univdevinto: 'https://a.espncdn.com/i/teamlogos/soccer/500/21379.png',
    universidadcatolica: 'https://a.espncdn.com/i/teamlogos/soccer/500/885.png',
    universidadcatolicaquito: 'https://a.espncdn.com/i/teamlogos/soccer/500/9283.png',
    universidadcentral: 'https://a.espncdn.com/i/teamlogos/soccer/500/10094.png',
    universidaddechile: 'https://a.espncdn.com/i/teamlogos/soccer/500/4139.png',
    universidaddeconcepcion: 'https://a.espncdn.com/i/teamlogos/soccer/500/5362.png',
    universitario: 'https://a.espncdn.com/i/teamlogos/soccer/500/2685.png',
    universitariodevinto: 'https://a.espncdn.com/i/teamlogos/soccer/500/21379.png',
    us: 'https://a.espncdn.com/i/teamlogos/soccer/500/311.png',
    utc: 'https://a.espncdn.com/i/teamlogos/soccer/500/10122.png',
    valencia: 'https://a.espncdn.com/i/teamlogos/soccer/500/94.png',
    vancouver: 'https://a.espncdn.com/i/teamlogos/soccer/500/9727.png',
    vancouverwhitecaps: 'https://a.espncdn.com/i/teamlogos/soccer/500/9727.png',
    vasco: 'https://a.espncdn.com/i/teamlogos/soccer/500/3454.png',
    vascodagama: 'https://a.espncdn.com/i/teamlogos/soccer/500/3454.png',
    velez: 'https://a.espncdn.com/i/teamlogos/soccer/500/21.png',
    velezsarsfield: 'https://a.espncdn.com/i/teamlogos/soccer/500/21.png',
    verona: 'https://a.espncdn.com/i/teamlogos/soccer/500/119.png',
    vfbstuttgart: 'https://a.espncdn.com/i/teamlogos/soccer/500/134.png',
    vflwolfsburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/138.png',
    viktoriaplzen: 'https://a.espncdn.com/i/teamlogos/soccer/500/11706.png',
    vilanova: 'https://a.espncdn.com/i/teamlogos/soccer/500/9973.png',
    villarreal: 'https://a.espncdn.com/i/teamlogos/soccer/500/102.png',
    vitoria: 'https://a.espncdn.com/i/teamlogos/soccer/500/3457.png',
    vitoriadeguimaraes: 'https://a.espncdn.com/i/teamlogos/soccer/500/5309.png',
    wanderers: 'https://a.espncdn.com/i/teamlogos/soccer/500/5501.png',
    watford: 'https://a.espncdn.com/i/teamlogos/soccer/500/395.png',
    werderbremen: 'https://a.espncdn.com/i/teamlogos/soccer/500/137.png',
    westbrom: 'https://a.espncdn.com/i/teamlogos/soccer/500/383.png',
    westbromwichalbion: 'https://a.espncdn.com/i/teamlogos/soccer/500/383.png',
    westham: 'https://a.espncdn.com/i/teamlogos/soccer/500/371.png',
    westhamunited: 'https://a.espncdn.com/i/teamlogos/soccer/500/371.png',
    whitecaps: 'https://a.espncdn.com/i/teamlogos/soccer/500/9727.png',
    wolfsburg: 'https://a.espncdn.com/i/teamlogos/soccer/500/138.png',
    wolverhamptonwanderers: 'https://a.espncdn.com/i/teamlogos/soccer/500/380.png',
    wolves: 'https://a.espncdn.com/i/teamlogos/soccer/500/380.png',
    wrexham: 'https://a.espncdn.com/i/teamlogos/soccer/500/352.png',
    youngboys: 'https://a.espncdn.com/i/teamlogos/soccer/500/2722.png',

      // NBA — ESPN CDN (verified live against ESPN nba teams feed)
      lakers:        'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
      celtics:       'https://a.espncdn.com/i/teamlogos/nba/500/bos.png',
      warriors:      'https://a.espncdn.com/i/teamlogos/nba/500/gs.png',
      heat:          'https://a.espncdn.com/i/teamlogos/nba/500/mia.png',
      nuggets:       'https://a.espncdn.com/i/teamlogos/nba/500/den.png',
      bucks:         'https://a.espncdn.com/i/teamlogos/nba/500/mil.png',
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

  // Hash determinístico para derivar paleta consistente del nombre del equipo.
  // Mismo nombre → mismos colores cada vez (no Math.random).
  function _hashName(name) {
    const s = String(name || '').toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  // Paletas de fallback (primary, accent) — mismas que se usan para top teams,
  // garantizan que un equipo random no listado parezca un crest "real".
  const _FB_PALETTES = [
    ['#0F3F88', '#FFC72C'],  // azul + amarillo (estilo Boca/Argentina)
    ['#C62828', '#FFFFFF'],  // rojo + blanco (River/Liverpool)
    ['#1B5E20', '#FFFFFF'],  // verde + blanco
    ['#4A148C', '#FFD700'],  // morado + dorado (Real Madrid alterno)
    ['#0D47A1', '#FFFFFF'],  // azul oscuro + blanco
    ['#B71C1C', '#000000'],  // rojo + negro (Milán)
    ['#FF6F00', '#FFFFFF'],  // naranja + blanco (Valencia/Atalanta)
    ['#1A237E', '#FFC107'],  // azul indigo + amarillo (Boca alt)
    ['#004D40', '#FFFFFF'],  // verde teal + blanco
    ['#37474F', '#FF5722']   // gris pizarra + naranja
  ];

  function neutralChip(name, color, size) {
    // Antes: cuadrado gris triste con iniciales gris-azuladas → impersonal.
    // Ahora: ESCUDO con paleta determinística por nombre — equipos sin logo
    // listado quedan visualmente diferenciados y se sienten "reales".
    // Si recibimos un color explícito (de TEAMS), respetarlo como primary.
    const initials = String(name || '?').replace(/[^A-Za-z0-9]/g, ' ')
      .split(/\s+/).filter(Boolean)
      .map(s => s[0]).slice(0, 2).join('').toUpperCase() || '?';
    let primary, accent;
    if (color && /^#[0-9a-f]{3,8}$/i.test(color)) {
      primary = color;
      accent = '#FFFFFF';
    } else {
      const pal = _FB_PALETTES[_hashName(name) % _FB_PALETTES.length];
      primary = pal[0];
      accent = pal[1];
    }
    const dark = shade(primary, -25);
    const safeName = String(name || '').replace(/"/g, '');
    const uid = _hashName(name).toString(36).slice(0, 6);
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${safeName}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fbc-${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${primary}"/>
          <stop offset="1" stop-color="${dark}"/>
        </linearGradient>
      </defs>
      <path d="M32 4 L56 14 L52 38 C50 50 42 56 32 60 C22 56 14 50 12 38 L8 14 Z" fill="url(#fbc-${uid})"/>
      <path d="M32 4 L56 14 L52 38 C50 50 42 56 32 60 C22 56 14 50 12 38 L8 14 Z" fill="none" stroke="${accent}" stroke-opacity=".35" stroke-width="1.2"/>
      <rect x="10" y="28" width="44" height="6" fill="${accent}" opacity=".25"/>
      <text x="32" y="40" text-anchor="middle" font-family="'Inter',system-ui,sans-serif" font-weight="900" font-size="20" fill="${accent}" letter-spacing="-.04em">${initials}</text>
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
    epl:           { name: 'Premier League',     primary: '#37003c', accent: '#00ff85' },
    championship:  { name: 'Championship',       primary: '#1b1a4e', accent: '#ffffff' },
    facup:         { name: 'FA Cup',             primary: '#003366', accent: '#ffffff' },
    laliga:        { name: 'LaLiga',             primary: '#ee2737', accent: '#ffffff' },
    laliga2:       { name: 'LaLiga 2',           primary: '#ee2737', accent: '#ffffff' },
    copadelrey:    { name: 'Copa del Rey',       primary: '#ad0a26', accent: '#ffd700' },
    seriea:        { name: 'Serie A',            primary: '#005ea6', accent: '#ffffff' },
    serieb:        { name: 'Serie B',            primary: '#005ea6', accent: '#ffffff' },
    coppaitalia:   { name: 'Coppa Italia',       primary: '#005ea6', accent: '#ffd700' },
    bundes:        { name: 'Bundesliga',         primary: '#d20515', accent: '#ffffff' },
    bundes2:       { name: '2. Bundesliga',      primary: '#d20515', accent: '#ffffff' },
    ligue1:        { name: 'Ligue 1',            primary: '#091c3e', accent: '#dca74d' },
    ligue2:        { name: 'Ligue 2',            primary: '#091c3e', accent: '#dca74d' },
    eredivisie:    { name: 'Eredivisie',         primary: '#fe6622', accent: '#ffffff' },
    primeira:      { name: 'Primeira Liga',      primary: '#21a55a', accent: '#ffffff' },
    ucl:           { name: 'UEFA Champions',     primary: '#0a1d6b', accent: '#ffffff' },
    uel:           { name: 'UEFA Europa',        primary: '#ff6a00', accent: '#0a1d6b' },
    conference:    { name: 'UEFA Conference',    primary: '#00ad6a', accent: '#ffffff' },
    lpfar:         { name: 'Liga Profesional',   primary: '#74acdf', accent: '#ffd700' },
    copaarg:       { name: 'Copa Argentina',     primary: '#74acdf', accent: '#ffd700' },
    primeranacional:{ name: 'Primera Nacional',  primary: '#74acdf', accent: '#ffffff' },
    libert:        { name: 'Copa Libertadores',  primary: '#003366', accent: '#ffd700' },
    sudamericana:  { name: 'Copa Sudamericana',  primary: '#003366', accent: '#dca74d' },
    recopa:        { name: 'Recopa Sudamericana',primary: '#003366', accent: '#ffd700' },
    brasileiraoa:  { name: 'Brasileirão A',      primary: '#009c3b', accent: '#ffdf00' },
    brasileiraob:  { name: 'Brasileirão B',      primary: '#009c3b', accent: '#ffdf00' },
    ligapro:       { name: 'Liga Pro',           primary: '#fff100', accent: '#000000' },
    primerachile:  { name: 'Primera Chile',      primary: '#d52b1e', accent: '#0033a0' },
    ligabetplay:   { name: 'Liga BetPlay',       primary: '#fcd116', accent: '#003893' },
    ligaperu:      { name: 'Liga 1 Perú',        primary: '#d91023', accent: '#ffffff' },
    uruguayoprimera:{ name: 'Primera Uruguay',   primary: '#0093dd', accent: '#ffffff' },
    paraguaprimera:{ name: 'Primera Paraguay',   primary: '#d22730', accent: '#ffffff' },
    ligamx:        { name: 'Liga MX',            primary: '#006847', accent: '#ce1126' },
    mls:           { name: 'MLS',                primary: '#001b40', accent: '#ef3340' },
    wc26:          { name: 'World Cup 2026',     primary: '#1a3a8e', accent: '#dca74d' },
    copaamerica:   { name: 'Copa América',       primary: '#003366', accent: '#ffd700' },
    euro:          { name: 'Eurocopa',           primary: '#1a3a8e', accent: '#ffffff' },
    fifa:          { name: 'FIFA',               primary: '#326ac8', accent: '#ffffff' },
    // Basquet
    nba:           { name: 'NBA',                primary: '#1d428a', accent: '#c8102e' },
    euroleague:    { name: 'EuroLeague',         primary: '#FF6A00', accent: '#000000' },
    eurocup:       { name: 'EuroCup',            primary: '#FF6A00', accent: '#000000' },
    acb:           { name: 'Liga ACB',           primary: '#fc4c02', accent: '#ffffff' },
    lnb:           { name: 'Liga Nacional AR',   primary: '#74acdf', accent: '#ffd700' },
    // Otros USA
    nfl:           { name: 'NFL',                primary: '#013369', accent: '#d50a0a' },
    mlb:           { name: 'MLB',                primary: '#002d72', accent: '#d50032' },
    nhl:           { name: 'NHL',                primary: '#000000', accent: '#ffffff' },
    // Tenis
    atp:           { name: 'ATP Tour',           primary: '#003478', accent: '#ffffff' },
    wta:           { name: 'WTA',                primary: '#562b8a', accent: '#ffffff' },
    atpchallenger: { name: 'ATP Challenger',     primary: '#003478', accent: '#dca74d' },
    grandslam:     { name: 'Grand Slam',         primary: '#1f3050', accent: '#ffd700' },
    wimbledon:     { name: 'Wimbledon',          primary: '#460b39', accent: '#ffd700' },
    usopen:        { name: 'US Open',            primary: '#1a3a8e', accent: '#fff100' },
    ausopen:       { name: 'Australian Open',    primary: '#0090d4', accent: '#fff100' },
    rolandgarros:  { name: 'Roland Garros',      primary: '#c47e2a', accent: '#ffffff' },
    itf:           { name: 'ITF',                primary: '#1f3050', accent: '#ffffff' },
    // MMA / Boxing
    ufc:           { name: 'UFC',                primary: '#d20a11', accent: '#000000' },
    mma:           { name: 'MMA',                primary: '#d20a11', accent: '#000000' },
    pfl:           { name: 'PFL',                primary: '#001b40', accent: '#fc4c02' },
    bellator:      { name: 'Bellator',           primary: '#c8102e', accent: '#000000' },
    // Esports
    csgo:          { name: 'CS:GO',              primary: '#f08d23', accent: '#000000' },
    cs2:           { name: 'CS2',                primary: '#f08d23', accent: '#000000' },
    lol:           { name: 'League of Legends',  primary: '#c89b3c', accent: '#0a1428' },
    dota2:         { name: 'Dota 2',             primary: '#a01a13', accent: '#000000' },
    valorant:      { name: 'Valorant',           primary: '#ff4655', accent: '#0f1923' },
    esports:       { name: 'eSports',            primary: '#7c3aed', accent: '#ffffff' }
  };
  // Map BSData league keys to our CDN keys.
  // Accepted in lowercase con o sin guiones/espacios — leagueLogo() normaliza el input.
  const LEAGUE_ALIASES = {
    // Premier League
    'premier-league':     'epl',
    'premierleague':      'epl',
    'premier league':     'epl',
    'english premier':    'epl',
    'inglaterra premier': 'epl',
    // La Liga
    'la-liga':            'laliga',
    'la liga':            'laliga',
    'laliga ea sports':   'laliga',
    'primera division':   'laliga',
    'espana primera':     'laliga',
    // Serie A
    'serie-a':            'seriea',
    'serie a':            'seriea',
    'italia serie a':     'seriea',
    // Bundesliga
    bundesliga:           'bundes',
    'bundesliga-1':       'bundes',
    'alemania bundesliga':'bundes',
    // Ligue 1
    'ligue-1':            'ligue1',
    'ligue 1':            'ligue1',
    'francia ligue':      'ligue1',
    // LPF Argentina
    lpf:                  'lpfar',
    'liga profesional':           'lpfar',
    'liga profesional argentina': 'lpfar',
    'primera argentina':  'lpfar',
    'lpf argentina':      'lpfar',
    // Sudamericanas
    libertadores:                 'libert',
    'copa libertadores':          'libert',
    'conmebol libertadores':      'libert',
    // Europeas
    championsleague:              'ucl',
    'champions-league':           'ucl',
    'champions league':           'ucl',
    'uefa champions league':      'ucl',
    europaleague:                 'uel',
    'europa-league':              'uel',
    'europa league':              'uel',
    'uefa europa league':         'uel',
    // World Cup
    worldcup:             'wc26',
    'world-cup':          'wc26',
    'world cup':          'wc26',
    'fifa world cup':     'wc26',
    'mundial':            'wc26',
    // FA Cup / Cup competitions
    'fa cup':             'facup',
    'fa-cup':             'facup',
    'copa del rey':       'copadelrey',
    'copa-del-rey':       'copadelrey',
    'copa argentina':     'copaarg',
    'coppa italia':       'coppaitalia',
    'coppa-italia':       'coppaitalia',
    'primera nacional':   'primeranacional',
    // Sudamericanas
    sudamericana:                 'sudamericana',
    'copa sudamericana':          'sudamericana',
    'conmebol sudamericana':      'sudamericana',
    recopa:                       'recopa',
    'recopa sudamericana':        'recopa',
    // Brasil
    brasileirao:          'brasileiraoa',
    'brasileirao a':      'brasileiraoa',
    'brasileirão':        'brasileiraoa',
    'brasileirão a':      'brasileiraoa',
    'brasileirao serie a':'brasileiraoa',
    'brasileirao b':      'brasileiraob',
    'brasileirão b':      'brasileiraob',
    // Ligas sudamericanas
    'liga pro':           'ligapro',
    'liga-pro':           'ligapro',
    'ligapro':            'ligapro',
    'ecuador liga pro':   'ligapro',
    'primera chile':      'primerachile',
    'primera division chile': 'primerachile',
    'liga betplay':       'ligabetplay',
    'liga-betplay':       'ligabetplay',
    'liga betplay dimayor':'ligabetplay',
    'liga 1':             'ligaperu',
    'liga 1 peru':        'ligaperu',
    'peru liga 1':        'ligaperu',
    'primera uruguay':    'uruguayoprimera',
    'primera division uruguay': 'uruguayoprimera',
    'primera paraguay':   'paraguaprimera',
    // México
    'liga mx':            'ligamx',
    'liga-mx':            'ligamx',
    'mexico liga mx':     'ligamx',
    // MLS
    mls:                  'mls',
    'major league soccer':'mls',
    // Otras europeas
    eredivisie:           'eredivisie',
    'primeira liga':      'primeira',
    'primeira-liga':      'primeira',
    'liga portuguesa':    'primeira',
    // Championship & lower divisions
    championship:         'championship',
    'english championship':'championship',
    'la liga 2':          'laliga2',
    'segunda':            'laliga2',
    'serie b':            'serieb',
    'segunda b':          'laliga2',
    // Conference League
    'conference league':  'conference',
    'uefa conference league': 'conference',
    // Copa América / Euro
    'copa america':       'copaamerica',
    'copa-america':       'copaamerica',
    eurocopa:             'euro',
    euro:                 'euro',
    'euro 2024':          'euro',
    'euro 2028':          'euro',
    // ── Basquet ──
    nba:                  'nba',
    'national basketball association': 'nba',
    euroleague:           'euroleague',
    'euroleague basketball':'euroleague',
    eurocup:              'eurocup',
    acb:                  'acb',
    'liga acb':           'acb',
    'liga endesa':        'acb',
    lnb:                  'lnb',
    'liga nacional argentina': 'lnb',
    'liga nacional basket':    'lnb',
    // ── NFL / MLB / NHL ──
    nfl:                  'nfl',
    'national football league': 'nfl',
    mlb:                  'mlb',
    'major league baseball':    'mlb',
    nhl:                  'nhl',
    // ── Tenis ──
    atp:                  'atp',
    'atp tour':           'atp',
    wta:                  'wta',
    'wta tour':           'wta',
    'atp challenger':     'atpchallenger',
    'challenger tour':    'atpchallenger',
    challenger:           'atpchallenger',
    'grand slam':         'grandslam',
    wimbledon:            'wimbledon',
    'us open':            'usopen',
    'australian open':    'ausopen',
    'roland garros':      'rolandgarros',
    'french open':        'rolandgarros',
    itf:                  'itf',
    'itf men':            'itf',
    'itf women':          'itf',
    // ── MMA / UFC ──
    ufc:                  'ufc',
    mma:                  'mma',
    pfl:                  'pfl',
    bellator:             'bellator',
    // ── Esports ──
    csgo:                 'csgo',
    'cs:go':              'csgo',
    'counter-strike':     'csgo',
    cs2:                  'cs2',
    'cs 2':               'cs2',
    lol:                  'lol',
    'league of legends':  'lol',
    'lol esports':        'lol',
    dota:                 'dota2',
    'dota 2':             'dota2',
    'the international':  'dota2',
    valorant:             'valorant',
    'valorant champions tour': 'valorant',
    esports:              'esports',
    'e-sports':           'esports'
  };
  function leagueLogo(key, opts = {}) {
    const size = opts.size || 36;
    const raw = String(key || '').toLowerCase().trim();
    // Probar el key tal cual primero
    let k = raw;
    if (LEAGUE_ALIASES[k]) k = LEAGUE_ALIASES[k];
    // Si no matched, normalizar (sin acentos, normalizar separators a espacio)
    if (!LEAGUES[k] && !CDN.league[k]) {
      const norm = raw
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
        .replace(/[_-]/g, ' ')                              // _ y - → espacio
        .replace(/\s+/g, ' ')
        .trim();
      if (LEAGUE_ALIASES[norm]) k = LEAGUE_ALIASES[norm];
      // Probar sin espacios
      const noSpace = norm.replace(/\s/g, '');
      if (!LEAGUES[k] && !CDN.league[k] && LEAGUE_ALIASES[noSpace]) k = LEAGUE_ALIASES[noSpace];
      // Substring matching (Premier League Argentina → premier league → epl)
      if (!LEAGUES[k] && !CDN.league[k]) {
        for (const [alias, target] of Object.entries(LEAGUE_ALIASES)) {
          if (norm.includes(alias)) { k = target; break; }
        }
      }
    }
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
      <rect width="64" height="64" rx="10" fill="#ffffff" stroke="${L.primary}" stroke-width="1.5"/>
      <path d="M10 28 L54 28 L52 36 L12 36 Z" fill="${L.accent}"/>
      <text x="32" y="22" text-anchor="middle" font-family="'Inter'" font-weight="900" font-size="11" fill="${L.primary}" letter-spacing=".05em">MLS</text>
      <g transform="translate(32 48)">
        ${[-10, 0, 10].map(x => `<polygon points="${x},-3 ${x + 1.5},-1 ${x + 4},-1 ${x + 2},1 ${x + 3},4 ${x},2 ${x - 3},4 ${x - 2},1 ${x - 4},-1 ${x - 1.5},-1" fill="${L.primary}"/>`).join('')}
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
   * actualiza TODOS los placeholders del DOM con `data-team-resolve` matching.
   * El parámetro league se pasa al backend para desambiguar teams ambiguos
   * (Independiente / Barcelona / America etc) entre países (2026-05-19). */
  function resolveRemoteLogo(rawName, sport, league) {
    const key = String(rawName || '').trim();
    if (!key) return;
    if (remoteLogoCache.has(key)) return;
    if (remoteLogoPending.has(key)) return;

    const apiBase = (window.BSLive?.API_BASE) || '';
    const url = `${apiBase}/api/logo?team=${encodeURIComponent(key)}${sport ? `&sport=${encodeURIComponent(sport)}` : ''}${league ? `&league=${encodeURIComponent(league)}` : ''}`;
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
  /* Aliases para short names comunes → keys del CDN baked.
   * Sin esto, 'River' no matchea 'riverplate', 'Inter' no matchea
   * 'inter' (existe pero quizás falla), 'Roma' no matchea 'asroma', etc. */
  const TEAM_NAME_ALIASES = {
    'river': 'riverplate',
    'boca': 'bocajuniors',
    'inter': 'internazionale',
    'intermilan': 'internazionale',
    'roma': 'asroma',
    'milan': 'acmilan',
    'leipzig': 'rbleipzig',
    'rbl': 'rbleipzig',
    'manchestercity': 'mancity',
    'mancity': 'mancity',
    'manchesterunited': 'manutd',
    'manutd': 'manutd',
    'realmadridcf': 'realmadrid',
    'atleticodemadrid': 'atleticomadrid',
    'atletimadrid': 'atleticomadrid',
    'barca': 'barcelona',
    'fcbarcelona': 'barcelona',
    'parissaintgermain': 'psg',
    'parisaintgerman': 'psg',
    'bayernmunchen': 'bayern',
    'bayernmunich': 'bayern',
    'bayern': 'bayern',
    'borussiadortmund': 'dortmund',
    'bvb': 'dortmund',
    'bayerleverkusen': 'leverkusen',
    'leverkusen': 'leverkusen',
    'cristalpalace': 'crystalpalace',
    'astonvilla': 'astonvilla',
    'newcastleunited': 'newcastle',
    'tottenhamhotspur': 'tottenham',
    'tottenhamhotspurs': 'tottenham',
    'spurs': 'tottenham',
    'westhamunited': 'westham',
    'wolverhampton': 'wolves',
    'palmeirassp': 'palmeiras',
    'flamengorj': 'flamengo',
    'racingclub': 'racing',
    'clubatleticoindependiente': 'independiente',
    'sanlorenzodealmagro': 'sanlorenzo',
    'velezsarsfield': 'velez',
    // ── Argentine teams with ambiguous "Gimnasia y Esgrima" names ──
    // Sin estos aliases, "Gimnasia y Esgrima" (sin sufijo de ciudad) caía a
    // resolución remota y a veces matcheaba el equipo equivocado (ej: Jujuy).
    // Ahora "Gimnasia y Esgrima" SIEMPRE matchea Gimnasia La Plata (el más
    // conocido), y cada variante específica matchea su ciudad.
    'gimnasiayesgrima': 'gimnasialaplata',           // default = LP (el más famoso)
    'gimnasiaesgrima': 'gimnasialaplata',
    'gimnasiayesgrimalaplata': 'gimnasialaplata',
    'gimnasiaesgrimalaplata': 'gimnasialaplata',
    'gelp': 'gimnasialaplata',                       // acrónimo común
    'gyelaplata': 'gimnasialaplata',
    'gimnasiayesgrimamendoza': 'gimnasiamendoza',
    'gimnasiaesgrimamendoza': 'gimnasiamendoza',
    'gem': 'gimnasiamendoza',
    'gimnasiayesgrimajujuy': 'gimnasiaj',
    'gimnasiaesgrimajujuy': 'gimnasiaj',
    'gimnasiajujuy': 'gimnasiaj',
    'gyejujuy': 'gimnasiaj',
    'gimnasiaytirosalta': 'gimnasiaytirosalta',
    'gytsalta': 'gimnasiaytirosalta',
    // ── Estudiantes — varias instituciones distintas ──
    'estudiantesdelaplata': 'estudiantes',          // Estudiantes LP (Primera) → 8.png
    'estudiantesdelp': 'estudiantes',
    'estudiantescaseros': 'estudiantesbuenosaires', // Estudiantes Caseros (B Nacional) → 17352.png
    'estudiantesdecaseros': 'estudiantesbuenosaires',
    // ── Independiente — varios equipos en Sudamérica ──
    'independienterivadaviadelacarlosa': 'independienterivadavia',
    'independienterivadavia': 'independienterivadavia',
    'cairivadavia': 'independienterivadavia'
  };

  // Map de nombres de SELECCIONES nacionales (español/inglés) → código ISO3.
  // Cuando teamCrest detecta uno de estos, retorna la bandera del país en
  // lugar del shield genérico. Cubre WC 2026 + ligas internacionales.
  const COUNTRY_NAME_TO_ISO3 = {
    // Sudamérica
    argentina:'ARG', brasil:'BRA', brazil:'BRA', uruguay:'URU', colombia:'COL',
    chile:'CHI', peru:'PER', perú:'PER', paraguay:'PAR', ecuador:'ECU',
    bolivia:'BOL', venezuela:'VEN',
    // Europa
    españa:'ESP', espana:'ESP', spain:'ESP',
    francia:'FRA', france:'FRA',
    alemania:'GER', germany:'GER', deutschland:'GER',
    inglaterra:'ENG', england:'ENG',
    italia:'ITA', italy:'ITA',
    portugal:'POR',
    paisesbajos:'NED', holanda:'NED', netherlands:'NED',
    belgica:'BEL', bélgica:'BEL', belgium:'BEL',
    croacia:'CRO', croatia:'CRO',
    suiza:'SUI', switzerland:'SUI',
    austria:'AUT',
    dinamarca:'DEN', denmark:'DEN',
    polonia:'POL', poland:'POL',
    noruega:'NOR', norway:'NOR',
    turquia:'TUR', turquía:'TUR', turkey:'TUR', türkiye:'TUR',
    chequia:'CZE', republicacheca:'CZE', repúblicacheca:'CZE', czechia:'CZE',
    suecia:'SWE', sweden:'SWE',
    // CONCACAF
    mexico:'MEX', méxico:'MEX',
    canada:'CAN', canadá:'CAN',
    estadosunidos:'USA', eeuu:'USA', usa:'USA',
    costarica:'CRC',
    panama:'PAN', panamá:'PAN',
    jamaica:'JAM',
    // AFC
    japon:'JPN', japón:'JPN', japan:'JPN',
    coreadelsur:'KOR', corea:'KOR', southkorea:'KOR',
    australia:'AUS',
    iran:'IRN', irán:'IRN',
    arabiasaudi:'KSA', arabiasaudí:'KSA', saudiarabia:'KSA',
    qatar:'QAT',
    irak:'IRQ', iraq:'IRQ',                              // ← user reportó este
    uzbekistan:'UZB', uzbekistán:'UZB',
    // CAF
    marruecos:'MAR', morocco:'MAR',
    senegal:'SEN', senegal:'SEN',
    egipto:'EGY', egypt:'EGY',
    nigeria:'NGA',
    costademarfil:'CIV', costadeumarfil:'CIV', ivorycoast:'CIV',
    ghana:'GHA',
    tunez:'TUN', túnez:'TUN', tunisia:'TUN',
    argelia:'DZA', algeria:'DZA',
    // OFC
    nuevazelanda:'NZL', newzealand:'NZL'
  };

  /* ─────────────────────────────────────────────────────────────────────
   * DESAMBIGUACIÓN DE TEAMS AMBIGUOS por liga / país (2026-05-19).
   *
   * Bug crítico reportado: cuando el orchestrator trunca "Independiente
   * Santa Fe" (Colombia) a "Independiente", o "Barcelona Sporting Club"
   * (Ecuador) a "Barcelona", la key normalizada cae al equipo DEFAULT
   * (Independiente de Avellaneda / FC Barcelona España) — mostrando el
   * escudo incorrecto.
   *
   * Este map resuelve esos casos usando opts.league / opts.country que
   * los callers pasan desde el evento (leagueName, sport).
   *
   * NOTA importante: SOLO afecta lookups con key ambigua. Si la key/name
   * ya es específica ("barcelonasc", "independientesantafe"), no se toca.
   * ───────────────────────────────────────────────────────────────────── */
  const AMBIGUOUS_TEAMS = {
    // "Barcelona": ESP (FC Barcelona) vs ECU (Barcelona SC) vs varios
    barcelona: {
      default: 'barcelona',          // FC Barcelona ESP (más conocido global)
      byLeagueRe: [
        [/liga\s*pro|primera\s*ecu|ecuador|serie\s*a\s*ecu/i, 'barcelonasc'],
        [/liga\s*betplay|colombia|dimayor/i,                  'barcelonasc']  // poco probable pero safe
      ],
      byCountry: { ECU: 'barcelonasc', ESP: 'barcelona' }
    },
    // "Independiente": ARG (Avellaneda) vs COL (Santa Fe) vs ECU (del Valle) vs varios
    independiente: {
      default: 'independiente',      // Independiente Avellaneda ARG (más conocido)
      byLeagueRe: [
        [/liga\s*betplay|colombia|dimayor|primera\s*colombia/i, 'independientesantafe'],
        [/liga\s*pro|primera\s*ecu|ecuador|serie\s*a\s*ecu/i,   'independientedelvalle'],
        [/primera\s*medellin|medellin/i,                         'independientemedellin']
      ],
      byCountry: { COL: 'independientesantafe', ECU: 'independientedelvalle', ARG: 'independiente' }
    },
    // "Gimnasia": LP (default) vs Jujuy vs Mendoza vs Tiro Salta
    gimnasia: {
      default: 'gimnasialaplata',    // Gimnasia LP (más conocido)
      byLeagueRe: [
        [/primera\s*nacional|nacional\s*b|federal/i, null]  // ambiguo — fallback a default
      ],
      byCountry: {}
    },
    // "Estudiantes": LP (Primera) vs Caseros (Nacional B) vs Buenos Aires
    estudiantes: {
      default: 'estudiantes',        // Estudiantes LP (Primera)
      byLeagueRe: [
        [/primera\s*nacional|nacional\s*b/i, 'estudiantesbuenosaires']  // Caseros juega ahí
      ],
      byCountry: {}
    },
    // "America": Cali COL vs Mineiro BRA vs Liga MX vs MLS
    america: {
      default: 'america',
      byLeagueRe: [
        [/liga\s*betplay|colombia|dimayor/i,   'americacali'],
        [/brasileir|serie\s*a\s*brasil/i,      'americamineiro'],
        [/liga\s*mx|mexicana|mexico/i,         'america'],    // América de México = default 227
        [/mls|major\s*league/i,                null]
      ],
      byCountry: { COL: 'americacali', BRA: 'americamineiro', MEX: 'america' }
    },
    // "Atletico" sin sufijo: ATM España vs Mineiro vs Tucumán etc — manejado por
    // alias "atletico" → CDN id 1068 (ATM España). Si el caller pasa "Atlético"
    // de otra liga, debería pasar el nombre completo (Atlético Mineiro, etc).
    // No agregamos resolución contextual acá — los aliases ya cubren los casos.
  };

  /* Normaliza un nombre de equipo para lookup en CDN/aliases.
   * Quita espacios, guiones, puntos, apóstrofes, underscores y acentos. */
  function _normKey(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s|-|\.|'|_/g, '');
  }

  function teamCrest(key, opts = {}) {
    const size = opts.size || 36;
    const fullName = opts.name || key;
    // PRIORIDAD AL NOMBRE COMPLETO ─────────────────────────────────────────
    // Antes confiábamos solo en `key` (el team.id que el caller deriva del
    // nombre). Si el caller deriva el id de un nombre TRUNCADO ("Independiente"
    // en vez de "Independiente Santa Fe"), el lookup CDN matcheaba al equipo
    // equivocado. Ahora resolvemos primero por nombre completo: si
    // CDN.team[normalize(name)] existe, ESE es el match — es estrictamente
    // más específico que la key derivada.
    const kFromKey  = _normKey(key);
    const kFromName = _normKey(opts.name);
    let k = kFromKey;
    if (kFromName && kFromName !== kFromKey) {
      // El nombre completo es más específico → priorizamos su match
      if (CDN.team[kFromName] || TEAM_NAME_ALIASES[kFromName] || TEAMS[kFromName] || COUNTRY_NAME_TO_ISO3[kFromName]) {
        k = kFromName;
      }
    }
    if (TEAM_NAME_ALIASES[k]) k = TEAM_NAME_ALIASES[k];

    // PATH 0 (NUEVO 2026-05-18): si es una SELECCIÓN nacional, retornar
    // bandera del país. Maneja variantes ES/EN (irak/iraq, noruega/norway,
    // brasil/brazil, etc.) que antes caían al shield genérico.
    const iso3 = COUNTRY_NAME_TO_ISO3[k];
    if (iso3) {
      return flag(iso3, { size });
    }

    // DESAMBIGUACIÓN POR LIGA/PAÍS (2026-05-19) ─────────────────────────────
    // Si la key cae en un team ambiguo (Independiente / Barcelona / Gimnasia /
    // Estudiantes / America), usamos opts.league (leagueName del evento) o
    // opts.country para elegir la variante correcta. Sin esto, "Independiente"
    // de Colombia mostraba el escudo de Avellaneda Argentina.
    const ambig = AMBIGUOUS_TEAMS[k];
    if (ambig) {
      const leagueStr = String(opts.league || opts.leagueName || '').toLowerCase();
      let resolved = null;
      if (leagueStr && ambig.byLeagueRe) {
        for (const [re, target] of ambig.byLeagueRe) {
          if (re.test(leagueStr)) { resolved = target; break; }
        }
      }
      if (!resolved && opts.country && ambig.byCountry) {
        resolved = ambig.byCountry[String(opts.country).toUpperCase()];
      }
      if (resolved && CDN.team[resolved]) {
        k = resolved;
      }
      // Si resolved es null explícito (regla "ambiguo, mejor caer a shield"),
      // saltamos el lookup CDN y vamos al fallback de iniciales — preferimos
      // shield genérico que escudo equivocado.
      else if (resolved === null) {
        const t = TEAMS[k];
        const color = t?.primary || opts.color || '#1f2937';
        return neutralChip(opts.name || key, color, size);
      }
    }

    const t = TEAMS[k];
    const color = t?.primary || opts.color || '#1f2937';
    const fb = neutralChip(t?.name || fullName, color, size);

    // Path 1: local CDN map
    const localUrl = CDN.team[k];
    if (localUrl) return imgWithFallback([localUrl], t?.name || fullName, size, fb);

    // Path 2: ya resolvimos remoto antes (cache por nombre completo)
    if (remoteLogoCache.has(fullName)) {
      const remoteUrl = remoteLogoCache.get(fullName);
      if (remoteUrl) {
        return `<img src="${remoteUrl}" alt="${String(fullName).replace(/"/g,'')}" width="${size}" height="${size}" loading="lazy" decoding="async" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px"/>`;
      }
      return fb;   // resolvimos null, ya no intentamos más
    }

    // Path 3: disparar resolve async + devolver placeholder que se actualizará.
    // Pasamos league al resolver para que el backend pueda desambiguar también.
    resolveRemoteLogo(fullName, opts.sport, opts.league || opts.leagueName);
    return `<span data-team-resolve="${String(fullName).replace(/"/g,'&quot;')}" data-size="${size}" style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">${fb}</span>`;
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
