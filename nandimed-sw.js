/* NANDI Med — service worker
   Network-first for the page (updates always flow through),
   cache fallback so the installed app opens with no internet. */
const CACHE = 'nandimed-v2';
const ASSETS = ['./nandimed.html','./nandimed.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
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
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put('./nandimed.html', copy)).catch(() => {});
        return r;
      }).catch(() => caches.match('./nandimed.html'))
    );
    return;
  }
  // For the JS: network-first, cache fallback. Cache-first would serve stale
  // code for a whole extra load after every update; offline still works here.
  if (req.url.includes('nandimed.js')) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(req))
    );
  }
});
