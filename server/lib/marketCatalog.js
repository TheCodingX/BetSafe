/* BetSafe — Market Catalog (single source of truth)
 * ============================================================================
 * 140+ mercados estructurados por deporte. Mantener esto SINCRONIZADO con:
 *   - server.js ALL_MARKETS_DEFAULT  (qué mercados aceptamos en /api/generator)
 *   - ai-pipeline.js extendedBySport (qué mercados mostramos al LLM)
 *   - factors/extendedMarkets.js     (qué mercados predecimos cuantitativamente)
 *
 * Cada entry:
 *   key     — id estable kebab-case (NO renombrar — se persiste en historial)
 *   sport   — soccer|basketball|tennis|amfootball|hockey|baseball|mma|esports
 *   name    — nombre humano corto en español argentino
 *   outcomes — array de outcomes posibles (o "line" si es over/under con línea)
 *   lines   — array de líneas típicas (cuando aplica)
 *   books   — 'all' (las 6 LOTBA) o array de keys de casas que lo cubren
 *   group   — agrupa mercados similares para UI
 *
 * "all" = ['bplay','betano','betwarrior','bet365ar','codere','betsson']
 * ============================================================================ */
'use strict';

const ALL_BOOKS = ['bplay', 'betano', 'betwarrior', 'bet365ar', 'codere', 'betsson'];

