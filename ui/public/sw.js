/*
 * BalaBot service worker — deliberately minimal.
 *
 * BalaBot is a LIVE agent console: chat uses SSE streaming (/api/*) and agent
 * state changes constantly. Caching API responses or any runtime asset would
 * show stale data and break streaming. Therefore:
 *
 *   - /api/* is NEVER intercepted or cached (the fetch handler ignores it).
 *   - We precache ONLY a tiny offline fallback page.
 *   - Navigation requests fall back to it only when offline.
 *   - No cache-first/SLR strategies anywhere: the network is always the
 *     source of truth for the app itself; the browser HTTP cache handles
 *     hashed /assets/* fine on its own.
 *
 * The offline page is tiny because the app can't function offline anyway
 * (it needs the live backend).
 */
const CACHE_NAME = 'balabot-shell-v1';
const OFFLINE_URL = '/offline.html';

const PRECACHE = [OFFLINE_URL];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NEVER touch the live API or SSE stream — pass straight through.
  if (url.pathname.startsWith('/api/')) return;

  // Only navigation requests get an offline fallback. Everything else is
  // left to the network + browser HTTP cache (no SW caching of app code).
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL, { ignoreSearch: true })
    )
  );
});
