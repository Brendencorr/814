/**
 * clarity.js — Dashboard State Engine v1.0, Section 3 (shared, pure functions)
 *
 * One definition of the Clarity Score + the Tier 1/Tier 2 event split, used by
 * the State Engine (server) and readable by the dashboard/brief. No Supabase, no
 * I/O — the caller gathers raw signals and passes them in.
 *
 * Dimensions are each 0-100. Clarity is their weighted composite, renormalized
 * over the dimensions we actually have data for — so a new member with only a
 * mood + sobriety signal isn't pushed to near-zero for not having logged meals.
 */

// ── Section 2 — the two-tier event split (the 5,000-user scaling fix) ─────────
// Only Tier 1 events fire the full recalculation chain. Tier 2 events log for
// recommendation/completion learning but never force a recompute.
const TIER1_EVENTS = [
  "mood_checked_in", "workout_completed", "meal_logged", "sleep_updated",
  "goal_completed", "journey_step_completed", "riley_conversation_started",
];
const TIER2_EVENTS = ["content_clicked", "content_started", "content_skipped", "content_saved"];
function isTier1(eventType) { return TIER1_EVENTS.indexOf(eventType) !== -1; }

// ── Weights (sum to 100). Tunable. Recovery is weighted highest, mirroring the
// dashboard's original sobriety-forward formula, then mood + sleep. ───────────
const WEIGHTS = {
  recovery_score: 22, mood_score: 16, sleep_score: 14, movement_score: 12,
  nourishment_score: 10, reflection_score: 10, goal_score: 10, community_score: 6,
};
const DIM_LABEL = {
  recovery_score: "recovery", mood_score: "how you're feeling", sleep_score: "sleep",
  movement_score: "movement", nourishment_score: "nourishment", reflection_score: "reflection",
  goal_score: "your habits", community_score: "staying connected",
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Derive 0-100 dimension scores from raw signals. Any input left undefined
 * yields a null dimension (excluded from clarity, not counted as zero).
 */
function computeDimensions(s) {
  s = s || {};
  const d = {};
  if (s.mood != null)         d.mood_score        = clamp((s.mood / 5) * 100);            // 1-5 → 0-100
  if (s.sleepHours != null)   d.sleep_score       = clamp((s.sleepHours / 8) * 100);      // 8h goal
  if (s.workoutsThisWeek != null)  d.movement_score    = clamp((s.workoutsThisWeek / 3) * 100);   // 3/wk = full
  if (s.mealsThisWeek != null)     d.nourishment_score = clamp((s.mealsThisWeek / 14) * 100);     // ~2/day
  if (s.reflectionsThisWeek != null) d.reflection_score = clamp((s.reflectionsThisWeek / 5) * 100); // 5/wk
  if (s.habitRate != null)    d.goal_score        = clamp(s.habitRate);                    // already 0-100
  if (s.checkinDays7 != null) d.community_score   = clamp((s.checkinDays7 / 7) * 100);     // consistency
  if (s.soberDays != null)    d.recovery_score    = clamp(recoveryFromStreak(s.soberDays));
  return d;
}

// Recovery strength curve: climbs fast early (every early day is huge), then
// plateaus high. 0d→0, 1d→~30, 7d→~62, 30d→~85, 90d+→~95+.
function recoveryFromStreak(days) {
  if (!days || days < 0) return 0;
  return 100 * (1 - Math.exp(-days / 35));
}

/** Weighted composite, renormalized over present dimensions → 0-100 (or null). */
function computeClarity(dims) {
  dims = dims || {};
  let num = 0, denom = 0;
  for (const k in WEIGHTS) {
    if (dims[k] != null) { num += WEIGHTS[k] * dims[k]; denom += WEIGHTS[k]; }
  }
  if (!denom) return null;
  return clamp(num / denom);
}

/**
 * Section 3.1 — "Why did this change?" Riley explains emotionally, never shows
 * math, and only at meaningful moments: a clarity delta of 5+ OR a checkpoint
 * (end-of-day / weekly recap, signalled by opts.checkpoint). Returns null when
 * the move isn't worth narrating.
 */
function explainChange(prevDims, nextDims, prevClarity, nextClarity, opts) {
  opts = opts || {};
  const delta = (nextClarity || 0) - (prevClarity || 0);
  if (Math.abs(delta) < 5 && !opts.checkpoint) return null;

  // Which dimensions moved the most, by direction.
  const moved = [];
  for (const k in WEIGHTS) {
    const a = prevDims && prevDims[k] != null ? prevDims[k] : null;
    const b = nextDims && nextDims[k] != null ? nextDims[k] : null;
    if (a == null && b == null) continue;
    moved.push({ k, diff: (b || 0) - (a || 0) });
  }
  const up   = moved.filter(m => m.diff >= 5).sort((a, b) => b.diff - a.diff).slice(0, 3).map(m => DIM_LABEL[m.k]);
  const down = moved.filter(m => m.diff <= -5).sort((a, b) => a.diff - b.diff).slice(0, 2).map(m => DIM_LABEL[m.k]);

  if (delta >= 5) {
    const verb = up.length === 1 ? "moved" : up.length === 2 ? "both moved" : "all moved";
    const because = up.length ? ` — ${listPhrase(up)} ${verb} in the right direction` : "";
    return `Your clarity lifted today${because}. That's you showing up.`;
  }
  if (delta <= -5) {
    const because = down.length ? ` — ${listPhrase(down)} got harder` : "";
    return `Clarity dipped a little today${because}. That happens. Tomorrow's a clean slate.`;
  }
  // checkpoint with small delta
  return `Your clarity held steady today. Steady is its own kind of progress.`;
}

function listPhrase(arr) {
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

module.exports = {
  TIER1_EVENTS, TIER2_EVENTS, isTier1, WEIGHTS,
  computeDimensions, computeClarity, explainChange, recoveryFromStreak,
};
