/**
 * stripe-checkout.js — creates a Stripe Checkout Session for a signed-in member. Member-facing.
 *
 * The app POSTs { token, lookup_key } — token = the member's Supabase access token, lookup_key =
 * a catalog key ("coach_annual", "companion_monthly", or a program key like "prog_body").
 * We resolve the member, reuse/create their Stripe Customer (stored as user_profiles.stripe_customer_id),
 * resolve the Price by lookup_key, and open a Checkout Session carrying the metadata the webhook grants
 * from: user_id / product_type / plan / term / program. Returns { url } to redirect to.
 *
 * DORMANT until STRIPE_SECRET_KEY is set. Stripe Tax is opt-in via STRIPE_TAX_ENABLED=true (off until
 * you've configured tax registrations, so checkout never errors before then).
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");
const { PLAN_BY_LOOKUP, PROGRAM_BY_LOOKUP } = require("./stripe-catalog");

const STRIPE = "https://api.stripe.com/v1/";
const APP = "https://riley.meetriley.us";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const authH = () => ({ Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" });
async function sGet(p) { const r = await fetch(STRIPE + p, { headers: authH() }); return r.json(); }
async function sPost(p, o) { const b = new URLSearchParams(); for (const k in o) if (o[k] != null && o[k] !== "") b.append(k, String(o[k])); const r = await fetch(STRIPE + p, { method: "POST", headers: authH(), body: b }); return r.json(); }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: "stripe_not_configured" });

  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "bad_json" }); }
  const token = body.token || (event.headers && (event.headers.authorization || event.headers.Authorization) || "").replace(/^Bearer\s+/i, "");
  const sb = getSupabaseClient();
  const uid = token ? await getUserIdFromToken(sb, token) : null;
  if (!uid) return json(401, { error: "unauthorized" });

  const lookup = String(body.lookup_key || "").trim();
  const sub = PLAN_BY_LOOKUP[lookup];       // subscription tier
  const program = PROGRAM_BY_LOOKUP[lookup]; // one-time program
  if (!sub && !program) return json(400, { error: "unknown_product", lookup_key: lookup });

  try {
    // Resolve the Price by PRODUCT id (riley_<key> — fixed + unambiguous), NOT by lookup_key. Programs
    // are one product = one price; subscriptions are one product with two prices, disambiguated by interval.
    // This is deterministic and immune to any lookup_key crossing in the catalog.
    const productId = sub ? ("riley_" + sub.plan) : ("riley_" + lookup);
    const want = sub ? (sub.term === "annual" ? "year" : "month") : null;
    const pr = await sGet("prices?product=" + encodeURIComponent(productId) + "&active=true&limit=10");
    const prices = (pr && pr.data) || [];
    const price = sub ? prices.find((p) => p.recurring && p.recurring.interval === want) : prices[0];
    if (!price || !price.id) return json(400, { error: "price_not_found", detail: "no active price for " + productId + " — run stripe-setup" });

    // Reuse or create the member's Stripe Customer.
    const { data: prof } = await sb.from("user_profiles").select("email,full_name,stripe_customer_id").eq("id", uid).maybeSingle();
    let customer = prof && prof.stripe_customer_id;
    if (!customer) {
      const c = await sPost("customers", { email: (prof && prof.email) || undefined, name: (prof && prof.full_name) || undefined, "metadata[user_id]": uid });
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
    };
    if (sub) {
      params["metadata[plan]"] = sub.plan; params["metadata[term]"] = sub.term;
      params["subscription_data[metadata][user_id]"] = uid;
      params["subscription_data[metadata][plan]"] = sub.plan;
    } else {
      params["metadata[program]"] = program;
    }
    if (String(process.env.STRIPE_TAX_ENABLED || "").toLowerCase() === "true") {
      params["automatic_tax[enabled]"] = "true";
      params["customer_update[address]"] = "auto";
      params["billing_address_collection"] = "required";
    }

    const session = await sPost("checkout/sessions", params);
    if (!session.url) return json(500, { error: "session_create_failed", detail: session.error });
    return json(200, { url: session.url, id: session.id });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
