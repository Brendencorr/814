const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key);
}

// Verify a Supabase access token (JWT) and return the authenticated user's id, or null.
// SECURITY: identity for user-scoped functions must come from THIS — never from a
// client-supplied user_id, which the caller can forge. Returns null on any failure
// (missing/invalid/expired token), so callers can treat "no valid token" as anonymous
// or reject with 401 as appropriate.
async function getUserIdFromToken(supabase, token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user.id;
  } catch (e) {
    return null;
  }
}

// Emit a canonical event (Doc 0 §9) to the `events` table — the single source for admin
// metrics (Doc 3). Fail-open + non-blocking: analytics must NEVER break a user action.
async function emitEvent(supabase, userId, name, props) {
  try { await supabase.from('events').insert({ user_id: userId || null, name, props: props || {} }); } catch (e) {}
}

module.exports = { getSupabaseClient, getUserIdFromToken, emitEvent };
