/**
 * admin-membership.js — Grant/revoke a member's entitlements. Team-only.
 *
 * Merges into the existing operator Users tab (per the v4 admin portal spec —
 * "UserEntitlementsPanel.jsx + GrantsLogPanel.jsx, unchanged from v3, generic
 * to any catalog"). Every grant/revoke is written to `grants_log` for audit.
 *
 * Protected by OPERATOR_KEY. Fails closed (503) if unset.
 *
 * POST { action: "get", user_id }                    → { entitlements: [...] }
 * POST { action: "grant", user_id, product_key }      → { ok }
 * POST { action: "revoke", user_id, product_key }     → { ok }
 * POST { action: "grants_log", user_id? }             → { log: [...] }  (all, or one member's)
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });

async function getEntitlements(sb, userId) {
  if (!userId) return json(400, { error: "user_id is required" });
  const { data, error } = await sb.from("entitlements").select("*").eq("user_id", userId).order("granted_at", { ascending: false });
  if (error) return json(500, { error: error.message });
  return json(200, { entitlements: data || [] });
}

async function grant(sb, userId, productKey) {
  if (!userId || !productKey) return json(400, { error: "user_id and product_key are required" });
  const { data: prod } = await sb.from("products").select("product_key").eq("product_key", productKey).maybeSingle();
  if (!prod) return json(400, { error: "Unknown product_key" });
  const { error } = await sb.from("entitlements")
    .upsert({ user_id: userId, product_key: productKey, status: "active", source: "manual_grant", granted_at: new Date().toISOString() }, { onConflict: "user_id,product_key" });
  if (error) return json(500, { error: error.message });
  await sb.from("grants_log").insert({ target_user_id: userId, product_key: productKey, action: "grant" });
  return json(200, { ok: true });
}

async function revoke(sb, userId, productKey) {
  if (!userId || !productKey) return json(400, { error: "user_id and product_key are required" });
  const { error } = await sb.from("entitlements").update({ status: "canceled" }).eq("user_id", userId).eq("product_key", productKey);
  if (error) return json(500, { error: error.message });
  await sb.from("grants_log").insert({ target_user_id: userId, product_key: productKey, action: "revoke" });
  return json(200, { ok: true });
}

async function grantsLog(sb, userId) {
  let q = sb.from("grants_log").select("id,created_at,action,product_key,target_user_id,actor_user_id").order("created_at", { ascending: false }).limit(200);
  if (userId) q = q.eq("target_user_id", userId);
  const { data, error } = await q;
  if (error) return json(500, { error: error.message });
  // Enrich with emails where we can (best-effort, non-fatal if it misses).
  const ids = [...new Set((data || []).map(r => r.target_user_id))];
  let emailMap = {};
  if (ids.length) {
    const { data: profs } = await sb.from("user_profiles").select("id,email").in("id", ids);
    (profs || []).forEach(p => { emailMap[p.id] = p.email; });
  }
  const log = (data || []).map(r => ({ ...r, target_email: emailMap[r.target_user_id] || null }));
  return json(200, { log });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  const expected = process.env.OPERATOR_KEY;
  if (!expected) return json(503, { error: "Membership manager not configured. Set OPERATOR_KEY in the environment." });
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  try {
    const sb = getSupabaseClient();
    switch (body.action) {
      case "get":         return await getEntitlements(sb, body.user_id);
      case "grant":        return await grant(sb, body.user_id, body.product_key);
      case "revoke":       return await revoke(sb, body.user_id, body.product_key);
      case "grants_log":   return await grantsLog(sb, body.user_id);
      default:             return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-membership error:", err.message);
    return json(500, { error: err.message });
  }
};
