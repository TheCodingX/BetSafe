#!/usr/bin/env node
/* BetSafe — Build step: inyecta env vars en assets/js/env.js
 * ============================================================================
 * Render (y cualquier CI) corre este script en buildCommand.
 * Lee process.env.BS_* y escribe un archivo JS que setea window.__BS_CONFIG.
 *
 * El frontend lee window.__BS_CONFIG en runtime y usa esas keys, así no quedan
 * hardcodeadas en el código fuente público.
 *
 * Si las env vars no están seteadas, escribe un env.js vacío y la app cae
 * al modo demo (sin afectar el build).
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '..', 'assets', 'js', 'env.js');

const KEYS = {
  odds:           process.env.BS_ODDS_API_KEY || '',
  groq:           process.env.BS_GROQ_API_KEY || '',
  gemini:         process.env.BS_GEMINI_API_KEY || '',
  openrouter:     process.env.BS_OPENROUTER_API_KEY || '',
  footballData:   process.env.BS_FOOTBALL_DATA_API_KEY || '',
  supabaseUrl:    process.env.BS_SUPABASE_URL || '',
  supabaseAnonKey: process.env.BS_SUPABASE_ANON_KEY || ''
};

// Solo incluir keys con valor (las vacías quedan undefined y el código de la
// app cae a localStorage o a sus defaults).
const cfg = {};
for (const [k, v] of Object.entries(KEYS)) {
  if (v) cfg[k] = v;
}

const banner = `/* AUTO-GENERATED por build/inject-env.js
 * Build time: ${new Date().toISOString()}
 * Provee window.__BS_CONFIG con keys reales de tu entorno.
 * NO editar a mano: este archivo se sobreescribe en cada deploy.
 */
`;

const content = `${banner}window.__BS_CONFIG = ${JSON.stringify(cfg, null, 2)};
`;

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, content, 'utf8');

const populated = Object.keys(cfg).length;
const total = Object.keys(KEYS).length;
console.log(`[inject-env] wrote ${OUT_PATH}`);
console.log(`[inject-env] ${populated}/${total} keys cargadas desde env`);
if (populated === 0) {
  console.warn('[inject-env] WARNING: ninguna env var detectada. Build seguirá pero la app correrá en modo demo.');
}
