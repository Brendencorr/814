/**
 * clarity-engine.js — Clarity Score v2.2 (Foundation / Practice / Direction).
 * Pure, dependency-free math (no Supabase, no I/O) so Stage-0 property tests import it
 * directly. state-engine.js gathers signals + baselines and calls computeClarityV2().
 * Spec: docs/CLARITY_SCORE_v2.2.md. Principle: distance traveled, not distance from perfect.
 *
 * Displayed = clamp(0.8·core + 0.2·D), core = (40·F + 40·P)/80. F absolute, P vs personal
 * 28-day baseline bands, D self-referenced trend. "Never shows the math" — callers narrate.
 */

'use strict';

// ── low-level helpers ────────────────────────────────────────────────────────────
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clamp100 = (n) => clamp(n, 0, 100);
const round = (n) => Math.round(n);
const isNum = (x) => typeof x === "number" && !isNaN(x);
const avg = (a) => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Exponential moving average over a series (oldest → newest). alpha = 2/(N+1). Used for
// Direction (short vs long trend), where reactivity is the point.
function ema(series, N) {
  const xs = (series || []).filter(isNum);
  if (!xs.length) return null;
  const alpha = 2 / (N + 1);
  let e = xs[0];
  for (let i = 1; i < xs.length; i++) e = alpha * xs[i] + (1 - alpha) * e;
  return e;
}
// 7-day mean of the most recent values. This is how we realize the spec's "EMA7" for the
// FOUNDATION level signals: a plain window mean caps any single day's weight at ~1/7, which is
// what makes one bad day move a layer < 12 points (§7/§15 acceptance). CTO decision: the
// member-trust robustness criterion wins over the literal EMA formula.
function mean7(series) {
  const xs = (series || []).filter(isNum);
  if (!xs.length) return null;
  return avg(xs.slice(-7));
}
// Sample standard deviation (population-ish; used for heaviness volatility σ7).
function stddev(series) {
  const xs = (series || []).filter(isNum);
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
}

// ── §7 input hygiene: plausibility clamps (accept raw, clamp in scoring) ───────────
function clampInputs(raw) {
  const r = Object.assign({}, raw || {});
  const cl15 = (a) => (a || []).filter(isNum).map((x) => clamp(x, 1, 5));
  r.mood7 = cl15(r.mood7);
  r.energy7 = cl15(r.energy7);
  r.heaviness7 = cl15(r.heaviness7);
  r.sleepQuality7 = cl15(r.sleepQuality7);
  r.sleepHours7 = (r.sleepHours7 || []).filter(isNum).map((h) => clamp(h, 3, 12)); // analysis clamp 3-12
  r.meals7d = isNum(r.meals7d) ? clamp(r.meals7d, 0, 28) : 0;                       // 4/day cap over 7d
  return r;
}

// ── §3 Foundation (absolute) — internal split 16 F1 : 14 F2 : 10 F3 ────────────────
const F_WEIGHTS = { f1: 16, f2: 14, f3: 10 };

