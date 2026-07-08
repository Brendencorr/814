/**
 * stripe-webhook.js — Stripe → Riley. The grant/renew/revoke engine. "Stripe for money, Supabase for access."
 *
 * SAFE BY DESIGN:
 *  - DORMANT until STRIPE_WEBHOOK_SECRET is set (no secret → 503).
 *  - Verifies Stripe's signature (HMAC-SHA256 over `${t}.${rawBody}`) before trusting anything.
 *  - Idempotent: each Stripe event.id is logged once in `payments` — a replay is a no-op.
 *  - Grants from Checkout Session METADATA (user_id, product_type, plan, term, program) that
 *    stripe-checkout.js sets — no price-guessing. Later events (renew/cancel/refund) map the Stripe
 *    customer back to the member via user_profiles.stripe_customer_id.
 *  - Never throws to Stripe: internal errors are logged and answered 200 (so Stripe doesn't retry-storm),
 *    only a bad signature is rejected (400).
 *
 * Events handled:
 *   checkout.session.completed     → grant (subscription or one-time program) + store customer id
 *   invoice.paid                   → renewal: extend the active sub's expiry
 *   customer.subscription.updated  → upgrade/downgrade: swap plan_id/term
 *   customer.subscription.deleted  → revoke
 *   charge.refunded                → revoke
 */
const crypto = require("crypto");
const { getSupabaseClient } = require("./supabase-client");
const { PLAN_BY_LOOKUP } = require("./stripe-catalog");

const DAY = 86400000;
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const graceISO = (term) => new Date(Date.now() + (term === "annual" ? 370 : 35) * DAY).toISOString();

function verify(rawBody, sigHeader, secret) {
  try {
    const parts = {};
    String(sigHeader || "").split(",").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1); });
    if (!parts.t || !parts.v1) return null;
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t)) > 300) return null; // 5-min tolerance
    const expected = crypto.createHmac("sha256", secret).update(parts.t + "." + rawBody).digest("hex");
    const a = Buffer.from(expected), b = Buffer.from(parts.v1);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return JSON.parse(rawBody);
  } catch (e) { return null; }
}

async function uidByCustomer(sb, customer) {
  if (!customer) return null;
  try { const { data } = await sb.from("user_profiles").select("id").eq("stripe_customer_id", customer).maybeSingle(); return data ? data.id : null; }
  catch (e) { return null; }
}
// Resolve a Stripe price's lookup_key from a subscription-item / invoice-line object.
function lookupOf(item) { return item && item.price && item.price.lookup_key; }

exports.handler = async (event) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "not_configured" }); // dormant until the endpoint secret is set
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const sig = (event.headers && (event.headers["stripe-signature"] || event.headers["Stripe-Signature"])) || "";
  const evt = verify(raw, sig, secret);
  if (!evt) return json(400, { error: "bad_signature" });

  const sb = getSupabaseClient();
  const log = async (status, extra) => { try { await sb.from("payments").insert({ external_id: evt.id, status, product: evt.type, raw: evt, ...extra }); } catch (_) {} };

  // Idempotency: this Stripe event already processed?
  try { const { data: dupe } = await sb.from("payments").select("id").eq("external_id", evt.id).maybeSingle(); if (dupe) return json(200, { received: true, status: "duplicate" }); } catch (_) {}

  const obj = (evt.data && evt.data.object) || {};
  try {
    switch (evt.type) {
      case "checkout.session.completed": {
        const md = obj.metadata || {};
        const uid = obj.client_reference_id || md.user_id || null;
        const email = (obj.customer_details && obj.customer_details.email) || null;
        if (uid && obj.customer) { try { await sb.from("user_profiles").update({ stripe_customer_id: obj.customer }).eq("id", uid); } catch (_) {} }
        if (!uid) { await log("unmatched", { email, detail: "no user_id in session" }); break; }
        if (md.product_type === "program" && md.program) {
          await sb.from("purchases").insert({ user_id: uid, program_id: md.program });
          await log("granted", { user_id: uid, program_id: md.program, term: "one_time", email });
        } else if (md.plan) {
          const term = md.term || "monthly";
          await sb.from("subscriptions").insert({ user_id: uid, plan_id: md.plan, term, status: "active", source: "checkout", expires_at: graceISO(term) });
          await log("granted", { user_id: uid, plan_id: md.plan, term, email });
        } else { await log("needs_review", { user_id: uid, email, detail: "session had no plan/program metadata" }); }
        break;
      }
      case "invoice.paid": { // renewal — extend the active sub
        const uid = await uidByCustomer(sb, obj.customer);
        const line = obj.lines && obj.lines.data && obj.lines.data[0];
        const lk = lookupOf(line);
        const term = (lk && PLAN_BY_LOOKUP[lk] && PLAN_BY_LOOKUP[lk].term) || "monthly";
        if (uid) await sb.from("subscriptions").update({ status: "active", expires_at: graceISO(term) }).eq("user_id", uid).eq("status", "active");
        await log(uid ? "renewed" : "unmatched", { user_id: uid, term });
        break;
      }
      case "customer.subscription.updated": { // upgrade / downgrade
        const uid = await uidByCustomer(sb, obj.customer);
        const item = obj.items && obj.items.data && obj.items.data[0];
        const lk = lookupOf(item);
        const map = lk && PLAN_BY_LOOKUP[lk];
        if (uid && map) await sb.from("subscriptions").update({ plan_id: map.plan, term: map.term, status: "active", expires_at: graceISO(map.term) }).eq("user_id", uid).eq("status", "active");
        await log(uid && map ? "updated" : "ignored", { user_id: uid, plan_id: map && map.plan, term: map && map.term });
        break;
      }
      case "customer.subscription.deleted": { // cancel → revoke
        const uid = await uidByCustomer(sb, obj.customer);
        if (uid) await sb.from("subscriptions").update({ status: "canceled", expires_at: new Date().toISOString() }).eq("user_id", uid).eq("status", "active");
        await log(uid ? "revoked" : "unmatched", { user_id: uid, detail: "subscription canceled" });
        break;
      }
      case "charge.refunded": { // refund → revoke
        const uid = await uidByCustomer(sb, obj.customer);
        if (uid) await sb.from("subscriptions").update({ status: "canceled", expires_at: new Date().toISOString() }).eq("user_id", uid).eq("status", "active");
        await log(uid ? "revoked" : "unmatched", { user_id: uid, detail: "refunded" });
        break;
      }
      case "invoice.payment_failed": { // renewal card declined — KEEP access during Stripe's automatic
        // retries (dunning). If they ultimately fail, customer.subscription.deleted revokes. Just log now.
        const uid = await uidByCustomer(sb, obj.customer);
        await log(uid ? "payment_failed" : "unmatched", { user_id: uid, detail: "renewal payment failed — in Stripe retry window" });
        break;
      }
      case "charge.dispute.created": { // chargeback → revoke (and it's flagged in payments for you to review)
        const uid = await uidByCustomer(sb, obj.customer);
        if (uid) await sb.from("subscriptions").update({ status: "canceled", expires_at: new Date().toISOString() }).eq("user_id", uid).eq("status", "active");
        await log(uid ? "revoked" : "unmatched", { user_id: uid, detail: "chargeback / dispute opened" });
        break;
      }
      default: await log("ignored", {});
    }
    return json(200, { received: true });
  } catch (e) {
    await log("error", { detail: String((e && e.message) || e) });
    return json(200, { received: true, error: String((e && e.message) || e) }); // 200 → no Stripe retry-storm on our bug
  }
};
