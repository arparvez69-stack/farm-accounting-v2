// Service Worker for The Goated Farm (Offline-First Agro ERP)
const CACHE_NAME = 'the-goated-farm-shell-v2';

// Core app shell assets to precache on install
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg'
];

// Install: Precache app shell assets and activate immediately
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

// Activate: Clean up legacy caches and claim active clients
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

// Fetch: Stale-while-revalidate for static assets & app shell
// STRICT RULE: Never cache POST requests or any /api/* responses.
self.addEventListener('fetch', (event) => {
  // 1. Only handle GET requests (never cache POST, PUT, DELETE)
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // 2. Never cache /api/* responses (bypass SW and go straight to network)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 3. Ignore non-HTTP/HTTPS protocols (e.g. chrome-extension:)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // 4. Bypass external Firebase and identity endpoints
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('identitytoolkit') ||
    url.hostname.includes('securetoken')
  ) {
    return;
  }

  // 5. Stale-While-Revalidate strategy for static assets & app shell
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);

      // Background network fetch to revalidate/update cache
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Cache successful 200 responses for static assets
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          // Network failure fallback for navigation requests
          if (event.request.mode === 'navigate') {
            const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
            if (fallback) return fallback;
          }
          return null;
        });

      // If cached response exists, return it immediately (stale)
      // and revalidate cache in the background
      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      // If not yet in cache, await the network fetch
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // If network failed and it is a navigation request, return cached index.html
      if (event.request.mode === 'navigate') {
        const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
        if (fallback) return fallback;
      }

      // Final fallback for missing static assets when offline
      return new Response('Offline', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});
