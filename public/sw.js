// Service Worker for The Goated Farm (Offline-First Agro ERP)
const CACHE_NAME = 'the-goated-farm-shell-v3';

// Core app shell assets to precache on install
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png'
];

// 1. Install: Precache app shell assets and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_ASSETS).catch((err) => {
        console.warn('[SW] App shell precache warning:', err);
      });
    })
  );
  // Force activating the newly installed service worker without waiting for old clients to close
  self.skipWaiting();
});

// 2. Activate: Clean up legacy caches and immediately claim active clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  // Take control of all open client tabs immediately
  self.clients.claim();
});

// 3. Message: Allow client pages to trigger immediate activation
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 4. Fetch: Safe strategy ensuring new deployments activate without trapping users
// STRICT RULE 1: Never cache POST/PUT/DELETE requests or any /api/* responses.
// STRICT RULE 2: Navigation requests (HTML pages) use Network-First to guarantee latest version.
// STRICT RULE 3: Offline IndexedDB data is never altered or cleared by the service worker.
self.addEventListener('fetch', (event) => {
  // Never intercept non-GET requests (e.g. POST, PUT, DELETE)
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Never cache /api/* responses — bypass service worker and go straight to network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Never intercept or cache Vite development modules, node_modules, or hot-reload assets
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@') ||
    url.searchParams.has('v') ||
    url.searchParams.has('t') ||
    url.searchParams.has('import')
  ) {
    return;
  }

  // Ignore non-http(s) schemes (e.g., chrome-extension:)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Bypass Firebase Auth and internal identity endpoints
  if (
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken') ||
    url.hostname.includes('firebaseio.com')
  ) {
    return;
  }

  // Strategy A: Navigation requests (HTML documents)
  // NETWORK-FIRST with CACHE FALLBACK:
  // Guarantees newly deployed code is received immediately without trapping users on stale bundles.
  // Falls back seamlessly to cached index.html when offline so the ERP works without an internet connection.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
            cache.put('/index.html', networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // Network unavailable: fall back to cached shell
        }

        const cache = await caches.open(CACHE_NAME);
        const cachedResponse =
          (await cache.match(event.request)) ||
          (await cache.match('/index.html')) ||
          (await cache.match('/'));

        if (cachedResponse) {
          return cachedResponse;
        }

        return new Response('Offline - The Goated Farm', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // Strategy B: Static assets (scripts, styles, icons, fonts, illustrations)
  // STALE-WHILE-REVALIDATE:
  // Serves instant cached assets while revalidating in background for lightning-fast loads.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);

      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});
