/**
 * admin-comp.js — Doc 3 Phase 2: operator override tools. OPERATOR_KEY gated. Every action writes
 * an append-only `admin_audit` row (before/after where relevant). Leverages the entitlements
 * bridge — a comp is just a `subscriptions` row, so it unlocks the client app within one refresh
 * (proves the Doc 0 §7 single-source design). NEVER touches conversation content.
 *
 * POST { action, user_id, ... } with header x-operator-key:
 *   'lookup'      { email | query }                 → { user } identity + entitlement state (READ-ONLY, no chat content)
 *   'comp'        { user_id, plan_id: 'companion'|'coach', expires_at? } → comped subscription
 *   'weekend'     { user_id }                        → 48h Companion weekend (fresh or extended)
 *   'grant_alc'   { user_id, program_id }            → à la carte program grant (purchase row)
 *   'credit'      { user_id, amount_cents?, days? }  → manual credit (default $8.14 / 90d)
 *   'reset_reset' { user_id }                        → restart the 8:14 Reset at Day 1
 * → { ok } (+ any created id).
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

async function audit(sb, action, target, detail) {
  try { await sb.from("admin_audit").insert({ action, target_user: target || null, detail: detail || {} }); } catch (_) {}
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const _op = process.env.OPERATOR_KEY;
  if (!_op) return json(503, { error: "Not configured" });
  if ((event.headers["x-operator-key"] || event.headers["X-Operator-Key"]) !== _op) return json(401, { error: "Unauthorized" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const { action } = body;
  const userId = body.user_id;
  const sb = getSupabaseClient();
  const now = new Date().toISOString();

  try {
    // ── Read-only member lookup (email or user id) — identity + entitlement state ONLY.
    // Never returns conversation content (Doc 3 privacy). Resolves the user_id the override
    // actions below need, and shows the operator exactly who they're about to modify.
    if (action === "lookup") {
      const q = (body.email || body.query || "").toString().trim();
      if (!q) return json(400, { error: "email or user id required" });
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
      const sel = "id,email,full_name,preferred_name";
      const { data: prof } = isUuid
        ? await sb.from("user_profiles").select(sel).eq("id", q).maybeSingle()
        : await sb.from("user_profiles").select(sel).ilike("email", q).maybeSingle();
      if (!prof) return json(404, { error: "No member found for that email or id." });
      const uid = prof.id;
      const [subs, purch, cred, reset] = await Promise.all([
        sb.from("subscriptions").select("plan_id,term,status,expires_at,started_at").eq("user_id", uid).eq("status", "active"),
        sb.from("purchases").select("program_id,purchased_at").eq("user_id", uid),
        sb.from("credits").select("amount_cents,expires_at,redeemed_at").eq("user_id", uid).is("redeemed_at", null),
        sb.from("reset_progress").select("day_number").eq("user_id", uid).order("day_number", { ascending: false }).limit(1),
      ]);
      return json(200, { ok: true, user: {
        id: uid,
        email: prof.email || null,
        name: prof.full_name || prof.preferred_name || null,
        subscriptions: subs.data || [],
        purchases: (purch.data || []).map((p) => p.program_id),
        credits: cred.data || [],
        reset_day: (reset.data && reset.data[0] && reset.data[0].day_number) || 0,
      } });
    }

    if (!userId) return json(400, { error: "action and user_id required" });

    if (action === "comp") {
      const plan = body.plan_id === "coach" ? "coach" : "companion";
      const { data: row } = await sb.from("subscriptions").insert({
        user_id: userId, plan_id: plan, term: "comped", status: "active", comped: true,
        source: "comp", started_at: now, expires_at: body.expires_at || null,
      }).select("id").maybeSingle();
      await audit(sb, "comp", userId, { plan_id: plan, expires_at: body.expires_at || null });
      return json(200, { ok: true, subscription_id: row?.id });
    }

    if (action === "weekend") {
      const expires = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
      // Re-grant/extend: remove any prior weekend then insert fresh.
      await sb.from("subscriptions").delete().eq("user_id", userId).eq("term", "weekend");
      await sb.from("subscriptions").insert({ user_id: userId, plan_id: "companion", term: "weekend", status: "active", source: "companion_weekend", started_at: now, expires_at: expires });
      await audit(sb, "weekend", userId, { expires_at: expires });
      return json(200, { ok: true, expires_at: expires });
    }

    if (action === "grant_alc") {
      const program = (body.program_id || "").toString().slice(0, 40);
      if (!program) return json(400, { error: "program_id required" });
      await sb.from("purchases").insert({ user_id: userId, program_id: program, amount_cents: 0, purchased_at: now });
      await audit(sb, "grant_alc", userId, { program_id: program });
      return json(200, { ok: true });
    }

    if (action === "credit") {
      const amount = parseInt(body.amount_cents, 10) || 814;
      const days = parseInt(body.days, 10) || 90;
      const expires = new Date(Date.now() + days * 86400000).toISOString();
      await sb.from("credits").insert({ user_id: userId, amount_cents: amount, expires_at: expires });
      await audit(sb, "credit", userId, { amount_cents: amount, days });
      return json(200, { ok: true });
    }

    if (action === "reset_reset") {
      await sb.from("reset_progress").delete().eq("user_id", userId);
      await sb.from("reset_enrollment").delete().eq("user_id", userId);
      await audit(sb, "reset_reset", userId, {});
      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (e) {
    console.error("admin-comp:", e.message);
    return json(500, { error: "Action failed", detail: e.message });
  }
};
