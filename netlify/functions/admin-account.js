/**
 * admin-account.js - OPERATOR-gated customer lifecycle controls for the member detail panel.
 *
 *   action=deactivate → cancel the member's Stripe subscription + revoke membership access
 *                       (subscriptions → canceled), but KEEP all their data. Reversible (re-comp
 *                       or they resubscribe). Everyday offboarding.
 *   action=delete     → HARD erase. Cancels Stripe first (so billing stops), then wipes every
 *                       member-owned row + the profile + the auth login via the SAME shared
 *                       eraseMemberById() the self-serve deletion uses. Requires confirm:true.
 *                       crisis_log is retained de-identified (per auth-handler's policy).
 *
 * Every action writes admin_audit. No card data ever touched - Stripe holds it; we only call
 * Stripe's cancel API. The stripe-webhook keeps Supabase access in lockstep on the resulting events.
 */

const { requireOperator, getSupabaseClient } = require("./supabase-client");
const { eraseMemberById } = require("./auth-handler"); // ONE erasure path, shared with self-serve

const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

// ── Stripe (cancel only; mirrors admin-billing) ──
const STRIPE = "https://api.stripe.com/v1/";
const authH = () => ({ Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" });
async function sGet(p) { const r = await fetch(STRIPE + p, { headers: authH() }); return r.json(); }
async function sDelete(p) { const r = await fetch(STRIPE + p, { method: "DELETE", headers: authH() }); return r.json(); }

async function cancelStripe(sb, uid) {
  if (!process.env.STRIPE_SECRET_KEY) return { skipped: "stripe_not_configured" };
  let cust = null;
  try { const { data } = await sb.from("user_profiles").select("stripe_customer_id").eq("id", uid).maybeSingle(); cust = data && data.stripe_customer_id; } catch (_) {}
  if (!cust) return { skipped: "no_customer" };
  try {
    const subs = await sGet("subscriptions?customer=" + cust + "&status=active&limit=10");
    const ids = ((subs && subs.data) || []).map((s) => s.id);
    const canceled = [];
    for (const id of ids) { await sDelete("subscriptions/" + id); canceled.push(id); }
    return { canceled };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

async function audit(sb, action, target, detail) {
  try { await sb.from("admin_audit").insert({ action, target_user: target || null, detail: detail || {} }); } catch (_) {}
}

exports.handler = async function (event) {
  const gate = requireOperator(event); if (gate) return gate;
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Content-Type": "application/json" }, body: "" };

  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "bad_json" }); }
  const action = String(body.action || "");
  const uid = String(body.user_id || "").trim();
  if (!uid) return json(400, { error: "user_id required" });

  let sb; try { sb = getSupabaseClient(); } catch (_) { return json(500, { error: "config" }); }

  // ── DEACTIVATE - reversible: stop the subscription, revoke access, keep data ──
  if (action === "deactivate") {
    const stripe = await cancelStripe(sb, uid);
    let subsCanceled = 0;
    try {
      const { data } = await sb.from("subscriptions").update({ status: "canceled", expires_at: new Date().toISOString() })
        .eq("user_id", uid).eq("status", "active").select("id");
      subsCanceled = (data || []).length;
    } catch (_) {}
    await audit(sb, "member_deactivate", uid, { stripe, subs_canceled: subsCanceled });
    return json(200, { ok: true, deactivated: true, stripe, subs_canceled: subsCanceled });
  }

  // ── DELETE - irreversible hard erase (Stripe canceled first so billing stops) ──
  if (action === "delete") {
    if (body.confirm !== true) return json(400, { error: "confirm:true required for hard delete" });
    let email = null;
    try { const { data } = await sb.from("user_profiles").select("email").eq("id", uid).maybeSingle(); email = data && data.email; } catch (_) {}
    const stripe = await cancelStripe(sb, uid);
    const { authDeleted, failed } = await eraseMemberById(sb, uid);
    // target_user=null (the user row is now gone); identity captured in detail for the audit trail.
    await audit(sb, "member_delete", null, { user_id: uid, email, stripe, auth_deleted: authDeleted, table_failures: failed });
    return json(200, { ok: true, deleted: true, auth_deleted: authDeleted, residual_failures: failed, stripe });
  }

  return json(400, { error: "unknown action" });
};
