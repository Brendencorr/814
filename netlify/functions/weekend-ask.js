/**
 * weekend-ask.js — Doc 2 §5.3: the SINGLE ask after the Companion Weekend ends.
 *
 * The Week One Letter has zero selling; the 48h Companion Weekend is a gift; THIS is the one and
 * only upgrade moment — shown once, warm, after the weekend expires and the member is back on Guide.
 * Never shown if they upgraded, and never twice (gated on the upgrade_prompt_shown event). No migration.
 *
 * POST { token, action }:
 *   'check' → { show, weekend_ended_at? }  (show=true only if: a weekend sub has EXPIRED, no active
 *                                           paid/comp sub, and the post_weekend ask wasn't shown yet)
 *   'seen'  → { ok }                        (emits upgrade_prompt_shown{source:'post_weekend'} once)
 *
 * Token-verified identity. Fail-open: any error → { show:false } (never nag on a hiccup).
 */
const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const supabase = getSupabaseClient();
  const userId = await getUserIdFromToken(supabase, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });
  const action = body.action || "check";
  const now = Date.now();

  try {
    if (action === "seen") {
      emitEvent(supabase, userId, "upgrade_prompt_shown", { source: "post_weekend" });
      return json(200, { ok: true });
    }

    // action 'check'
    const [wkRes, activeRes, priorRes] = await Promise.all([
      supabase.from("subscriptions").select("expires_at").eq("user_id", userId).eq("term", "weekend").maybeSingle(),
      supabase.from("subscriptions").select("plan_id, expires_at").eq("user_id", userId).eq("status", "active").neq("term", "weekend"),
      supabase.from("events").select("id").eq("user_id", userId).eq("name", "upgrade_prompt_shown").contains("props", { source: "post_weekend" }).limit(1),
    ]);

    const weekend = wkRes.data;
    // Weekend must exist AND have expired.
    if (!weekend || !weekend.expires_at || new Date(weekend.expires_at).getTime() > now) return json(200, { show: false });
    // Already upgraded to a real paid/comp plan (non-weekend, not expired)? Then no ask.
    const hasPaid = (activeRes.data || []).some((s) =>
      ["companion", "coach", "mentor"].includes(s.plan_id) && (!s.expires_at || new Date(s.expires_at).getTime() > now));
    if (hasPaid) return json(200, { show: false });
    // Already shown once?
    if (priorRes.data && priorRes.data.length) return json(200, { show: false });

    return json(200, { show: true, weekend_ended_at: weekend.expires_at });
  } catch (e) {
    console.error("weekend-ask:", e.message);
    return json(200, { show: false }); // fail-open: never nag on an error
  }
};
