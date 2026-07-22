/**
 * guide-flow.test.js - unit tests for the pure Guide-flow candidate picker (comms-flow.js).
 * Run: node tests/comms/guide-flow.test.js   (pure - no DB, no network, no env)
 *
 * Simulates one evaluation per calendar day under the one-email-per-day cap and asserts the
 * day-by-day schedule, including THE fix this picker exists for: reset_daily must fire for
 * Reset days 2-7 content regardless of signup day (the old else-if chain short-circuited on
 * guide_4's branch after day 4, so days 5-7 never sent, and late starters got nothing).
 */
"use strict";
const assert = require("assert");
const { pickGuideCandidate } = require("../../netlify/functions/comms-flow");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok - " + name); }
  catch (e) { failures++; console.error("  FAIL - " + name + "\n    " + e.message); }
}

/**
 * Simulate the guide flow: one cron evaluation per calendar day (the daily cap = at most one
 * send/day), tracking once-ever sends and per-reset-day dedup exactly like evaluate-comms does.
 *
 * @param {number} days                 calendar days to simulate (evaluations on day 0..days-1)
 * @param {(day:number)=>object} state  per-day member state { resetStarted, resetDay, pushOptedIn, plan }
 * @returns {Array<{day:number, key:string, n?:number}>} the send schedule
 */
function simulate(days, state) {
  const sentKeys = new Set();
  const sentResetDays = new Set();
  const schedule = [];
  for (let day = 0; day < days; day++) {
    const s = state(day);
    const cand = pickGuideCandidate({
      daysSinceSignup: day,
      resetStarted: !!s.resetStarted,
      resetDay: s.resetDay || 0,
      pushOptedIn: !!s.pushOptedIn,
      plan: s.plan || "guide",
      sentKeys, sentResetDays,
      dayFor: (k, d) => d,
      tplOff: () => false,
    });
    if (!cand) continue;
    if (cand.key === "reset_daily") sentResetDays.add(cand.n);
    else sentKeys.add(cand.key);
    schedule.push(cand.n != null ? { day, key: cand.key, n: cand.n } : { day, key: cand.key });
  }
  return schedule;
}

// Member completes one Reset day per calendar day starting on `startDay` (completion happens
// before that day's evaluation), capped at 7.
function resetFrom(startDay) {
  return (day) => ({
    resetStarted: day >= startDay,
    resetDay: day >= startDay ? Math.min(day - startDay + 1, 7) : 0,
  });
}

console.log("guide-flow candidate picker");

// ── THE spec scenario: signs up day 0, starts the Reset day 5 ──────────────────────────────
check("late starter (Reset from day 5) gets the FULL days 2-7 reset_daily sequence", () => {
  const sched = simulate(14, resetFrom(5));
  const resetSends = sched.filter((s) => s.key === "reset_daily");
  assert.deepStrictEqual(
    resetSends,
    [
      { day: 5, key: "reset_daily", n: 2 },
      { day: 6, key: "reset_daily", n: 3 },
      { day: 7, key: "reset_daily", n: 4 },
      { day: 8, key: "reset_daily", n: 5 },
      { day: 9, key: "reset_daily", n: 6 },
      { day: 10, key: "reset_daily", n: 7 },
    ],
    "expected days 2-7 content on calendar days 5-10, got " + JSON.stringify(resetSends)
  );
});

check("late starter full schedule: welcome d0, guide_2 d1, guide_4 d4, pitch d12", () => {
  const sched = simulate(14, resetFrom(5));
  assert.deepStrictEqual(sched, [
    { day: 0, key: "guide_1" },
    { day: 1, key: "guide_2" },
    { day: 4, key: "guide_4" },
    { day: 5, key: "reset_daily", n: 2 },
    { day: 6, key: "reset_daily", n: 3 },
    { day: 7, key: "reset_daily", n: 4 },
    { day: 8, key: "reset_daily", n: 5 },
    { day: 9, key: "reset_daily", n: 6 },
    { day: 10, key: "reset_daily", n: 7 },
    { day: 12, key: "guide_6" },
  ]);
});

