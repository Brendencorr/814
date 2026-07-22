/**
 * payment-webhook.js - grants Riley access when a payment succeeds.
 *
 * Flow: member pays via a RockPaperCoin hosted invoice (charged through your Stripe) → a Zap
 * (trigger: Rock Paper Coin "Invoice Paid" OR Stripe "Charge Succeeded") → "Webhooks by Zapier: POST"
 * to THIS endpoint → we match the member by email, map the amount/product to a tier or program, and
 * insert the same subscriptions/purchases row a comp would (so user_active_products picks it up).
 *
 * SAFE BY DESIGN:
 *  - DORMANT until PAYMENTS_WEBHOOK_SECRET is set in Netlify (no secret → 503, grants nothing).
 *  - Idempotent: external_id (the Stripe/RPC invoice id) is unique in `payments` - a replayed event
 *    logs `duplicate` and grants nothing.
 *  - Fail-closed: an email we can't match, or an amount/product we can't resolve, is LOGGED
 *    (`unmatched` / `needs_review`) and grants NOTHING - it never guesses a tier.
 *  - Every event (granted or not) is written to `payments` for the operator to audit.
 *
 * Contract (map RockPaperCoin/Stripe trigger fields to these in the Zap's POST step):
 *   email        (required)  payer email
 *   external_id  (required)  the invoice/charge id  - idempotency key
 *   amount_cents  OR amount   e.g. 3400  or  "34.00"
 *   plan         (optional)  explicit tier: "companion" | "coach"
 *   term         (optional)  "monthly" | "annual"
 *   program      (optional)  explicit program key for a $8.14 purchase
 *   product      (optional)  freetext invoice title (audit + fallback)
 *   event        (optional)  e.g. "invoice.paid"
 * Auth: header `x-webhook-secret` (or ?secret= / body.secret) must equal PAYMENTS_WEBHOOK_SECRET.
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-webhook-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

// Unique prices -> internal tier + term. Paid tier $19/$175 (internal "companion", displays as Coach).
// 3400/35000 are RETIRED prices kept ONLY so grandfathered internal-"coach" payers still resolve.
const TIER_BY_CENTS = {
  1900:  { plan: "companion", term: "monthly" },
  17500: { plan: "companion", term: "annual" },
  3400:  { plan: "coach",     term: "monthly" },
  35000: { plan: "coach",     term: "annual" },
};
const PROGRAM_CENTS = 814; // every $8.14 program shares this price - needs an explicit program key.
const DAY = 86400000;

function toCents(body) {
  if (body.amount_cents != null && body.amount_cents !== "") { const n = parseInt(body.amount_cents, 10); if (!isNaN(n)) return n; }
  if (body.amount != null && body.amount !== "") {
    const f = parseFloat(String(body.amount).replace(/[^0-9.]/g, ""));
    if (!isNaN(f)) return Math.round(f * 100);
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  // Dormant until configured - no secret means no live payments wired yet.
  const SECRET = process.env.PAYMENTS_WEBHOOK_SECRET;
  if (!SECRET) return json(503, { error: "not_configured", detail: "PAYMENTS_WEBHOOK_SECRET is not set - webhook is dormant." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) { return json(400, { error: "bad_json" }); }
  const qs = event.queryStringParameters || {};
  const given = (event.headers && (event.headers["x-webhook-secret"] || event.headers["X-Webhook-Secret"])) || qs.secret || body.secret;
  if (given !== SECRET) return json(401, { error: "unauthorized" });

  const sb = getSupabaseClient();
  const email = String(body.email || body.customer_email || body.payer_email || "").trim().toLowerCase();
  const externalId = String(body.external_id || body.invoice_id || body.charge_id || body.id || "").trim();
  const cents = toCents(body);
  const product = String(body.product || body.description || body.title || "").trim() || null;
  const raw = body;

  // Log helper - UPDATEs the claimed payments row (created by the idempotency guard below).
  async function log(status, extra) {
    try { await sb.from("payments").update({ status, ...(extra || {}) }).eq("external_id", externalId); } catch (e) { /* non-fatal: never block the response */ }
  }

  if (!externalId) { try { await sb.from("payments").insert({ external_id: null, email: email || null, amount_cents: cents, product, status: "error", raw, detail: "missing external_id (idempotency key)" }); } catch (_) {} return json(400, { error: "missing_external_id" }); }

  // Idempotency guard (ATOMIC): CLAIM this invoice by inserting its payments row FIRST. UNIQUE(external_id)
  // makes a concurrent redelivery fail (code 23505) → return duplicate and grant nothing. `log` then
  // UPDATEs this row. (Was SELECT-then-act, which let two concurrent redeliveries both pass + double-grant.)
  try {
    const { error } = await sb.from("payments").insert({ external_id: externalId, email: email || null, amount_cents: cents, product, status: "processing", raw });
    if (error && error.code === "23505") return json(200, { ok: true, status: "duplicate", external_id: externalId });
  } catch (_) { /* non-unique error → proceed best-effort */ }

  // Resolve WHAT was bought (explicit fields win; else map by amount). Never guess a tier.
  let plan = (body.plan || "").toString().toLowerCase().trim();
  let term = (body.term || "").toString().toLowerCase().trim();
  let program = (body.program || body.program_id || "").toString().trim();

  if (!plan && !program && cents != null) {
    if (TIER_BY_CENTS[cents]) { plan = TIER_BY_CENTS[cents].plan; term = term || TIER_BY_CENTS[cents].term; }
    else if (cents === PROGRAM_CENTS) { /* a program, but which? needs an explicit program key */ }
  }
  if (plan && !["companion", "coach"].includes(plan)) plan = ""; // only these tiers are sold

  // Nothing resolvable → surface for the operator, grant nothing.
  if (!plan && !program) {
    await log("needs_review", { detail: "could not resolve tier/program from amount (" + cents + ") or fields" });
    return json(200, { ok: true, status: "needs_review", note: "logged for operator review - nothing granted" });
  }

  // Match the member by email. No match → log + grant nothing (operator reconciles manually).
  let userId = null;
  if (email) { try { const { data: u } = await sb.from("user_profiles").select("id").ilike("email", email).maybeSingle(); if (u) userId = u.id; } catch (_) {} }
  if (!userId) {
    await log("unmatched", { plan_id: plan || null, program_id: program || null, term: term || null, detail: "no Riley member with email " + email });
    return json(200, { ok: true, status: "unmatched", note: "no member matched - logged for operator; nothing granted" });
  }

  // GRANT.
  try {
    if (plan) {
      term = term || "monthly";
      const expiresAt = term === "annual" ? new Date(Date.now() + 370 * DAY).toISOString()
                      : term === "monthly" ? new Date(Date.now() + 35 * DAY).toISOString()  // grace for the next renewal
                      : null;
      await sb.from("subscriptions").insert({ user_id: userId, plan_id: plan, term, status: "active", source: "checkout", started_at: new Date().toISOString(), expires_at: expiresAt });
      await log("granted", { user_id: userId, plan_id: plan, term });
    } else {
      await sb.from("purchases").insert({ user_id: userId, program_id: program });
      await log("granted", { user_id: userId, program_id: program, term: "one_time" });
    }
  } catch (e) {
    await log("error", { user_id: userId, plan_id: plan || null, program_id: program || null, detail: String((e && e.message) || e) });
    return json(500, { error: "grant_failed", detail: String((e && e.message) || e) });
  }

  return json(200, { ok: true, status: "granted", user_id: userId, plan_id: plan || null, program_id: program || null, term: term || "one_time" });
};
