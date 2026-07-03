/**
 * companion-weekend.js — Doc 2 §5.2: the 48-hour Companion gift after the Week One Letter.
 *
 * Grants full Companion access for 48 hours by inserting a subscription
 * (plan_id='companion', term='weekend', expires_at = now + 48h). entitlements.js's bridge then
 * unlocks Companion across the app; it reverts cleanly to Guide the moment it expires (no cron
 * needed — the bridge only counts non-expired subs). Idempotent: ONE Companion Weekend per user,
 * ever. Token-verified. Emits companion_weekend_started.
 *
 * POST { token } → { granted, expires_at } | { already, expires_at }.
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const supabase = getSupabaseClient();
  const userId = await getUserIdFromToken(supabase, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  try {
    // Idempotent — one Companion Weekend ever per user (Doc 2 §5.2).
    const { data: existing } = await supabase.from("subscriptions")
      .select("expires_at").eq("user_id", userId).eq("term", "weekend").maybeSingle();
    if (existing) return json(200, { already: true, expires_at: existing.expires_at });

    const expires = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    await supabase.from("subscriptions").insert({
      user_id: userId, plan_id: "companion", term: "weekend", status: "active",
      source: "companion_weekend", started_at: new Date().toISOString(), expires_at: expires,
    });
    try { await supabase.from("events").insert({ user_id: userId, name: "companion_weekend_started", props: {} }); } catch (_) {}

    return json(200, { granted: true, expires_at: expires });
  } catch (e) {
    console.error("companion-weekend:", e.message);
    return json(500, { error: "Could not start the Companion Weekend." });
  }
};