// ── The original bug: on-time starter must keep receiving reset_daily AFTER day 4 ──────────
// Trace (completion before evaluation): d1 rd=1→n2, d2 rd=2→n3, d3 rd=3→n4, d4 rd=4→guide_4
// wins (n5's day is consumed), d5 rd=5→n6, d6 rd=6→n7. The old chain sent NOTHING after d4.
check("day-1 starter keeps receiving reset_daily after day 4 (the old chain sent nothing)", () => {
  const sched = simulate(12, resetFrom(1));
  const resetSends = sched.filter((s) => s.key === "reset_daily").map((s) => s.n);
  assert.deepStrictEqual(resetSends, [2, 3, 4, 6, 7],
    "expected n 2,3,4,6,7 (n=5 skipped: guide_4 won its day), got " + JSON.stringify(resetSends));
  assert.ok(sched.some((s) => s.key === "guide_4" && s.day === 4), "guide_4 should win day 4");
});

// ── Conflict rule: the calendar guide wins and the reset number is SKIPPED, never deferred ──
check("a reset number skipped for a calendar guide is never re-announced (no stale days)", () => {
  const sched = simulate(12, resetFrom(1));
  const ns = sched.filter((s) => s.key === "reset_daily").map((s) => s.n);
  assert.ok(!ns.includes(5), "n=5 was consumed by guide_4's day and must never send late");
  assert.deepStrictEqual([...ns].sort((a, b) => a - b), ns, "day numbers strictly increase - never deferred backwards");
  assert.strictEqual(new Set(ns).size, ns.length, "no duplicate day numbers");
});

// ── Push-opted members: no reset_daily emails; guide_3 congratulates instead ───────────────
check("push-opted member gets guide_3, never reset_daily", () => {
  const sched = simulate(14, (day) => ({ ...resetFrom(1)(day), pushOptedIn: true }));
  assert.ok(!sched.some((s) => s.key === "reset_daily"), "push members get push nudges, not emails");
  assert.ok(sched.some((s) => s.key === "guide_3" && s.day === 1), "guide_3 fires while progress is day 1");
});

// ── Paid members: never the pitch; the rest of the calendar unaffected ─────────────────────
check("paid member (internal key companion) never receives guide_6", () => {
  const sched = simulate(30, (day) => ({ ...resetFrom(1)(day), plan: "companion" }));
  assert.ok(!sched.some((s) => s.key === "guide_6"), "no pitch for a member who already has the tier");
  assert.ok(sched.some((s) => s.key === "guide_5" && s.day === 29), "founder letter still lands day 29");
});

// ── No-reset member: pure calendar flow, each email exactly once ────────────────────────────
check("member who never starts the Reset: guide_1 d0, guide_2 d1, guide_4 d4, guide_6 d12, guide_5 d29", () => {
  const sched = simulate(30, () => ({}));
  assert.deepStrictEqual(sched, [
    { day: 0, key: "guide_1" },
    { day: 1, key: "guide_2" },
    { day: 4, key: "guide_4" },
    { day: 12, key: "guide_6" },
    { day: 29, key: "guide_5" },
  ]);
});

// ── Stuck member: each reset day number announces at most once (no daily re-nag) ───────────
check("a member stuck on Reset day 1 hears about Day 2 exactly once", () => {
  const sched = simulate(10, (day) => ({ resetStarted: day >= 1, resetDay: day >= 1 ? 1 : 0 }));
  const resetSends = sched.filter((s) => s.key === "reset_daily");
  assert.deepStrictEqual(resetSends, [{ day: 1, key: "reset_daily", n: 2 }]);
});

// ── Operator controls still bind ────────────────────────────────────────────────────────────
check("tplOff disables a template without blocking the rest of the flow", () => {
  const sentKeys = new Set(), sentResetDays = new Set();
  const cand = pickGuideCandidate({
    daysSinceSignup: 2, resetStarted: true, resetDay: 1, pushOptedIn: false, plan: "guide",
    sentKeys, sentResetDays, dayFor: (k, d) => d, tplOff: (k) => k === "reset_daily",
  });
  assert.strictEqual(cand && cand.key, "guide_3", "with reset_daily off, guide_3 is next in priority");
});

if (failures) { console.error("\n" + failures + " failing"); process.exit(1); }
console.log("\nall guide-flow tests passing");
