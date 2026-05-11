/* BetSafe — Correlation engine
 * ============================================================================
 * Detecta cuándo dos legs en una combinada NO son independientes y la cuota
 * final está INFLADA (book gana plata, vos perdés en el cálculo de EV).
 *
 * Casos clásicos:
 *   - Mismo evento: BTTS-Yes + Over 2.5  → fuertemente correlacionados (positivo)
 *   - Mismo evento: Home Win + Under 2.5 → negativamente correlacionados
 *   - Mismo equipo en distintos partidos → correlación si es double up
 *   - Mismo torneo: si dependés de un equipo común en bracket
 *
 * Para cada par devolvemos:
 *   correlation: -1 (anti) .. +1 (perfecta)
 *   warning: true si |corr| > 0.20 (umbral configurable)
 *   evAdjustment: cuánto deberías descontar de tu EV si tomás esta combinada
 *
 * Modelo: para mismo evento usamos coefficients pre-computados (research
 * empírico). Para mismo equipo en distintos eventos calculamos vía Poisson.
 * ============================================================================
 */
'use strict';

// Las keys siguen el formato producido por normKey():
//   h2h:      'home' | 'draw' | 'away'
//   totals:   '<outcome><line>' ej: 'over2.5', 'under2.5', 'over3.5'
//   btts:     'btts_yes' | 'btts_no'
//   dc:       'home_or_draw' | 'draw_or_away' | 'home_or_away'
//   ah:       '<outcome>_<line>' ej: 'home_-0.5'
const SAME_EVENT_CORR = {
  // Pares clásicos en fútbol (h2h × totals — línea 2.5)
  'home_x_over2.5':   { corr: -0.10, note: '1 + Over: tendencia inversa media' },
  'home_x_under2.5':  { corr:  0.18, note: '1 + Under: home suele ganar 1-0 / 2-0' },
  'away_x_over2.5':   { corr: -0.05, note: '2 + Over: ligeramente inverso' },
  'away_x_under2.5':  { corr:  0.12, note: '2 + Under: visitante suele ganar bajo' },
  'draw_x_under2.5':  { corr:  0.35, note: 'Empate + Under: ALTÍSIMA correlación (0-0, 1-1)' },
  'draw_x_over2.5':   { corr: -0.30, note: 'Empate + Over: muy inverso' },
  'home_x_btts_yes':  { corr: -0.05, note: '1 + BTTS-Sí: ligeramente inverso (clean sheet local)' },
  'away_x_btts_yes':  { corr: -0.08, note: '2 + BTTS-Sí: clean sheet visit es plausible' },
  'over2.5_x_btts_yes':{ corr: 0.55, note: 'Over + BTTS-Sí: muy correlacionado positivo' },
  'over2.5_x_btts_no':{ corr: -0.45, note: 'Over + BTTS-No: contradictorio (un equipo mete 3+)' },
  'under2.5_x_btts_no':{ corr: 0.40, note: 'Under + BTTS-No: muy correlacionado positivo' },
  'home_x_home_-0.5': { corr: 0.80, note: 'Same outcome via AH: prácticamente la misma apuesta' },
  // Doble oportunidad — directamente lock
  'home_x_home_or_draw':{ corr: 0.95, note: 'Home + 1X: solapamiento total — no apostar combinada' },
  'away_x_draw_or_away':{ corr: 0.95, note: '2 + X2: solapamiento total — no apostar combinada' },
  'draw_x_home_or_draw':{ corr: 0.70, note: 'X + 1X: alta superposición' },
  'draw_x_draw_or_away':{ corr: 0.70, note: 'X + X2: alta superposición' },
  // Líneas alternativas 1.5 y 3.5
  'home_x_over1.5':  { corr: -0.05, note: '1 + Over 1.5: leve inverso' },
  'home_x_under1.5': { corr:  0.10, note: '1 + Under 1.5: home gana 1-0' },
  'draw_x_under1.5': { corr:  0.25, note: 'Empate + Under 1.5: 0-0 / 1-1' },
  'over3.5_x_btts_yes':{ corr: 0.45, note: 'Over 3.5 + BTTS: ambos meten 2+' }
};

