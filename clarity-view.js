/**
 * clarity-view.js - Clarity Score v2.2 shared client reader (the cutover switch).
 *
 * ONE place that decides whether a page shows the v1 or v2 Clarity score, and turns a
 * user_daily_state row into a normalized, member-facing view. dashboard.html and brief.html
 * both defer to this, so the historical THREE independent v1 display formulas collapse to a
 * single source the moment v2 is active. Loaded as <script src="/clarity-view.js">.
 *
 * DARK by default: the global flag (site_content clarity/engine) ships as 'v1', so
 * resolveEngine() returns 'v1' for everyone and the pages keep their exact v1 behavior.
 * A member with user_profiles.clarity_preview=true (dogfood) sees 'v2'; the public flips
 * only when the flag is set to 'v2'. Never shows the math - narration stays emotional.
 */
(function () {
  'use strict';

  var _flagCache = null; // {engine, onboarding, at}

  // Read the global engine flag from site_content (public anon-read). Cached ~5 min.
  async function readFlag(SB) {
    try {
      if (_flagCache && (Date.now() - _flagCache.at) < 300000) return _flagCache;
      var r = await SB.from('site_content').select('props').eq('page', 'clarity').eq('key', 'engine').maybeSingle();
      var props = (r && r.data && r.data.props) || {};
      _flagCache = { engine: props.engine === 'v2' ? 'v2' : 'v1', onboarding: !!props.onboarding, at: Date.now() };
    } catch (e) { _flagCache = { engine: 'v1', onboarding: false, at: Date.now() }; }
    return _flagCache;
  }

  // Effective engine for THIS member = their dogfood preview OR the global flag.
  async function resolveEngine(SB, UID) {
    var flag = await readFlag(SB);
    var preview = false;
    try {
      if (UID) { var p = await SB.from('user_profiles').select('clarity_preview').eq('id', UID).maybeSingle(); preview = !!(p && p.data && p.data.clarity_preview); }
    } catch (e) {}
    return { engine: preview ? 'v2' : flag.engine, onboarding: flag.onboarding, preview: preview, globalEngine: flag.engine };
  }

  // Normalize a user_daily_state row's v2 columns into a view, or null if v2 hasn't run.
  function v2(uds) {
    if (!uds || uds.clarity_v2 == null) return null;
    return {
      score: uds.clarity_v2,
      provisional: !!uds.provisional,
      frozen: !!uds.frozen,
      core: uds.clarity_core,
      F: uds.f_score, P: uds.p_score, D: uds.d_score,
      breakdown: uds.v2_breakdown || null,
      note: uds.clarity_v2_note || null,
    };
  }

  // Member-facing copy for a v2 view. Emotional, never the math. "Distance traveled."
  function narrate(view) {
    if (!view) return { phrase: '', note: '' };
    if (view.provisional) return { phrase: 'Getting to know you.', note: 'A few more check-ins and your Clarity picture comes into focus. No number to chase yet - just keep showing up.' };
    if (view.frozen) return { phrase: 'Holding steady with you.', note: "We're keeping your Clarity right where it was while you find your footing. Coming back is the whole thing." };
    var s = view.score;
    var phrase = s >= 80 ? "You're in a real rhythm." : s >= 60 ? "You're building something." : s >= 40 ? 'One steady step at a time.' : s > 0 ? "You're finding your footing." : 'Every day counts.';
    // Prefer trend-aware framing when Direction leans clearly one way (self-referenced, not vs "perfect").
    var note;
    if (view.note) note = view.note;
    else if (view.D != null && view.D >= 60) note = "Your last stretch is trending lighter than the one before it. That's you, moving.";
    else if (view.D != null && view.D <= 40) note = "A heavier stretch than usual - that's information, not failure. Gentle is allowed.";
    else note = s >= 60 ? 'Steady is its own kind of progress.' : 'Showing up on the hard days is what moves this.';
    return { phrase: phrase, note: note };
  }

  // The v2 columns a page must SELECT from user_daily_state for v2() to work.
  var STATE_COLS = 'clarity_v2,provisional,frozen,clarity_core,f_score,p_score,d_score,v2_breakdown,clarity_v2_note';

  window.ClarityView = { resolveEngine: resolveEngine, readFlag: readFlag, v2: v2, narrate: narrate, STATE_COLS: STATE_COLS };
})();
