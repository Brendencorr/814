/**
 * admin-correspondence.js - operator view of every client email we've sent (email_log).
 *
 * OPERATOR_KEY-gated GET. Returns metadata only (recipient, subject, kind, status, provider
 * id, error, time) - never email bodies. Crisis follow-ups are intentionally NOT in email_log
 * (crisis stays out of any operator-visible stream, §1.4), so they never appear here.
 *
 * GET /admin-correspondence?user_id=<uuid>   - this member's email history
 *     /admin-correspondence?email=<addr>     - by recipient (covers prospects with no user_id)
 *     /admin-correspondence                   - recent across everyone
 *   header x-operator-key
 * → { items: [ { id, user_id, to_email, kind, subject, status, provider_id, error, created_at } ] }
 * Model: n/a
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireOperator(event); if (gate) return gate;

  const qs = event.queryStringParameters || {};
  const userId = (qs.user_id || "").toString().trim();
  const email = (qs.email || "").toString().trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 100, 1), 200);

  try {
    const sb = getSupabaseClient();
    let q = sb.from("email_log")
      .select("id, user_id, to_email, kind, subject, status, provider_id, error, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (userId) q = q.eq("user_id", userId);
    else if (email) q = q.ilike("to_email", email);
    const { data, error } = await q;
    if (error) return json(500, { error: error.message });
    return json(200, { items: data || [] });
  } catch (e) {
    return json(500, { error: (e && e.message) || "error" });
  }
};
