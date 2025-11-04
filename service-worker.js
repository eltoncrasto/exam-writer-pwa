// ---- PWA service worker tuned for GitHub Pages + kiosk ----
// Cache version. Bump on deploys when not using hashed assets.
const VERSION = 'v6.1';
const CACHE_PREFIX = 'exam-writer';
const PRECACHE = `${CACHE_PREFIX}-precache-${VERSION}`;
const RUNTIME = `${CACHE_PREFIX}-runtime-${VERSION}`;

// Detect the scope path so it works in subfolders like /exam-writer-pwa/
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/+$/, '') + '/';
// e.g. '/exam-writer-pwa/' or '/' if at root

// Precache your app shell (paths relative to scope)
const ASSETS = [
  '',                 // resolves to SCOPE_PATH (i.e., start_url)
  'index.html',
  'offline.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
].map(p => SCOPE_PATH + p);

// Optional: enable navigation preload for faster first paint
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    // Clean up old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && ![PRECACHE, RUNTIME].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // Use 'reload' to avoid cached index.html on first install
    await cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
  })());
  self.skipWaiting();
});

// Network helpers
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    // Only cache good same-origin GETs
    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => undefined);
  return cached || fetchPromise || Promise.reject('SW: no response');
}

async function cacheOnly(urlPath) {
  const cache = await caches.open(PRECACHE);
  return cache.match(urlPath);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin with our strategies
  const isSameOrigin = url.origin === self.location.origin;

  // 1) SPA navigations: network-first, fall back to cached index.html, then offline.html
  const isNavigation = request.mode === 'navigate';

  if (isNavigation && isSameOrigin) {
    event.respondWith((async () => {
      try {
        // Use navigation preload if available
        const preload = await event.preloadResponse;
        if (preload) return preload;

        const network = await fetch(request);
        // Successful HTML? great.
        if (network.ok) return network;
        throw new Error('Bad HTML response');
      } catch {
        // Fallback to cached app shell
        const cachedIndex = await cacheOnly(SCOPE_PATH + 'index.html');
        if (cachedIndex) return cachedIndex;

        const offline = await cacheOnly(SCOPE_PATH + 'offline.html');
        if (offline) return offline;

        // Last resort
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // 2) Static same-origin assets: stale-while-revalidate
  if (isSameOrigin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3) Cross-origin requests: try network, fall back to cache if we happen to have it
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      return res;
    } catch {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(request);
      if (cached) return cached;
      // If it’s a font or image, show something helpful? (Optional: return offline asset)
      return new Response('', { status: 502 });
    }
  })());
});

// Allow your app to trigger immediate SW activation
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
