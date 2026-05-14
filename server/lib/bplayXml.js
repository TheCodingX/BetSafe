/* BetSafe — Parser XML de feed Bplay (Sportingtech / IGT)
 * ============================================================================
 * Bplay expone un feed XML PÚBLICO con todo su catálogo de cuotas en:
 *   https://deportespba.bplay.bet.ar/oddsfeeds/odds.xml          (~2.5 MB, TODO)
 *   https://deportespba.bplay.bet.ar/oddsfeeds/odds-competition{ID}.xml  (1 comp)
 *
 * Estructura:
 *   <Data>
 *     <SportList>
 *       <Sport id name>
 *         <RegionList><Region id name>
 *           <CompetitionList><Competition id name>
 *             <MatchList>
 *               <Match id date>
 *                 <OfferList>
 *                   <Offer type_id type_name [number]>
 *                     <Outcome name odds/>
 *                   </Offer>
 *                 </OfferList>
 *                 <Team post="home|away" name/>
 *               </Match>
 *
 * Markets identificados por type_name:
 *   "1-X-2"               → h2h (home/draw/away)
 *   "1-2"                 → h2h sin empate (DNB)
 *   "Doble oportunidad"   → DC (1X / X2 / 12)
 *   "Más de / Menos de"   → totals (number = línea)
 *   "Handicap 1-2"        → AH (number = handicap)
 *   "Sí - No"             → BTTS o varios markets sí/no
 *   "Hándicap"            → European handicap
 *   "Primer gol"          → first scorer team
 *   "Par - Impar"         → odd/even
 *   "Apuesta sobre el evento" → futures (outright)
 * ============================================================================
 */
'use strict';

const { XMLParser } = require('fast-xml-parser');
const { isFinite2 } = require('./index');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,   // mantenemos strings para evitar number coercion en IDs largos
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ['Sport', 'Region', 'Competition', 'Match', 'Offer', 'Outcome', 'Team', 'MatchList'].includes(name)
});

// Normalización: lowercase + remove accents para hacer match estable
// independientemente de si vienen como "Fútbol" o "F&#xFA;tbol".
const SPORT_PATTERNS = [
  { re: /^futbol americano$/i, sport: 'amfootball' },
  { re: /^futbol australiano$/i, sport: 'soccer' },
  { re: /^futbol$/i,           sport: 'soccer' },
  { re: /^tenis(?: de mesa)?$/i, sport: 'tennis' },
  { re: /^baloncesto|basquet/i, sport: 'basketball' },
  { re: /^beisbol$/i,          sport: 'baseball' },
  { re: /^hockey/i,            sport: 'hockey' },
  { re: /^mma$|ufc/i,          sport: 'mma' },
  { re: /^boxeo$/i,            sport: 'mma' },
  { re: /^voleibol$/i,         sport: 'volleyball' },
  { re: /^rugby/i,             sport: 'rugby' },
  { re: /^golf$/i,             sport: 'golf' },
  { re: /^cricket$/i,          sport: 'cricket' },
  { re: /^esports$/i,          sport: 'esports' }
];

function normalizeSportName(name) {
  if (!name) return 'soccer';
  const norm = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const { re, sport } of SPORT_PATTERNS) if (re.test(norm)) return sport;
  return 'other';
}

const LEAGUE_MAP = [
  // STRICT: solo Liga Profesional ARGENTINA
  { re: /liga\s*profesional\s*(?:de\s*f[úu]tbol|argentina)|copa\s*argentina|argentina.*primera\s*divisi|\bafa\b/i,         key: 'lpf' },
  { re: /premier league/i,                          key: 'epl' },
  { re: /liga espa.ola|laliga|la liga/i,            key: 'laliga' },
  { re: /serie a/i,                                 key: 'seriea' },
  { re: /bundesliga/i,                              key: 'bundesliga' },
  { re: /ligue 1|liga francia/i,                    key: 'ligue1' },
  { re: /champions/i,                               key: 'ucl' },
  { re: /europa league/i,                           key: 'uel' },
  { re: /libertadores/i,                            key: 'libertadores' },
  { re: /sudamericana/i,                            key: 'sudamericana' },
  { re: /\bnba\b/i,                                 key: 'nba' },
  { re: /\bnfl\b/i,                                 key: 'nfl' },
  { re: /\bmlb\b/i,                                 key: 'mlb' },
  { re: /\bnhl\b/i,                                 key: 'nhl' },
  { re: /\bmls\b/i,                                 key: 'mls' },
  { re: /ufc/i,                                     key: 'ufc' },
  { re: /atp/i,                                     key: 'atp' },
  { re: /wta/i,                                     key: 'wta' }
];

