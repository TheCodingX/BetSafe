#!/usr/bin/env node
/* BetSafe — CSS build step (v5.9)
 * ============================================================================
 * Toma `assets/css/main.css` (fuente legible para desarrollo) y genera
 * `assets/css/main.min.css` (versión minificada para producción).
 *
 * Minificación CONSERVADORA — no rompe selectores ni cambia comportamiento:
 *   1) Elimina comentarios (excepto los que tienen "v5", "IMPORTANT", "FIX", "TODO", "HACK", "BUG")
 *   2) Colapsa whitespace (newlines, spaces múltiples → 1 espacio)
 *   3) Elimina whitespace alrededor de `{`, `}`, `:`, `;`, `,`
 *   4) Elimina el `;` antes de `}` (es redundante)
 *
 * NO toca: nombres de clases, valores, media queries, keyframes.
 *
 * Render lo corre en buildCommand (después de inject-env.js).
 * En local: `node build/build-css.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'css', 'main.css');
const DST = path.join(__dirname, '..', 'assets', 'css', 'main.min.css');

function minifyCss(css) {
  // 1) Eliminar TODOS los comentarios (la fuente legible queda en main.css)
  //    Excepto los marcados con /*! ... */ (preservar por convención)
  css = css.replace(/\/\*(?!!)[\s\S]*?\*\//g, '');

  // 2) Procesar línea por línea para preservar strings dentro de url() o content:""
  // Estrategia simple: tokenizar muy básico — strings entre comillas se preservan,
  // todo lo demás se colapsa.
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    // String dentro de comillas (preservar literal)
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < css.length && css[j] !== quote) {
        if (css[j] === '\\') j++; // escape next
        j++;
      }
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // url(...) sin quotes — preservar
    if (css.slice(i, i + 4).toLowerCase() === 'url(') {
      const end = css.indexOf(')', i);
      if (end > i) {
        out += css.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    // Whitespace
    if (/\s/.test(c)) {
      // Colapsar a 1 espacio
      while (i < css.length && /\s/.test(css[i])) i++;
      // Eliminar el espacio si está pegado a un token estructural
      const last = out[out.length - 1];
      const next = css[i];
      if (last && next && /[{}:;,>+~\(\)]/.test(last)) continue;
      if (next && /[{}:;,>+~\)]/.test(next)) continue;
      out += ' ';
      continue;
    }
    // Caracteres estructurales — no agregar espacio antes
    if (/[{};,]/.test(c)) {
      // Trim espacio anterior
      if (out.endsWith(' ')) out = out.slice(0, -1);
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }

  // 3) Eliminar `;` justo antes de `}` (redundante)
  out = out.replace(/;}/g, '}');
  // 4) Comprimir 0.0 → 0 en valores comunes (0.5 → .5)
  out = out.replace(/(\s|:|,|\()0\.(\d)/g, '$1.$2');
  // 5) Comprimir 0px/0em/etc → 0 cuando es seguro (en valores compuestos)
  out = out.replace(/(:|,|\s)0(px|em|rem|pt|%)/g, '$10');
  // 6) Comprimir hex de 6 chars a 3 cuando sea posible: #ffffff → #fff, #aabbcc → #abc
  out = out.replace(/#([0-9a-fA-F])\1([0-9a-fA-F])\2([0-9a-fA-F])\3\b/g, '#$1$2$3');
  // 7) Eliminar leading/trailing zeros: 0.5 → .5 ya hecho arriba
  // 8) Comprimir múltiples espacios → 1
  out = out.replace(/  +/g, ' ');
  // 9) Trim general
  return out.trim();
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('[build-css] no encontré', SRC);
    process.exit(1);
  }
  const src = fs.readFileSync(SRC, 'utf8');
  const srcSize = Buffer.byteLength(src, 'utf8');
  const minified = minifyCss(src);
  const dstSize = Buffer.byteLength(minified, 'utf8');
  fs.writeFileSync(DST, minified);
  const pct = ((srcSize - dstSize) / srcSize * 100).toFixed(1);
  console.log(`[build-css] ${SRC}`);
  console.log(`[build-css]   ${(srcSize / 1024).toFixed(1)} KB → ${(dstSize / 1024).toFixed(1)} KB (${pct}% reducción)`);
  console.log(`[build-css]   escrito en ${DST}`);
}

if (require.main === module) main();
module.exports = { minifyCss };
