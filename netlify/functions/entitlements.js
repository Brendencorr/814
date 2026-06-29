/**
 * entitlements.js — Server-side source of truth for what a user can access.
 *
 * GET/POST /.netlify/functions/entitlements
 *   Body or query: { user_id } OR Authorization: Bearer <supabase access token>
 *
 * Returns:
 *   {
 *     products: ["concierge","prog_sobriety_90",...],   // resolved active products
 *     tier: "concierge" | "companion" | "free",
 *     features: {
 *       daily_checkin: { access: true,  gate_mode: "locked_upsell" },
 *       program_grief: { access: false, gate_mode: "locked_upsell" },
 *       ...
 *     }
 *   }
 *
 * Reads the user_active_products view (concierge already expanded to all programs,
 * reset_free added to everyone with any row) and the feature_map config table.
 * Uses SUPABASE_SERVICE_KEY — server side only.
 */

const { getSupabaseClient } = require('./supabase-client');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

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

    // 1. Resolved active products (view already expands concierge + reset_free)
    const { data: prodRows, error: prodErr } = await sb
      .from('user_active_products')
      .select('product_key')
      .eq('user_id', userId);
    if (prodErr) throw prodErr;
    const owned = new Set((prodRows || []).map(r => r.product_key));

    // 2. Feature map config
    const { data: featRows, error: featErr } = await sb
      .from('feature_map')
      .select('feature_key, required_any, gate_mode, display_name, sort_order')
      .order('sort_order');
    if (featErr) throw featErr;

    // 3. Compute access per feature
    const features = {};
    for (const f of featRows || []) {
      const access = (f.required_any || []).some(p => owned.has(p));
      features[f.feature_key] = {
        access,
        gate_mode:    f.gate_mode,
        display_name: f.display_name,
      };
    }

    // 4. Derive tier label
    const tier = owned.has('concierge') ? 'concierge'
               : owned.has('companion') ? 'companion'
               : 'free';

    return json(200, {
      products: [...owned],
      tier,
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
