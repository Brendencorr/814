/**
 * stripe-webhook.js - Stripe → Riley. The grant/renew/revoke engine. "Stripe for money, Supabase for access."
 *
 * SAFE BY DESIGN:
 *  - DORMANT until STRIPE_WEBHOOK_SECRET is set (no secret → 503).
 *  - Verifies Stripe's signature (HMAC-SHA256 over `${t}.${rawBody}`) before trusting anything.
 *  - Idempotent: each Stripe event.id is logged once in `payments` - a replay is a no-op.
 *  - Grants from Checkout Session METADATA (user_id, product_type, plan, term, program) that
 *    stripe-checkout.js sets - no price-guessing. Later events (renew/cancel/refund) map the Stripe
 *    customer back to the member via user_profiles.stripe_customer_id.
 *  - Never throws to Stripe: internal errors are logged and answered 200 (so Stripe doesn't retry-storm),
 *    only a bad signature is rejected (400).
 *
 * Events handled:
 *   checkout.session.completed     → grant (subscription or one-time program) + store customer id
 *                                    + capture stripe_coupon_id / promo_code if a discount was applied
 *   invoice.paid                   → renewal: extend the active sub's expiry
 *   customer.subscription.updated  → upgrade/downgrade: swap plan_id/term
 *   customer.subscription.deleted  → revoke
 *   charge.refunded                → revoke
 */
const crypto = require("crypto");
const { getSupabaseClient } = require("./supabase-client");
const { PLAN_BY_LOOKUP } = require("./stripe-catalog");
const { notifyOperator } = require("./operator-email");

// Stripe REST helpers (reuse the pattern from stripe-checkout.js - no SDK needed).
const STRIPE_BASE = "https://api.stripe.com/v1/";
function stripeAuthHeader() { return { Authorization: "Bearer " + (process.env.STRIPE_SECRET_KEY || "") }; }
async function stripeGet(path) {
  try {
    const r = await fetch(STRIPE_BASE + path, { headers: stripeAuthHeader() });
    return r.json();
  } catch (_) { return null; }
}

/**
 * captureCoupon - non-blocking, fault-tolerant coupon capture for checkout.session.completed.
 * Reads the discount from the session discounts array first; if not present, falls back to a
 * single GET on the Stripe subscription object. Returns { stripe_coupon_id, promo_code } or
 * {} if no discount was applied. Never throws.
 */
