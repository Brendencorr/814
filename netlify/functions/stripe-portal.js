/**
 * stripe-portal.js — opens Stripe's hosted Customer Portal for a signed-in member.
 *
 * The app POSTs { token } (the member's Supabase access token). We find their stripe_customer_id and
 * create a Billing Portal session; the member manages cards, cancels, switches plans, and views/downloads
 * invoices — all hosted by Stripe (what actions are allowed is configured in the Stripe dashboard).
 * Returns { url } to redirect to. DORMANT until STRIPE_SECRET_KEY is set.
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");

const STRIPE = "https://api.stripe.com/v1/";
const RETURN_URL = "https://riley.meetriley.us/settings";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: "stripe_not_configured" });

  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "bad_json" }); }
  const token = body.token || (event.headers && (event.headers.authorization || event.headers.Authorization) || "").replace(/^Bearer\s+/i, "");
  const sb = getSupabaseClient();
  const uid = token ? await getUserIdFromToken(sb, token) : null;
  if (!uid) return json(401, { error: "unauthorized" });

  try {
    const { data: prof } = await sb.from("user_profiles").select("stripe_customer_id").eq("id", uid).maybeSingle();
    const customer = prof && prof.stripe_customer_id;
    if (!customer) return json(400, { error: "no_billing_account", detail: "member has no Stripe customer yet (no purchase made)" });

    const b = new URLSearchParams();
    b.append("customer", customer);
    b.append("return_url", body.return_url || RETURN_URL);
    const r = await fetch(STRIPE + "billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: b,
    });
    const session = await r.json();
    if (!session.url) {
      const err = session.error || {};
      // The stored customer doesn't exist in THIS Stripe mode — e.g. a test-mode id lingering after go-live, or
      // a customer deleted in Stripe. Self-heal: drop the stale id (so the billing card hides on next load) and
      // report the friendly "no billing account" state instead of a scary "Could not open billing" error.
      const missing = err.code === "resource_missing" || /no such customer/i.test(err.message || "");
      if (missing) {
        try { await sb.from("user_profiles").update({ stripe_customer_id: null }).eq("id", uid); } catch (_) {}
        return json(400, { error: "no_billing_account", detail: "stored customer not found — cleared stale id" });
      }
      return json(502, { error: "portal_create_failed", detail: err.message || err });
    }
    return json(200, { url: session.url });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
