/**
 * stripe-setup.js — the "seamless push". OPERATOR_KEY-gated.
 *
 * Reads STRIPE_SECRET_KEY from env and creates/updates every Product + Price from stripe-catalog.js
 * in Stripe (idempotent). Products use fixed ids (riley_<key>) so re-runs reuse them; Prices are
 * idempotent by lookup_key. Returns the resulting product/price ids + the lookup_key→price_id map
 * (which the webhook + checkout consume). Safe to run repeatedly; in the sandbox it touches no real money.
 */
const { requireOperator } = require("./supabase-client");
const { CURRENCY, SUBSCRIPTIONS, PROGRAMS } = require("./stripe-catalog");

const STRIPE = "https://api.stripe.com/v1/";
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

function authHeaders() {
  return { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" };
}
async function sGet(path) {
  const r = await fetch(STRIPE + path, { headers: authHeaders() });
  return r.json();
}
async function sPost(path, obj) {
  const body = new URLSearchParams();
  for (const k in obj) if (obj[k] != null && obj[k] !== "") body.append(k, String(obj[k]));
  const r = await fetch(STRIPE + path, { method: "POST", headers: authHeaders(), body });
  return r.json();
}

// Idempotent product by fixed id.
async function ensureProduct(id, name, description, metaKey, metaVal) {
  const got = await sGet("products/" + id);
  if (got && got.id) {
    // Refresh name + description on re-runs so catalog copy edits take effect on existing products.
    const upd = { name }; if (description) upd.description = description;
    return sPost("products/" + id, upd);
  }
  const params = { id, name, ["metadata[" + metaKey + "]"]: metaVal };
  if (description) params.description = description;
  return sPost("products", params);
}
// Idempotent price by lookup_key. interval null => one-time.
async function ensurePrice(lookupKey, product, unitAmount, interval, nickname) {
  const found = await sGet("prices?lookup_keys[]=" + encodeURIComponent(lookupKey) + "&limit=1");
  if (found && found.data && found.data[0]) return found.data[0];
  const params = { lookup_key: lookupKey, product, unit_amount: unitAmount, currency: CURRENCY, nickname };
  if (interval) params["recurring[interval]"] = interval;
  return sPost("prices", params);
}

exports.handler = async (event) => {
  const gate = requireOperator(event); if (gate) return gate;
  if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: "STRIPE_SECRET_KEY not set" });

  const mode = (process.env.STRIPE_SECRET_KEY.indexOf("sk_live") === 0) ? "LIVE" : "test/sandbox";
  const out = { ok: true, mode, products: [], prices: {}, errors: [] };
  try {
    // Recurring subscription tiers.
    for (const s of SUBSCRIPTIONS) {
      const prod = await ensureProduct("riley_" + s.riley_plan, s.name, s.description, "riley_plan", s.riley_plan);
      if (!prod.id) { out.errors.push({ product: s.riley_plan, error: prod.error }); continue; }
      out.products.push({ key: s.riley_plan, id: prod.id });
      for (const pr of s.prices) {
        const price = await ensurePrice(pr.lookup_key, prod.id, pr.unit_amount, pr.interval, pr.nickname);
        if (price.id) out.prices[pr.lookup_key] = price.id;
        else out.errors.push({ price: pr.lookup_key, error: price.error });
      }
    }
    // One-time programs.
    for (const pg of PROGRAMS) {
      const prod = await ensureProduct("riley_" + pg.product_key, pg.name, pg.description, "riley_program", pg.product_key);
      if (!prod.id) { out.errors.push({ product: pg.product_key, error: prod.error }); continue; }
      out.products.push({ key: pg.product_key, id: prod.id });
      const price = await ensurePrice(pg.product_key, prod.id, pg.unit_amount, null, pg.name);
      if (price.id) out.prices[pg.product_key] = price.id;
      else out.errors.push({ price: pg.product_key, error: price.error });
    }
    // Create the webhook endpoint (idempotent by url). We deliberately DON'T return the signing secret —
    // reveal it in Stripe (Developers → Webhooks → this endpoint → Signing secret) → Netlify STRIPE_WEBHOOK_SECRET.
    try {
      const whUrl = "https://www.meetriley.us/.netlify/functions/stripe-webhook";
      const list = await sGet("webhook_endpoints?limit=100");
      const existing = ((list && list.data) || []).find((w) => w.url === whUrl);
      if (existing) { out.webhook = { id: existing.id, url: whUrl, existed: true }; }
      else {
        const evs = ["checkout.session.completed", "invoice.paid", "customer.subscription.updated", "customer.subscription.deleted", "charge.refunded"];
        const wb = new URLSearchParams(); wb.append("url", whUrl); evs.forEach((e, i) => wb.append("enabled_events[" + i + "]", e));
        const wr = await fetch(STRIPE + "webhook_endpoints", { method: "POST", headers: authHeaders(), body: wb });
        const w = await wr.json();
        out.webhook = w.id ? { id: w.id, url: whUrl, created: true, next: "reveal the signing secret in Stripe → Webhooks → this endpoint → Netlify STRIPE_WEBHOOK_SECRET" } : { error: (w.error && w.error.message) || "create failed" };
      }
    } catch (e) { out.webhook = { error: String((e && e.message) || e) }; }

    out.ok = out.errors.length === 0;
    out.counts = { products: out.products.length, prices: Object.keys(out.prices).length };
    return json(200, out);
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
