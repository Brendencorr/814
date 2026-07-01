/* Riley PWA service worker — NETWORK-FIRST.
 * Live data must never go stale, so we always try the network first and only fall
 * back to cache when offline. We only ever touch same-origin GET requests — never
 * POSTs, never the Supabase API or CDN fonts (those are cross-origin and pass
 * straight through untouched). This gives installability + an offline shell
 * without any risk of serving stale user data. */
const CACHE = 'riley-shell-v1';
const FALLBACK = '/dashboard';

self.addEventListener('install', (e) => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never cache POST (Supabase / functions)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // ignore Supabase, jsDelivr, Google Fonts
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match(FALLBACK) : undefined)))
  );
});
