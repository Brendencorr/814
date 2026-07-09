/* Riley PWA service worker - NETWORK-FIRST.
 * Live data must never go stale, so we always try the network first and only fall
 * back to cache when offline. We only ever touch same-origin GET requests - never
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

/* ── Web push: show the nudge, and focus/open the app when it's tapped ──
 * Payloads are generic and warm (never crisis-sensitive on a lock screen, per the
 * Reset's crisis architecture). { title, body, url, tag } arrive JSON-encoded. */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const options = {
    body: data.body || '',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: data.tag || 'riley-nudge',
    renotify: false,
    data: { url: data.url || '/reset' },
  };
  e.waitUntil(self.registration.showNotification(data.title || 'Riley', options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/reset';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { try { c.navigate(url); } catch (err) {} return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
