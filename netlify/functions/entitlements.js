/**
 * entitlements.js — Server-side source of truth for what a user can access.
 *
 * v4 — Riley Guide (free, persistent) / Companion ($29) / Coach ($49) /
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

    // Resolve user_id: from body, query string, or auth token
    let userId = null;
    if (event.body) {
      try { userId = JSON.parse(event.body).user_id; } catch (_) {}
    }
    if (!userId && event.queryStringParameters) {
      userId = event.queryStringParameters.user_id;
    }
    if (!userId) {
      const auth = event.headers.authorization || event.headers.Authorization;
      if (auth && auth.startsWith('Bearer ')) {
        const { data } = await sb.auth.getUser(auth.slice(7));
        userId = data?.user?.id || null;
      }
    }
    if (!userId) {
      return json(400, { error: 'No user_id provided' });
    }

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

    // Free-access mode (friends & family testing): grant everyone every product
    // so testers see the whole app for free. Toggled in the operator Pricing
    // tab; flip off later to enforce real purchases. Pure read-time override, no
    // per-user data changes, fully reversible.
    let freeAccess = false;
    try {
      const { data: fa } = await sb.from('app_settings').select('value').eq('key', 'free_access_mode').maybeSingle();
      if (fa && String(fa.value).toLowerCase() === 'true') {
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
      const cappedForUser = access && state === 'capped' && !freeAccess && !uncappedViaTier && caps.some(c => owned.has(c.product_key));
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

    return json(200, {
      products: [...owned],
      tier: currentTier(owned),
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