function resolveLeague(name) {
  if (!name) return { key: null, name: null };
  for (const { re, key } of LEAGUE_MAP) {
    if (re.test(name)) return { key, name };
  }
  return { key: null, name };
}

function parseOdd(s) {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) && n > 1.01 && n < 1000 ? n : null;
}

/* Convierte la fecha "2026-05-12 21:30:00" (UTC-3 implícita) a ms epoch. */
function parseDate(dateStr) {
  if (!dateStr) return null;
  // Asumimos que la fecha viene en hora local Argentina (UTC-3)
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    const t = Date.parse(dateStr);
    return Number.isFinite(t) ? t : null;
  }
  const [, y, M, d, h, mi, s] = m;
  // Date.UTC + offset AR (-3h = +3h UTC)
  return Date.UTC(+y, +M - 1, +d, +h + 3, +mi, +s);
}

/* Match → estructura interna BetSafe. */
function parseMatch(matchNode, sportName, regionName, competitionName) {
  const id = matchNode['@_id'];
  const date = matchNode['@_date'];
  const teams = matchNode.Team || [];
  const home = teams.find(t => t['@_post'] === 'home');
  const away = teams.find(t => t['@_post'] === 'away');
  if (!home || !away) return null;

  const offers = matchNode.OfferList?.Offer || [];
  const markets = { h2h: null, totals: {}, btts: null, dc: null, ah: null };

  for (const offer of offers) {
    const typeName = offer['@_type_name'];
    const number = offer['@_number'];                 // línea (para AH/totals)
    const outcomes = Array.isArray(offer.Outcome) ? offer.Outcome : (offer.Outcome ? [offer.Outcome] : []);
    if (!outcomes.length) continue;

    // ── 1X2 (home/draw/away)
    if (typeName === '1-X-2' && !markets.h2h) {
      const homeOut = outcomes.find(o => o['@_name'] === home['@_name']);
      const awayOut = outcomes.find(o => o['@_name'] === away['@_name']);
      const drawOut = outcomes.find(o => /^empate$/i.test(o['@_name']));
      markets.h2h = {
        home: parseOdd(homeOut?.['@_odds']),
        draw: parseOdd(drawOut?.['@_odds']),
        away: parseOdd(awayOut?.['@_odds'])
      };
    }
    // ── Doble oportunidad
    else if (typeName === 'Doble oportunidad' && !markets.dc) {
      const m1x = outcomes.find(o => o['@_name'] === '1X');
      const mx2 = outcomes.find(o => o['@_name'] === 'X2');
      const m12 = outcomes.find(o => o['@_name'] === '12');
      markets.dc = {
        home_or_draw: parseOdd(m1x?.['@_odds']),
        draw_or_away: parseOdd(mx2?.['@_odds']),
        home_or_away: parseOdd(m12?.['@_odds'])
      };
    }
    // ── Más de / Menos de (totals con línea en `number`)
    else if (typeName === 'Más de / Menos de' && number != null) {
      const line = parseFloat(number);
      if (!Number.isFinite(line)) continue;
      const mas = outcomes.find(o => /^M[áa]s$/i.test(o['@_name']));
      const menos = outcomes.find(o => /^Menos$/i.test(o['@_name']));
      // Tomamos la PRIMERA línea registrada por número (puede haber varios offers con misma línea)
      if (!markets.totals[line]) {
        markets.totals[line] = {
          line,
          over: parseOdd(mas?.['@_odds']),
          under: parseOdd(menos?.['@_odds'])
        };
      }
    }
    // ── Handicap 1-2 (AH)
    else if (typeName === 'Handicap 1-2' && number != null && !markets.ah) {
      const line = parseFloat(number);
      if (!Number.isFinite(line)) continue;
      const homeOut = outcomes.find(o => o['@_name'] === home['@_name']);
      const awayOut = outcomes.find(o => o['@_name'] === away['@_name']);
      markets.ah = {
        line,
        home_minus: parseOdd(homeOut?.['@_odds']),
        away_plus: parseOdd(awayOut?.['@_odds'])
      };
    }
    // ── BTTS (heurística: "Sí - No" con offer type que típicamente es BTTS)
    // El XML tiene varios "Sí - No" pero uno suele ser BTTS. Tomamos solo el que
    // tiene 2 outcomes y odds en rango razonable (1.4-3.5 para BTTS típico).
    else if (typeName === 'Sí - No' && !markets.btts && outcomes.length === 2) {
      const si = outcomes.find(o => o['@_name'] === 'Sí');
      const no = outcomes.find(o => o['@_name'] === 'No');
      const yesOdd = parseOdd(si?.['@_odds']);
      const noOdd = parseOdd(no?.['@_odds']);
      // BTTS odds típicas: yes entre 1.6-2.5, no entre 1.6-2.5
      if (yesOdd && noOdd && yesOdd > 1.4 && yesOdd < 3.5 && noOdd > 1.4 && noOdd < 3.5) {
        markets.btts = { yes: yesOdd, no: noOdd };
      }
    }
  }

  // Limpiar markets vacíos
  if (!markets.h2h?.home && !markets.h2h?.away) markets.h2h = null;
  if (Object.keys(markets.totals).length === 0) delete markets.totals;
  if (!markets.btts) delete markets.btts;
  if (!markets.dc?.home_or_draw && !markets.dc?.draw_or_away) markets.dc = null;
  if (!markets.ah?.home_minus && !markets.ah?.away_plus) markets.ah = null;

  // Si no hay nada, descartar
  if (!markets.h2h && !markets.totals && !markets.btts && !markets.dc && !markets.ah) return null;

  const sport = normalizeSportName(sportName);
  const lg = resolveLeague(competitionName);

  // Wrap markets bajo bookKey='bplay' (formato esperado por scrapers.js wrapper)
  const wrappedMarkets = {};
  for (const [k, v] of Object.entries(markets)) {
    if (v) wrappedMarkets[k] = { bplay: v };
  }

  return {
    home: { name: home['@_name'] },
    away: { name: away['@_name'] },
    start: parseDate(date),
    league: lg.key,
    leagueName: competitionName,
    sport,
    markets: wrappedMarkets
  };
}

