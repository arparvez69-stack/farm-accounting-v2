// Service Worker for The Goated Farm (Offline-First Agro ERP)
const CACHE_NAME = 'the-goated-farm-shell-v1';

// Core app shell assets to precache on install
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg'
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
  self.skipWaiting();
});

// 2. Activate: Clean up legacy caches and claim active clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch: Stale-While-Revalidate for static assets & app shell
// STRICT RULE: Never cache POST requests or any /api/* responses — only static assets.
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

  // Stale-While-Revalidate caching strategy for app shell and static assets
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Look for matching resource in cache
      let cachedResponse = await cache.match(event.request);

      // If navigation request and not directly cached, fall back to cached /index.html
      if (!cachedResponse && event.request.mode === 'navigate') {
        cachedResponse = (await cache.match('/index.html')) || (await cache.match('/'));
      }

      // 2. Network revalidation promise to update cache in the background
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          // If network fetch fails and this is a navigation request, serve cached shell
          if (event.request.mode === 'navigate') {
            const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
            if (fallback) return fallback;
          }
          return null;
        });

      // 3. If cached response exists, return it immediately (stale)
      // and revalidate cache in background
      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      // 4. If not yet in cache, await the network fetch
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // 5. Final fallback for navigation requests when completely offline
      if (event.request.mode === 'navigate') {
        const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
        if (fallback) return fallback;
      }

      // 6. Return offline status for missing assets
      return new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});
