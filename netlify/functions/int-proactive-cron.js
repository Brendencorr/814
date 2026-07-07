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

// Decide the single nudge (if any) for one enrollment, from PRE-FETCHED data (no per-enrollment queries
// — the reads are batched once in the handler). Dates first (time-sensitive), then a past-due commitment.
function planForEnrollment(enr, datesByEnr, pastDueCommit, todayDate, todayStr) {
  const dates = datesByEnr.get(enr.id) || [];
  for (const dt of dates) {
    if (dt.last_touch === todayStr) continue;
    const touch = touchFor(occurrenceOffset(dt.date, dt.recurrence, todayDate));
    if (touch) return { alert: dateAlert(enr, dt, touch), step: "date_" + touch, dateId: dt.id };
  }
  if (pastDueCommit.has(enr.id)) return { alert: commitmentAlert(enr), step: "commit_popup", dateId: null };
  return null;
}

// A single next-day care check-in after a slip — gentle, no inventory, no agenda.
function lapseFollowupAlert(enr) {
  return {
    audience: "user", user_id: enr.user_id, kind: "program",
    title: "Good morning", body: "No agenda and no inventory — just checking in. However today feels, Riley's here. Water, something to eat, and we go from there.",
    url: "/int-program?p=" + encodeURIComponent(enr.program_key), icon: "🤍", ref_table: "int_enrollments", ref_id: enr.id,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  let dryRun = false;
  try { dryRun = JSON.parse(event.body || "{}").dry_run === true; } catch (_) {}

  const sb = getSupabaseClient();
  const now = new Date();
  const nowMs = now.getTime();
  const todayStr = ymd(now);

  // Resilient select — lapse_at lands with migration 065; fall back gracefully if it isn't applied yet.
  let enrolls = [];
  const withLapseAt = await sb.from("int_enrollments").select("id, user_id, program_key, state, lapse_state, lapse_at").neq("state", "paused");
  if (withLapseAt.error) {
    const basic = await sb.from("int_enrollments").select("id, user_id, program_key, state, lapse_state").neq("state", "paused");
    enrolls = basic.data || [];
  } else {
    enrolls = withLapseAt.data || [];
  }
  const { data: todays } = await sb.from("int_nudges").select("enrollment_id").eq("sent_date", todayStr);
  const nudgedToday = new Set((todays || []).map((r) => r.enrollment_id));

  // Batch the per-enrollment reads ONCE (was an N+1 of 2 queries per enrollment). Both are naturally
  // bounded — int_dates is small, and past-due unconfirmed commitments ride the partial index
  // idx_int_commit_due. Group in memory so the loop below does zero queries.
  const datesByEnr = new Map();
  {
    const { data: allDates } = await sb.from("int_dates").select("id, label, date, date_type, recurrence, last_touch, enrollment_id");
    (allDates || []).forEach((d) => { if (!datesByEnr.has(d.enrollment_id)) datesByEnr.set(d.enrollment_id, []); datesByEnr.get(d.enrollment_id).push(d); });
  }
  const pastDueCommit = new Set();
  {
    const { data: commits } = await sb.from("int_commitments").select("enrollment_id")
      .is("confirmed_state", null).not("due_at", "is", null).lte("due_at", now.toISOString());
    (commits || []).forEach((c) => pastDueCommit.add(c.enrollment_id));
  }

  const plans = [];
  const clears = [];   // Staying Free enrollments whose lapse has aged out → auto-clear the suspend (never sticks)
  for (const enr of enrolls || []) {
    // Lapse (Staying Free) takes priority and suspends normal nudges.
    if (enr.program_key === "prog_int_staying_free" && enr.lapse_state === "lapse_active") {
      const lapseMs = enr.lapse_at ? Date.parse(enr.lapse_at) : NaN;
      const ageDays = isNaN(lapseMs) ? null : (nowMs - lapseMs) / DAY;
      if (ageDays != null && ageDays >= 3) { clears.push(enr.id); continue; }        // backstop exit
      if (nudgedToday.has(enr.id)) continue;                                          // 1/day cap
      if (ageDays != null && ageDays >= 1 && ageDays < 2) {                           // the day after — one gentle care touch
        plans.push({ enr, alert: lapseFollowupAlert(enr), step: "lapse_followup", dateId: null });
      }
      continue;                                                                        // no normal nudges while lapse-active
    }
    if (nudgedToday.has(enr.id)) continue;                                            // 1/day cap
    const plan = planForEnrollment(enr, datesByEnr, pastDueCommit, now, todayStr);
    if (plan) plans.push({ enr, ...plan });
  }

  let sent = 0, cleared = 0;
  if (!dryRun) {
    for (const p of plans) {
      try {
        await sb.from("client_alerts").insert(p.alert);
        await sb.from("int_nudges").insert({ enrollment_id: p.enr.id, ladder_step: p.step, channel: "popup", sent_date: todayStr });
        if (p.dateId) await sb.from("int_dates").update({ last_touch: todayStr }).eq("id", p.dateId);
        sent++;
      } catch (e) { console.error("nudge send failed (non-fatal):", e.message); }
    }
    for (const id of clears) {
      try { await sb.from("int_enrollments").update({ lapse_state: null, lapse_at: null, updated_at: new Date().toISOString() }).eq("id", id); cleared++; } catch (_) {}
    }
  }

  return json(200, {
    ok: true, dry_run: dryRun, date: todayStr,
    enrollments_scanned: (enrolls || []).length, planned: plans.length, sent: dryRun ? 0 : sent,
    lapse_auto_cleared: dryRun ? clears.length : cleared,
    preview: plans.slice(0, 25).map((p) => ({ program: p.enr.program_key, step: p.step, title: p.alert.title })),
  });
};

// Exposed for local unit testing of the date math (no DB).
module.exports._test = { occurrenceOffset, touchFor };
