/**
 * program-list.js — the member's programs split into INCLUDED (owned) vs ADD-ONS (buyable).
 * Drives the "Included Programs" + "Program Add-ons" surfaces. POST { token } ->
 *   { tier, included:[{key,name,blurb,kind}], available:[{key,name,blurb,price_cents,status,kind}] }
 *
 * "included" reflects REAL entitlements (Companion → the 3 self-guided; Coach → all programs) —
 * free_access_mode / admin only unlock the reader, NOT the buy-list, so Add-ons is honest about
 * what still costs money. Expansion mirrors user_active_products + the products.implies model.
 * Model: n/a
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

const SELF_GUIDED = ["prog_sobriety", "prog_grief", "prog_body"];
function kindOf(p) { return p.type === "bundle" ? "bundle" : (SELF_GUIDED.includes(p.product_key) ? "self_guided" : "guided"); }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  // Full catalog (one source of truth) + real ownership.
  const { data: allProds } = await sb.from("products")
    .select("product_key, display_name, blurb, type, price_cents, status, implies, implies_all_programs, visible_on_menu, sort_order")
    .in("type", ["program", "bundle", "subscription", "free"]);
  const byKey = {}; (allProds || []).forEach((p) => { byKey[p.product_key] = p; });

  const owned = new Set();
  try { const { data } = await sb.from("user_active_products").select("product_key").eq("user_id", userId); (data || []).forEach((r) => owned.add(r.product_key)); } catch (_) {}
  // Comp path: an active subscription row grants that plan even without an entitlements row.
  try {
    const { data: subs } = await sb.from("subscriptions").select("plan_id, expires_at").eq("user_id", userId).eq("status", "active");
    const now = Date.now();
    (subs || []).forEach((s) => { const live = !s.expires_at || new Date(s.expires_at).getTime() > now; if (live && ["companion", "coach", "mentor"].includes(s.plan_id)) owned.add(s.plan_id); });
  } catch (_) {}
  // Expand any owned subscription/bundle to its implied programs (mirrors the entitlement view, but also
  // covers comp-via-subscriptions, so "included" is correct however access was granted).
  const programKeys = (allProds || []).filter((p) => p.type === "program").map((p) => p.product_key);
  [...owned].forEach((k) => {
    const p = byKey[k];
    if (!p) return;
    if (p.implies_all_programs) programKeys.forEach((pk) => owned.add(pk));
    if (Array.isArray(p.implies)) p.implies.forEach((i) => owned.add(i));
  });

  const tier = (owned.has("coach") || owned.has("mentor")) ? "coach" : owned.has("companion") ? "companion" : "guide";

  const catalog = (allProds || [])
    .filter((p) => (p.type === "program" || p.type === "bundle") && p.visible_on_menu !== false && p.status !== "retired")
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const included = [], available = [];
  const ownedSelfGuided = SELF_GUIDED.filter((k) => owned.has(k)).length;

  for (const p of catalog) {
    const kind = kindOf(p);
    if (p.type === "bundle") {
      // Offer the bundle only while they don't already own all 3 self-guided.
      if (ownedSelfGuided < 3) available.push({ key: p.product_key, name: p.display_name, blurb: p.blurb, price_cents: p.price_cents, status: p.status, kind });
      continue;
    }
    if (owned.has(p.product_key)) included.push({ key: p.product_key, name: p.display_name, blurb: p.blurb, kind });
    else available.push({ key: p.product_key, name: p.display_name, blurb: p.blurb, price_cents: p.price_cents, status: p.status, kind });
  }

  return json(200, { tier, included, available });
};
