const CACHE = 'silva-xvi-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './network.js',
  './manifest.json',
  './vendor/qrcode.min.js', './vendor/jsQR.js',
  './sounds/nudge.wav', './sounds/message.wav', './sounds/ring.wav',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => {
      const network = fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => hit || caches.match('./index.html'));
      return hit || network;
    })
  );
});