function computeF1(mood7, energy7, heaviness7) {
  const m = mean7(mood7), e = mean7(energy7);
  const level = m != null ? ((m - 1) / 4) * 100 : null;
  const energyLvl = e != null ? ((e - 1) / 4) * 100 : null;
  const calm = 100 * Math.max(0, 1 - stddev(heaviness7) / 1.5); // low volatility = calm
  // renormalize the 0.5/0.2/0.3 mix over whichever of level/energy are present (calm always present)
  const parts = [];
  if (level != null) parts.push([0.5, level]);
  if (energyLvl != null) parts.push([0.2, energyLvl]);
  parts.push([0.3, calm]);
  const wsum = parts.reduce((s, p) => s + p[0], 0);
  return clamp100(parts.reduce((s, p) => s + p[0] * p[1], 0) / wsum);
}
// §3 F2 — DELIBERATELY NON-MONOTONIC (7-9h plateau). Documented exception to §12 monotonicity.
function computeF2(sleepHours7, sleepQuality7) {
  const h = mean7(sleepHours7);
  if (h == null) return null;
  let base;
  if (h >= 7 && h <= 9) base = 100;
  else { const outside = h < 7 ? 7 - h : h - 9; base = Math.max(20, 100 - 22 * outside); }
  const q = mean7(sleepQuality7);
  const qMod = q != null ? Math.min(1.0, 0.8 + 0.05 * q) : 1.0;
  return clamp100(base * qMod);
}
function computeF3(meals7d) {
  if (!isNum(meals7d)) return null;
  return clamp100(Math.min(1, meals7d / 14) * 100);
}
// Combine F1/F2/F3 with §6 freshness decay + fuel opt-out; renormalize over present dims.
function computeFoundation(inp, gaps) {
  gaps = gaps || {};
  const f1 = computeF1(inp.mood7, inp.energy7, inp.heaviness7);
  const f2 = computeF2(inp.sleepHours7, inp.sleepQuality7);
  const f3 = inp.fuelOptOut ? null : computeF3(inp.meals7d);
  const dims = [
    { s: f1, w: F_WEIGHTS.f1, c: confFor(gaps.steadiness) },
    { s: f2, w: F_WEIGHTS.f2, c: confFor(gaps.rest) },
    { s: f3, w: F_WEIGHTS.f3, c: confFor(gaps.fuel) },
  ].filter((d) => d.s != null && d.c >= 0.1);
  const wc = dims.reduce((s, d) => s + d.w * d.c, 0);
  const F = wc ? dims.reduce((s, d) => s + d.w * d.c * d.s, 0) / wc : null;
  return { F: F == null ? null : clamp100(F), f1, f2, f3, wConf: wc, wTotal: F_WEIGHTS.f1 + F_WEIGHTS.f2 + (inp.fuelOptOut ? 0 : F_WEIGHTS.f3) };
}

// ── §6 freshness ───────────────────────────────────────────────────────────────
function confFor(gapDays) { return Math.pow(0.5, (isNum(gapDays) ? gapDays : 0) / 6); }

// ── §4 Practice (personal bands) + §9 First Light / hard-day band widening ─────────
const DIM_FLOORS = { movement: 1, reflection: 1, habits: 0, program: 1, outside: 1, connection: 1 };

// One practice dim's 0-100 score given trailing-7d value v and baseline B.
function practiceDimScore(v, B, floor, opts) {
  opts = opts || {};
  if (!isNum(v)) return null;
  // First Light (days 1-14 or newly-added dim): tiny thresholds — showing up = full band.
  if (opts.firstLight) return v >= (floor || 1) ? 100 : Math.max(30, 65 * v / Math.max(1, floor || 1));
  const b = isNum(B) && B > 0 ? B : Math.max(1, floor || 1); // no baseline yet → treat floor as baseline
  let lo = 0.7 * b;
  if (isNum(floor)) lo = Math.max(lo, floor);
  if (opts.hardDay) lo = 0.5 * b;               // §9: hard day widens the band, never lowers
  const hi = 1.15 * b;
  if (v >= hi) return clamp100(85 + 15 * Math.min(1, (v - hi) / Math.max(1e-9, hi)));
  if (v >= lo) return clamp100(65 + 20 * (v - lo) / Math.max(1e-9, hi - lo));
  return clamp100(Math.max(30, 65 * v / Math.max(1e-9, lo)));
}
// §4 asymmetric ratchet: bar rises fast (α_up), falls gently (α_down).
function ratchet(B, v, alphaUp, alphaDown) {
  if (!isNum(v)) return B;
  if (!isNum(B)) return v; // seed
  const a = v >= B ? (alphaUp != null ? alphaUp : 0.10) : (alphaDown != null ? alphaDown : 0.02);
  return B + a * (v - B);
}

