/**
 * entitlements.js — Server-side source of truth for what a user can access.
 *
 * v4 — Riley Guide (free, persistent) / Companion ($19) / Coach ($34) /
 * Mentor (future, draft) + à la carte ($9, content-only). No domain-locking,
 * ever — every active tier unlocks every domain; tiers differ in platform
 * depth, and Guide's depth is CAPPED (has access, limited quantity) rather
 * than absent. See supabase/migrations/033_pricing_v4.sql + the
 * Program&Pricing updateV4 build package for the full spec.
 *
 * GET/POST /.netlify/functions/entitlements
 *   Body or query: { user_id } OR Authorization: Bearer <supabase access token>
 *
 * Returns:
 *   {
 *     products: ["coach","prog_sobriety",...],
 *     tier: "guide" | "companion" | "coach" | "mentor" | null,
 *     features: {
 *       riley_chat:  { access: true, gate_mode: "capped", capped: true, remaining: 7, limit: 10, period: "week" },
 *       knowledge_graph: { access: false, gate_mode: "locked_upsell", capped: false },
 *       ...
 *     }
 *   }
 *
 * Reads the user_active_products view (implies_all_programs already expanded,
 * reset_free added to everyone with any row), feature_map, and usage_limits/
 * usage_counters for any 'capped' feature. Uses SUPABASE_SERVICE_KEY — server
 * side only.
 */

