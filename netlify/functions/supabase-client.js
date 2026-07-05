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

// Operator-only gate. Returns null when the request carries the correct OPERATOR_KEY header,
// or a fail-closed 401/503 response object otherwise. For operator/pipeline endpoints that must
// NOT be reachable unauthenticated at their public Netlify URL (cost-drain / tamper / publish
// vectors). Same secret the operator dashboard sends via `x-operator-key`. Scheduled functions
// that invoke their runner INLINE (e.g. content-daily-cron → runDaily) are unaffected — this only
// gates the public HTTP handler. Usage: `const gate = requireOperator(event); if (gate) return gate;`
function requireOperator(event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-operator-key',
    'Content-Type': 'application/json',
  };
  const expected = process.env.OPERATOR_KEY;
  if (!expected) return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'OPERATOR_KEY not configured' }) };
  const provided = (event.headers && (event.headers['x-operator-key'] || event.headers['X-Operator-Key'])) || '';
  if (provided !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  return null;
}

// Gate for SCHEDULED cron functions. Allows the Netlify scheduler — which sends BOTH an
// `x-nf-event: schedule` header AND a `{"next_run":...}` body (two independent signals, so a
// stripped header still passes) — or an operator-key manual trigger; rejects anonymous direct HTTP.
// Netlify does NOT reliably block direct invocation of netlify.toml-scheduled functions in production
// (verified empirically 2026-07-05: a direct POST ran them), so this app-level guard is REQUIRED.
// Returns null when allowed, or a 403 response object otherwise.
function requireScheduledOrOperator(event) {
  const h = (event && event.headers) || {};
  if ((h['x-nf-event'] || h['X-Nf-Event']) === 'schedule') return null;      // Netlify scheduler header
  try { if (JSON.parse((event && event.body) || '{}').next_run) return null; } catch (_) {}  // scheduler body
  const opk = process.env.OPERATOR_KEY;                                        // operator manual trigger
  if (opk && (h['x-operator-key'] || h['X-Operator-Key']) === opk) return null;
  return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden' }) };
}

module.exports = { getSupabaseClient, getUserIdFromToken, emitEvent, requireOperator, requireScheduledOrOperator };
