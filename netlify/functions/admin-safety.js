/**
 * admin-safety.js — Operator safety queue (RESTRICTED)
 *
 * Reads crisis_log (which is RLS-locked to service-key only) and joins minimal
 * client info for the operator's safety queue + pop-up. Because this exposes
 * who-is-in-crisis — among the most sensitive data in the product — it is NOT
 * open like the other admin endpoints. It requires a real server-side secret:
 *
 *   OPERATOR_KEY — set in Netlify env. The operator dashboard sends it as the
 *                  `x-operator-key` header. If OPERATOR_KEY is unset, this
 *                  endpoint FAILS CLOSED (503) — crisis data is never served
 *                  without protection.
 *
 * POST { action: "list" }            → { open_count, flags: [...] }
 * POST { action: "resolve", id, note } → { success: true }   (marks operator_handled_at)
 */

const { getSupabaseClient, soberDaysForMember } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (statusCode, data) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) });

async function listFlags(supabase) {
  // Recent flags, newest first (open ones are what the queue/pop-up care about).
  const { data: logs, error } = await supabase
    .from("crisis_log")
    .select("id,user_id,session_id,level,matched_rules,message_excerpt,followup_stage,resolved,operator_handled_at,operator_note,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const ids = [...new Set((logs || []).map(l => l.user_id))];
  const profMap = new Map();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("user_profiles")
      .select("id,full_name,preferred_name,email,sobriety_date,last_active_at")
      .in("id", ids);
    (profs || []).forEach(p => profMap.set(p.id, p));
  }

  const now = Date.now();
  const flags = (logs || []).map(l => {
    const p = profMap.get(l.user_id) || {};
    const soberDays = p.sobriety_date ? soberDaysForMember(p.sobriety_date) : null;
    return {
      id: l.id,
      user_id: l.user_id,
      name: p.preferred_name || p.full_name || "Member",
      email: p.email || null,
      sober_days: soberDays,
      last_active_at: p.last_active_at || null,
      level: l.level,
      via: l.session_id === "daily-checkin" ? "Daily check-in" : "Chat",
      matched_rules: l.matched_rules || [],
      excerpt: l.message_excerpt || "",
      followup_stage: l.followup_stage || 0,
      resolved: !!l.resolved,
      handled: !!l.operator_handled_at,
      operator_handled_at: l.operator_handled_at || null,
      operator_note: l.operator_note || null,
      created_at: l.created_at,
    };
  });

  const open_count = flags.filter(f => !f.handled).length;
  return { open_count, flags };
}

async function resolveFlag(supabase, body) {
  if (!body.id) return json(400, { error: "id is required" });
  const { error } = await supabase
    .from("crisis_log")
    .update({ operator_handled_at: new Date().toISOString(), operator_note: (body.note || "").slice(0, 1000) || null })
    .eq("id", body.id);
  if (error) return json(500, { error: error.message });
  return json(200, { success: true });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  // Fail closed: no configured secret → never serve crisis data.
  const expected = process.env.OPERATOR_KEY;
  if (!expected) return json(503, { error: "Safety queue not configured. Set OPERATOR_KEY in the environment." });

  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  try {
    const supabase = getSupabaseClient(); // SERVICE_KEY
    switch (body.action) {
      case "list":    return json(200, await listFlags(supabase));
      case "resolve": return await resolveFlag(supabase, body);
      default:        return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-safety error:", err.message);
    return json(500, { error: err.message });
  }
};
