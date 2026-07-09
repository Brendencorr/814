/**
 * stripe-test-checkout.js — OPERATOR-gated. Mints a real LIVE Checkout Session for a specific member so the
 * operator can smoke-test the whole money loop (checkout → webhook grant → portal → refund) WITHOUT opening
 * the public buy buttons (payments_live can stay false). It builds the SAME session shape as the member-facing
 * stripe-checkout.js (client_reference_id + metadata), so the webhook grants exactly as it would for a real
 * customer, and the member's stripe_customer_id gets stored → the Customer Portal then works for them too.
 *
 * POST { user_id, lookup_key? }  — lookup_key defaults to "prog_sobriety" ($8.14, the cheapest item).
 * Returns { url } to open. Operator-only; safe to keep for future member testing or remove after launch.
 */
const { requireOperator, getSupabaseClient } = require("./supabase-client");
const { PLAN_BY_LOOKUP, PROGRAM_BY_LOOKUP } = require("./stripe-catalog");

const STRIPE = "https://api.stripe.com/v1/";
const APP = "https://riley.meetriley.us";
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const authH = () => ({ Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" });
async function sGet(p) { const r = await fetch(STRIPE + p, { headers: authH() }); return r.json(); }
async function sPost(p, o) { const b = new URLSearchParams(); for (const k in o) if (o[k] != null && o[k] !== "") b.append(k, String(o[k])); const r = await fetch(STRIPE + p, { method: "POST", headers: authH(), body: b }); return r.json(); }

exports.handler = async (event) => {
  const gate = requireOperator(event); if (gate) return gate;
  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: "stripe_not_configured" });

  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "bad_json" }); }
  const uid = String(body.user_id || "").trim();
  if (!uid) return json(400, { error: "user_id required" });
  const lookup = String(body.lookup_key || "prog_sobriety").trim();
  const sub = PLAN_BY_LOOKUP[lookup];        // subscription tier
  const program = PROGRAM_BY_LOOKUP[lookup]; // one-time program
  if (!sub && !program) return json(400, { error: "unknown_product", lookup_key: lookup });

  try {
    const sb = getSupabaseClient();
    // Resolve the Price by PRODUCT id (riley_<key>) — deterministic, same as stripe-checkout.
    const productId = sub ? ("riley_" + sub.plan) : ("riley_" + lookup);
    const want = sub ? (sub.term === "annual" ? "year" : "month") : null;
    const pr = await sGet("prices?product=" + encodeURIComponent(productId) + "&active=true&limit=10");
    const prices = (pr && pr.data) || [];
    const price = sub ? prices.find((p) => p.recurring && p.recurring.interval === want) : prices[0];
    if (!price || !price.id) return json(400, { error: "price_not_found", detail: productId + " — run stripe-setup" });

    // Reuse or create the member's Stripe Customer (stored on their profile so the portal works).
    const { data: prof } = await sb.from("user_profiles").select("email,stripe_customer_id").eq("id", uid).maybeSingle();
    if (!prof) return json(404, { error: "no_such_member" });
    let customer = prof.stripe_customer_id;
    if (!customer) {
      const c = await sPost("customers", { email: prof.email || undefined, "metadata[user_id]": uid });
      if (!c.id) return json(500, { error: "customer_create_failed", detail: c.error });
      customer = c.id;
      try { await sb.from("user_profiles").update({ stripe_customer_id: customer }).eq("id", uid); } catch (_) {}
    }

    const params = {
      mode: sub ? "subscription" : "payment",
      customer,
      client_reference_id: uid,
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": 1,
      success_url: APP + "/dashboard?checkout=success",
      cancel_url: APP + "/programs?checkout=cancel",
      "metadata[user_id]": uid,
      "metadata[product_type]": sub ? "subscription" : "program",
      allow_promotion_codes: "true",
    };
    if (sub) {
      params["metadata[plan]"] = sub.plan; params["metadata[term]"] = sub.term;
      params["subscription_data[metadata][user_id]"] = uid;
      params["subscription_data[metadata][plan]"] = sub.plan;
    } else {
      params["metadata[program]"] = program;
      if (prof.email) params["payment_intent_data[receipt_email]"] = prof.email;
    }

    const session = await sPost("checkout/sessions", params);
    if (!session.url) return json(500, { error: "session_create_failed", detail: session.error });
    return json(200, { url: session.url, id: session.id, mode: params.mode, amount_cents: price.unit_amount, livemode: session.livemode, product: lookup });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
