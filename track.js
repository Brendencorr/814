/*
 * track.js — 8:14 client engagement tracker (drop-in, zero per-page setup).
 * Include on every authenticated client page:  <script src="/track.js"></script>
 *
 * Auto-captures, batched, fully non-blocking:
 *   - login       once per browser session
 *   - page_view   on load (page derived from the URL path)
 *   - click       on any element (records nearest label / [data-track] / nav text)
 *   - read        dwell time on the page when it's hidden/closed
 * User is attributed from the Supabase session in localStorage — no page changes
 * needed. Falls back to an anonymous persistent visitor id.
 */
(function () {
  var ENDPOINT = "/.netlify/functions/track-event";
  var SUPA_KEY = "sb-tglljvjixlolaguycvbb-auth-token";

  // ── identity ──────────────────────────────────────────────────────────────
  function uid() {
    try {
      var raw = localStorage.getItem(SUPA_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return (j.user && j.user.id) || (j.currentSession && j.currentSession.user && j.currentSession.user.id) || null;
    } catch (e) { return null; }
  }
  function sid() {
    try {
      var s = localStorage.getItem("814_visitor");
      if (!s) { s = "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("814_visitor", s); }
      return s;
    } catch (e) { return "v-anon"; }
  }
  function page() {
    var p = location.pathname.replace(/^\/|\.html$|\/$/g, "") || "home";
    return p.split("/").pop() || "home";
  }

  // ── batched sender ──────────────────────────────────────────────────────────
  var queue = [];
  function enqueue(type, target, meta) {
    queue.push({ user_id: uid(), session_id: sid(), event_type: type, page: page(), target: target || null, meta: meta || {} });
    if (queue.length >= 8) flush();
  }
  function flush(useBeacon) {
    if (!queue.length) return;
    var payload = JSON.stringify({ events: queue.splice(0, queue.length) });
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      } else {
        fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }
  setInterval(function () { flush(); }, 10000); // periodic flush

  // ── login (once per session) ────────────────────────────────────────────────
  try {
    if (uid() && !sessionStorage.getItem("814_logged")) {
      sessionStorage.setItem("814_logged", "1");
      enqueue("login", null, { referrer: document.referrer || null });
    }
  } catch (e) {}

  // ── page view ────────────────────────────────────────────────────────────────
  enqueue("page_view", null, { referrer: document.referrer || null, w: window.innerWidth });

  // ── clicks (nearest meaningful label) ────────────────────────────────────────
  document.addEventListener("click", function (ev) {
    try {
      var el = ev.target;
      for (var i = 0; i < 4 && el; i++) {
        if (el.getAttribute && (el.getAttribute("data-track") || el.tagName === "A" || el.tagName === "BUTTON")) break;
        el = el.parentElement;
      }
      if (!el) return;
      var label = (el.getAttribute && el.getAttribute("data-track")) ||
                  (el.textContent || "").trim().slice(0, 60) ||
                  (el.getAttribute && el.getAttribute("aria-label")) || el.tagName;
      enqueue("click", label);
    } catch (e) {}
  }, true);

  // ── read / dwell ─────────────────────────────────────────────────────────────
  var start = Date.now();
  function sendDwell() {
    var ms = Date.now() - start;
    if (ms > 1500) enqueue("read", page(), { dwell_ms: ms });
    flush(true);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") sendDwell(); });
  window.addEventListener("pagehide", sendDwell);
})();
