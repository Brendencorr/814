/**
 * admin-billing.js — OPERATOR-gated. Per-member billing visibility + controls for the operator dashboard.
 * "See the payment + receipt in each member's account, and cancel or refund yourself." No banking details
 * ever leave Stripe — we only surface non-sensitive summaries (amount, status, date, card brand+last4) plus
 * Stripe's own hosted receipt/invoice links. The stripe-webhook then revokes/updates access on the resulting
 * Stripe events (charge.refunded, customer.subscription.deleted/updated), so access stays in lockstep.
 *
 * POST { action, user_id, ... }:
 *   action=get     → { customer, subscriptions[], payments[] }  (payments include receipt_url, invoice_url)
 *   action=cancel  → cancel the member's active subscription(s). Immediate by default; at_period_end:true keeps
 *                    access until the paid period ends. (Not a fund movement.)
 *   action=refund  → refund a charge (charge_id, or the member's latest charge). Operator-initiated.
 */
const { requireOperator, getSupabaseClient } = require("./supabase-client");

const STRIPE = "https://api.stripe.com/v1/";
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const authH = () => ({ Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" });
async function sGet(p) { const r = await fetch(STRIPE + p, { headers: authH() }); return r.json(); }
async function sPost(p, o) { const b = new URLSearchParams(); for (const k in o) if (o[k] != null && o[k] !== "") b.append(k, String(o[k])); const r = await fetch(STRIPE + p, { method: "POST", headers: authH(), body: b }); return r.json(); }
async function sDelete(p) { const r = await fetch(STRIPE + p, { method: "DELETE", headers: authH() }); return r.json(); }

exports.handler = async (event) => {
  const gate = requireOperator(event); if (gate) return gate;
  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: "stripe_not_configured" });

  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "bad_json" }); }
  const action = String(body.action || "get");
  const uid = String(body.user_id || "").trim();
  const sb = getSupabaseClient();

  // Resolve the member's Stripe customer id from their profile.
  let customer = body.customer || null;
  if (!customer && uid) {
    const { data } = await sb.from("user_profiles").select("stripe_customer_id").eq("id", uid).maybeSingle();
    customer = data && data.stripe_customer_id;
  }

  try {
    if (action === "get") {
      if (!customer) return json(200, { customer: null, subscriptions: [], payments: [] });
      const [subs, ch] = await Promise.all([
        sGet("subscriptions?customer=" + customer + "&status=all&limit=10"),
        sGet("charges?customer=" + customer + "&limit=10"),
      ]);
      const subscriptions = ((subs && subs.data) || []).map((s) => {
        const it = s.items && s.items.data && s.items.data[0];
        const pr = it && it.price;
        return { id: s.id, status: s.status, cancel_at_period_end: !!s.cancel_at_period_end, current_period_end: s.current_period_end, plan: pr && pr.lookup_key, amount: pr && pr.unit_amount, interval: pr && pr.recurring && pr.recurring.interval };
      });
      const payments = ((ch && ch.data) || []).map((c) => {
        const pd = c.payment_method_details && c.payment_method_details.card;
        return { id: c.id, amount: c.amount, currency: c.currency, status: c.status, paid: !!c.paid, refunded: !!c.refunded, amount_refunded: c.amount_refunded, created: c.created, description: c.description, receipt_url: c.receipt_url, card_brand: pd && pd.brand, card_last4: pd && pd.last4 };
      });
      return json(200, { customer, subscriptions, payments });
    }

    if (action === "cancel") {
      if (!customer) return json(400, { error: "no_billing_account" });
      const subs = await sGet("subscriptions?customer=" + customer + "&status=active&limit=10");
      const ids = ((subs && subs.data) || []).map((s) => s.id);
      if (!ids.length) return json(200, { canceled: [], detail: "no active subscription" });
      const results = [];
      for (const id of ids) {
        const r = body.at_period_end ? await sPost("subscriptions/" + id, { cancel_at_period_end: "true" }) : await sDelete("subscriptions/" + id);
        results.push({ id, status: r && r.status, ok: !!(r && r.id), error: r && r.error && r.error.message });
      }
      return json(200, { canceled: results, mode: body.at_period_end ? "at_period_end" : "immediate" });
    }

    if (action === "refund") {
      let chargeId = body.charge_id || null;
      if (!chargeId && customer) { const ch = await sGet("charges?customer=" + customer + "&limit=1"); chargeId = ch && ch.data && ch.data[0] && ch.data[0].id; }
      if (!chargeId) return json(400, { error: "no_charge" });
      const r = await sPost("refunds", { charge: chargeId });
      return json(r && r.id ? 200 : 400, { refunded: !!(r && r.id), refund_id: r && r.id, charge: chargeId, error: r && r.error && r.error.message });
    }

    return json(400, { error: "unknown_action" });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
