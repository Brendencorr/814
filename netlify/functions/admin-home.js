/**
 * admin-home.js — powers the operator Home dashboard.
 *   GET                       → full analytics blob (admin_home_analytics)
 *   GET ?detail=<kind>&val=.. → drill-down rows (admin_home_detail)
 *
 * detail kinds: total | active | new | logins | messages | page | click
 * (page/click take val=<page|target>; logins/messages accept optional val=MM-DD)
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  // Operator-only. Fail closed: without the secret, never serve member analytics/PII (names, emails).
  const expected = process.env.OPERATOR_KEY;
  if (!expected) return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: "Not configured. Set OPERATOR_KEY." }) };
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Unauthorized" }) };
  try {
    const db = getSupabaseClient();
    const q = event.queryStringParameters || {};
    if (q.detail) {
      const { data, error } = await db.rpc("admin_home_detail", { kind: q.detail, val: q.val || null });
      if (error) throw error;
      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ rows: data || [] }) };
    }
    const { data, error } = await db.rpc("admin_home_analytics");
    if (error) throw error;
    const blob = data || {};
    // Recent signups → drives the operator Home "Latest sign-ups" section (newest first), enriched with
    // customer info + programs owned + 7-day activity so one section replaces the old two. Resilient: any
    // sub-query failing just degrades that field; the Home still renders.
    try {
      const { data: signups } = await db.from("user_profiles")
        .select("id,full_name,preferred_name,email,created_at")
        .order("created_at", { ascending: false }).limit(25);
      const ids = (signups || []).map((s) => s.id);
      // Program count per user (actual programs bought — product_key prefix 'prog_'; excludes tiers + reset_free).
      const progCount = {};
      if (ids.length) {
        try {
          const { data: uap } = await db.from("user_active_products").select("user_id, product_key").in("user_id", ids);
          (uap || []).forEach((r) => { if (String(r.product_key).startsWith("prog_")) progCount[r.user_id] = (progCount[r.user_id] || 0) + 1; });
        } catch (_) {}
      }
      // 7-day activity — reuse the analytics blob's last_active (already computed) rather than re-querying.
      const eventsById = {};
      (Array.isArray(blob.last_active) ? blob.last_active : []).forEach((u) => { if (u && u.user_id) eventsById[u.user_id] = u.events_7d || 0; });
      blob.recent_signups = (signups || []).map((s) => ({
        id: s.id,
        name: s.preferred_name || s.full_name || (s.email || "").split("@")[0] || "Member",
        email: s.email || null,
        created_at: s.created_at,
        programs: progCount[s.id] || 0,
        events_7d: eventsById[s.id] || 0,
      }));
    } catch (_) { blob.recent_signups = []; }
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(blob) };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
