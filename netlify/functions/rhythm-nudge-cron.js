/**
 * rhythm-nudge-cron.js — adaptive notification rhythm (docs/08 §3). Daily.
 *
 * Replaces static pings with observed-rhythm mirroring for members OUTSIDE an active 8:14
 * Reset window (the Reset's own consented 8:14am/8pm nudges stay as-designed - the :14 send
 * time is the brand). Ladder: base = personal_cadence + 1 quiet day; each unanswered touch
 * doubles the interval (cap 14); 3 ignored → weekly gentle; 30 days silent → monthly
 * "the light's on", indefinitely. Never fully dark, never louder. Hard dates OVERRIDE the
 * backoff: a pre-date touch sends regardless of rhythm, because that's care, not marketing.
 * Copy is Never-Say-clean by construction (asserted in tests/rhythm).
 */
const { getSupabaseClient, requireScheduledOrOperator, getVapidConfig, emitEvent } = require("./supabase-client");
const { nextNudgeIntervalDays } = require("./rhythm-utils");
const { governProactiveTouch, recordProactiveTouch } = require("./touch-governor");
const webpush = require("web-push");

const DAY = 86400000;
const appDayISO = (d) => new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);

// Tier-matched, Never-Say-clean copy (08 §3): R1 practice-anchored · long-quiet presence-anchored.
function touchCopy(daysSilent, hardDateLabel) {
  if (hardDateLabel) return { title: "Riley", body: `Thinking of you this week. I'm here whenever you want to talk.` };
  if (daysSilent >= 30) return { title: "Riley", body: "The light's on. No agenda - come say hi whenever." };
  if (daysSilent >= 7) return { title: "Riley", body: "No agenda - just leaving the light on for you." };
  return { title: "Riley", body: "Your quiet close is ready whenever you are." };
}

exports.handler = async (event) => {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;
  const { publicKey, privateKey, subject } = await getVapidConfig();
  if (!publicKey || !privateKey) return { statusCode: 200, body: "no-vapid" };
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const sb = getSupabaseClient();
  const now = new Date();
  const today = appDayISO(now);

  // Push consents that are NOT inside an active Reset window (those get the Reset nudges).
  const { data: consents } = await sb.from("notification_consents")
    .select("user_id,push_subscription,ends_at").eq("channel", "push").eq("granted", true).eq("status", "active");
  const candidates = (consents || []).filter((c) => !c.ends_at || Date.parse(c.ends_at) <= now.getTime());
  if (!candidates.length) return { statusCode: 200, body: "none" };

  const uids = [...new Set(candidates.map((c) => c.user_id).filter(Boolean))];
  const { data: profs } = await sb.from("user_profiles")
    .select("id,last_active_at,personal_cadence,nudge_interval_days,nudge_unanswered,last_nudge_at,push_notifications")
    .in("id", uids);
  const profBy = {}; (profs || []).forEach((p) => { profBy[p.id] = p; });

  // Hard dates in the next 3 days (pre-date care touch overrides backoff).
  const soon = new Date(now.getTime() + 3 * DAY).toISOString().slice(0, 10);
  const { data: hds } = await sb.from("hard_dates").select("user_id,date,label").in("user_id", uids).gte("date", today).lte("date", soon);
  const hardBy = {}; (hds || []).forEach((h) => { if (!hardBy[h.user_id]) hardBy[h.user_id] = h; });

  let sent = 0;
  for (const c of candidates) {
    const p = profBy[c.user_id];
    if (!p || p.push_notifications === false) continue;
    const daysSilent = p.last_active_at ? Math.floor((now.getTime() - Date.parse(p.last_active_at)) / DAY) : 0;
    if (daysSilent < 1) continue;                                 // active today - no touch needed
    const hd = hardBy[c.user_id] || null;
    const interval = nextNudgeIntervalDays({ intervalDays: p.nudge_interval_days, unanswered: p.nudge_unanswered, cadence: p.personal_cadence, daysSilent });
    const daysSinceNudge = p.last_nudge_at ? (now.getTime() - Date.parse(p.last_nudge_at)) / DAY : Infinity;
    const due = daysSinceNudge >= interval && daysSilent >= (Number(p.personal_cadence) || 1) + 1;
    if (!hd && !due) continue;
    if (hd && daysSinceNudge < 1) continue;                       // even a care touch: max one/day
    // ONE gate across channels (touch-governor, 2026-07-24): if anything already touched
    // this member today (brief email, lifecycle email, another push), hold. Hard-date
    // care touches bypass the cap (never the crisis check) - showing up on the day that
    // matters is the promise.
    const _gate = await governProactiveTouch(sb, c.user_id, { careTouch: !!hd });
    if (_gate) { emitEvent(sb, c.user_id, "nudge_suppressed", { reason: _gate, source: hd ? "harddate_touch" : "rhythm_nudge" }); continue; }
    try {
      await webpush.sendNotification(c.push_subscription, JSON.stringify(touchCopy(daysSilent, hd && hd.label)));
      sent++;
      recordProactiveTouch(sb, c.user_id, hd ? "harddate_touch" : "rhythm_nudge", "push");
      // Un-opened until session-return sees a session within 48h (which resets the ladder).
      const unanswered = (p.nudge_unanswered || 0) + 1;
      const cadence = Math.min(7, Math.max(1, Number(p.personal_cadence) || 1));
      const nextInterval = Math.min(14, (Number(p.nudge_interval_days) > 0 ? p.nudge_interval_days : cadence + 1) * 2);
      await sb.from("user_profiles").update({
        last_nudge_at: now.toISOString(),
        nudge_unanswered: hd ? p.nudge_unanswered || 0 : unanswered,   // a care touch never steps the ladder
        nudge_interval_days: hd ? p.nudge_interval_days : nextInterval,
      }).eq("id", c.user_id);
      emitEvent(sb, c.user_id, hd ? "harddate_touch_sent" : "notification_backoff_stepped", { interval, days_silent: daysSilent });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        try { await sb.from("notification_consents").update({ status: "expired" }).eq("user_id", c.user_id).eq("channel", "push"); } catch (_) {}
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ sent }) };
};
