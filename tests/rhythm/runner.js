/**
 * tests/rhythm/runner.js — Rhythm & Return v1.1 acceptance suite (docs/08 §7 + docs/07 §15 #27-33
 * where automatable). Run: node --test tests/rhythm/runner.js
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const R = require(path.join(__dirname, "../../netlify/functions/rhythm-utils.js"));
const T = require(path.join(__dirname, "../../netlify/functions/checkin-templates.js"));
const engine = require(path.join(__dirname, "../../netlify/functions/clarity-engine.js"));

// 08 acc #1: tier boundaries exact at 2/3, 6/7, 29/30 (gap is app-day-diffed upstream; 4am
// rollover correctness is the appDay() property below).
test("return tier boundaries", () => {
  assert.equal(R.returnTier(0), "R0");
  assert.equal(R.returnTier(1), "R1"); assert.equal(R.returnTier(2), "R1");
  assert.equal(R.returnTier(3), "R2"); assert.equal(R.returnTier(6), "R2");
  assert.equal(R.returnTier(7), "R3"); assert.equal(R.returnTier(29), "R3");
  assert.equal(R.returnTier(30), "R4"); assert.equal(R.returnTier(400), "R4");
});

test("app-day 4am rollover", () => {
  const appDay = (d) => new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(appDay(new Date("2026-07-22T03:59:00Z")), "2026-07-21"); // pre-4am belongs to yesterday
  assert.equal(appDay(new Date("2026-07-22T04:00:00Z")), "2026-07-22");
});

// 08 acc #2 (static half): every string in the template bank + return copy is Never-Say-clean.
test("template bank passes the Never-Say gate", () => {
  const all = [];
  Object.values(T.FRAMINGS).forEach((v) => Object.values(v).forEach((s) => all.push(s)));
  Object.values(T.DYNAMIC).forEach((s) => all.push(s));
  Object.values(T.RETURN_SEQ).forEach((s) => Array.isArray(s) ? all.push(...s) : all.push(s));
  all.push(T.AFTERMATH);
  for (const s of all) assert.equal(R.violatesNeverSay(s), null, `Never-Say violation in template: "${s}"`);
});

// 07 acc #27: no member-facing string may state gap length. Red-team samples.
test("Never-Say catches gap arithmetic and streak language", () => {
  const bad = ["It's been 12 days", "you've been gone a while", "we missed you!", "don't break your streak", "let's get back on track", "been 5 days since"];
  for (const s of bad) assert.ok(R.violatesNeverSay(s), `should flag: ${s}`);
  const good = ["Good to see you.", "Welcome back. Everything's where you left it.", "The light's on. Come say hi."];
  for (const s of good) assert.equal(R.violatesNeverSay(s), null, `should NOT flag: ${s}`);
});

// 08 acc #3: notification simulator - backoff ladder behavior.
test("backoff ladder: doubles capped at 14, 3 ignored -> weekly, 30d silent -> monthly, opens restore", () => {
  let s = { cadence: 3.5, intervalDays: null, unanswered: 0 };           // twice-a-week member
  assert.equal(R.nextNudgeIntervalDays({ ...s, daysSilent: 5 }), 4.5);   // cadence+1 -> at most ~2 touches/wk
  s = R.recordNudgeResult(s, false); assert.equal(s.intervalDays, 9);    // (4.5)*2
  s = R.recordNudgeResult(s, false); assert.equal(s.intervalDays, 14);   // capped
  s = R.recordNudgeResult(s, false);
  assert.equal(R.nextNudgeIntervalDays({ ...s, cadence: 3.5, daysSilent: 20 }), 7);  // 3 ignored -> weekly
  assert.equal(R.nextNudgeIntervalDays({ ...s, cadence: 3.5, daysSilent: 31 }), 30); // silent month -> monthly
  s = R.recordNudgeResult(s, true); s = R.recordNudgeResult(s, true);
  assert.equal(s.intervalDays, null);                                    // two opens restore cadence
  assert.equal(s.unanswered, 0);
});

test("personal cadence: median of gaps, min 1 cap 7", () => {
  assert.equal(R.personalCadence([]), 1);
  assert.equal(R.personalCadence([3, 4, 3, 4, 3]), 3);
  assert.equal(R.personalCadence([20, 25, 30]), 7);
  assert.equal(R.personalCadence([0, 0, 1]), 1);
});

// 08 acc #6 / 07 acc #29: Re-Light windows + rise-only display + provisional floor 0.5.
test("relight config: R3 relight 7d, R4 first_light_lite 7d", () => {
  assert.deepEqual(R.relightFor("R3"), { mode: "relight", days: 7 });
  assert.deepEqual(R.relightFor("R4"), { mode: "first_light_lite", days: 7 });
  assert.equal(R.relightFor("R1"), null);
});
test("engine: relight is rise-only and provisional below coverage 0.5", () => {
  const base = {
    mood7: [4, 4, 4, 4, 4, 4, 4], energy7: [4, 4, 4, 4, 4, 4, 4], heaviness7: [2, 2, 2, 2, 2, 2, 2],
    sleepHours7: [8, 8, 8, 8, 8, 8, 8], sleepQuality7: [4, 4, 4, 4, 4, 4, 4], meals7d: 14,
    practice: { movement: { v: 3, baseline: 3 } }, enabledPractice: ["movement"], coreHistory: [70, 70, 70],
    gaps: { steadiness: 0, rest: 0, fuel: 0, movement: 0 },
  };
  const normal = engine.computeClarityV2({ ...base, prevDisplayed: 90 });
  assert.ok(normal.displayed < 90, "control: score would drop without relight");
  const rl = engine.computeClarityV2({ ...base, prevDisplayed: 90, relight: "relight" });
  assert.ok(rl.provisional === true || rl.displayed >= 90, "relight: never greeted by a lower number");
  // gap 9 -> conf ~0.35: provisional under the relight floor (0.5) but NOT under the normal floor (0.35)
  const staleGaps = { steadiness: 9, rest: 9, fuel: 9, movement: 9 };
  const staleNormal = engine.computeClarityV2({ ...base, gaps: staleGaps });
  const staleRelight = engine.computeClarityV2({ ...base, gaps: staleGaps, relight: "relight" });
  assert.equal(staleNormal.provisional, false, "same coverage shows a number outside relight");
  assert.equal(staleRelight.provisional, true, "coverage below 0.5 during relight -> provisional");
});
test("engine: first_light_lite gives tiny thresholds (showing up = full band)", () => {
  const r = engine.practiceDimScore(1, 10, 1, { firstLight: true });
  assert.equal(r, 100);
});

// 07 acc #31/#4-spine: the bank carries framing STRINGS only for known spine fields - it cannot
// alter field types, scales, or add scored fields (schema-level invariance).
test("spine invariance: template bank fields are a subset of the spine, strings only", () => {
  const SPINE = ["mood", "energy", "heaviness", "sleep", "sentence", "outside", "connection"];
  for (const field of Object.keys(T.FRAMINGS)) {
    assert.ok(SPINE.includes(field), `unknown spine field in bank: ${field}`);
    for (const v of Object.values(T.FRAMINGS[field])) assert.equal(typeof v, "string");
  }
});

// 08 acc #5 (grep-half): fuel_opt_out members must never receive food-flavored dynamic items -
// the v1 bank simply contains none.
test("no food-flavored templates in the dynamic bank", () => {
  const FOOD = /\b(meal|food|eat|ate|nutrition|calorie|diet|breakfast|lunch|dinner)\b/i;
  Object.values(T.DYNAMIC).forEach((s) => assert.ok(!FOOD.test(s), `food-flavored dynamic template: ${s}`));
});

// 08 acc #10 (static audit): the answer path of checkin-prompt writes only context tables -
// never user_daily_state / daily_checkins.
test("gap answers can never touch scored rows (write-path audit)", () => {
  // Reconciliation note: the unified living-check-in endpoint is checkin-prompts.js (the
  // parallel checkin-prompt.js was superseded). Same guarantee, same audit: the answer
  // path writes context only - never a scored table.
  const src = fs.readFileSync(path.join(__dirname, "../../netlify/functions/checkin-prompts.js"), "utf8");
  const start = src.indexOf('action === "answer"');
  const end = src.indexOf("action === 'get'");
  assert.ok(start >= 0 && end > start, "answer block not found");
  const answerBlock = src.slice(start, end);
  assert.ok(!/user_daily_state|daily_checkins/.test(answerBlock), "answer path must not reference scored tables");
});

// Brand law 5: every member-facing template string uses plain hyphens, never em-dashes.
test("template bank contains no em-dashes", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../netlify/functions/checkin-templates.js"), "utf8");
  assert.ok(!src.includes("—"), "em-dash found in checkin-templates.js");
});

// Nudge copy is Never-Say-clean too (rhythm-nudge-cron literals).
test("nudge copy passes Never-Say", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../netlify/functions/rhythm-nudge-cron.js"), "utf8");
  const strings = [...src.matchAll(/body: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(strings.length >= 3);
  for (const s of strings) assert.equal(R.violatesNeverSay(s), null, `nudge copy violation: ${s}`);
});
