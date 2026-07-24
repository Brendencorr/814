/**
 * insight-nudge.js - Clarity v2.4 §2 insight nudges (docs/07A). All members, not grief-specific.
 * Riley may reach toward a member with THEIR OWN measured pattern. Five laws, enforced here
 * structurally (bank-based v1 - no free generation; tests/presence red-teams the bank):
 *  1. their own pattern as observation, never a consistency lecture
 *  2. invitation, never assignment
 *  3. the score is NEVER cited as caused by absence
 *  4. never inside protected windows (hard days / hard-date +-1) - presence, not coaching
 *  5. always ends by handing agency back ("What would help?")
 * Cap: one per member per 7 days. Crisis fail-safe: any L2+ event in 7 days - or any ERROR
 * checking - suppresses entirely. Surfaces: chat narration + Daily Brief card only.
 */
"use strict";
const DAY = 86400000;
const dayISO = (d) => d.toISOString().slice(0, 10);
const daysAgoISO = (n) => dayISO(new Date(Date.now() - n * DAY));
const appDay = () => dayISO(new Date(Date.now() - 4 * 3600 * 1000));

// The approved bank - every line: observation + "your pattern, not a rule" + agency-return.
const BANK = {
  outside_lighter: "One thing I've noticed in your own numbers - the days you get outside tend to sit a little lighter for you. That's your pattern, not a rule. What would help?",
  connection_softer: "Something yours, worth knowing: the days you talk to a real human tend to land softer for you. Just your own pattern - no assignment in it. What would help?",
  checkin_steadier: "A pattern of yours I want to hand back to you: the mornings after you check in tend to be your steadier ones. That's an observation, not a rule. What would help?",
};

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/**
 * Returns { key, text } when a nudge is due and safe, else null. Never throws.
 * Caller emits nothing on null; on delivery call recordShown().
 */
async function maybeInsightNudge(sb, userId) {
  try {
    if (!sb || !userId) return null;
    // This runs in the riley-chat reply hot path - the four reads go out IN PARALLEL
    // (audit 2026-07-24: they were sequential, serializing 4 round-trips onto every turn).
    const today = appDay();
    const [evRes, crRes, hdRes, ckRes] = await Promise.all([
      sb.from("events").select("id").eq("user_id", userId)
        .eq("name", "insight_nudge_shown").gte("created_at", daysAgoISO(7)).limit(1),
      sb.from("crisis_log").select("id").eq("user_id", userId)
        .gte("level", 2).gte("created_at", daysAgoISO(7)).limit(1),
      sb.from("hard_dates").select("date").eq("user_id", userId)
        .gte("date", daysAgoISO(2)).lte("date", dayISO(new Date(Date.now() + 2 * DAY))),
      sb.from("daily_checkins")
        .select("checkin_date,mood,outside,connection,hard_day").eq("user_id", userId)
        .gte("checkin_date", daysAgoISO(28)).order("checkin_date", { ascending: true }),
    ]);
    // cap: max one per 7 days
    if (evRes.error || (evRes.data && evRes.data.length)) return null;
    // crisis suppression - FAIL-SAFE: an error checking means suppress
    if (crRes.error || (crRes.data && crRes.data.length)) return null;
    // protected windows: today flagged hard, or within +-1 day of any hard date
    const hd = hdRes.data;
    const t = Date.parse(today + "T00:00:00Z");
    if ((hd || []).some((h) => Math.abs(Date.parse(h.date + "T00:00:00Z") - t) <= DAY)) return null;
    const cks = ckRes.data;
    const rows = (cks || []).filter((c) => typeof c.mood === "number");
    if (rows.some((c) => c.checkin_date === today && c.hard_day === true)) return null;
    if (rows.length < 10) return null;
    // pattern pick: strongest same-day contrast with n>=4 each side and diff >= 0.5
    const contrast = (flag) => {
      const yes = rows.filter((c) => c[flag] === true).map((c) => c.mood);
      const no = rows.filter((c) => c[flag] !== true).map((c) => c.mood);
      if (yes.length < 4 || no.length < 4) return null;
      const d = avg(yes) - avg(no);
      return d >= 0.5 ? d : null;
    };
    const cands = [];
    const o = contrast("outside"); if (o != null) cands.push(["outside_lighter", o]);
    const c = contrast("connection"); if (c != null) cands.push(["connection_softer", c]);
    if (!cands.length) {
      // next-morning steadiness: mood on days that follow a check-in day vs days that don't
      const dates = new Set(rows.map((r) => r.checkin_date));
      const after = rows.filter((r) => dates.has(dayISO(new Date(Date.parse(r.checkin_date + "T00:00:00Z") - DAY)))).map((r) => r.mood);
      const cold = rows.filter((r) => !dates.has(dayISO(new Date(Date.parse(r.checkin_date + "T00:00:00Z") - DAY)))).map((r) => r.mood);
      if (after.length >= 5 && cold.length >= 4 && avg(after) - avg(cold) >= 0.4) cands.push(["checkin_steadier", avg(after) - avg(cold)]);
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b[1] - a[1]);
    const key = cands[0][0];
    return { key, text: BANK[key] };
  } catch (_) { return null; }
}

// lazy-require so pure consumers (tests) can import the BANK without the supabase dependency
function recordShown(sb, userId, key) { try { require("./supabase-client").emitEvent(sb, userId, "insight_nudge_shown", { key }); } catch (_) {} }

module.exports = { maybeInsightNudge, recordShown, BANK };
