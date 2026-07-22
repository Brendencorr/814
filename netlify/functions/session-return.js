/**
 * session-return.js — POST at session start (docs/08 §2, §5). Resolves the return tier from
 * last_active_at (app-day aware), arms Re-Light / Direction-mute on R3/R4, maintains
 * personal_cadence, and settles notification backoff (a session within 48h of a nudge counts
 * as an open). Returns { tier } plus what the client needs to shape the session.
 * The gap is an INPUT here - it never appears in any member-facing string (Never-Say law).
 */
const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");
const { returnTier, relightFor, directionMuteDaysFor, personalCadence, recordNudgeResult } = require("./rhythm-utils");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

// App-day: 4am rollover (house rule). A timestamp before 4am belongs to the previous day.
function appDay(d) {
  const t = new Date(d.getTime() - 4 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const plusDays = (iso, n) => { const d = new Date(Date.parse(iso) + n * 86400000); return d.toISOString().slice(0, 10); };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  const now = new Date();
  const today = appDay(now);

  const { data: prof } = await sb.from("user_profiles")
    .select("last_active_at,personal_cadence,relight_until,relight_mode,direction_mute_until,nudge_interval_days,nudge_unanswered,last_nudge_at")
    .eq("id", userId).maybeSingle();

  const lastDay = prof && prof.last_active_at ? appDay(new Date(prof.last_active_at)) : null;
  const gap = lastDay == null ? null : dayDiff(lastDay, today);
  const tier = lastDay == null ? "R0" : returnTier(gap);

  const patch = { last_active_at: now.toISOString() };

  // Re-Light / Direction mute on R3/R4 (don't shorten an already-armed window).
  const rl = relightFor(tier);
  if (rl) {
    const until = plusDays(today, rl.days);
    if (!prof || !prof.relight_until || prof.relight_until < until) { patch.relight_until = until; patch.relight_mode = rl.mode; }
    const muteDays = directionMuteDaysFor(tier);
    const muteUntil = plusDays(today, muteDays);
    if (!prof || !prof.direction_mute_until || prof.direction_mute_until < muteUntil) patch.direction_mute_until = muteUntil;
  }

  // Personal cadence: median inter-session gap over trailing 28d (min 1, cap 7). We maintain it
  // incrementally: shift toward the observed gap via the stored median approximation.
  if (gap != null && gap >= 0) {
    const prevC = Number(prof && prof.personal_cadence) || 1;
    // P² would be overkill for one signal - a bounded EMA toward the clamped gap tracks the median well here.
    patch.personal_cadence = Math.min(7, Math.max(1, prevC + 0.25 * (Math.min(7, Math.max(gap, 0.5)) - prevC)));
  }

  // Notification backoff settle: a session within 48h of the last nudge = that nudge was answered.
  if (prof && prof.last_nudge_at && now.getTime() - Date.parse(prof.last_nudge_at) <= 48 * 3600 * 1000) {
    const s = recordNudgeResult({ intervalDays: prof.nudge_interval_days, unanswered: prof.nudge_unanswered, cadence: patch.personal_cadence || prof.personal_cadence }, true);
    patch.nudge_interval_days = s.intervalDays; patch.nudge_unanswered = s.unanswered; patch.last_nudge_opened_at = now.toISOString();
  }

  try { await sb.from("user_profiles").update(patch).eq("id", userId); } catch (e) { console.warn("session-return patch failed:", e.message); }

  // Record the return + arm the return-day accommodation (context, never scores - 08 §3b).
  if (gap != null && gap >= 3) {
    try { await sb.from("gap_summaries").upsert({ user_id: userId, returned_on: today, gap_days: gap }, { onConflict: "user_id,returned_on" }); } catch (_) {}
  }
  try {
    emitEvent(sb, userId, "session_return", { tier });
    if (rl && (!prof || !prof.relight_until || prof.relight_until < today)) emitEvent(sb, userId, tier === "R4" ? "reentry_firstlight_started" : "relight_started", { until: patch.relight_until });
  } catch (_) {}

  return json(200, {
    tier,
    relight: rl ? rl.mode : null,
    // Client shapes the session from the tier alone; the gap number itself stays server-side by design.
    return_sequence: tier === "R2" || tier === "R3" || tier === "R4",
    recap_offer: tier === "R3",
    fresh_start_offer: tier === "R4",
  });
};
