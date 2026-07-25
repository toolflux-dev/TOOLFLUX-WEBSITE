/* FLUX service worker — offline shell + asset cache. Independent of site sw.js. */
const CACHE = 'flux-v3';
const SHELL = [
  './pitch.html',
  './pitch.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './pitch-assets/manifest.json',
  './pitch-assets/logo-light.svg',
  './pitch-assets/logo-dark.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('flux-') && k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isFlux = url.pathname.endsWith('/pitch.html') || url.pathname.includes('pitch-assets/') ||
    url.pathname.endsWith('/pitch.webmanifest');
  if (!isFlux) return;
  // The app itself is network-first so a new build always wins; assets are cache-first for speed.
  const isApp = url.pathname.endsWith('/pitch.html') || url.pathname.endsWith('/pitch.webmanifest');
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      if (isApp) {
        try {
          const fresh = await fetch(e.request, { cache: 'no-store' });
          if (fresh && fresh.ok) { cache.put(e.request, fresh.clone()); return fresh; }
        } catch {}
        return (await cache.match(e.request)) || new Response('offline', { status: 503 });
      }
      const cached = await cache.match(e.request);
      const fetching = fetch(e.request).then(resp => {
        if (resp && resp.ok) cache.put(e.request, resp.clone());
        return resp;
      }).catch(() => null);
      return cached || fetching.then(r => r || new Response('offline', { status: 503 }));
    })
  );
});
