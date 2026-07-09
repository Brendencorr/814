/**
 * track-event.js - lightweight client engagement ingest.
 * Called from track.js on every client page. Writes to client_events with the
 * service key (bypasses RLS). Analytics only - always non-fatal, never blocks UI.
 *
 * POST { events: [ {user_id?, session_id, event_type, page, target, meta} ] }
 * Accepts a batch to keep requests cheap. Silently drops malformed rows.
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TYPES = ["login", "page_view", "click", "read", "feature_use", "riley_open"];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "" };
  try {
    const body = JSON.parse(event.body || "{}");
    const db = getSupabaseClient();
    // SECURITY: attribute to the VERIFIED token's user only - never a client-supplied user_id.
    // Anonymous events (no token) are still accepted as user_id null; they just can't be forged.
    let uid = null;
    if (body.token) { try { const { data } = await db.auth.getUser(body.token); uid = data?.user?.id || null; } catch (_) {} }
    const raw = Array.isArray(body.events) ? body.events : [body];
    const rows = raw
      .filter((e) => e && TYPES.includes(e.event_type))
      .slice(0, 50)
      .map((e) => ({
        user_id: uid,
        session_id: (e.session_id || "").slice(0, 80) || null,
        event_type: e.event_type,
        page: (e.page || "").slice(0, 60) || null,
        target: (e.target || "").slice(0, 200) || null,
        meta: e.meta && typeof e.meta === "object" ? e.meta : {},
      }));
    if (rows.length) {
      await db.from("client_events").insert(rows);
    }
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, n: rows.length }) };
  } catch (e) {
    // Never surface tracking errors to the client
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: false }) };
  }
};
