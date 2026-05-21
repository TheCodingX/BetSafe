/* Env config — apuntamos al backend en VPS Argentina vía Cloudflare Tunnel.
 *
 * El backend corre en VPS DonWeb (Rosario, AR) en el puerto 8787 (HTTP) y
 * cloudflared expone esa app via un quick tunnel con HTTPS válido. Cuando
 * el tunnel se reinicia (reboot del VPS, kill manual), la URL CAMBIA: hay
 * que actualizar este archivo y re-deployar Netlify. Eventualmente migrar
 * a Named Tunnel con dominio propio para URL estable forever.
 *
 * Cómo regenerar:
 *   ssh root@138.219.41.212
 *   pm2 logs tunnel --lines 50 --nostream
 *   → buscar la línea "Visit it at: https://....trycloudflare.com"
 *   → copiar acá → commit + push (Netlify auto-deploya)
 */
window.__BS_CONFIG = window.__BS_CONFIG || {};
window.__BS_CONFIG.apiBase = 'https://pamela-legislature-logos-determined.trycloudflare.com';
