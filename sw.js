// BetSafe Service Worker — KILLER (2026-05-17)
//
// El SW causó múltiples bugs persistentes de cache stale para los usuarios
// (combos del 14-may apareciendo el 17, selector de casino invisible aunque
// el JS estuviera deployado, etc.). Decisión: REMOVER el SW completamente.
//
// Este archivo, al ser fetcheado por browsers con SW v5.3-v5.8 registrado:
//   1) Se instala (skipWaiting) y activa inmediatamente
//   2) Borra TODOS los caches que pudo crear cualquier versión anterior
//   3) Se DESREGISTRA a sí mismo
//   4) Notifica a las pestañas abiertas para que recarguen
//
// app.js ya no registra el SW (línea ~61 fue removida), así que tras esto
// los nuevos visitantes nunca van a tener SW activo.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) Borrar TODOS los caches (no solo de versiones viejas — todos)
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // 2) Tomar control de todas las pestañas para poder notificarles
    await self.clients.claim();
    // 3) Desregistrar este SW
    await self.registration.unregister();
    // 4) Recargar pestañas para que carguen sin SW intermediario
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url));
  })());
});

// Fetch handler "pass-through": no interceptamos NADA mientras quedemos
// activos por algunos milisegundos hasta que unregister termine.
// (Sin handler, el browser usa la red directo igual.)