// Compute the Practice layer over enabled dims (+ sobriety lane taking 12 of 40) with freshness.
function computePractice(inp) {
  const enabled = (inp.enabledPractice && inp.enabledPractice.length) ? inp.enabledPractice : ["movement", "habits", "reflection"];
  const perDim = {};
  const scored = [];
  enabled.forEach((dim) => {
    const d = (inp.practice && inp.practice[dim]) || {};
    const floor = isNum(d.floor) ? d.floor : DIM_FLOORS[dim];
    const s = practiceDimScore(d.v, d.baseline, floor, { firstLight: !!d.firstLight, hardDay: !!inp.hardDayToday });
    const c = confFor((inp.gaps || {})[dim]);
    perDim[dim] = { score: s, v: d.v, baseline: d.baseline, conf: c };
    if (s != null && c >= 0.1) scored.push({ s, c, w: 1 });
  });
  const lane = inp.lane && inp.lane.sobriety && inp.lane.sobriety.enabled;
  let laneScore = null;
  if (lane) {
    const density = clamp((inp.lane.sobriety.soberDays30 || 0) / 30, 0, 1);
    laneScore = clamp100(100 * Math.pow(density, 0.8));
    perDim.sobriety = { score: laneScore, density };
  }
  // Non-lane dims share (lane ? 28 : 40) of P; lane takes 12.
  const dimsWc = scored.reduce((s, d) => s + d.w * d.c, 0);
  const dimsAvg = dimsWc ? scored.reduce((s, d) => s + d.w * d.c * d.s, 0) / dimsWc : null;
  let P;
  if (lane && dimsAvg != null) P = (laneScore * 12 + dimsAvg * 28) / 40;
  else if (lane) P = laneScore;
  else P = dimsAvg;
  return { P: P == null ? null : clamp100(P), perDim, hasData: scored.length > 0 || lane };
}

// ── §8 Direction ─────────────────────────────────────────────────────────────────
function computeDirection(coreHistory) {
  // coreHistory: array of daily core values, oldest → newest (up to 28).
  const xs = (coreHistory || []).filter(isNum);
  if (xs.length < 2) return 50; // neutral until there's a trend
  const e7 = ema(xs.slice(-7), 7);
  const e28 = ema(xs, 28);
  const delta = e7 - e28;
  return clamp100(50 + clamp(delta, -15, 15) / 15 * 50);
}

// ── assemble (§1) + §6 provisional + §9 First Light rise-only + §5 freeze ──────────
function computeClarityV2(raw) {
  const inp = clampInputs(raw);
  const gaps = inp.gaps || {};
  const F = computeFoundation(inp, gaps);
  const P = computePractice(inp);
  const D = computeDirection(inp.coreHistory);

  // core needs at least one of F/P; renormalize 40/40 over what's present.
  let core = null;
  if (F.F != null && P.P != null) core = (40 * F.F + 40 * P.P) / 80;
  else if (F.F != null) core = F.F;
  else if (P.P != null) core = P.P;

  // §6 provisional: confidence-weight coverage. Foundation carries the bulk of the weight, so a
  // completed check-in (fresh Foundation) clears the bar — a two-datapoint score never shows a number.
  const coverage = (F.wTotal ? F.wConf / F.wTotal : 0);
  const provisional = core == null || coverage < 0.35;

  let displayed = core == null ? null : clamp100(0.8 * core + 0.2 * D);

  // §9 First Light rise-only: membership days 1-14 — displayed never drops below yesterday.
  if (!provisional && displayed != null && inp.firstLight && isNum(inp.prevDisplayed)) {
    displayed = Math.max(displayed, inp.prevDisplayed);
  }

  // §5 freeze (lapse-repair): hold displayed + lane at the pre-slip snapshot.
  const frozen = inp.freeze && inp.freeze.active;
  if (frozen && inp.freeze.snapshot && isNum(inp.freeze.snapshot.displayed)) {
    displayed = inp.freeze.snapshot.displayed;
  }

  return {
    displayed: displayed == null ? null : round(displayed),
    core: core == null ? null : round(core),
    F: F.F == null ? null : round(F.F),
    P: P.P == null ? null : round(P.P),
    D: round(D),
    provisional: !!provisional,
    frozen: !!frozen,
    breakdown: { foundation: { f1: F.f1, f2: F.f2, f3: F.f3 }, practice: P.perDim, coverage: Number(coverage.toFixed(3)) },
  };
}

// Update a dimension's 28-day baseline via the asymmetric ratchet (caller persists).
function updateBaseline(prevB, v, opts) {
  opts = opts || {};
  return ratchet(prevB, v, opts.alphaUp != null ? opts.alphaUp : 0.10, opts.alphaDown != null ? opts.alphaDown : 0.02);
}

module.exports = {
  computeClarityV2, computeFoundation, computePractice, computeDirection,
  computeF1, computeF2, computeF3, practiceDimScore, ratchet, updateBaseline,
  ema, stddev, clampInputs, confFor,
};