const { getSupabaseClient } = require('./supabase-client');
const { getRemaining } = require('./usage-limits');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function currentTier(owned) {
  if (owned.has('mentor'))    return 'mentor';
  if (owned.has('coach'))     return 'coach';
  if (owned.has('companion')) return 'companion';
  if (owned.has('reset_free')) return 'guide';
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    const sb = getSupabaseClient();

    // SECURITY: identity from the VERIFIED token ONLY — never an unauthenticated body/query user_id
    // (this used to return ANY user's plan/tier/features to an unauthenticated caller who passed a UUID).
    // The token may arrive in the JSON body (token) or an Authorization: Bearer header. preview_tier is
    // still read from the body but is honored only when the VERIFIED user is an admin (below).
    let previewTier = null;
    let bodyTok = null;
    if (event.body) {
      try { const _b = JSON.parse(event.body); previewTier = _b.preview_tier || null; bodyTok = _b.token || null; } catch (_) {}
    }
    const _auth = event.headers.authorization || event.headers.Authorization || '';
    const _token = bodyTok || (_auth.startsWith('Bearer ') ? _auth.slice(7) : null);
    let userId = null;
    if (_token) { try { const { data } = await sb.auth.getUser(_token); userId = data?.user?.id || null; } catch (_) {} }
    if (!userId) return json(401, { error: 'Unauthorized' });

    // 1. Resolved active products (view expands implies_all_programs + reset_free)
    const { data: prodRows, error: prodErr } = await sb
      .from('user_active_products')
      .select('product_key')
      .eq('user_id', userId);
    if (prodErr) throw prodErr;
    const owned = new Set((prodRows || []).map(r => r.product_key));
    // Defensive default: Riley Guide is meant to be automatic and universal —
    // "everyone gets a capped version of everything, forever." The app has more
    // than one place a profile can first get created (auth-handler.js's
    // get_session, onboarding.html's own upsert, etc.); rather than chase every
    // signup path, any known user_id is treated as at least Guide-tier here,
    // with or without an explicit entitlements row. (An explicit row is still
    // written where we can — see auth-handler.js get_session — for clean audit
    // history; this is the guarantee, not a substitute for that.)
    owned.add('reset_free');

    // Bridge (Doc 2 §5 / Doc 0 §7): an active new-system subscription — a comp, a Companion
    // Weekend gift, or a real paid plan — grants that plan's access in the LEGACY feature gating
    // too, by adding its product to `owned`. So `features` (sidebar/wall) and `entitlements`
    // (plan_entitlements) agree, and a grant actually unlocks the app + reverts cleanly at expiry.
    // Inert until any subscription rows exist; fail-open (never blocks).
    try {
      const { data: _subs } = await sb.from('subscriptions').select('plan_id, expires_at').eq('user_id', userId).eq('status', 'active');
      const _now = Date.now();
      (_subs || []).forEach(function (s) {
        const live = !s.expires_at || new Date(s.expires_at).getTime() > _now;
        if (live && (s.plan_id === 'companion' || s.plan_id === 'coach' || s.plan_id === 'mentor')) owned.add(s.plan_id);
      });
    } catch (_) {}

    // Master admin: full access to everything + an `admin` flag that drives the
    // tier-preview toggle + edit controls in the app. Flagged on user_profiles.is_admin.
    let isAdmin = false;
    try {
      const { data: prof } = await sb.from('user_profiles').select('is_admin').eq('id', userId).maybeSingle();
      isAdmin = !!(prof && prof.is_admin === true);
      if (isAdmin) {
        const PREVIEW = { guide: ['reset_free'], companion: ['reset_free', 'companion'], coach: ['reset_free', 'companion', 'coach'] };
        if (PREVIEW[previewTier]) {
          // Tier-preview (admin only): render EXACTLY as that tier would see it.
          owned.clear(); PREVIEW[previewTier].forEach(p => owned.add(p));
        } else {
          previewTier = null;
          try { const r = await sb.from('products').select('product_key'); (r.data || []).forEach(p => owned.add(p.product_key)); } catch (_) {}
          owned.add('coach'); owned.add('companion');
        }
      } else { previewTier = null; }
    } catch (_) { previewTier = null; }

    // Free-access mode (friends & family testing): grant everyone every product
    // so testers see the whole app for free. Toggled in the operator Pricing
    // tab; flip off later to enforce real purchases. Pure read-time override, no
    // per-user data changes, fully reversible.
    let freeAccess = false;
    try {
      const { data: fa } = await sb.from('app_settings').select('value').eq('key', 'free_access_mode').maybeSingle();
      if (fa && String(fa.value).toLowerCase() === 'true' && !previewTier) {
        freeAccess = true;
        // .eq('status','live') needs migration 033 (products.status). Fall back
        // to "every product" pre-migration so free-access mode still works.
        let allProds;
        try {
          const r = await sb.from('products').select('product_key').eq('status', 'live');
          if (r.error) throw r.error;
          allProds = r.data;
        } catch (_) {
          const r2 = await sb.from('products').select('product_key');
          allProds = r2.data;
        }
        (allProds || []).forEach(p => owned.add(p.product_key));
      }
    } catch (_) { /* settings table optional — fall back to real entitlements */ }

    // 2. Feature map + usage limits config. unentitled_state / usage_limits
    // need migration 033 — degrade to pre-v4 columns (gate_mode only, no caps)
    // rather than hard-failing the whole endpoint if it hasn't run yet.
    let featRows = [], limitRows = [];
    try {
      const [featRes, limitsRes] = await Promise.all([
        sb.from('feature_map').select('feature_key, required_any, gate_mode, unentitled_state, display_name, sort_order').order('sort_order'),
        sb.from('usage_limits').select('product_key, feature_key, limit_amount, limit_period'),
      ]);
      if (featRes.error) throw featRes.error;
      featRows  = featRes.data || [];
      limitRows = limitsRes.error ? [] : (limitsRes.data || []);
    } catch (_) {
      const fallback = await sb.from('feature_map').select('feature_key, required_any, gate_mode, display_name, sort_order').order('sort_order');
      featRows = fallback.data || [];
    }
    const limitsByFeature = {};
    limitRows.forEach(l => { (limitsByFeature[l.feature_key] ||= []).push(l); });

    // 3. Compute access + capped state per feature
    const features = {};
    const cappedFeatureKeys = [];
    for (const f of featRows) {
      const required = f.required_any || [];
      const access = required.some(p => owned.has(p));
      const state = f.unentitled_state || f.gate_mode || 'hidden';
      // A feature is only actually "capped" for THIS user if they don't also
      // hold a product that has no cap row for it (Companion/Coach = uncapped).
      const caps = limitsByFeature[f.feature_key] || [];
      const uncappedViaTier = required.some(p => owned.has(p) && !caps.find(c => c.product_key === p));
      const cappedForUser = access && state === 'capped' && !freeAccess && !isAdmin && !uncappedViaTier && caps.some(c => owned.has(c.product_key));
      features[f.feature_key] = {
        access,
        gate_mode:    f.gate_mode || state,   // backward-compat field name
        capped:       cappedForUser,
        display_name: f.display_name,
      };
      if (cappedForUser) cappedFeatureKeys.push(f.feature_key);
    }

    // 4. Live remaining-count for every currently-capped feature — via the SAME
    // shared helper riley-chat.js uses to enforce the cap, so display and
    // enforcement can never disagree on what "this week" means.
    const ownedList = [...owned];
    await Promise.all(cappedFeatureKeys.map(async (key) => {
      const r = await getRemaining(sb, userId, key, ownedList);
      if (r) Object.assign(features[key], { remaining: r.remaining, limit: r.limit, period: r.period });
    }));

    // 5. NEW (Doc 0 §7): resolve the user's PLAN + its entitlements from plan_entitlements.
    //    Backward-compatible — {} until migration 042 seeds the tables; the existing `features`
    //    gating is untouched. New surfaces (chat limit, DB-driven pricing) read these keys.
    let plan = currentTier(owned) || 'guide';
    let planEntitlements = {};
    try {
      // An active subscription in the new commerce tables wins (comps, weekend grants, paid).
      // Skipped while admin-previewing a tier so the preview stays faithful.
      if (!previewTier) {
        const { data: subs } = await sb.from('subscriptions')
          .select('plan_id, expires_at').eq('user_id', userId).eq('status', 'active');
        const RANK = { guide: 1, companion: 2, coach: 3, mentor: 4 };
        const now = Date.now();
        (subs || []).forEach(s => {
          const live = !s.expires_at || new Date(s.expires_at).getTime() > now;
          if (live && (RANK[s.plan_id] || 0) > (RANK[plan] || 0)) plan = s.plan_id;
        });
      }
      const { data: pe } = await sb.from('plan_entitlements').select('key, value').eq('plan_id', plan);
      (pe || []).forEach(r => { planEntitlements[r.key] = r.value; });
    } catch (_) { /* plan tables not seeded yet → empty; app falls back to `features` */ }

    return json(200, {
      products: [...owned],
      tier: currentTier(owned),
      plan,
      entitlements: planEntitlements,
      admin: isAdmin,
      preview_tier: previewTier,
      features,
    });

  } catch (err) {
    console.error('entitlements error:', err.message);
    return json(500, { error: 'Failed to load entitlements' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}
