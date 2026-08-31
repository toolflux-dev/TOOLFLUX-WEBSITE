/* FLUX LEDGER — offline shell.
   Network-first for the app's own code so a redeploy always wins;
   cache-first only for the big immutable vendor assets.
   Bump CACHE on every release. */
const CACHE = 'flux-ledger-v3';
const SHARE = 'flux-ledger-share';
const SHELL = [
  'ledger.html',
  'ledger.css',
  'ledger.js',
  'ledger.webmanifest',
  'assets/clash-grotesk.css',
  'assets/vendor/pdf.min.js',
  'assets/vendor/pdf.worker.min.js',
  'icon-192.png',
  'icon-512.png'
];
const IMMUTABLE = /\/assets\/(vendor\/|clash-grotesk\.css)|icon-\d+\.png/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== SHARE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // A PDF shared into the installed app arrives as a POST. Stash the files and
  // bounce to the normal page, which picks them up and imports them.
  if (req.method === 'POST' && /ledger\.html$/.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData();
        const files = fd.getAll('file').filter(f => f && f.size);
        const c = await caches.open(SHARE);
        for (const f of files) {
          await c.put('/shared/' + encodeURIComponent(f.name || 'statement.pdf'),
                      new Response(f, { headers: { 'Content-Type': 'application/pdf' } }));
        }
        return Response.redirect('ledger.html?shared=1', 303);
      } catch (err) {
        return Response.redirect('ledger.html', 303);      // never strand the user
      }
    })());
    return;
  }

  if (req.method !== 'GET') return;

  if (IMMUTABLE.test(url.pathname)) {           // big, versionless, never changes
    e.respondWith(caches.match(req).then(hit => hit || fetchAndPut(req)));
    return;
  }
  // app code: network first, cache as the safety net, and never resolve to
  // undefined — respondWith(undefined) turns a blip into a hard page error.
  e.respondWith(
    fetchAndPut(req).catch(() => caches.match(req).then(hit =>
      hit || new Response('Offline and not cached', { status: 504, statusText: 'Offline' })))
  );
});

function fetchAndPut(req) {
  return fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  });
}
