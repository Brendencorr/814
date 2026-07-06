/**
 * int-proactive-cron.js — the in-app proactive layer for the interactive programs (Phase 3, in-app channel).
 *
 * Once a day, generates gentle IN-APP nudges (client_alerts) for:
 *   1. approaching dates (int_dates) — T-2 / day-of / T+1, care-toned for grief/risk, celebration for milestone
 *   2. past-due unconfirmed commitments (int_commitments) — "even partly counts"
 * Enforces max 1 nudge/enrollment/day via int_nudges (dates take priority — they're time-sensitive). Suspended
 * for a Staying Free enrollment while lapse_state='lapse_active' (the ladder pauses; only care touches fire, later).
 *
 * SAFETY: in-app only (no push/email yet — that infra is a later step). Copy is deliberately generic and never
 * names the loss / substance / commitment text — the alert just warmly points back into the program.
 *
 * NOT scheduled yet. Test first: POST { dry_run:true } returns the planned nudges WITHOUT writing. When verified,
 * add a schedule in netlify.toml (e.g. "0 15 * * *" = ~9am MT) — no -background suffix (the schedule makes it bg).
 * Uses the service key (scans all users; bypasses RLS by design).
 * Model: n/a
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
const utcMidnight = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// Whole-day signed offset (occurrence - today), in UTC calendar days.
function dayOffset(todayMs, occMs) { return Math.round((occMs - todayMs) / DAY); }

// The occurrence of a date nearest to today: for 'annual', the closest of this-year / next-year / last-year
// (so a T+1 touch the day after, and a T-2 touch across a year boundary, both resolve correctly). For 'once',
// the literal date. Returns the offset in days (occurrence - today).
function occurrenceOffset(dateStr, recurrence, todayDate) {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const today0 = utcMidnight(todayDate);
  if (recurrence !== "annual") return dayOffset(today0, Date.UTC(y, m - 1, d));
  const cy = todayDate.getUTCFullYear();
  let best = null;
  for (const yr of [cy - 1, cy, cy + 1]) {
    const off = dayOffset(today0, Date.UTC(yr, m - 1, d));
    if (best === null || Math.abs(off) < Math.abs(best)) best = off;
  }
  return best;
}

// Which touch (if any) fires for a given offset: 2 days before, day-of, or 1 day after.
function touchFor(offset) {
  if (offset === 2) return "t_minus_2";
  if (offset === 0) return "day_of";
  if (offset === -1) return "t_plus_1";
  return null;
}

function dateAlert(enr, dt, touch) {
  const celebration = dt.date_type === "milestone";
  const url = "/int-program?p=" + encodeURIComponent(enr.program_key);
  const icon = celebration ? "🎉" : "🤍";
  let title, body;
  if (celebration) {
    title = "A day worth marking";
    body = touch === "t_minus_2" ? "Something you're building toward is coming up in a couple of days. Riley wants to mark it with you."
         : touch === "day_of" ? "Today's the day. Riley remembered — want to mark it together?"
         : "That milestone was yesterday. However it went, it counts. Riley's here.";
  } else {
    title = "Riley's thinking of you";
    body = touch === "t_minus_2" ? "There's a date coming up that Riley knows can be heavy. No pressure — just know you won't face it unannounced."
         : touch === "day_of" ? "Riley knows what today is. Want to look at the plan together, or just know I'm here?"
         : "Yesterday was a hard one to hold. Riley's checking in — no agenda, just here.";
  }
  return { audience: "user", user_id: enr.user_id, kind: "program", title, body, url, icon, ref_table: "int_dates", ref_id: dt.id };
}

function commitmentAlert(enr) {
  return {
    audience: "user", user_id: enr.user_id, kind: "program",
    title: "A gentle check-in", body: "No pressure at all — how did it go? Even partly counts. Riley's here whenever you're ready.",
    url: "/int-program?p=" + encodeURIComponent(enr.program_key), icon: "🌙", ref_table: "int_enrollments", ref_id: enr.id,
  };
}

// Decide the single nudge (if any) for one enrollment. Dates first (time-sensitive), then a past-due commitment.
async function planForEnrollment(sb, enr, nowMs, todayDate, todayStr) {
  const { data: dates } = await sb.from("int_dates").select("id, label, date, date_type, recurrence, last_touch").eq("enrollment_id", enr.id);
  for (const dt of dates || []) {
    if (dt.last_touch === todayStr) continue;
    const touch = touchFor(occurrenceOffset(dt.date, dt.recurrence, todayDate));
    if (touch) return { alert: dateAlert(enr, dt, touch), step: "date_" + touch, dateId: dt.id };
  }
  const { data: commits } = await sb.from("int_commitments")
    .select("id, due_at, confirmed_state").eq("enrollment_id", enr.id)
    .is("confirmed_state", null).not("due_at", "is", null).lte("due_at", new Date(nowMs).toISOString())
    .order("due_at", { ascending: false }).limit(1);
  if (commits && commits[0]) return { alert: commitmentAlert(enr), step: "commit_popup", dateId: null };
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  let dryRun = false;
  try { dryRun = JSON.parse(event.body || "{}").dry_run === true; } catch (_) {}

  const sb = getSupabaseClient();
  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = ymd(now);

  const { data: enrolls } = await sb.from("int_enrollments").select("id, user_id, program_key, state, lapse_state").neq("state", "paused");
  const { data: todays } = await sb.from("int_nudges").select("enrollment_id").eq("sent_date", todayStr);
  const nudgedToday = new Set((todays || []).map((r) => r.enrollment_id));

  const plans = [];
  for (const enr of enrolls || []) {
    if (nudgedToday.has(enr.id)) continue;                                           // 1/day cap
    if (enr.program_key === "prog_int_staying_free" && enr.lapse_state === "lapse_active") continue;  // ladder suspended in lapse
    const plan = await planForEnrollment(sb, enr, nowMs, now, todayStr);
    if (plan) plans.push({ enr, ...plan });
  }

  let sent = 0;
  if (!dryRun) {
    for (const p of plans) {
      try {
        await sb.from("client_alerts").insert(p.alert);
        await sb.from("int_nudges").insert({ enrollment_id: p.enr.id, ladder_step: p.step, channel: "popup", sent_date: todayStr });
        if (p.dateId) await sb.from("int_dates").update({ last_touch: todayStr }).eq("id", p.dateId);
        sent++;
      } catch (e) { console.error("nudge send failed (non-fatal):", e.message); }
    }
  }

  return json(200, {
    ok: true, dry_run: dryRun, date: todayStr,
    enrollments_scanned: (enrolls || []).length, planned: plans.length, sent: dryRun ? 0 : sent,
    preview: plans.slice(0, 25).map((p) => ({ program: p.enr.program_key, step: p.step, title: p.alert.title })),
  });
};

// Exposed for local unit testing of the date math (no DB).
module.exports._test = { occurrenceOffset, touchFor };
