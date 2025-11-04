// Basic app-shell cache for offline use
const CACHE = 'exam-writer-v3';
const ASSETS = [
'/',
'/index.html',
'/styles.css',
'/app.js',
'/manifest.webmanifest',
'/icons/icon-192.png',
'/icons/icon-512.png'
];


self.addEventListener('install', (e) => {
e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
self.skipWaiting();
});


self.addEventListener('activate', (e) => {
e.waitUntil(
caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
);
self.clients.claim();
});


self.addEventListener('fetch', (e) => {
const url = new URL(e.request.url);
if (e.request.method === 'GET' && url.origin === location.origin) {
e.respondWith(
caches.match(e.request).then((cached) => cached || fetch(e.request))
);
}
});