async function captureCoupon(session) {
  try {
    let couponId = null;
    let promoCodeStr = null;

    // Preferred path: discount embedded directly on the Checkout Session.
    // Stripe populates session.discounts[] when allow_promotion_codes=true and a code is applied.
    const discounts = Array.isArray(session.discounts) ? session.discounts : [];
    const sessionDiscount = discounts[0] || null;
    if (sessionDiscount && sessionDiscount.coupon && sessionDiscount.coupon.id) {
      couponId = sessionDiscount.coupon.id;
      // The promotion_code field on the discount object is a PromotionCode id (starts "promo_"),
      // not the human-readable code. We resolve it below.
      const promoId = sessionDiscount.promotion_code || null;
      if (promoId && typeof promoId === "string") {
        const pc = await stripeGet("promotion_codes/" + promoId);
        if (pc && pc.code) promoCodeStr = pc.code;
      }
    } else if (session.subscription && typeof session.subscription === "string") {
      // Fallback: fetch the Stripe subscription to read its applied discount.
      const sub = await stripeGet("subscriptions/" + session.subscription + "?expand[]=discount.promotion_code");
      if (sub && sub.discount && sub.discount.coupon && sub.discount.coupon.id) {
        couponId = sub.discount.coupon.id;
        const pc = sub.discount.promotion_code;
        if (pc && typeof pc === "object" && pc.code) {
          promoCodeStr = pc.code;
        } else if (pc && typeof pc === "string") {
          // promotion_code came back as an id despite expand - resolve it
          const pcObj = await stripeGet("promotion_codes/" + pc);
          if (pcObj && pcObj.code) promoCodeStr = pcObj.code;
        }
      }
    }

    if (!couponId) return {}; // no discount applied - leave columns null
    return { stripe_coupon_id: couponId, promo_code: promoCodeStr || null };
  } catch (_) { return {}; }
}

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
// Member display info (name + email) for operator alerts. Never throws.
async function memberInfo(sb, uid, fallbackEmail) {
  const out = { name: "Member", email: fallbackEmail || "-" };
  try {
    if (!uid) return out;
    const { data } = await sb.from("user_profiles").select("preferred_name,full_name,email").eq("id", uid).maybeSingle();
    if (data) { out.name = data.preferred_name || data.full_name || data.email || fallbackEmail || "Member"; out.email = data.email || fallbackEmail || "-"; }
  } catch (_) {}
  return out;
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
  // Idempotency guard (ATOMIC): CLAIM this event by inserting its payments row FIRST. The
  // UNIQUE(external_id) constraint makes a concurrent redelivery fail here (code 23505) → we
  // return duplicate and grant nothing. `log` then UPDATEs that row to the final status. (Was a
  // SELECT-then-act check, which let two concurrent redeliveries both pass and double-grant.)
  try {
    const { error } = await sb.from("payments").insert({ external_id: evt.id, status: "processing", product: evt.type, raw: evt });
    if (error && error.code === "23505") return json(200, { received: true, status: "duplicate" });
  } catch (_) { /* non-unique error → proceed best-effort; never drop a real payment over a logging hiccup */ }
  const log = async (status, extra) => { try { await sb.from("payments").update({ status, ...extra }).eq("external_id", evt.id); } catch (_) {} };

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
          try {
            const who = await memberInfo(sb, uid, email);
            await notifyOperator({ event: "purchase", subject: `Program purchase: ${who.name}`,
              lines: [["Member", who.name], ["Email", who.email], ["Program", md.program], ["Type", "One-time purchase"]] });
          } catch (_) {}
        } else if (md.plan) {
          const term = md.term || "monthly";
          // v2.3: Coach is no longer sold (folded into Companion). Defensive normalization - if a
          // "coach" plan somehow arrives (stale checkout link, replayed metadata), grant Companion.
          const plan = md.plan === "coach" ? "companion" : md.plan;
          await sb.from("subscriptions").insert({ user_id: uid, plan_id: plan, term, status: "active", source: "checkout", expires_at: graceISO(term) });
          await log("granted", { user_id: uid, plan_id: plan, term, email });
          // Non-blocking coupon capture: stamp the promo/coupon onto the subscription row we just
          // inserted. Runs after the grant is logged - a capture failure NEVER reverts the grant.
          try {
            const coupon = await captureCoupon(obj);
            if (coupon.stripe_coupon_id) {
              await sb.from("subscriptions").update(coupon).eq("user_id", uid).eq("status", "active");
            }
          } catch (_) {}
          try {
            const who = await memberInfo(sb, uid, email);
            // Label the GRANTED plan (Coach retired in v2.3 - no longer advertised).
            const planLabel = plan === "companion" ? "Riley Companion" : plan;
            await notifyOperator({ event: "new_sub", subject: `New paid subscription: ${who.name}`,
              lines: [["Member", who.name], ["Email", who.email], ["Plan", `${planLabel} (${term})`], ["Source", "Stripe checkout"]] });
          } catch (_) {}
        } else { await log("needs_review", { user_id: uid, email, detail: "session had no plan/program metadata" }); }
        break;
      }
      case "invoice.paid": { // renewal - extend the active sub
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
        try {
          const who = await memberInfo(sb, uid, null);
          await notifyOperator({ event: "cancel", subject: `Subscription canceled: ${who.name}`,
            lines: [["Member", who.name], ["Email", who.email], ["Event", "Subscription canceled"], ["Access", "Reverts to Guide"]] });
        } catch (_) {}
        break;
      }
      case "charge.refunded": { // refund → revoke
        const uid = await uidByCustomer(sb, obj.customer);
        if (uid) await sb.from("subscriptions").update({ status: "canceled", expires_at: new Date().toISOString() }).eq("user_id", uid).eq("status", "active");
        await log(uid ? "revoked" : "unmatched", { user_id: uid, detail: "refunded" });
        try {
          const who = await memberInfo(sb, uid, (obj.billing_details && obj.billing_details.email) || null);
          const amt = typeof obj.amount_refunded === "number" ? `$${(obj.amount_refunded / 100).toFixed(2)}` : "-";
          await notifyOperator({ event: "refund", subject: `Refund issued: ${who.name}`,
            lines: [["Member", who.name], ["Email", who.email], ["Refund", amt], ["Access", "Reverts to Guide"]] });
        } catch (_) {}
        break;
      }
      case "invoice.payment_failed": { // renewal card declined - KEEP access during Stripe's automatic
        // retries (dunning). If they ultimately fail, customer.subscription.deleted revokes. Just log now.
        const uid = await uidByCustomer(sb, obj.customer);
        await log(uid ? "payment_failed" : "unmatched", { user_id: uid, detail: "renewal payment failed - in Stripe retry window" });
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
