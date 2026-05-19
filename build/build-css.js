#!/usr/bin/env node
/* BetSafe — CSS minifier sin dependencias
 * ============================================================================
 * Lee assets/css/main.css, hace una minificación conservadora (comentarios +
 * whitespace + nesting), y escribe assets/css/main.min.css. Si main.css no
 * existe (caso primer deploy), no falla — solo loguea y sale OK.
 *
 * Este archivo se reintrodujo después del force-push de la cascada IA free
 * porque el Build Command de Render Dashboard quedó pidiéndolo. Mantener este
 * script aunque los HTMLs hoy referencien main.css directo: deja el camino
 * abierto para apuntarlos a .min.css cuando convenga (HTTP gain ~30-40%).
 * ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'css', 'main.css');
const DST = path.join(ROOT, 'assets', 'css', 'main.min.css');

function minifyCss(css) {
  let out = css;
  // 1) Remover comentarios /* ... */ (no greedy, multi-line).
  //    Preservamos comentarios con "!important" estilo /*! ... */ (license blocks).
  out = out.replace(/\/\*(?!!)[\s\S]*?\*\//g, '');
  // 2) Colapsar whitespace alrededor de { } : ; , >
  out = out.replace(/\s*([{}:;,>])\s*/g, '$1');
  // 3) Quitar último ; antes de }
  out = out.replace(/;}/g, '}');
  // 4) Colapsar saltos de línea y espacios consecutivos
  out = out.replace(/\s+/g, ' ');
  // 5) Quitar espacios al inicio/fin
  return out.trim();
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.log(`[build-css] ${SRC} no existe — skip (no fail)`);
    return;
  }
  const src = fs.readFileSync(SRC, 'utf8');
  const min = minifyCss(src);
  fs.writeFileSync(DST, min, 'utf8');
  const srcKb = (src.length / 1024).toFixed(1);
  const minKb = (min.length / 1024).toFixed(1);
  const pct = (((src.length - min.length) / src.length) * 100).toFixed(1);
  console.log(`[build-css] ${srcKb}KB → ${minKb}KB (-${pct}%) escrito en ${DST}`);
}

try {
  main();
} catch (e) {
  console.error(`[build-css] error: ${e.message}`);
  // No abortar el build por un fallo de minificación cosmética
  process.exit(0);
}
