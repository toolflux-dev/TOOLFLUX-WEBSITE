/* TOOLFLUX Machining Log — service worker
   Network-first for the page itself (so updates always flow through),
   cache fallback so the installed app opens with no internet at all. */
const CACHE = 'machlog-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put('./', copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match('./'))
    );
  }
});
