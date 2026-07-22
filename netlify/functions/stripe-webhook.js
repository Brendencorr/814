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
 *                                    + member purchase emails: paid_1 receipt + paid_2 memory moment
 *                                      (subscription) / addon_1 receipt (program) - transactional,
 *                                      never blocking the grant; addon_2 is evaluate-comms' calendar job
 *   invoice.paid                   → renewal: extend the active sub's expiry; fallback paid_1/paid_2
 *                                    ONCE for a payer who never got them via checkout
 *   customer.subscription.updated  → upgrade/downgrade: swap plan_id/term
 *   customer.subscription.deleted  → revoke
 *   charge.refunded                → revoke
 */
const crypto = require("crypto");
const { getSupabaseClient } = require("./supabase-client");
const { PLAN_BY_LOOKUP, PROGRAMS } = require("./stripe-catalog");
const { notifyOperator } = require("./operator-email");
const { render } = require("./comms-templates");
const { sendClientEmail } = require("./email-send");
const { tierLabel } = require("./tier-labels");
const { signUid } = require("./comms-sign");

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

// ── Member-facing purchase emails (paid_1 receipt, paid_2 memory moment, addon_1 program receipt) ──
// These are TRANSACTIONAL: category 'transactional' at the choke point bypasses COMMS_ENABLED,
// the global daily cap, and crisis suppression - a receipt must always send. Every send is also
// mirrored into email_sends (flow from the template) so the operator comms view and the once-ever
// dedup (paid_2) see it. All of this is non-fatal by construction: a failed email NEVER blocks
// or reverts a grant.

