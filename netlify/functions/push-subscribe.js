/**
 * push-subscribe.js - The 8:14 Reset web-push consent + subscription.
 *
 * POST { action, token?, ... }:
 *   'key'         → { publicKey }               (VAPID public key for pushManager.subscribe)
 *   'subscribe'   { token, subscription, tz }   → grant + store the subscription (program-scoped, auto end date)
 *   'decline'     { token }                     → record a decline (so we never re-ask)
 *   'unsubscribe' { token }                     → revoke
 *
 * Identity comes from the verified access token. Consent is scoped to '7-day-reset'
 * with an ends_at (7 program days + 3 grace), honored automatically by the cron.
 */
const { getSupabaseClient, getUserIdFromToken, getVapidConfig } = require("./supabase-client");
const webpush = require("web-push");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PROGRAM = "7-day-reset";
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action;

  // The public key is safe to expose - the client needs it to subscribe.
  if (action === "key") { const { publicKey } = await getVapidConfig(); return json(200, { publicKey: publicKey || null }); }

  const supabase = getSupabaseClient();
  const userId = await getUserIdFromToken(supabase, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });
  const now = new Date();

  if (action === "subscribe") {
    const sub = body.subscription;
    if (!sub || !sub.endpoint) return json(400, { error: "subscription required" });
    const ends = new Date(now.getTime() + 10 * 24 * 3600 * 1000); // 7 program days + 3 grace
    await supabase.from("notification_consents").upsert({
      user_id: userId, program_key: PROGRAM, granted: true,
      starts_at: now.toISOString(), ends_at: ends.toISOString(),
      cadence: "am_pm", channel: "push", push_subscription: sub,
      tz: (body.tz || "America/Denver"), status: "active", updated_at: now.toISOString(),
    }, { onConflict: "user_id,program_key" });
    return json(200, { ok: true });
  }

  if (action === "decline") {
    await supabase.from("notification_consents").upsert(
      { user_id: userId, program_key: PROGRAM, granted: false, status: "declined", updated_at: now.toISOString() },
      { onConflict: "user_id,program_key" }
    );
    return json(200, { ok: true });
  }

  if (action === "unsubscribe") {
    await supabase.from("notification_consents")
      .update({ granted: false, status: "revoked", updated_at: now.toISOString() })
      .eq("user_id", userId).eq("program_key", PROGRAM);
    return json(200, { ok: true });
  }

  // Send a real web push to the caller's own device right now - confirms push works
  // without waiting for the 8:14am/8pm cron.
  if (action === "test") {
    const { publicKey, privateKey, subject } = await getVapidConfig();
    if (!publicKey || !privateKey) return json(503, { error: "Push not configured" });
    const { data: c } = await supabase.from("notification_consents")
      .select("push_subscription").eq("user_id", userId).eq("program_key", PROGRAM).maybeSingle();
    if (!c || !c.push_subscription) return json(400, { error: "No subscription yet" });
    webpush.setVapidDetails(subject, publicKey, privateKey);
    try {
      await webpush.sendNotification(c.push_subscription, JSON.stringify({
        title: "Riley - test nudge",
        body: "Web push is working. This is exactly how your morning and evening nudges will arrive.",
        url: "/reset", tag: "reset-test",
      }));
      return json(200, { ok: true });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supabase.from("notification_consents").update({ status: "revoked", granted: false }).eq("user_id", userId).eq("program_key", PROGRAM);
      }
      return json(502, { error: "Send failed", detail: e.statusCode || e.message });
    }
  }

  return json(400, { error: "Unknown action" });
};
