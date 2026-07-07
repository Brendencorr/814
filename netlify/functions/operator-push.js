/**
 * operator-push.js — register admin DEVICES to receive new-member push alerts.
 *
 * Separate from member push (notification_consents). OPERATOR_KEY-gated on every
 * action (the operator dashboard's fetch injector sends x-operator-key on all calls).
 * Devices live in operator_push_subscriptions and are pushed to by operator-notify on
 * each signup. operator.html has no per-user identity (shared operator key), so
 * "any admin with dashboard access" registers their own device(s) here.
 *
 * POST { action, ... }:
 *   'key'          → { publicKey }                    VAPID public key (for pushManager.subscribe)
 *   'subscribe'    { subscription, label?, tz? }      register / reactivate THIS device
 *   'unsubscribe'  { endpoint }                       deactivate a device (stops operator sends only)
 *   'list'         → { devices:[{ label, active, created_at, last_sent_at, tail }] }
 *   'test'         → send a test alert to all active operator devices
 * Model: n/a
 */
const { getSupabaseClient, requireOperator, getVapidConfig } = require("./supabase-client");
const { sendToAllOperators } = require("./operator-notify");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // Operator-only — same gate as the rest of the dashboard. Sits AFTER OPTIONS so the
  // CORS preflight isn't blocked.
  const gate = requireOperator(event); if (gate) return gate;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action;

  // VAPID public key is safe to expose; still behind the operator gate for consistency.
  if (action === "key") { const { publicKey } = await getVapidConfig(); return json(200, { publicKey: publicKey || null }); }

  const supabase = getSupabaseClient();

  if (action === "subscribe") {
    const sub = body.subscription;
    if (!sub || !sub.endpoint) return json(400, { error: "subscription required" });
    const { error } = await supabase.from("operator_push_subscriptions").upsert({
      endpoint: sub.endpoint,
      subscription: sub,
      label: (typeof body.label === "string" ? body.label.trim().slice(0, 80) : "") || null,
      tz: body.tz || "America/Denver",
      active: true,
    }, { onConflict: "endpoint" });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === "unsubscribe") {
    if (!body.endpoint) return json(400, { error: "endpoint required" });
    await supabase.from("operator_push_subscriptions").update({ active: false }).eq("endpoint", body.endpoint);
    return json(200, { ok: true });
  }

  if (action === "list") {
    const { data } = await supabase.from("operator_push_subscriptions")
      .select("endpoint, label, active, created_at, last_sent_at")
      .order("created_at", { ascending: true });
    const devices = (data || []).map((d) => ({
      label: d.label || null,
      active: d.active,
      created_at: d.created_at,
      last_sent_at: d.last_sent_at,
      tail: (d.endpoint || "").slice(-10),   // last chars only — never expose the full endpoint token
    }));
    return json(200, { devices });
  }

  if (action === "test") {
    const r = await sendToAllOperators(supabase, {
      title: "Riley — operator test",
      body: "Operator alerts are working on this device.",
      url: "/operator",
      tag: "op-test",
    });
    return json(200, r);
  }

  return json(400, { error: "Unknown action" });
};
