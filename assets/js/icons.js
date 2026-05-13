/* BetSafe — Lucide-style inline SVG icon set + book/team logo factory */
(function (global) {
  'use strict';

  const PATH = {
    home: 'M3 12l9-9 9 9v9a2 2 0 0 1-2 2h-4v-7H10v7H6a2 2 0 0 1-2-2v-9z',
    chart: 'M3 3v18h18M7 14l4-4 4 4 5-7',
    bolt: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
    target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    trophy: 'M6 4h12v3a4 4 0 0 1-4 4h-1v3h2a3 3 0 0 1 3 3v3H6v-3a3 3 0 0 1 3-3h2v-3h-1a4 4 0 0 1-4-4V4z',
    calc: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2 4v3h10V7H7zm0 5h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v6h-2v-6zm-8 4h2v2H7v-2zm4 0h2v2h-2v-2z',
    arb: 'M7 7h10l-3-3M17 17H7l3 3M3 12h18',
    book: 'M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    bell: 'M12 2a6 6 0 0 0-6 6v3.5L4 16h16l-2-4.5V8a6 6 0 0 0-6-6zm-3 18a3 3 0 0 0 6 0',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4l-2 1 1 3-3 1-1 3-3-1-1 2-2-1-2 1-1-2-3 1-1-3-3-1 1-3-2-1 2-1-1-3 3-1 1-3 3 1 1-2 2 1 2-1 1 2 3-1 1 3 3 1-1 3z',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 6v2h16v-2c0-4-4-6-8-6z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm10 16l-5.5-5.5',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    check: 'M5 12l5 5L20 7',
    x: 'M6 6l12 12M18 6L6 18',
    arrowUp: 'M12 19V5M5 12l7-7 7 7',
    arrowDown: 'M12 5v14M19 12l-7 7-7-7',
    arrowRight: 'M5 12h14M12 5l7 7-7 7',
    sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.5-6.5L19 4M5 19l1.5-1.5M19 19l-1.5-1.5M5 4l1.5 1.5M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-2 5h2v6h2',
    lock: 'M6 10V8a6 6 0 1 1 12 0v2h1v12H5V10h1zm2 0h8V8a4 4 0 1 0-8 0v2z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M16 9c1.5 1.4 2 3 2 3s-4 7-10 7c-1 0-2-.2-2.9-.6M6.5 6.5C7.7 5.6 9.7 5 12 5c6 0 10 7 10 7s-1.6 2.9-4.5 4.7',
    flame: 'M12 2s-6 6-6 11a6 6 0 1 0 12 0c0-3-2-5-4-7 1 4-2 5-2 5s-2-3 0-9z',
    risk: 'M12 9v4M12 17h.01M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z',
    shield: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z',
    list: 'M3 6h18M3 12h18M3 18h18',
    cart: 'M2 3h2l3.6 13.59A2 2 0 0 0 9.55 18h7.45a2 2 0 0 0 1.95-1.59L21 8H6',
    refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
    trend: 'M3 17l6-6 4 4 8-8M14 7h7v7',
    soccer: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2l3 2v3l-3 2-3-2V6l3-2zm0 8l5 3-2 5h-6l-2-5 5-3z',
    basketball: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2v20M5 5l14 14M19 5L5 19',
    tennis: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM5 5c4 4 10 4 14 0M5 19c4-4 10-4 14 0',
    football: 'M3 6c4-2 14-2 18 0v12c-4 2-14 2-18 0V6zm9 1v10M9 9l6 6M15 9l-6 6',
    hockey: 'M3 17l5-5 4 4 9-9M14 7h7v7',
    baseball: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 7c4 4 10 6 16 4M4 17c4-4 10-6 16-4',
    mma: 'M5 11h14M9 6h6M9 16h6M5 11v6h14v-6',
    boxing: 'M7 4h7a3 3 0 0 1 3 3v6l-2 7H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    rugby: 'M3 12c0-4 4-9 9-9s9 5 9 9-4 9-9 9-9-5-9-9zM8 8l8 8M16 8l-8 8',
    golf: 'M12 2v18M12 2l8 4-8 4M5 22h14',
    volleyball: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12c4-2 8-2 10 4M22 12c-4 2-8 2-10-4M12 12c-4 0-8 2-10 6',
    /* esports — gamepad icon (más distintivo + scifi: D-pad + face buttons + grips) */
    esports: 'M6 8c-2.5 0-4.5 2-4.5 4.5v3C1.5 18 3.5 20 6 20c1.5 0 2.5-1 3-2h6c.5 1 1.5 2 3 2 2.5 0 4.5-2 4.5-4.5v-3C22.5 10 20.5 8 18 8H6zm-1.5 4h2v-1.5h1.5v1.5h2v1.5h-2v1.5H6.5V13h-2v-1.5zM15 11.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3 2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
    cricket: 'M3 21l8-8 5 5-3 3H3v-3 3zM14 8l4 4 3-3-4-4-3 3z',
    f1: 'M3 13h6l2-3h6l3 3h-3v3H6l-3-3zM7 16h2M14 16h3',
    download: 'M12 3v12m0 0l-4-4m4 4l4-4M3 17v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3',
    upload: 'M12 21V9m0 0L8 13m4-4l4 4M3 5h18',
    copy: 'M8 8h12v12H8zM4 4h12v4M4 4v12h4',
    share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v14',
    play: 'M6 4l14 8-14 8z',
    pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    book2: 'M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zm0 0a2 2 0 0 1 2-2h12',
    cup: 'M3 4h18v3a5 5 0 0 1-5 5h-1v3a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3v-3H6a5 5 0 0 1-5-5V4z'
  };

  // Iconos premium con múltiples paths/gradientes (no usan el factory simple)
  let _customSeq = 0;
  const CUSTOM_SVG = {
    cup(size) {
      const uid = ++_customSeq;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="bs-icon-trophy">
        <defs>
          <linearGradient id="bs-cup-body-${uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stop-color="#FFE07A" stop-opacity=".55"/>
            <stop offset="55%" stop-color="#D4A017" stop-opacity=".20"/>
            <stop offset="100%" stop-color="#D4A017" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="bs-cup-star-${uid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"  stop-color="#FFE07A"/>
            <stop offset="50%" stop-color="#D4A017"/>
            <stop offset="100%" stop-color="#9C7416"/>
          </linearGradient>
        </defs>
        <!-- Asas izquierda y derecha -->
        <path d="M5.5 7.2H4a2 2 0 0 0-2 2v.4a3.6 3.6 0 0 0 3.6 3.6H6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18.5 7.2H20a2 2 0 0 1 2 2v.4a3.6 3.6 0 0 1-3.6 3.6H18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- Cuerpo de la copa con gradiente dorado interior -->
        <path d="M5.5 4.8h13v6.4c0 3.6-2.9 6.5-6.5 6.5S5.5 14.8 5.5 11.2V4.8z" fill="url(#bs-cup-body-${uid})" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <!-- Estrella dorada en el centro -->
        <path d="M12 8.6l.86 1.74 1.92.28-1.39 1.36.33 1.92L12 12.99l-1.72.91.33-1.92-1.39-1.36 1.92-.28L12 8.6z" fill="url(#bs-cup-star-${uid})"/>
        <!-- Cuello/stem -->
        <path d="M12 17.7v2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        <!-- Base de dos niveles -->
        <path d="M8.2 20.2h7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M6.6 22h10.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
      </svg>`;
    }
  };

  function svg(name, opts = {}) {
    const size = opts.size || 18;
    if (CUSTOM_SVG[name]) return CUSTOM_SVG[name](size);
    const d = PATH[name] || PATH.info;
    const stroke = opts.stroke != null ? opts.stroke : 'currentColor';
    const strokeWidth = opts.strokeWidth || 1.7;
    const fill = opts.fill || 'none';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${pathOf(d)}</svg>`;
  }

  function pathOf(d) {
    // Some paths need to be rendered as <path d="...">
    return `<path d="${d}"/>`;
  }

  // Book logo factory — delegates to BSLogos.bookLogo for rich SVG art
  function bookLogo(book, opts = {}) {
    if (window.BSLogos && book && book.id) {
      const v = window.BSLogos.bookLogo(book.id, opts);
      if (v) return v;
    }
    const size = opts.size || 22;
    const initials = (book.name || '').replace(/[^A-Za-z0-9]/g, ' ').split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase();
    const bg = book.color || '#0b6b3a';
    const fg = bestText(bg);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-label="${book.name}"><rect width="24" height="24" rx="5" fill="${bg}"/><text x="12" y="15" text-anchor="middle" font-family="'Inter', sans-serif" font-size="9" font-weight="800" fill="${fg}">${initials}</text></svg>`;
  }
  function teamLogo(team, opts = {}) {
    // Always go through BSLogos.teamCrest — uses CDN URL with neutral fallback
    // + async fetch al backend si el equipo no está en el mapa local.
    if (window.BSLogos && team) {
      const k = String(team.id || team.name || '').toLowerCase().replace(/\s|-|\.|'|_/g, '');
      return window.BSLogos.teamCrest(k, {
        size: opts.size || 28,
        name: team.name || k,
        sport: opts.sport || team.sport       // hint para mejor matching en TheSportsDB
      });
    }
    return window.BSLogos?.neutralChip?.(team?.name || '?', team?.color || '#1f2937', opts.size || 28) || '';
  }
  function flagSvg(code, opts = {}) {
    if (window.BSLogos && window.BSLogos.flag) {
      const v = window.BSLogos.flag(code, opts);
      if (v) return v;
    }
    const size = opts.size || 22;
    const colors = FLAG_COLORS[code] || ['#cbd5e1', '#e2e8f0'];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 0.7}" viewBox="0 0 30 21" aria-label="${code}">
      <rect width="30" height="7" fill="${colors[0]}"/>
      <rect y="7" width="30" height="7" fill="${colors[1] || '#fff'}"/>
      <rect y="14" width="30" height="7" fill="${colors[2] || colors[0]}"/>
      <text x="15" y="14" text-anchor="middle" font-family="'Inter'" font-size="6" font-weight="700" fill="#0f172a">${code}</text>
    </svg>`;
  }
  // League + confederation passthrough helpers
  function leagueLogo(key, opts = {}) {
    if (window.BSLogos && window.BSLogos.leagueLogo) return window.BSLogos.leagueLogo(key, opts);
    return svg('trophy', opts);
  }
  function confedLogo(key, opts = {}) {
    if (window.BSLogos && window.BSLogos.confedLogo) return window.BSLogos.confedLogo(key, opts);
    return svg('soccer', opts);
  }

  function bestText(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.6 ? '#0f172a' : '#ffffff';
  }

  const FLAG_COLORS = {
    AR:['#74ACDF','#fff','#74ACDF'], BR:['#009c3b','#ffdf00','#009c3b'], FR:['#0055A4','#fff','#EF4135'],
    ES:['#AA151B','#F1BF00','#AA151B'], DE:['#000','#DD0000','#FFCE00'], IT:['#008C45','#fff','#CD212A'],
    EN:['#fff','#CE1124','#fff'], PT:['#006600','#FF0000','#006600'], NL:['#AE1C28','#fff','#21468B'],
    BE:['#000','#FAE042','#ED2939'], HR:['#171796','#fff','#FF0000'], CH:['#FF0000','#fff','#FF0000'],
    AT:['#ED2939','#fff','#ED2939'], DK:['#C8102E','#fff','#C8102E'], PL:['#fff','#DC143C','#fff'],
    NO:['#EF2B2D','#fff','#002868'], TR:['#E30A17','#fff','#E30A17'], CZ:['#11457E','#fff','#D7141A'],
    SE:['#006AA7','#FECC00','#006AA7'], MX:['#006847','#fff','#CE1126'], CA:['#FF0000','#fff','#FF0000'],
    US:['#B22234','#fff','#3C3B6E'], UY:['#7B96D6','#fff','#7B96D6'], CO:['#FCD116','#003893','#CE1126'],
    EC:['#FFD100','#0072CE','#EF3340'], PY:['#D52B1E','#fff','#0038A8'], CR:['#002B7F','#fff','#CE1126'],
    PA:['#fff','#005AA7','#D21034'], JM:['#000','#FED100','#009B3A'], JP:['#fff','#BC002D','#fff'],
    KR:['#fff','#cd2e3a','#fff'], AU:['#012169','#fff','#E4002B'], IR:['#239F40','#fff','#DA0000'],
    SA:['#006C35','#fff','#006C35'], QA:['#8D1B3D','#fff','#8D1B3D'], IQ:['#CE1126','#fff','#000'],
    UZ:['#0099B5','#fff','#1EB53A'], MA:['#C1272D','#005138','#C1272D'], SN:['#00853F','#FDEF42','#E31B23'],
    EG:['#CE1126','#fff','#000'], NG:['#008751','#fff','#008751'], CI:['#F77F00','#fff','#009E60'],
    GH:['#CE1126','#FCD116','#006B3F'], CM:['#007A5E','#CE1126','#FCD116'], TN:['#E70013','#fff','#E70013'],
    DZ:['#006233','#fff','#D21034'], NZ:['#012169','#fff','#012169'], P1:['#cbd5e1','#94a3b8','#64748b'],
    P2:['#cbd5e1','#94a3b8','#64748b']
  };

  global.BSIcons = { svg, bookLogo, teamLogo, flagSvg, leagueLogo, confedLogo };
})(window);
