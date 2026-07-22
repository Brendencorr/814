/* Riley PWA service worker - App Spec v1.0 Sections 6.2-6.3.
 * One deploy, one app: this worker is the ONLY drift vector between what we
 * deploy and what an installed app shows, so it is governed:
 *   1. Cache names carry a per-deploy build id (stamped by the Netlify build
 *      command - see netlify.toml). A new deploy invalidates every old cache.
 *   2. Strategy by surface (Spec 6.2 table):
 *        safety + crisis resources  -> precache, cache-first, updated in background
 *        app shell (icons, root JS) -> precache, cache-first within this version
 *        member pages               -> network-first, short-lived fallback cache
 *        /.netlify/functions/*      -> NETWORK ONLY, never cached, never queued
 *        site media / CMS assets    -> stale-while-revalidate
 *   3. Update flow (Spec 6.3): a new worker installs in the background and
 *      WAITS. pwa.js shows the "Riley has something new" toast; tapping it
 *      posts SKIP_WAITING here. If ignored, the new version activates on the
 *      next cold start. Maximum staleness: one session.
 * Same-origin GET only - Supabase, fonts and CDNs pass straight through. */

// Stamped at deploy time by the Netlify build command (COMMIT_REF). The literal
// placeholder still works locally - it just behaves like a fixed version.
const BUILD = '__RILEY_BUILD__';
const V = 'riley-' + BUILD;
const SHELL_CACHE = V + '-shell';
const SAFETY_CACHE = V + '-safety';
const PAGES_CACHE = V + '-pages';
const MEDIA_CACHE = V + '-media';

// Crisis surface: must open with NO network. The one place stale beats absent.
const SAFETY_URLS = ['/safety', '/safety.html', '/offline.html'];
// Static shell: instant open, purged wholesale on version change.
const SHELL_URLS = [
  '/pwa.js', '/manifest.json',
  '/icon-192.png', '/icon-512.png', '/icon-1024.png',
  '/icon-maskable-192.png', '/icon-maskable-512.png', '/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // Precache tolerantly (one 404 must not brick the install), but do NOT
  // skipWaiting here - the member-controlled update flow in pwa.js owns that.
  e.waitUntil((async () => {
    const safety = await caches.open(SAFETY_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    await Promise.allSettled([
      ...SAFETY_URLS.map((u) => safety.add(u)),
      ...SHELL_URLS.map((u) => shell.add(u)),
    ]);
  })());
});

// Spec 6.3: the update toast's tap lands here -> take over -> pwa.js reloads.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(V)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isSafety = (path) => SAFETY_URLS.indexOf(path) >= 0;
const isShell = (path) => SHELL_URLS.indexOf(path) >= 0 || /^\/icon-[\w-]+\.png$/.test(path);
const isMedia = (path) => path.indexOf('/assets/') === 0 || path.indexOf('/site-media/') === 0;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never touch POST (functions / Supabase)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // Supabase, fonts, CDNs pass through
  const path = url.pathname;

  // API calls: network ONLY. Chat, check-ins, entitlements and payments must
  // never serve stale, and nothing queues offline (Spec 6.2 + 7.1: a queued
  // crisis message with a delayed response is a safety hazard, not a feature).
  if (path.indexOf('/.netlify/') === 0) return;

  // Crisis surface: cache-first so it opens with no network; refresh in background.
  if (isSafety(path)) {
    e.respondWith((async () => {
      const cache = await caches.open(SAFETY_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => undefined);
      return hit || (await refresh) || cache.match('/offline.html');
    })());
    return;
  }

  // App shell: cache-first within THIS version's cache only.
  if (isShell(path)) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  // Site media / CMS imagery: stale-while-revalidate (imagery can lag one view).
  if (isMedia(path)) {
    e.respondWith((async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => undefined);
      return hit || refresh;
    })());
    return;
  }

  // Member pages + everything else: network-first. Freshness wins on dynamic
  // surfaces (sober days, Clarity, chat); cache only bridges flaky connections.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(PAGES_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // Fully offline navigation with nothing cached: the warm offline page
        // (crisis numbers included) - never a browser error page (Spec 7.1).
        if (req.mode === 'navigate') {
          const safety = await caches.open(SAFETY_CACHE);
          return safety.match('/offline.html');
        }
        return undefined;
      })
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
