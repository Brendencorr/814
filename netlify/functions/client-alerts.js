/**
 * client-alerts.js — member-facing notifications feed for the client dashboard.
 *
 * Surfaces client_alerts (broadcast audience='all' + rows targeted to the user)
 * with per-user read state from client_alert_reads. Powers the dashboard bell.
 * Uses the service key (bypasses RLS); user_id is supplied by the caller, matching
 * the existing track-event / auth-handler pattern. Read-only + read-marking only.
 *
 *   GET  ?user_id=UUID                         → { alerts:[...], unread:N }
 *   POST { action:"read",     user_id, alert_id }  → mark one read
 *   POST { action:"read_all", user_id }            → mark all visible read
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });
const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const LIMIT = 40;

// Alerts visible to this user: broadcasts + rows addressed to them, newest first.
async function visibleAlerts(db, userId) {
  const { data, error } = await db
    .from("client_alerts")
    .select("id,kind,title,body,url,icon,created_at")
    .eq("is_active", true)
    .or(`audience.eq.all,user_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return data || [];
}

async function listAlerts(db, userId) {
  const alerts = await visibleAlerts(db, userId);
  if (!alerts.length) return json(200, { alerts: [], unread: 0 });

  const ids = alerts.map((a) => a.id);
  const { data: reads, error: rErr } = await db
    .from("client_alert_reads")
    .select("alert_id")
    .eq("user_id", userId)
    .in("alert_id", ids);
  if (rErr) throw rErr;
  const readSet = new Set((reads || []).map((r) => r.alert_id));

  let unread = 0;
  const out = alerts.map((a) => {
    const read = readSet.has(a.id);
    if (!read) unread++;
    return { ...a, read };
  });
  return json(200, { alerts: out, unread });
}

async function markRead(db, userId, alertId) {
  if (!isUuid(alertId)) return json(400, { error: "alert_id required" });
  // upsert so a repeat read is a no-op (PK = alert_id,user_id)
  const { error } = await db
    .from("client_alert_reads")
    .upsert({ alert_id: alertId, user_id: userId }, { onConflict: "alert_id,user_id", ignoreDuplicates: true });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

async function markAllRead(db, userId) {
  const alerts = await visibleAlerts(db, userId);
  if (!alerts.length) return json(200, { ok: true, n: 0 });
  const rows = alerts.map((a) => ({ alert_id: a.id, user_id: userId }));
  const { error } = await db
    .from("client_alert_reads")
    .upsert(rows, { onConflict: "alert_id,user_id", ignoreDuplicates: true });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, n: rows.length });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  try {
    const db = getSupabaseClient();

    // SECURITY: identity from the verified Supabase token only — never a client-supplied user_id.
    const verify = async (tok) => { try { const { data } = await db.auth.getUser(tok); return data?.user?.id || null; } catch (_) { return null; } };

    if (event.httpMethod === "GET") {
      const tok = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
      const userId = await verify(tok);
      if (!userId) return json(200, { alerts: [], unread: 0 }); // anon / logged-out / bad token → empty, never error
      return await listAlerts(db, userId);
    }

    if (event.httpMethod === "POST") {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
      const userId = await verify(body.token);
      if (!userId) return json(401, { error: "Unauthorized" });
      if (body.action === "read")      return await markRead(db, userId, body.alert_id);
      if (body.action === "read_all")  return await markAllRead(db, userId);
      return json(400, { error: "Unknown action" });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("client-alerts error:", err.message);
    return json(500, { error: err.message });
  }
};
