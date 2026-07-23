/**
 * tests/presence/runner.js - Clarity v2.4 Presence lane + insight nudges acceptance
 * (docs/07A §4). Run: node --test tests/presence/runner.js
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const P = require(path.join(__dirname, "../../netlify/functions/presence-lane.js"));
const engine = require(path.join(__dirname, "../../netlify/functions/clarity-engine.js"));
const R = require(path.join(__dirname, "../../netlify/functions/rhythm-utils.js"));
const { BANK } = require(path.join(__dirname, "../../netlify/functions/insight-nudge.js"));
const { validateConfig } = require(path.join(__dirname, "../../netlify/functions/clarity-config-util.js"));

const baseInp = (lane) => ({
  mood7: [4, 4, 4, 4, 4, 4, 4], energy7: [4, 4, 4, 4, 4, 4, 4], heaviness7: [2, 2, 2, 2, 2, 2, 2],
  sleepHours7: [8, 8, 8, 8, 8, 8, 8], sleepQuality7: [4, 4, 4, 4, 4, 4, 4], meals7d: 14,
  practice: { movement: { v: 3, baseline: 3 }, habits: { v: 60, baseline: 60 } },
  enabledPractice: ["movement", "habits"], coreHistory: [70, 70, 70],
  gaps: { steadiness: 0, rest: 0, fuel: 0, movement: 0, habits: 0 }, lane,
});

// 07A acc #1: anniversary test - a brutal hard-date day with zero activity does not lower the lane.
test("anniversary protection: lane holds on protected days, including the +-1 boundary", () => {
  const hd = [{ date: "2026-07-23" }];
  for (const day of ["2026-07-22", "2026-07-23", "2026-07-24"]) {
    assert.equal(P.isProtectedDay(day, false, hd), true, day + " inside window");
  }
  assert.equal(P.isProtectedDay("2026-07-21", false, hd), false, "2 days before is OUTSIDE");
  assert.equal(P.isProtectedDay("2026-07-25", false, hd), false, "2 days after is OUTSIDE");
  const r = engine.computeClarityV2(baseInp({ presence: { enabled: true, qualifyingDays14: 0, protectedToday: true, prevLane: 74 } }));
  assert.equal(r.breakdown.practice.presence.score, 74, "zero-activity protected day holds at prev lane");
  const rOpen = engine.computeClarityV2(baseInp({ presence: { enabled: true, qualifyingDays14: 0, protectedToday: false, prevLane: 74 } }));
  assert.ok(rOpen.breakdown.practice.presence.score < 74, "outside protection density eases honestly");
});

// 07A acc #2: occurrence-only - identical lane result regardless of any content/sentiment.
test("occurrence-only: conversation content can never move the lane", () => {
  const mk = (noteJunk) => { const inp = baseInp({ presence: { enabled: true, qualifyingDays14: 6, protectedToday: false, prevLane: null } }); inp.notes = noteJunk; return engine.computeClarityV2(inp); };
  const a = mk("I am furious and hopeless"); const b = mk("Today was full of gratitude and light");
  assert.equal(a.breakdown.practice.presence.score, b.breakdown.practice.presence.score);
  assert.equal(a.displayed, b.displayed);
});

// 07A acc #3: multi-lane weights - two lanes 10/10 (20 combined), practice dims retain 20; third lane impossible.
test("multi-lane weights: 12 solo, 20 combined for two, max two at the API", () => {
  assert.equal(P.laneWeight(1), 12); assert.equal(P.laneWeight(2), 20); assert.equal(P.laneWeight(5), 20);
  const one = engine.computeClarityV2(baseInp({ sobriety: { enabled: true, soberDays30: 30 } }));
  const two = engine.computeClarityV2(baseInp({ sobriety: { enabled: true, soberDays30: 30 }, presence: { enabled: true, qualifyingDays14: 14 } }));
  // both lanes at 100, dims identical -> P must equal (100*20 + dims*20)/40 for two lanes
  const dims = engine.computeClarityV2(baseInp({})).P;
  assert.equal(two.P, Math.round === undefined ? two.P : Math.max(0, Math.min(100, Math.round((100 * 20 + dims * 20) / 40 * 1000) / 1000)) || two.P);
  assert.ok(Math.abs(two.P - (100 * 20 + dims * 20) / 40) < 0.75, "two-lane split is 20/20");
  assert.ok(Math.abs(one.P - (100 * 12 + dims * 28) / 40) < 0.75, "solo lane split is 12/28");
  const cfg = validateConfig({ lanes: { sobriety: true, presence: true, hustle: true, focus: true } });
  assert.deepEqual(Object.keys(cfg.lanes).sort(), ["presence", "sobriety"], "unknown lanes dropped - a third weighted lane is impossible");
});

// 07A acc #4 (counting half): multiple behaviors in one day = ONE qualifying day.
test("qualifying days: distinct-day counting, ritual caps at one day", () => {
  const today = "2026-07-23";
  const cks = [
    { checkin_date: "2026-07-23", hard_day: true, heaviness: 5, connection: true, kept_ritual: true }, // 3 behaviors, 1 day
    { checkin_date: "2026-07-20", kept_ritual: true },
    { checkin_date: "2026-07-01", kept_ritual: true }, // outside the 14-day window
  ];
  assert.equal(P.qualifyingDays14(today, cks, [], []), 2);
  assert.equal(P.qualifyingDays14(today, cks, [], ["2026-07-19", "2026-07-19", "junk"]), 3, "extra-day sources dedupe by day");
  assert.ok(Math.abs(P.presenceLaneScore(7) - 100 * Math.pow(0.5, 0.8)) < 1e-9);
});

// 07A acc #5: insight-nudge red-team over the bank (bank-based v1 - generation IS the bank).
test("insight nudge bank: five laws hold on every line", () => {
  const lines = Object.values(BANK);
  assert.ok(lines.length >= 3);
  for (const s of lines) {
    assert.equal(R.violatesNeverSay(s), null, "Never-Say: " + s);
    assert.ok(!/score|dropped|because (we|you) haven'?t|absen/i.test(s), "no score-blame: " + s);
    assert.ok(!/make sure|every day|you should|need to/i.test(s), "invitation, never assignment: " + s);
    assert.ok(/What would help\?$/.test(s), "agency-return closer: " + s);
    assert.ok(/pattern/i.test(s), "their own pattern as observation: " + s);
    assert.ok(!s.includes("—"), "plain hyphens only");
  }
});

// 07A acc #6: Re-Light + Presence - gap days are never retro-scored (structural: density counts
// only days with actual rows/occurrences; no writer exists for absent days).
test("no retro-scoring: absent days contribute nothing and nothing writes them", () => {
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "../../netlify/functions/presence-lane.js"), "utf8");
  assert.ok(!/insert|upsert|update\(/.test(src), "presence-lane is pure - it can write nothing");
  assert.equal(P.qualifyingDays14("2026-07-23", [], [], []), 0);
});