/* parseXmlFeed: convierte el XML completo a array de events. */
function parseXmlFeed(xml) {
  if (!xml || typeof xml !== 'string' || xml.length < 100) return [];
  let doc;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    return [];
  }
  const out = [];
  // Estructura: Data > SportList > Sport[] > RegionList > Region[] > CompetitionList > Competition[] > MatchList[] > Match[]
  const sports = doc?.Data?.SportList?.Sport || [];
  for (const sport of sports) {
    const sportName = sport['@_name'];
    const regions = sport.RegionList?.Region || [];
    for (const region of regions) {
      const regionName = region['@_name'];
      const competitions = region.CompetitionList?.Competition || [];
      const compArr = Array.isArray(competitions) ? competitions : [competitions];
      for (const comp of compArr) {
        const compName = comp['@_name'];
        // MatchList puede repetirse: cada Offer/Market está en un MatchList separado a veces.
        // Necesitamos mergear todos los matches con mismo Match id.
        const matchLists = Array.isArray(comp.MatchList) ? comp.MatchList : (comp.MatchList ? [comp.MatchList] : []);
        const matchMap = new Map();
        for (const ml of matchLists) {
          const matches = ml.Match || [];
          const matchArr = Array.isArray(matches) ? matches : [matches];
          for (const m of matchArr) {
            const id = m['@_id'];
            if (!id) continue;
            if (!matchMap.has(id)) {
              matchMap.set(id, m);
            } else {
              // Mergear offers en el match existente
              const existing = matchMap.get(id);
              const existingOffers = existing.OfferList?.Offer || [];
              const newOffers = m.OfferList?.Offer || [];
              const existingArr = Array.isArray(existingOffers) ? existingOffers : [existingOffers];
              const newArr = Array.isArray(newOffers) ? newOffers : [newOffers];
              existing.OfferList = { Offer: existingArr.concat(newArr) };
              // Teams: mergear también
              const existingTeams = Array.isArray(existing.Team) ? existing.Team : (existing.Team ? [existing.Team] : []);
              const newTeams = Array.isArray(m.Team) ? m.Team : (m.Team ? [m.Team] : []);
              const allTeams = existingTeams.concat(newTeams);
              const uniqueTeams = [];
              const seenPosts = new Set();
              for (const t of allTeams) {
                const post = t['@_post'];
                if (post && !seenPosts.has(post)) { seenPosts.add(post); uniqueTeams.push(t); }
              }
              existing.Team = uniqueTeams;
            }
          }
        }
        // Convertir cada match mergeado
        for (const m of matchMap.values()) {
          const ev = parseMatch(m, sportName, regionName, compName);
          if (ev) out.push(ev);
        }
      }
    }
  }
  return out;
}

module.exports = { parseXmlFeed, parseMatch, normalizeSportName };
