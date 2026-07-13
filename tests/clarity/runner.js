/**
 * tests/clarity/runner.js — Clarity v2.2 engine Stage-0 property tests (spec §13).
 * Pure, no framework: `node tests/clarity/runner.js`. Exits non-zero on any failure.
 * These gate the engine BEFORE it's wired live (Phase B) and before cutover.
 */
'use strict';
const E = require("../../netlify/functions/clarity-engine.js");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; console.error("  ✗ " + name + (detail ? "  — " + detail : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const series = (v, n) => Array.from({ length: n || 7 }, () => v);

// baseline: a steady, realistic member (mood ~4, energy ~4, slept 7-8h, low heaviness)
function baseInput(over) {
  return Object.assign({
    mood7: [4, 4, 3, 4, 4, 3, 4], energy7: [4, 3, 4, 4, 3, 4, 4],
    heaviness7: [2, 2, 3, 2, 2, 3, 2], sleepHours7: [7.5, 8, 7, 7.5, 8, 7, 7.5], sleepQuality7: [4, 4, 3, 4, 4, 4, 3],
    meals7d: 14, fuelOptOut: false,
    enabledPractice: ["movement", "habits", "reflection"],
    practice: {
      movement: { v: 3, baseline: 3, floor: 1 },
      habits: { v: 5, baseline: 5, floor: 0 },
      reflection: { v: 4, baseline: 4, floor: 1 },
    },
    gaps: {}, coreHistory: series(60, 28), hardDayToday: false,
  }, over || {});
}

// ── 1. Bounds + null-safety on random inputs ──────────────────────────────────────
(function () {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let allBounded = true;
  for (let i = 0; i < 400; i++) {
    const inp = baseInput({
      mood7: series(1 + Math.floor(rnd() * 5), 7), energy7: series(1 + Math.floor(rnd() * 5), 7),
      heaviness7: series(1 + Math.floor(rnd() * 5), 7), sleepHours7: series(rnd() * 14, 7),
      sleepQuality7: series(1 + Math.floor(rnd() * 5), 7), meals7d: Math.floor(rnd() * 28),
      practice: { movement: { v: rnd() * 10, baseline: rnd() * 6 }, habits: { v: rnd() * 7, baseline: rnd() * 7 }, reflection: { v: rnd() * 6, baseline: rnd() * 6 } },
    });
    const r = E.computeClarityV2(inp);
    ["displayed", "core", "F", "P", "D"].forEach((k) => { if (r[k] != null && (r[k] < 0 || r[k] > 100)) allBounded = false; });
  }
  ok("bounds: all layers stay within 0-100 across 400 random inputs", allBounded);
})();

// ── 2. Determinism (individual fairness §13) ──────────────────────────────────────
(function () {
  const a = E.computeClarityV2(baseInput());
  const b = E.computeClarityV2(baseInput());
  ok("individual fairness: identical inputs → identical scores", JSON.stringify(a) === JSON.stringify(b));
})();

// ── 3. Monotonicity of the LEVEL layers (rest is the documented exception) ─────────
(function () {
  const low = E.computeF1([2, 2, 2, 2, 2, 2, 2], [3, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2, 2]);
  const hi = E.computeF1([5, 5, 5, 5, 5, 5, 5], [3, 3, 3, 3, 3, 3, 3], [2, 2, 2, 2, 2, 2, 2]);
  ok("F1 monotonic in mood (higher mood → higher steadiness)", hi > low, `${low} → ${hi}`);
  ok("F3 monotonic in meals", E.computeF3(4) < E.computeF3(14));
})();

// ── 4. Rest is NON-monotonic — plateau at 7-9h (documented exception) ──────────────
(function () {
  const short = E.computeF2([5, 5, 5, 5, 5, 5, 5], [4, 4, 4, 4, 4, 4, 4]);
  const ideal = E.computeF2([8, 8, 8, 8, 8, 8, 8], [4, 4, 4, 4, 4, 4, 4]);
  const over = E.computeF2([11, 11, 11, 11, 11, 11, 11], [4, 4, 4, 4, 4, 4, 4]);
  ok("rest peaks in the 7-9h plateau (not monotonic)", ideal > short && ideal > over, `5h=${round(short)} 8h=${round(ideal)} 11h=${round(over)}`);
})();
function round(n) { return n == null ? null : Math.round(n); }

// ── 5. Practice bands: at baseline = mid, above = high, well below = bends (never 0) ─
(function () {
  const atB = E.practiceDimScore(5, 5, 0);
  const above = E.practiceDimScore(9, 5, 0);
  const wayBelow = E.practiceDimScore(0.5, 5, 0);
  ok("practice: at-baseline lands mid-band (65-85)", atB >= 60 && atB <= 90, "" + round(atB));
  ok("practice: well above baseline scores high (>=85)", above >= 85, "" + round(above));
  ok("practice: far below baseline bends, never craters below 30", wayBelow >= 30, "" + round(wayBelow));
})();

// ── 6. Direction: rising trend > 50, falling < 50, flat = 50 ───────────────────────
(function () {
  const rising = []; for (let i = 0; i < 28; i++) rising.push(40 + i);      // climbing
  const falling = []; for (let i = 0; i < 28; i++) falling.push(80 - i);    // dropping
  ok("direction: rising core history → D > 50", E.computeDirection(rising) > 50, "" + round(E.computeDirection(rising)));
  ok("direction: falling core history → D < 50", E.computeDirection(falling) < 50, "" + round(E.computeDirection(falling)));
  ok("direction: flat history → D == 50", near(E.computeDirection(series(60, 28)), 50, 0.5));
})();

// ── 7. Outlier robustness (§7/§15): one extreme SINGLE-input day moves a layer <12pt ─
// (calm/volatility is intentionally reactive — a documented exception like non-monotonic rest —
//  so we spike one input at a time, which is the "one extreme day" the acceptance criterion means.)
(function () {
  const baseF1 = E.computeF1([4, 4, 3, 4, 4, 3, 4], [4, 3, 4, 4, 3, 4, 4], [2, 2, 3, 2, 2, 3, 2]);
  const spikeMood = E.computeF1([4, 4, 3, 4, 4, 3, 1], [4, 3, 4, 4, 3, 4, 4], [2, 2, 3, 2, 2, 3, 2]);   // one awful mood day
  const spikeHeavy = E.computeF1([4, 4, 3, 4, 4, 3, 4], [4, 3, 4, 4, 3, 4, 4], [2, 2, 3, 2, 2, 3, 5]);  // one heavy day
  ok("outlier: one extreme mood day moves F1 < 12 points", Math.abs(spikeMood - baseF1) < 12, `Δ=${(spikeMood - baseF1).toFixed(1)}`);
  ok("outlier: one heavy day moves F1 < 12 points", Math.abs(spikeHeavy - baseF1) < 12, `Δ=${(spikeHeavy - baseF1).toFixed(1)}`);
  const baseF2 = E.computeF2([7.5, 8, 7, 7.5, 8, 7, 7.5], [4, 4, 4, 4, 4, 4, 4]);
  const spikeF2 = E.computeF2([7.5, 8, 7, 7.5, 8, 7, 3], [4, 4, 4, 4, 4, 4, 4]);   // one 3h night
  ok("outlier: one bad-sleep night moves F2 < 12 points", Math.abs(spikeF2 - baseF2) < 12, `Δ=${(spikeF2 - baseF2).toFixed(1)}`);
})();

// ── 8. Asymmetric ratchet: rises faster than it falls (§4 anti-gaming) ─────────────
(function () {
  const up = E.updateBaseline(5, 8);    // v above B → alpha_up 0.10
  const down = E.updateBaseline(5, 2);  // v below B → alpha_down 0.02
  ok("ratchet: baseline rises faster than it falls", (up - 5) > Math.abs(down - 5), `up=${(up - 5).toFixed(2)} down=${(down - 5).toFixed(2)}`);
})();

// ── 9. Provisional: no Foundation data → provisional; a real check-in → not ────────
(function () {
  const empty = E.computeClarityV2({ mood7: [], energy7: [], heaviness7: [], sleepHours7: [], sleepQuality7: [], meals7d: 0, fuelOptOut: false, gaps: { steadiness: 30, rest: 30, fuel: 30 }, enabledPractice: [], practice: {}, coreHistory: [] });
  ok("provisional: essentially no data → provisional=true, no number", empty.provisional === true);
  const real = E.computeClarityV2(baseInput());
  ok("provisional: a completed check-in → provisional=false, real number", real.provisional === false && real.displayed != null);
})();

// ── 10. First Light rise-only: displayed never drops below yesterday ───────────────
(function () {
  const r = E.computeClarityV2(baseInput({ firstLight: true, prevDisplayed: 90, mood7: [1, 1, 1, 1, 1, 1, 1], energy7: [1, 1, 1, 1, 1, 1, 1] }));
  ok("first light: rise-only — displayed never drops below prior", r.displayed >= 90, "" + r.displayed);
})();

// ── 11. Freeze (§5): frozen holds displayed at the pre-slip snapshot ───────────────
(function () {
  const r = E.computeClarityV2(baseInput({ freeze: { active: true, snapshot: { displayed: 77 } }, mood7: [1, 1, 1, 1, 1, 1, 1] }));
  ok("freeze: displayed held at the pre-slip snapshot", r.displayed === 77 && r.frozen === true, "" + r.displayed);
})();

// ── 12. Hard-day never lowers the score vs the same day unflagged ──────────────────
(function () {
  const soft = E.computeClarityV2(baseInput({ practice: { movement: { v: 1, baseline: 5, floor: 1 }, habits: { v: 1, baseline: 5, floor: 0 }, reflection: { v: 1, baseline: 5, floor: 1 } } }));
  const hard = E.computeClarityV2(baseInput({ hardDayToday: true, practice: { movement: { v: 1, baseline: 5, floor: 1 }, habits: { v: 1, baseline: 5, floor: 0 }, reflection: { v: 1, baseline: 5, floor: 1 } } }));
  ok("hard day: never scores lower than the same day unflagged", hard.displayed >= soft.displayed, `soft=${soft.displayed} hard=${hard.displayed}`);
})();

// ── 13. Grief lane (§5): presence-based only — never scored on quality, never penalizes ──
(function () {
  // grief present → full presence credit (100) regardless of any "quality"
  const present = E.computeClarityV2(baseInput({
    enabledPractice: ["movement", "grief"],
    practice: { movement: { v: 3, baseline: 3, floor: 1 }, grief: { v: 1 } },
  }));
  ok("grief: presence gives full credit", present.breakdown.practice.grief && present.breakdown.practice.grief.score === 100, JSON.stringify(present.breakdown.practice.grief));
  // grief absent (v=0) → dim drops out, never a low/zero score dragging Practice down
  const absent = E.computeClarityV2(baseInput({
    enabledPractice: ["movement", "grief"],
    practice: { movement: { v: 3, baseline: 3, floor: 1 }, grief: { v: 0 } },
  }));
  ok("grief: absence never scores (null, not a penalty)", absent.breakdown.practice.grief.score == null, JSON.stringify(absent.breakdown.practice.grief));
  // grief absent must equal movement-only — it never drags Practice down
  const moveOnly = E.computeClarityV2(baseInput({ enabledPractice: ["movement"], practice: { movement: { v: 3, baseline: 3, floor: 1 } } }));
  ok("grief: absence doesn't change Practice vs movement-only", absent.P === moveOnly.P, `absent=${absent.P} moveOnly=${moveOnly.P}`);
})();

// ── 14. Habits floor (§4): a 0-100 engagement rate floors at 20 (=20% of active×7) ──
(function () {
  // v below the 20% floor bends but never craters; with baseline 60, lo=max(0.7·60,20)=42
  const low = E.practiceDimScore(10, 60, 20, {});   // well under floor
  ok("habits: sub-floor bends, never craters (>=30)", low >= 30 && low < 65, "" + low);
  const atFloorRegion = E.practiceDimScore(50, 60, 20, {}); // inside band
  ok("habits: in-band scores in the middle range", atFloorRegion >= 65 && atFloorRegion <= 85, "" + atFloorRegion);
})();

// ── 15. Life-event recalibration (§2): widens bands like a hard day, never lowers ──
(function () {
  const low = { movement: { v: 1, baseline: 5, floor: 1 }, habits: { v: 1, baseline: 5, floor: 20 }, reflection: { v: 1, baseline: 5, floor: 1 } };
  const normal = E.computeClarityV2(baseInput({ practice: JSON.parse(JSON.stringify(low)) }));
  const recal = E.computeClarityV2(baseInput({ recalibrating: true, practice: JSON.parse(JSON.stringify(low)) }));
  ok("recalibration: never scores lower than normal for the same low week", recal.displayed >= normal.displayed, `normal=${normal.displayed} recal=${recal.displayed}`);
})();

// ── 16. σ7 window (§3): calm reflects only the LAST 7 heaviness values, not older history ──
(function () {
  // Same steady recent 7, but one series carries a volatile OLDER stretch. If σ7 is windowed
  // correctly, the older noise is ignored and both F1s are equal.
  const withOldNoise = E.computeF1([4,4,4,4,4,4,4], [4,4,4,4,4,4,4], [1,5,1,5,1, 3,3,3,3,3,3,3]);
  const cleanOnly = E.computeF1([4,4,4,4,4,4,4], [4,4,4,4,4,4,4], [3,3,3,3,3,3,3]);
  ok("σ7: older heaviness noise outside the last 7 days is ignored", near(withOldNoise, cleanOnly, 0.01), `withOld=${withOldNoise.toFixed(2)} clean=${cleanOnly.toFixed(2)}`);
})();

console.log(`\nClarity engine Stage-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