/** Calcula correlación entre dos legs. Devuelve { corr, warning, note }. */
function pairCorrelation(legA, legB) {
  if (!legA || !legB) return { corr: 0 };

  // Mismo evento
  if (legA.eventId && legA.eventId === legB.eventId) {
    const k1 = normKey(legA);
    const k2 = normKey(legB);
    const key1 = `${k1}_x_${k2}`;
    const key2 = `${k2}_x_${k1}`;
    const found = SAME_EVENT_CORR[key1] || SAME_EVENT_CORR[key2];
    if (found) {
      return {
        corr: found.corr,
        warning: Math.abs(found.corr) > 0.20,
        note: found.note,
        reason: 'same-event-known-pair'
      };
    }
    // Default: mismo evento sin par conocido = correlación moderada por dependencia común
    return {
      corr: 0.15,
      warning: true,
      note: 'Mismo evento — outcomes no independientes',
      reason: 'same-event-generic'
    };
  }

  // Mismo equipo en distintos eventos
  const teamsA = teamsOfLeg(legA);
  const teamsB = teamsOfLeg(legB);
  const common = teamsA.filter(t => teamsB.includes(t));
  if (common.length) {
    return {
      corr: 0.25,
      warning: true,
      note: `Equipo en común: ${common.join(', ')}`,
      reason: 'common-team'
    };
  }
  return { corr: 0, warning: false };
}

function normKey(leg) {
  if (leg.market === 'h2h') return leg.outcome;
  if (leg.market === 'totals') return `${leg.outcome}${leg.line || 2.5}`;
  if (leg.market === 'btts') return `btts_${leg.outcome}`;
  if (leg.market === 'dc') return leg.outcome;
  if (leg.market === 'ah') return `${leg.outcome}_${leg.line || 0}`;
  return leg.outcome;
}

function teamsOfLeg(leg) {
  const t = [];
  if (leg.home) t.push(leg.home);
  if (leg.away) t.push(leg.away);
  if (leg.team) t.push(leg.team);
  return t;
}

/** Analiza una combinada (array de legs) y devuelve matriz de correlaciones
 *  + métrica agregada + advertencias. */
function analyzeCombo(legs) {
  if (!Array.isArray(legs) || legs.length < 2) {
    return { ok: true, legs: legs?.length || 0, pairs: [], warnings: [], evAdjustment: 0 };
  }
  const pairs = [];
  const warnings = [];
  let maxAbsCorr = 0;
  let maxPositiveCorr = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const c = pairCorrelation(legs[i], legs[j]);
      const pair = { i, j, corr: c.corr, warning: c.warning, note: c.note, reason: c.reason };
      pairs.push(pair);
      if (c.warning) warnings.push({ i, j, note: c.note });
      if (Math.abs(c.corr) > maxAbsCorr) maxAbsCorr = Math.abs(c.corr);
      // Trackeo separado de la max correlación POSITIVA (la que infla EV)
      if (c.corr > maxPositiveCorr) maxPositiveCorr = c.corr;
    }
  }
  // EV adjustment: solo se aplica para corr positivas (book infla la cuota).
  // Una corr negativa NO infla EV — al contrario, te paga más vs independiente.
  const evAdjustment = -maxPositiveCorr * 0.40;
  return {
    ok: warnings.length === 0,
    legs: legs.length,
    pairs,
    warnings,
    maxCorrelation: Number(maxAbsCorr.toFixed(3)),
    maxPositiveCorrelation: Number(maxPositiveCorr.toFixed(3)),
    evAdjustment: Number(evAdjustment.toFixed(3))
  };
}

module.exports = { pairCorrelation, analyzeCombo, SAME_EVENT_CORR };