const MARKETS = [
  // ═══════════════════ FÚTBOL (40) ════════════════════════════════════════
  { key: 'match-winner',          sport: 'soccer', name: 'Ganador del partido (1X2)',         outcomes: ['1','X','2'],                  books: 'all',                                          group: 'principal' },
  { key: 'double-chance',         sport: 'soccer', name: 'Doble oportunidad',                 outcomes: ['1X','12','X2'],                books: 'all',                                          group: 'principal' },
  { key: 'dnb',                   sport: 'soccer', name: 'Empate no apuesta (DNB)',           outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'totals',                sport: 'soccer', name: 'Más/Menos goles totales',           outcomes: ['over','under'], lines: [0.5,1.5,2.5,3.5,4.5,5.5,6.5], books: 'all',                  group: 'goles' },
  { key: 'btts',                  sport: 'soccer', name: 'Ambos equipos anotan (BTTS)',       outcomes: ['yes','no'],                    books: 'all',                                          group: 'goles' },
  { key: 'result-btts',           sport: 'soccer', name: 'Resultado y ambos marcan',          outcomes: ['1-yes','1-no','X-yes','X-no','2-yes','2-no'], books: 'all',                          group: 'combos' },
  { key: 'ht-result',             sport: 'soccer', name: 'Resultado al descanso',             outcomes: ['1','X','2'],                   books: 'all',                                          group: 'ht' },
  { key: 'result-totals',         sport: 'soccer', name: 'Resultado y goles (1X2 + +/-2.5)',  outcomes: ['1-over','1-under','X-over','X-under','2-over','2-under'], lines: [2.5], books: 'all', group: 'combos' },
  { key: 'ah-asian',              sport: 'soccer', name: 'Hándicap asiático',                 outcomes: ['home','away'], lines: [-2.5,-2,-1.5,-1,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1,1.5,2,2.5], books: ['bet365ar','betano','bplay'],          group: 'handicap' },
  { key: 'ah-european',           sport: 'soccer', name: 'Hándicap europeo 3-vías',           outcomes: ['1','X','2'],   lines: [-2,-1,0,1,2],         books: ['codere','betsson','betwarrior'],     group: 'handicap' },
  { key: 'ht-ft',                 sport: 'soccer', name: 'Doble resultado HT/FT',             outcomes: ['1-1','1-X','1-2','X-1','X-X','X-2','2-1','2-X','2-2'],     books: 'all',                  group: 'ht' },
  { key: 'win-margin',            sport: 'soccer', name: 'Margen de victoria',                outcomes: ['by-1','by-2','by-3plus'],      books: ['bet365ar','betano','betsson'],                group: 'principal' },
  { key: 'exact-score',           sport: 'soccer', name: 'Marcador exacto',                   outcomes: ['1-0','0-0','2-1','2-0','2-2','3-1','3-0','3-2','1-1','0-1','0-2','1-2','any-other'], books: 'all', group: 'exacto' },
  { key: 'exact-score-ht',        sport: 'soccer', name: 'Marcador exacto 1er tiempo',        outcomes: ['1-0','0-0','1-1','0-1','2-0','0-2','any-other'], books: 'all',                       group: 'ht' },
  { key: 'first-team-to-score',   sport: 'soccer', name: 'Equipo que anota el 1er gol',      outcomes: ['home','away','none'],          books: 'all',                                          group: 'goles' },
  { key: 'corners-total',         sport: 'soccer', name: 'Más/Menos córners totales',         outcomes: ['over','under'], lines: [7.5,8.5,9.5,10.5,11.5,12.5,13.5], books: 'all',                group: 'corners' },
  { key: 'corners-ht',            sport: 'soccer', name: 'Más/Menos córners 1er tiempo',      outcomes: ['over','under'], lines: [3.5,4.5,5.5,6.5],     books: 'all',                          group: 'corners' },
  { key: 'corners-team',          sport: 'soccer', name: 'Córners por equipo',                outcomes: ['home-over','home-under','away-over','away-under'], lines: [4.5,5.5,6.5], books: ['betano','codere','bet365ar'], group: 'corners' },
  { key: 'corners-asian',         sport: 'soccer', name: 'Córners asiáticos',                 outcomes: ['home','away'], lines: [8,8.5,9,9.5,10,10.5,11,11.5,12], books: ['bet365ar','betano'],  group: 'corners' },
  { key: 'cards-total',           sport: 'soccer', name: 'Total tarjetas',                    outcomes: ['over','under'], lines: [2.5,3.5,4.5,5.5,6.5], books: 'all',                          group: 'cards' },
  { key: 'red-card',              sport: 'soccer', name: 'Tarjeta roja en el partido',        outcomes: ['yes','no'],                    books: 'all',                                          group: 'cards' },
  { key: 'player-card',           sport: 'soccer', name: 'Tarjeta para jugador X',            outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano','bplay'],                  group: 'cards' },
  { key: 'player-sent-off',       sport: 'soccer', name: 'Jugador expulsado',                 outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano'],                          group: 'cards' },
  { key: 'goalscorer-anytime',    sport: 'soccer', name: 'Goleador anytime',                  outcomes: ['yes','no'], byPlayer: true,    books: 'all',                                          group: 'scorer' },
  { key: 'first-goalscorer',      sport: 'soccer', name: 'Primer goleador',                   outcomes: ['player'], byPlayer: true,      books: ['betano','betwarrior','bet365ar'],             group: 'scorer' },
  { key: 'last-goalscorer',       sport: 'soccer', name: 'Último goleador',                   outcomes: ['player'], byPlayer: true,      books: 'all',                                          group: 'scorer' },
  { key: 'player-multi-goal',     sport: 'soccer', name: 'Anota 2 o más goles',               outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano'],                          group: 'scorer' },
  { key: 'player-scores-both-halves', sport: 'soccer', name: 'Marca en ambos tiempos',        outcomes: ['yes','no'], byPlayer: true,    books: ['betano','bet365ar'],                          group: 'scorer' },
  { key: 'shots-on-target-total', sport: 'soccer', name: 'Tiros al arco totales',             outcomes: ['over','under'], lines: [7.5,8.5,9.5,10.5], books: ['bet365ar','betano','bplay'],     group: 'tiros' },
  { key: 'player-shots-on-target',sport: 'soccer', name: 'Tiros al arco por jugador',         outcomes: ['over','under'], lines: [0.5,1.5,2.5], byPlayer: true, books: ['bet365ar','betano'], group: 'tiros' },
  { key: 'player-total-shots',    sport: 'soccer', name: 'Tiros totales por jugador',         outcomes: ['over','under'], lines: [1.5,2.5,3.5,4.5], byPlayer: true, books: ['bet365ar','betano','bplay'], group: 'tiros' },
  { key: 'player-assists',        sport: 'soccer', name: 'Asistencias por jugador',           outcomes: ['yes','no','over','under'], lines: [0.5,1.5], byPlayer: true, books: ['bet365ar','betano'], group: 'asistencias' },
  { key: 'fouls-total',           sport: 'soccer', name: 'Faltas totales',                    outcomes: ['over','under'], lines: [22.5], books: ['codere','betano','bet365ar'],                group: 'faltas' },
  { key: 'player-fouls-committed',sport: 'soccer', name: 'Faltas cometidas por jugador',      outcomes: ['over','under'], lines: [0.5,1.5,2.5], byPlayer: true, books: ['bet365ar','betano'], group: 'faltas' },
  { key: 'player-fouls-suffered', sport: 'soccer', name: 'Faltas recibidas por jugador',      outcomes: ['over','under'], lines: [1.5,2.5,3.5], byPlayer: true, books: ['betano','bplay'],    group: 'faltas' },
  { key: 'player-passes',         sport: 'soccer', name: 'Pases totales por jugador',         outcomes: ['over','under'], lines: [35.5,45.5,55.5,65.5,75.5], byPlayer: true, books: ['bet365ar','betano'], group: 'pases' },
  { key: 'player-tackles',        sport: 'soccer', name: 'Entradas (Tackles) por jugador',    outcomes: ['over','under'], lines: [1.5,2.5,3.5], byPlayer: true, books: ['bet365ar','betano'], group: 'tackles' },
  { key: 'penalty-in-match',      sport: 'soccer', name: 'Habrá penal en el partido',         outcomes: ['yes','no'],                    books: 'all',                                          group: 'eventos' },
  { key: 'free-kick-goal',        sport: 'soccer', name: 'Gol de tiro libre directo',         outcomes: ['yes','no'],                    books: ['bet365ar','betano'],                          group: 'eventos' },
  { key: 'first-goal-method',     sport: 'soccer', name: 'Método del primer gol',             outcomes: ['shot','header','penalty','own-goal','none'], books: ['bet365ar','betano'],         group: 'eventos' },

  // ═══════════════════ BÁSQUET (22) ═══════════════════════════════════════
  { key: 'moneyline',             sport: 'basketball', name: 'Ganador (Moneyline, incl. OT)',  outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'spread',                sport: 'basketball', name: 'Hándicap de puntos (Spread)',    outcomes: ['home','away'], lines: [-15.5,-12.5,-9.5,-6.5,-4.5,-2.5,-1.5,1.5,2.5,4.5,6.5,9.5,12.5,15.5], books: 'all', group: 'handicap' },
  { key: 'totals-points',         sport: 'basketball', name: 'Total de puntos',                outcomes: ['over','under'], lines: [145.5,165.5,185.5,205.5,215.5,225.5,235.5,245.5], books: 'all', group: 'totales' },
  { key: 'team-totals-points',    sport: 'basketball', name: 'Puntos por equipo (NBA)',        outcomes: ['home-over','home-under','away-over','away-under'], lines: [95.5,105.5,115.5], books: 'all', group: 'totales' },
  { key: 'q1-winner',             sport: 'basketball', name: 'Ganador del 1er Cuarto',         outcomes: ['1','X','2'],                   books: 'all',                                          group: 'parciales' },
  { key: 'q1-spread',             sport: 'basketball', name: 'Hándicap 1er Cuarto',            outcomes: ['home','away'], lines: [-5.5,-3.5,-1.5,1.5,3.5,5.5], books: 'all',                    group: 'parciales' },
  { key: 'q1-totals',             sport: 'basketball', name: 'Total puntos 1er Cuarto',        outcomes: ['over','under'], lines: [45.5,50.5,55.5,60.5], books: 'all',                          group: 'parciales' },
  { key: 'half-winner',           sport: 'basketball', name: 'Ganador 1er Tiempo (Mitad)',     outcomes: ['1','X','2'],                   books: 'all',                                          group: 'parciales' },
  { key: 'win-margin',            sport: 'basketball', name: 'Margen de victoria',             outcomes: ['1-5','6-10','11-15','16-20','21-25','26+'], books: 'all',                            group: 'principal' },
  { key: 'overtime',              sport: 'basketball', name: 'Ir a prórroga (OT)',             outcomes: ['yes','no'],                    books: 'all',                                          group: 'eventos' },
  { key: 'race-to-x',             sport: 'basketball', name: 'Carrera a 10/20 puntos',         outcomes: ['1','2'], lines: [10,15,20],     books: ['bet365ar','betano','bplay'],                  group: 'parciales' },
  { key: 'player-points',         sport: 'basketball', name: 'Puntos jugador NBA',             outcomes: ['over','under'], lines: [10.5,15.5,20.5,25.5,30.5,35.5], byPlayer: true, books: 'all', group: 'props' },
  { key: 'player-rebounds',       sport: 'basketball', name: 'Rebotes jugador',                outcomes: ['over','under'], lines: [3.5,5.5,7.5,9.5,11.5,13.5,15.5], byPlayer: true, books: 'all', group: 'props' },
  { key: 'player-assists',        sport: 'basketball', name: 'Asistencias jugador',            outcomes: ['over','under'], lines: [2.5,4.5,6.5,8.5,10.5,12.5], byPlayer: true, books: 'all',    group: 'props' },
  { key: 'player-steals',         sport: 'basketball', name: 'Robos jugador',                  outcomes: ['over','under'], lines: [0.5,1.5,2.5], byPlayer: true, books: ['bet365ar','betano','bplay'], group: 'props' },
  { key: 'player-blocks',         sport: 'basketball', name: 'Tapas/Bloqueos jugador',         outcomes: ['over','under'], lines: [0.5,1.5,2.5], byPlayer: true, books: ['bet365ar','betano'], group: 'props' },
  { key: 'player-threes',         sport: 'basketball', name: 'Triples anotados jugador',       outcomes: ['over','under'], lines: [0.5,1.5,2.5,3.5,4.5,5.5], byPlayer: true, books: 'all',     group: 'props' },
  { key: 'player-turnovers',      sport: 'basketball', name: 'Pérdidas de balón jugador',      outcomes: ['over','under'], lines: [1.5,2.5,3.5,4.5], byPlayer: true, books: ['bet365ar','betano'], group: 'props' },
  { key: 'player-double-double',  sport: 'basketball', name: 'Doble-doble jugador',            outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano','bplay'],                  group: 'props' },
  { key: 'player-triple-double',  sport: 'basketball', name: 'Triple-doble jugador',           outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano'],                          group: 'props' },
  { key: 'player-pra',            sport: 'basketball', name: 'Pts + Rebs + Asist jugador',     outcomes: ['over','under'], lines: [15.5,20.5,25.5,30.5,35.5,40.5,45.5], byPlayer: true, books: ['bet365ar','betano','bplay'], group: 'props' },

  // ═══════════════════ TENIS (15) ═════════════════════════════════════════
  { key: 'match-winner',          sport: 'tennis', name: 'Ganador del partido',                outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'set-score',             sport: 'tennis', name: 'Apuestas a sets (Marcador exacto)',  outcomes: ['2-0','2-1','3-0','3-1','3-2','0-2','1-2','0-3','1-3','2-3'], books: 'all',         group: 'sets' },
  { key: 'total-games',           sport: 'tennis', name: 'Total de juegos (Games)',            outcomes: ['over','under'], lines: [18.5,21.5,24.5,28.5,32.5,36.5,40.5], books: 'all',           group: 'games' },
  { key: 'games-handicap',        sport: 'tennis', name: 'Hándicap de juegos',                 outcomes: ['home','away'], lines: [-8.5,-5.5,-3.5,-1.5,1.5,3.5,5.5,8.5], books: 'all',           group: 'handicap' },
  { key: 'set1-winner',           sport: 'tennis', name: 'Ganador Set 1',                      outcomes: ['1','2'],                       books: 'all',                                          group: 'parciales' },
  { key: 'set1-total-games',      sport: 'tennis', name: 'Total juegos Set 1',                 outcomes: ['over','under'], lines: [8.5,9.5,10.5,11.5,12.5], books: 'all',                      group: 'parciales' },
  { key: 'set1-exact-score',      sport: 'tennis', name: 'Resultado exacto Set 1',             outcomes: ['6-0','6-1','6-2','6-3','6-4','7-5','7-6'], books: 'all',                            group: 'parciales' },
  { key: 'sets-handicap',         sport: 'tennis', name: 'Hándicap de sets',                   outcomes: ['home','away'], lines: [-2.5,-1.5,1.5,2.5], books: 'all',                            group: 'handicap' },
  { key: 'tiebreak-in-match',     sport: 'tennis', name: 'Habrá Tiebreak en el partido',       outcomes: ['yes','no'],                    books: 'all',                                          group: 'eventos' },
  { key: 'total-tiebreaks',       sport: 'tennis', name: 'Total tiebreaks',                    outcomes: ['over','under'], lines: [0.5,1.5,2.5], books: ['betano','bet365ar'],                   group: 'eventos' },
  { key: 'both-players-win-set',  sport: 'tennis', name: 'Ambos jugadores ganan un set',       outcomes: ['yes','no'],                    books: ['bet365ar','betano','betsson'],                group: 'eventos' },
  { key: 'total-aces',            sport: 'tennis', name: 'Total de Aces en el partido',        outcomes: ['over','under'], lines: [10.5,14.5,18.5,21.5,25.5], books: ['bet365ar','betano'],     group: 'aces' },
  { key: 'player-aces',           sport: 'tennis', name: 'Aces por jugador',                   outcomes: ['over','under'], lines: [5.5,8.5,10.5,12.5,15.5], byPlayer: true, books: ['bet365ar','betano'], group: 'aces' },
  { key: 'double-faults',         sport: 'tennis', name: 'Doble faltas en el partido',         outcomes: ['over','under'], lines: [4.5,6.5,8.5,10.5,12.5], books: ['bet365ar','betano'],         group: 'errores' },
  { key: 'fastest-serve',         sport: 'tennis', name: 'Velocidad del servicio más rápido',  outcomes: ['over','under'], lines: [195,205,215,225], books: ['betano'],                        group: 'props' },

  // ═══════════════════ eSPORTS (15) ═══════════════════════════════════════
  { key: 'match-winner',          sport: 'esports', name: 'Ganador del partido',               outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'maps-handicap',         sport: 'esports', name: 'Hándicap de mapas',                 outcomes: ['home','away'], lines: [-1.5,1.5],              books: 'all',                          group: 'handicap' },
  { key: 'maps-total',            sport: 'esports', name: 'Total de mapas',                    outcomes: ['over','under'], lines: [2.5],                   books: 'all',                          group: 'principal' },
  { key: 'maps-exact-score',      sport: 'esports', name: 'Marcador exacto de mapas',          outcomes: ['2-0','2-1','3-0','3-1','3-2','0-2','1-2','0-3','1-3','2-3'], books: 'all',         group: 'principal' },
  { key: 'map1-winner',           sport: 'esports', name: 'Ganador Mapa 1',                    outcomes: ['1','2'],                       books: 'all',                                          group: 'parciales' },
  { key: 'map2-winner',           sport: 'esports', name: 'Ganador Mapa 2',                    outcomes: ['1','2'],                       books: 'all',                                          group: 'parciales' },
  { key: 'pistol-round',          sport: 'esports', name: 'Pistol round (Ronda 1) CS2/Val',    outcomes: ['1','2'],                       books: ['bet365ar','betano','bplay'],                  group: 'csgo-val' },
  { key: 'rounds-total',          sport: 'esports', name: 'Total rondas CS2/Val',              outcomes: ['over','under'], lines: [21.5,23.5,24.5,25.5,26.5], books: ['bet365ar','betano'],     group: 'csgo-val' },
  { key: 'rounds-handicap',       sport: 'esports', name: 'Hándicap rondas CS2/Val',           outcomes: ['home','away'], lines: [-5.5,-3.5,-2.5,2.5,3.5,5.5], books: ['bet365ar','betano'],   group: 'csgo-val' },
  { key: 'overtime',              sport: 'esports', name: 'Irá a Overtime CS2/Val',            outcomes: ['yes','no'],                    books: ['bet365ar','betano'],                          group: 'csgo-val' },
  { key: 'first-blood',           sport: 'esports', name: 'Primera Sangre (First Blood)',      outcomes: ['1','2'],                       books: ['bet365ar','betano','bplay'],                  group: 'moba' },
  { key: 'first-tower',           sport: 'esports', name: 'Primera Torre destruida',           outcomes: ['1','2'],                       books: ['bet365ar','betano'],                          group: 'moba' },
  { key: 'first-objective',       sport: 'esports', name: 'Primer Dragón/Roshan',              outcomes: ['1','2'],                       books: ['bet365ar','betano'],                          group: 'moba' },
  { key: 'kills-total',           sport: 'esports', name: 'Total de Kills',                    outcomes: ['over','under'], lines: [25.5,30.5,35.5,40.5,45.5], books: ['bet365ar','betano'],     group: 'moba' },
  { key: 'map-duration',          sport: 'esports', name: 'Duración del mapa (min)',           outcomes: ['over','under'], lines: [28.5,32.5,36.5], books: ['bet365ar','betano'],              group: 'moba' },

  // ═══════════════════ NFL (16) ═══════════════════════════════════════════
  { key: 'moneyline',             sport: 'amfootball', name: 'Ganador (Moneyline)',             outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'spread',                sport: 'amfootball', name: 'Hándicap (Spread)',               outcomes: ['home','away'], lines: [-14.5,-10.5,-7.5,-5.5,-3.5,-1.5,1.5,3.5,5.5,7.5,10.5,14.5], books: 'all', group: 'handicap' },
  { key: 'totals-points',         sport: 'amfootball', name: 'Total de puntos',                 outcomes: ['over','under'], lines: [35.5,40.5,45.5,50.5,55.5], books: 'all',                    group: 'totales' },
  { key: 'team-totals',           sport: 'amfootball', name: 'Total puntos por equipo',         outcomes: ['home-over','home-under','away-over','away-under'], lines: [17.5,21.5,24.5,28.5], books: 'all', group: 'totales' },
  { key: 'half-winner',           sport: 'amfootball', name: 'Ganador 1er Tiempo',              outcomes: ['1','X','2'],                   books: 'all',                                          group: 'parciales' },
  { key: 'half-spread',           sport: 'amfootball', name: 'Hándicap 1er Tiempo',             outcomes: ['home','away'], lines: [-7.5,-3.5,-0.5,0.5,3.5,7.5], books: 'all',                    group: 'parciales' },
  { key: 'win-margin',            sport: 'amfootball', name: 'Margen de victoria',              outcomes: ['1-6','7-12','13-18','19-24','25+'], books: ['bet365ar','betano','codere'],            group: 'principal' },
  { key: 'td-anytime',            sport: 'amfootball', name: 'Touchdown anytime',               outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano','bplay'],                  group: 'props' },
  { key: 'td-first',              sport: 'amfootball', name: 'Primer jugador con TD',           outcomes: ['player'], byPlayer: true,      books: ['bet365ar','betano'],                          group: 'props' },
  { key: 'player-multi-td',       sport: 'amfootball', name: 'Anota 2+ TDs',                    outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano'],                          group: 'props' },
  { key: 'qb-pass-yards',         sport: 'amfootball', name: 'Yardas de pase por QB',           outcomes: ['over','under'], lines: [180.5,220.5,250.5,275.5,300.5], byPlayer: true, books: ['bet365ar','betano','bplay'], group: 'qb' },
  { key: 'qb-pass-tds',           sport: 'amfootball', name: 'Pases de TD por QB',              outcomes: ['over','under'], lines: [1.5,2.5], byPlayer: true, books: ['bet365ar','betano'],     group: 'qb' },
  { key: 'qb-interceptions',      sport: 'amfootball', name: 'Intercepciones lanzadas por QB',  outcomes: ['over','under'], lines: [0.5], byPlayer: true, books: ['bet365ar','betano'],         group: 'qb' },
  { key: 'player-rush-yards',     sport: 'amfootball', name: 'Yardas por tierra jugador',       outcomes: ['over','under'], lines: [40.5,60.5,75.5,90.5], byPlayer: true, books: ['bet365ar','betano'], group: 'props' },
  { key: 'player-rec-yards',      sport: 'amfootball', name: 'Yardas por recepción jugador',    outcomes: ['over','under'], lines: [30.5,50.5,65.5,80.5], byPlayer: true, books: ['bet365ar','betano'], group: 'props' },
  { key: 'overtime',              sport: 'amfootball', name: 'Habrá Prórroga (OT)',             outcomes: ['yes','no'],                    books: 'all',                                          group: 'eventos' },

  // ═══════════════════ NHL (12) ═══════════════════════════════════════════
  { key: 'moneyline',             sport: 'hockey', name: 'Ganador (incl. OT y penales)',        outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'regulation-winner',     sport: 'hockey', name: 'Ganador Tiempo Reglamentario (60min)', outcomes: ['1','X','2'],                  books: 'all',                                          group: 'principal' },
  { key: 'puck-line',             sport: 'hockey', name: 'Línea de Puck (Hándicap)',            outcomes: ['home','away'], lines: [-1.5,1.5], books: 'all',                                      group: 'handicap' },
  { key: 'totals-goals',          sport: 'hockey', name: 'Total de goles',                      outcomes: ['over','under'], lines: [4.5,5.5,6.5,7.5], books: 'all',                              group: 'totales' },
  { key: 'both-teams-2-goals',    sport: 'hockey', name: 'Ambos equipos anotan 2+ goles',       outcomes: ['yes','no'],                    books: ['bet365ar','betano'],                          group: 'totales' },
  { key: 'p1-winner',             sport: 'hockey', name: 'Ganador 1er Período',                 outcomes: ['1','X','2'],                   books: 'all',                                          group: 'parciales' },
  { key: 'p1-totals',             sport: 'hockey', name: 'Total goles 1er Período',             outcomes: ['over','under'], lines: [1.5], books: 'all',                                          group: 'parciales' },
  { key: 'exact-score',           sport: 'hockey', name: 'Resultado exacto',                    outcomes: ['1-0','2-0','2-1','3-1','3-2','4-1','4-2','any-other'], books: 'all',                  group: 'exacto' },
  { key: 'player-scores',         sport: 'hockey', name: 'Marcador en cualquier momento',       outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano','bplay'],                  group: 'props' },
  { key: 'player-shots',          sport: 'hockey', name: 'Tiros a puerta por jugador',          outcomes: ['over','under'], lines: [1.5,2.5,3.5,4.5], byPlayer: true, books: ['bet365ar','betano'], group: 'props' },
  { key: 'player-points',         sport: 'hockey', name: 'Puntos por jugador (G+A)',            outcomes: ['over','under'], lines: [0.5,1.5], byPlayer: true, books: ['bet365ar','betano'],     group: 'props' },
  { key: 'first-goal-team',       sport: 'hockey', name: 'Equipo en marcar el 1er gol',         outcomes: ['1','2'],                       books: 'all',                                          group: 'parciales' },

  // ═══════════════════ MLB (15) ═══════════════════════════════════════════
  { key: 'moneyline',             sport: 'baseball', name: 'Ganador (Moneyline)',               outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'run-line',              sport: 'baseball', name: 'Línea de Carreras (Hándicap)',      outcomes: ['home','away'], lines: [-1.5,1.5], books: 'all',                                      group: 'handicap' },
  { key: 'run-line-alt',          sport: 'baseball', name: 'Línea de Carreras Alternativa',     outcomes: ['home','away'], lines: [-4.5,-3.5,-2.5,2.5,3.5,4.5], books: ['bet365ar','betano'],   group: 'handicap' },
  { key: 'totals-runs',           sport: 'baseball', name: 'Total de carreras',                 outcomes: ['over','under'], lines: [6.5,7.5,8.5,9.5,10.5,11.5], books: 'all',                    group: 'totales' },
  { key: 'team-totals-runs',      sport: 'baseball', name: 'Total carreras por equipo',         outcomes: ['home-over','home-under','away-over','away-under'], lines: [3.5,4.5,5.5], books: 'all', group: 'totales' },
  { key: 'f5-winner',             sport: 'baseball', name: 'Ganador 1ras 5 Entradas (F5)',      outcomes: ['1','X','2'],                   books: ['bet365ar','betano','bplay','codere'],          group: 'f5' },
  { key: 'f5-totals',             sport: 'baseball', name: 'Total carreras F5',                 outcomes: ['over','under'], lines: [3.5,4.5,5.5], books: ['bet365ar','betano'],                   group: 'f5' },
  { key: 'f5-handicap',           sport: 'baseball', name: 'Hándicap F5',                       outcomes: ['home','away'], lines: [-0.5,0.5], books: ['bet365ar','betano'],                      group: 'f5' },
  { key: 'yrfi-nrfi',             sport: 'baseball', name: 'Carrera en 1ra Entrada (YRFI/NRFI)', outcomes: ['yes','no'],                   books: ['bet365ar','betano','bplay'],                  group: 'eventos' },
  { key: 'total-hits',            sport: 'baseball', name: 'Hits totales del partido',          outcomes: ['over','under'], lines: [14.5,15.5,16.5,17.5,18.5], books: ['bet365ar','betano'],     group: 'eventos' },
  { key: 'player-hr',             sport: 'baseball', name: 'Home Run por jugador',              outcomes: ['yes','no'], byPlayer: true,    books: ['bet365ar','betano','bplay'],                  group: 'props' },
  { key: 'player-bases',          sport: 'baseball', name: 'Bases totales por jugador',         outcomes: ['over','under'], lines: [0.5,1.5,2.5], byPlayer: true, books: ['bet365ar','betano'], group: 'props' },
  { key: 'player-hits',           sport: 'baseball', name: 'Hits por jugador',                  outcomes: ['over','under'], lines: [0.5,1.5], byPlayer: true, books: ['bet365ar','betano'],     group: 'props' },
  { key: 'player-rbi',            sport: 'baseball', name: 'RBI por jugador',                   outcomes: ['over','under'], lines: [0.5], byPlayer: true, books: ['bet365ar','betano'],         group: 'props' },
  { key: 'pitcher-ks',            sport: 'baseball', name: 'Ks (ponches) por lanzador',         outcomes: ['over','under'], lines: [4.5,5.5,6.5,7.5,8.5], byPlayer: true, books: ['bet365ar','betano','bplay'], group: 'props' },

  // ═══════════════════ MMA / UFC (8) ══════════════════════════════════════
  { key: 'moneyline',             sport: 'mma', name: 'Ganador (Moneyline)',                    outcomes: ['1','2'],                       books: 'all',                                          group: 'principal' },
  { key: 'method',                sport: 'mma', name: 'Método de victoria',                     outcomes: ['ko-tko','submission','decision'], books: 'all',                                      group: 'principal' },
  { key: 'total-rounds',          sport: 'mma', name: 'Total de asaltos',                       outcomes: ['over','under'], lines: [1.5,2.5,3.5,4.5], books: 'all',                              group: 'principal' },
  { key: 'fight-goes-distance',   sport: 'mma', name: 'La pelea completa todos los asaltos',    outcomes: ['yes','no'],                    books: 'all',                                          group: 'principal' },
  { key: 'round-betting',         sport: 'mma', name: 'Round betting',                          outcomes: ['1-by-1','1-by-2','1-by-3','1-by-4','1-by-5','1-by-dec','2-by-1','2-by-2','2-by-3','2-by-4','2-by-5','2-by-dec'], books: 'all', group: 'principal' },
  { key: 'method-double-chance',  sport: 'mma', name: 'Doble Oportunidad de Método',            outcomes: ['ko-or-sub','sub-or-dec','ko-or-dec'], books: ['bet365ar','betano'],                  group: 'principal' },
  { key: 'first-minute-finish',   sport: 'mma', name: 'Pelea termina en el 1er minuto',         outcomes: ['yes','no'],                    books: ['bet365ar','betano'],                          group: 'eventos' },
  { key: 'judges-decision',       sport: 'mma', name: 'Decisión de los jueces',                 outcomes: ['unanimous','split','majority'], books: ['bet365ar','betano','betsson'],               group: 'eventos' }
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Compone una clave única por deporte+key (varios sports comparten 'moneyline', etc.) */
function uniqueKey(market) {
  return `${market.sport}.${market.key}`;
}

/** Devuelve mercados disponibles para un deporte específico. */
function marketsForSport(sport) {
  return MARKETS.filter(m => m.sport === sport);
}

/** Devuelve mercados que CUBRE una casa específica (entre los seleccionados por el user). */
function marketsForBooks(books) {
  if (!Array.isArray(books) || !books.length) return MARKETS;
  return MARKETS.filter(m => {
    if (m.books === 'all') return true;
    return m.books.some(b => books.includes(b));
  });
}

/** Devuelve mercados disponibles para deporte + casas seleccionadas. */
function marketsForSportAndBooks(sport, books) {
  return marketsForSport(sport).filter(m => {
    if (m.books === 'all') return true;
    if (!Array.isArray(books) || !books.length) return true;
    return m.books.some(b => books.includes(b));
  });
}

/** Lista PLANA de keys (con prefijo sport.) — útil para validación de filtros. */
function allKeys() {
  return MARKETS.map(uniqueKey);
}

/** Lista plana de keys SIN prefijo de deporte (compat con ALL_MARKETS_DEFAULT viejo). */
function allLegacyKeys() {
  return [...new Set(MARKETS.map(m => m.key))];
}

/** Devuelve true si un key:string corresponde a un mercado registrado. */
function isKnownMarket(key, sport) {
  if (sport) return MARKETS.some(m => m.key === key && m.sport === sport);
  return MARKETS.some(m => m.key === key);
}

/** Renderiza una lista de mercados como string compacto para incluir en system
 *  prompt LLM. Una línea por mercado: "  • key (Nombre) — outcomes — líneas". */
function describeForPrompt(sport, books) {
  const list = marketsForSportAndBooks(sport, books);
  return list.map(m => {
    const lineStr = m.lines ? ` (líneas: ${m.lines.join(', ')})` : '';
    const playerStr = m.byPlayer ? ' [por jugador]' : '';
    return `  • ${m.key} — ${m.name} — outcomes: ${(m.outcomes||[]).join('|')}${lineStr}${playerStr}`;
  }).join('\n');
}

module.exports = {
  MARKETS,
  ALL_BOOKS,
  marketsForSport,
  marketsForBooks,
  marketsForSportAndBooks,
  allKeys,
  allLegacyKeys,
  isKnownMarket,
  describeForPrompt
};
