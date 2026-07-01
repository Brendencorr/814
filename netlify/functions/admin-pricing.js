/**
 * admin-pricing.js — Membership & Pricing manager (v4). Team-only.
 *
 * Manages the `products` catalog (Riley Guide/Companion/Coach/Mentor + à la
 * carte) and `usage_limits` (Riley Guide's caps — chat/week, library items,
 * etc.) — the two tables the Program&Pricing updateV4 admin spec calls the
 * "Programs & Pricing" tab + its "Usage Limits" sub-section.
 *
 * Distinct from admin-programs.js, which manages the CONTENT curriculum table
 * (`programs` — 7-Day Reset, Recovery Journey, etc.) — a different table for a
 * different purpose that happens to share the word "program."
 *
 * Protected by the same OPERATOR_KEY as Safety/Content/Programs. Fails closed
 * (503) if OPERATOR_KEY is unset.
 *
 * POST { action: "list" }                                → { products, usage_limits }
 *   each product also carries active_count — how many members currently hold
 *   an active entitlement for it, for the operator's at-a-glance ladder view.
 * POST { action: "update_product", key, patch }          → { ok }  (status/price_cents/blurb/visible_on_menu/sort_order)
 * POST { action: "update_usage_limit", id, patch }       → { ok }  (limit_amount/limit_period)
 * POST { action: "set_free_access", value: bool }        → { ok }  (same switch admin-programs.js already exposes)
 * POST { action: "members", key }                        → { members: [{id,email,full_name,granted_at,source}] }
 *   who currently holds product_key=key, active. Drill-down from the count.
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });

async function listAll(sb) {
  const [prodRes, limitRes, faRes, entRes] = await Promise.all([
    sb.from("products").select("product_key,display_name,type,price_cents,recurring,status,blurb,sort_order,visible_on_menu,implies_all_programs,tier_level").order("sort_order"),
    sb.from("usage_limits").select("id,product_key,feature_key,limit_amount,limit_period").order("product_key"),
    sb.from("app_settings").select("value").eq("key", "free_access_mode").maybeSingle(),
    // Active-holder counts — one pass over entitlements, tallied client-side
    // rather than N per-product queries. expires_at is checked in JS since
    // PostgREST can't express "IS NULL OR > now()" in a single filter easily.
    sb.from("entitlements").select("product_key,expires_at").eq("status", "active"),
  ]);
  if (prodRes.error) throw prodRes.error;
  const freeAccess = !!(faRes.data && String(faRes.data.value).toLowerCase() === "true");
  const now = Date.now();
  const counts = {};
  (entRes.data || []).forEach(e => {
    if (e.expires_at && new Date(e.expires_at).getTime() <= now) return; // expired, don't count
    counts[e.product_key] = (counts[e.product_key] || 0) + 1;
  });
  const products = (prodRes.data || []).map(p => ({ ...p, active_count: counts[p.product_key] || 0 }));
  return json(200, { products, usage_limits: limitRes.data || [], free_access_mode: freeAccess });
}

async function members(sb, key) {
  if (!key) return json(400, { error: "key is required" });
  const { data: ents, error } = await sb.from("entitlements")
    .select("user_id,granted_at,source,expires_at")
    .eq("product_key", key).eq("status", "active")
    .order("granted_at", { ascending: false }).limit(500);
  if (error) return json(500, { error: error.message });
  const now = Date.now();
  const active = (ents || []).filter(e => !e.expires_at || new Date(e.expires_at).getTime() > now);
  const ids = [...new Set(active.map(e => e.user_id))];
  let profMap = {};
  if (ids.length) {
    const { data: profs } = await sb.from("user_profiles").select("id,email,full_name").in("id", ids);
    (profs || []).forEach(p => { profMap[p.id] = p; });
  }
  const out = active.map(e => ({
    id: e.user_id,
    email: (profMap[e.user_id] || {}).email || null,
    full_name: (profMap[e.user_id] || {}).full_name || null,
    granted_at: e.granted_at,
    source: e.source,
  }));
  return json(200, { members: out });
}

async function updateProduct(sb, key, patch) {
  if (!key) return json(400, { error: "key is required" });
  const allowed = ["status", "price_cents", "blurb", "visible_on_menu", "sort_order", "display_name"];
  const row = {};
  for (const k of allowed) if (k in (patch || {})) row[k] = patch[k];
  if (!Object.keys(row).length) return json(400, { error: "no valid fields" });
  if (row.status && !["draft", "locked", "live", "retired"].includes(row.status)) return json(400, { error: "invalid status" });
  if (row.price_cents != null) row.price_cents = Math.max(0, Math.round(+row.price_cents) || 0);
  const { error } = await sb.from("products").update(row).eq("product_key", key);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

async function updateUsageLimit(sb, id, patch) {
  if (!id) return json(400, { error: "id is required" });
  const row = {};
  if (patch && patch.limit_amount != null) row.limit_amount = Math.max(0, Math.round(+patch.limit_amount) || 0);
  if (patch && ["day", "week", "month", "lifetime"].includes(patch.limit_period)) row.limit_period = patch.limit_period;
  if (!Object.keys(row).length) return json(400, { error: "no valid fields" });
  const { error } = await sb.from("usage_limits").update(row).eq("id", id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

async function setFreeAccess(sb, value) {
  const v = value ? "true" : "false";
  const { error } = await sb.from("app_settings")
    .upsert({ key: "free_access_mode", value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, free_access_mode: value === true });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  const expected = process.env.OPERATOR_KEY;
  if (!expected) return json(503, { error: "Pricing manager not configured. Set OPERATOR_KEY in the environment." });
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  try {
    const sb = getSupabaseClient();
    switch (body.action) {
      case "list":               return await listAll(sb);
      case "update_product":     return await updateProduct(sb, body.key, body.patch);
      case "update_usage_limit": return await updateUsageLimit(sb, body.id, body.patch);
      case "set_free_access":    return await setFreeAccess(sb, body.value === true);
      case "members":            return await members(sb, body.key);
      default:                   return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-pricing error:", err.message);
    return json(500, { error: err.message });
  }
};
