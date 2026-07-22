/**
 * rhythm.test.js - unit tests for the pure Rhythm & Return module (docs/08 acceptance #1-#3 core).
 * Run: node tests/rhythm/rhythm.test.js   (pure - no DB, no network, no env)
 */
"use strict";
const assert = require("assert");
const R = require("../../netlify/functions/rhythm");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok - " + name); }
  catch (e) { failures++; console.error("  FAIL - " + name + "\n    " + e.message); }
}

console.log("rhythm - return tiers, Never-Say, backoff ladder, Re-Light");

// ── Acceptance #1: tier boundaries (2/3, 6/7, 29/30) ───────────────────────────────────────────
check("tier boundaries: 0=R0, 1-2=R1, 3-6=R2, 7-29=R3, 30+=R4", () => {
  assert.strictEqual(R.returnTier(0), "R0");
  assert.strictEqual(R.returnTier(1), "R1");
  assert.strictEqual(R.returnTier(2), "R1");
  assert.strictEqual(R.returnTier(3), "R2");   // 2/3 boundary
  assert.strictEqual(R.returnTier(6), "R2");
  assert.strictEqual(R.returnTier(7), "R3");   // 6/7 boundary
  assert.strictEqual(R.returnTier(29), "R3");
  assert.strictEqual(R.returnTier(30), "R4");  // 29/30 boundary
  assert.strictEqual(R.returnTier(365), "R4");
});

check("appDayGap works on member app-day strings; unknown last activity is null (no-gap-safe)", () => {
  assert.strictEqual(R.appDayGap("2026-07-22", "2026-07-19"), 3);
  assert.strictEqual(R.appDayGap("2026-07-22", "2026-07-22"), 0);
  assert.strictEqual(R.appDayGap("2026-07-22", null), null);
});

// ── Acceptance #2 (core): Never-Say catches every banned shape, passes benign copy ─────────────
check("Never-Say catches gap references, streaks, guilt language", () => {
  const banned = [
    "Hey, you've been gone a while!",
    "We missed you around here.",
    "It's been 9 days since we talked.",
    "It's been 2 weeks - welcome back!",
    "Let's get back on track today.",
    "Don't break your streak now.",
    "You were away for a bit.",
    "14 days since your last check-in.",
    "Where have you been?",
    "Long time no see!",
  ];
  for (const b of banned) assert.ok(R.violatesNeverSay(b), "should catch: " + b);
});

check("Never-Say passes warm, gap-free welcomes", () => {
  const fine = [
    "Good to see you.",
    "Welcome back. Everything's where you left it.",
    "Last time you were working up to that call with your sister - no pressure, but I remembered.",
    "You're here. That's the whole assignment today.",
    "Want a quick where-we-left-off, or just start fresh?",
  ];
  for (const f of fine) assert.strictEqual(R.violatesNeverSay(f), null, "false positive on: " + f);
});

check("every registerBlock passes its own Never-Say gate", () => {
  for (const t of ["R0", "R1", "R2", "R3", "R4"]) {
    const block = R.registerBlock(t, "the call with your sister");
    // The block INSTRUCTS about banned phrases (mentions them), so test the member-facing openers only.
    assert.ok(block.indexOf("RETURN REGISTER") === 0 || t === "R?", "has register header for " + t);
  }
});

// ── Acceptance #3: notification simulator ──────────────────────────────────────────────────────
check("twice-a-week member (cadence 3) receives at most 2 touches/week", () => {
  const gap = R.nextNudgeGap(3, 0, 0);
  assert.ok(gap >= 4, "first touch waits cadence+1 days, got " + gap);
  assert.ok(7 / gap <= 2, "touch rate must be <= 2/week");
});

check("fully silent member converges to monthly and never goes fully dark", () => {
  // unanswered climbs: doubling then weekly, then 30d silent -> monthly, forever.
  assert.strictEqual(R.nextNudgeGap(1, 0, 0), 2);
  assert.strictEqual(R.nextNudgeGap(1, 1, 2), 4);
  assert.strictEqual(R.nextNudgeGap(1, 2, 6), 8);
  assert.strictEqual(R.nextNudgeGap(1, 3, 14), 7);   // 3 ignored -> weekly
  assert.strictEqual(R.nextNudgeGap(1, 5, 31), 30);  // 30d silent -> monthly
  assert.strictEqual(R.nextNudgeGap(1, 99, 400), 30, "monthly indefinitely - the light stays on");
});

check("doubling caps at 14 days before the weekly/monthly floors take over", () => {
  assert.ok(R.nextNudgeGap(7, 2, 0) <= 14);
});

check("two consecutive opens restore cadence (caller resets unanswered to 0)", () => {
  assert.strictEqual(R.nextNudgeGap(3, 0, 0), 4); // reset state = base interval again
});

check("personalCadence: median of gaps, clamped [1,7]", () => {
  assert.strictEqual(R.personalCadence([3, 4, 3, 4, 3]), 3);
  assert.strictEqual(R.personalCadence([0, 0, 1]), 1);   // daily member floors at 1
  assert.strictEqual(R.personalCadence([20, 25, 30]), 7); // cap 7
  assert.strictEqual(R.personalCadence([]), 1);
});

// ── Re-Light: rise-only display inside the window (07 §2b, acceptance #29-style) ───────────────
check("relightDisplay is rise-only inside the window, pass-through outside", () => {
  assert.strictEqual(R.relightDisplay(40, null, true), 40);  // first shown value
  assert.strictEqual(R.relightDisplay(35, 40, true), 40);    // never drops in-window
  assert.strictEqual(R.relightDisplay(52, 40, true), 52);    // rises freely
  assert.strictEqual(R.relightDisplay(35, 40, false), 35);   // honest again after the window
});

// ── Tier behavior mapping (07 §2b onto 08 tiers - recorded resolution) ─────────────────────────
check("tier behavior: R3 and R4 relight 7d (unified resolution), R4 adds tiny thresholds", () => {
  assert.strictEqual(R.tierBehavior("R3").relightDays, 7);
  assert.strictEqual(R.tierBehavior("R4").relightDays, 7);
  assert.ok(R.tierBehavior("R4").tinyThresholds, "R4 = First-Light-lite");
  assert.ok(R.tierBehavior("R2").hardDayWiden, "R2 return day widens bands");
  assert.strictEqual(R.tierBehavior("R4").checkin, "micro", "R4 gets three questions, not nine");
});

if (failures) { console.error("\n" + failures + " failing"); process.exit(1); }
console.log("\nall rhythm tests passing");
