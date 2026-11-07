/* SEMATEC ACADEMY — service worker: app instalable y uso sin conexión.
 * - Páginas (/app/...): red primero; si no hay internet, la última copia guardada.
 * - Archivos estáticos de la app (/_next/static): caché primero (no cambian entre versiones).
 * - Imágenes (/media) y materiales del aula: se guardan al verlos.
 * - Nunca se guardan /api, /auth, /instalar ni respuestas de otros sitios.
 * Al cerrar sesión el servidor envía Clear-Site-Data: "cache" y todo se borra del dispositivo. */
const VERSION = 'v1';
const STATIC = 'sematec-static-' + VERSION;
const PAGES = 'sematec-pages';
const MEDIA = 'sematec-media';
const MAX_PAGES = 80;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sematec-static-') && k !== STATIC) await caches.delete(k);
    await self.clients.claim();
  })());
});

const NO_CACHE = /^\/(api|auth|instalar|pago|login|mfa|recuperar|cambiar-clave)(\/|$)/;

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function pageNetworkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    // Solo copias completas y del propio usuario (nada de redirecciones al login ni errores)
    if (res.ok && !res.redirected && res.type === 'basic') {
      await cache.put(req.url, res.clone());
      trim(PAGES, MAX_PAGES);
    }
    return res;
  } catch {
    const hit = (await cache.match(req.url)) || (await cache.match(req.url, { ignoreSearch: true }));
    if (hit) return hit;
    return (await caches.match('/offline.html')) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NO_CACHE.test(url.pathname)) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/app/aula/archivo/')) {
    e.respondWith(staleWhileRevalidate(req, MEDIA));
    return;
  }
  // Datos de navegación interna de Next (RSC): si falla, Next recarga la página completa y entra la regla de abajo
  if (req.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return;
  if (req.mode === 'navigate' && url.pathname.startsWith('/app')) {
    e.respondWith(pageNetworkFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match(req.url)) || (await caches.match('/offline.html')) || Response.error()));
  }
});

// Preparar para usar sin conexión: la app envía la lista de páginas principales del usuario.
self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'warm' && Array.isArray(msg.urls)) {
    e.waitUntil((async () => {
      const pages = await caches.open(PAGES);
      const stat = await caches.open(STATIC);
      let done = 0;
      for (const path of msg.urls.slice(0, 40)) {
        try {
          const u = new URL(path, self.location.origin);
          if (u.origin !== self.location.origin || !u.pathname.startsWith('/app')) continue;
          const res = await fetch(u.href, { credentials: 'same-origin' });
          if (!res.ok || res.redirected) continue;
          const html = await res.clone().text();
          await pages.put(u.href, res);
          // Los archivos JS/CSS que esa página necesita para funcionar
          const assets = Array.from(new Set(html.match(/\/_next\/static\/[^"'\s\\)]+/g) || []));
          for (const a of assets) if (!(await stat.match(a))) { try { const r = await fetch(a); if (r.ok) await stat.put(a, r); } catch {} }
          done++;
        } catch {}
      }
      e.source && e.source.postMessage({ type: 'warm-done', count: done });
    })());
  }
});
