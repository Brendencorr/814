/*
 * posthog.js - Riley business-attribution layer (drop-in, zero per-page setup).
 * Include on every marketing + app page:  <script src="/posthog.js"></script>
 *
 * ROLE (one job): attribution funnel - utm → signup → reset_completed → upgrade.
 * PostHog is the *lens*; Supabase stays canonical. This never blocks the UI and
 * fully no-ops when POSTHOG_PROJECT_KEY isn't configured, so it is always safe to ship.
 *
 * Autocaptures (via posthog-js): $pageview, autocapture clicks, and - critically -
 * first-touch UTM params, which posthog-js persists across the whole session so a
 * signup days later still carries the social post that drove it.
 *
 * Config (key + host) is fetched from /.netlify/functions/site-config so nothing
 * is hardcoded and no key lands in static source (clean secret-scan, one source of truth).
 *
 * Identity is read from the Supabase session in localStorage - same convention as
 * track.js - so identified members are stitched to their pre-signup anonymous events.
 *
 * Public API (all no-op until PostHog is live):
 *   window.RileyPH.track(event, props)      → posthog.capture
 *   window.RileyPH.identify(id, props)      → posthog.identify
 *   window.RileyPH.reset()                  → posthog.reset (call on logout)
 */
(function () {
  var SUPA_KEY = "sb-tglljvjixlolaguycvbb-auth-token";
  var CFG_CACHE = "814_ph_cfg";           // sessionStorage cache of {key,host}
  var CDN = "https://us-assets.i.posthog.com/static/array.js";

  // Queue explicit calls made before posthog finishes loading, then replay them.
  var pending = [];
  window.RileyPH = {
    track:    function (e, p) { withPH(function (ph) { ph.capture(e, p || {}); }); },
    identify: function (id, p) { if (id) withPH(function (ph) { ph.identify(String(id), p || {}); }); },
    reset:    function ()      { withPH(function (ph) { ph.reset(); }); },
  };
  function withPH(fn) {
    if (window.posthog && window.posthog.__loaded) { try { fn(window.posthog); } catch (e) {} }
    else pending.push(fn);
  }

  function uid() {
    try {
      var raw = localStorage.getItem(SUPA_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      return (j.user && j.user.id) ||
             (j.currentSession && j.currentSession.user && j.currentSession.user.id) || null;
    } catch (e) { return null; }
  }

  // ── official posthog-js loader stub (queues calls until array.js loads) ─────────
  function loadPosthog() {
    (function (t, e) {
      var o, n, p, r;
      e.__SV || ((window.posthog = e), (e._i = []),
      (e.init = function (i, s, a) {
        function g(t, e) { var o = e.split("."); 2 == o.length && ((t = t[o[0]]), (e = o[1]));
          t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; }
        ((p = t.createElement("script")).type = "text/javascript"), (p.crossOrigin = "anonymous"),
        (p.async = !0), (p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js"),
        (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r);
        var u = e; for (void 0 !== a ? (u = e[a] = []) : (a = "posthog"), u.people = u.people || [],
        u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e; },
        u.people.toString = function () { return u.toString(1) + ".people (stub)"; },
        o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),
        n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]); }),
      (e.__SV = 1));
    })(document, window.posthog || []);
  }

  function init(cfg) {
    if (!cfg || !cfg.key) return; // not configured yet → stay a no-op
    var host = cfg.host || "https://us.i.posthog.com";
    loadPosthog();
    window.posthog.init(cfg.key, {
      api_host: host,
      capture_pageview: true,          // attribution needs the landing pageview
      autocapture: true,
      capture_pageleave: true,
      persistence: "localStorage+cookie",
      person_profiles: "identified_only", // keep anon marketing visitors cheap; still funnel-tracked
      loaded: function (ph) {
        ph.__loaded = true;
        var id = uid();
        if (id) { try { ph.identify(String(id)); } catch (e) {} }
        // replay any explicit calls queued before load
        for (var i = 0; i < pending.length; i++) { try { pending[i](ph); } catch (e) {} }
        pending = [];
      },
    });
  }

  function boot() {
    // cached config for this browser session → no refetch on every page
    try {
      var c = sessionStorage.getItem(CFG_CACHE);
      if (c) { init(JSON.parse(c)); return; }
    } catch (e) {}
    fetch("/.netlify/functions/site-config")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var cfg = { key: j.posthogKey || "", host: j.posthogHost || "https://us.i.posthog.com" };
        try { sessionStorage.setItem(CFG_CACHE, JSON.stringify(cfg)); } catch (e) {}
        init(cfg);
      })
      .catch(function () { /* analytics is never fatal */ });
  }

  boot();
})();
