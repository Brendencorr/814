/**
 * admin-integrations.js — operator "which integrations are wired?" status (Settings tab).
 *
 * Returns a boolean per integration — whether its Netlify env var(s) are present. NEVER returns the
 * secret values themselves, only presence. OPERATOR_KEY-gated. GET (the dashboard's opGet sends
 * x-operator-key). Replaces the old hardcoded "Anthropic: Connected / Supabase: Connected" that lied.
 * Model: n/a
 */
const { requireOperator, getVapidConfig } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireOperator(event); if (gate) return gate;

  const on = (v) => !!(v && String(v).trim());
  const vapid = await getVapidConfig();
  const items = [
    { label: "Anthropic — Riley chat",         group: "Core",     ok: on(process.env.ANTHROPIC_API_KEY),                                     critical: true },
    { label: "Supabase — database",            group: "Core",     ok: on(process.env.SUPABASE_SERVICE_KEY) && on(process.env.SUPABASE_URL),   critical: true },
    { label: "Operator key — this dashboard",  group: "Core",     ok: on(process.env.OPERATOR_KEY),                                          critical: true },
    { label: "Resend — email delivery",        group: "Delivery", ok: on(process.env.RESEND_API_KEY) },
    { label: "Web push — VAPID",               group: "Delivery", ok: on(vapid.publicKey) && on(vapid.privateKey), note: vapid.source === "db" ? "keys in database" : undefined },
    { label: "FeedHive — social publishing",   group: "Growth",   ok: on(process.env.FEEDHIVE_API_KEY) },
    { label: "PostHog — attribution",          group: "Growth",   ok: on(process.env.POSTHOG_PROJECT_ID) && (on(process.env.POSTHOG_PERSONAL_KEY) || on(process.env.POSTHOG_PROJECT_KEY)) },
    { label: "Canva — auto-design",            group: "Growth",   ok: on(process.env.CANVA_CONNECT_TOKEN), optional: true },
    { label: "Stripe — payments",              group: "Growth",   ok: on(process.env.STRIPE_SECRET_KEY),   optional: true, note: "not built yet" },
  ];
  return json(200, { items });
};