function fmtPrice(cents, term) {
  if (cents == null || isNaN(cents)) cents = term === "annual" ? 17500 : 1900; // catalog fallback
  const n = cents / 100;
  return "$" + (Number.isInteger(n) ? n : n.toFixed(2)) + (term === "annual" ? "/yr" : "/mo");
}
function renewalDate(term) {
  const d = new Date();
  if (term === "annual") d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
function programDisplayName(programId) {
  const p = PROGRAMS.find((x) => x.product_key === programId);
  return (p && p.name) || String(programId || "your program");
}
// Has this template ever ACTUALLY been sent to this member? (paid_1/paid_2 fallback dedup)
async function everSent(sb, uid, key) {
  try {
    const { data } = await sb.from("email_sends").select("id").eq("user_id", uid).eq("template_key", key).eq("suppressed", false).limit(1);
    return !!(data && data.length);
  } catch (_) { return true; } // fail-closed: if we can't check, don't risk a duplicate
}
async function sendPurchaseEmail(sb, key, uid, email, vars) {
  try {
    if (!email) return false;
    // Operator override row (edited copy/sender/kill-switch) - same contract as evaluate-comms.
    let override = null;
    try {
      const { data } = await sb.from("comms_templates").select("*").eq("template_key", key).maybeSingle();
      override = data || null;
    } catch (_) {}
    if (override && override.enabled === false) return false; // explicit operator kill-switch
    // Signed unsub/pref links, same as the lifecycle cron builds them.
    const APP = "https://riley.meetriley.us";
    const sig = signUid(uid); const sp = sig ? "&s=" + sig : "";
    const urls = {
      unsub: APP + "/.netlify/functions/comms-unsubscribe?u=" + encodeURIComponent(uid) + sp,
      pref: APP + "/preferences?u=" + encodeURIComponent(uid) + sp,
    };
    const msg = render(key, vars, urls, override);
    const r = await sendClientEmail({
      to: email, from: msg.from, replyTo: msg.replyTo, subject: msg.subject,
      html: msg.html, text: msg.text,
      category: "transactional",
      kind: "transactional:" + key, userId: uid, meta: { template_key: key },
    });
    try {
      await sb.from("email_sends").insert({
        user_id: uid, template_key: key, flow: msg.flow, resend_id: r.id || null,
        suppressed: !r.sent, suppression_reason: r.sent ? null : (r.reason || "error"),
        plan: vars.plan_key || null,
      });
    } catch (_) {}
    return r.sent;
  } catch (e) {
    console.warn("[stripe-webhook] purchase email failed (non-fatal):", key, e && e.message);
    return false;
  }
}
// Stamp the comms-state subscription start (paid_3's day-25 clock - nothing else writes it).
async function stampSubscriptionStart(sb, uid, plan) {
  try {
    await sb.from("user_comms_state").upsert(
      { user_id: uid, subscription_started_at: new Date().toISOString(), plan, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  } catch (_) {}
}

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
          const who = await memberInfo(sb, uid, email);
          // addon_1: the $8.14 program receipt - transactional, always sends. (addon_2, the
          // unopened follow-up, is calendar work: evaluate-comms sends it ~3 days later.)
          await sendPurchaseEmail(sb, "addon_1", uid, who.email !== "-" ? who.email : email, {
            first_name: (who.name || "there").split(" ")[0] || "there",
            program_name: programDisplayName(md.program),
          });
          try {
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
          // Member-facing purchase emails + the paid_3 day-25 clock. Any granted subscription is
          // the paid memory tier (display name ALWAYS via tierLabel on the internal key).
          const who = await memberInfo(sb, uid, email);
          const memberEmail = who.email !== "-" ? who.email : email;
          const first = (who.name || "there").split(" ")[0] || "there";
          const payVars = {
            first_name: first, plan: tierLabel(plan), plan_key: plan,
            price: fmtPrice(obj.amount_total, term), renewal_date: renewalDate(term),
          };
          await stampSubscriptionStart(sb, uid, plan);
          await sendPurchaseEmail(sb, "paid_1", uid, memberEmail, payVars);            // receipt - every purchase
          if (!(await everSent(sb, uid, "paid_2"))) {                                   // memory moment - once ever
            await sendPurchaseEmail(sb, "paid_2", uid, memberEmail, payVars);
          }
          try {
            await notifyOperator({ event: "new_sub", subject: `New paid subscription: ${who.name}`,
              lines: [["Member", who.name], ["Email", who.email], ["Plan", `${tierLabel(plan)} (${term})`], ["Source", "Stripe checkout"]] });
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
        // FALLBACK purchase emails: a paying subscriber who somehow never got paid_1/paid_2 via
        // checkout (grandfathered sub renewing on an archived price, missed/unmatched checkout
        // event) gets them ONCE here. Ordinary renewals send nothing (everSent guard).
        if (uid && !(await everSent(sb, uid, "paid_1"))) {
          const who = await memberInfo(sb, uid, null);
          if (who.email !== "-") {
            // Internal key for logic from the live sub row; display is ALWAYS the paid tier's
            // label via tierLabel("companion") - a grandfathered internal-"coach" key must show
            // as the paid tier, not the coming-soon one.
            let planKey = "companion";
            try {
              const { data: subRow } = await sb.from("subscriptions").select("plan_id").eq("user_id", uid).eq("status", "active").maybeSingle();
              if (subRow && subRow.plan_id) planKey = String(subRow.plan_id);
            } catch (_) {}
            const cents = typeof obj.amount_paid === "number" ? obj.amount_paid : null;
            const payVars = {
              first_name: (who.name || "there").split(" ")[0] || "there",
              plan: tierLabel("companion"), plan_key: planKey,
              price: fmtPrice(cents, term), renewal_date: renewalDate(term),
            };
            await sendPurchaseEmail(sb, "paid_1", uid, who.email, payVars);
            if (!(await everSent(sb, uid, "paid_2"))) await sendPurchaseEmail(sb, "paid_2", uid, who.email, payVars);
          }
        }
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
            lines: [["Member", who.name], ["Email", who.email], ["Event", "Subscription canceled"], ["Access", "Reverts to " + tierLabel("guide") + " (free)"]] });
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
            lines: [["Member", who.name], ["Email", who.email], ["Refund", amt], ["Access", "Reverts to " + tierLabel("guide") + " (free)"]] });
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
