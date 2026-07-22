/**
 * rhythm-utils.js — Rhythm & Return v1.1 pure helpers (docs/08). No I/O, fully testable.
 *
 * Return tiers follow Doc 08 §2 (R0 same app-day · R1 1-2d · R2 3-6d · R3 7-29d · R4 30+),
 * which governs over Doc 07 §2b's slightly different gap table — 08 is the dedicated cadence
 * spec and its acceptance tests pin the 2/3, 6/7, 29/30 boundaries. Re-Light windows follow
 * Doc 08 §5: R3 → 'relight' 7 days · R4 → 'first_light_lite' 7 days ("7 days (not 14)" —
 * 08's explicit correction of 07 §2b's 14). Both resolutions logged in the PR.
 */

// gapDays: whole app-days between last activity and now (caller passes app-day-aware dates).
function returnTier(gapDays) {
  if (gapDays == null || gapDays <= 0) return "R0";
  if (gapDays <= 2) return "R1";
  if (gapDays <= 6) return "R2";
  if (gapDays <= 29) return "R3";
  return "R4";
}

// Re-Light window on return, or null when the score needs no re-entry protection.
function relightFor(tier) {
  if (tier === "R3") return { mode: "relight", days: 7 };
  if (tier === "R4") return { mode: "first_light_lite", days: 7 };
  return null;
}

// 08 §5: Direction narration muted until 14 days of post-return data (R3/R4).
function directionMuteDaysFor(tier) {
  return tier === "R3" || tier === "R4" ? 14 : 0;
}

// 08 §3: personal cadence = median inter-session gap over trailing 28d, min 1, cap 7.
function personalCadence(gaps) {
  const xs = (gaps || []).filter((g) => Number.isFinite(g) && g >= 0).sort((a, b) => a - b);
  if (!xs.length) return 1;
  const mid = Math.floor(xs.length / 2);
  const med = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.min(7, Math.max(1, med));
}

/**
 * 08 §3 backoff ladder. State: { intervalDays|null, unanswered, cadence, daysSilent }.
 * - base interval = cadence + 1 day of quiet before the first gentle touch
 * - each unanswered notification doubles the next interval (max 14)
 * - 3 ignored → one quiet weekly touch; 30 days silent → monthly "the light's on", indefinitely
 * - two consecutive opens restore cadence (handled by recordNudgeResult)
 * Never fully dark, never louder.
 */
function nextNudgeIntervalDays(state) {
  const s = state || {};
  const cadence = Math.min(7, Math.max(1, Number(s.cadence) || 1));
  if ((Number(s.daysSilent) || 0) >= 30) return 30;          // monthly light-on note
  if ((Number(s.unanswered) || 0) >= 3) return 7;            // weekly gentle
  const base = Number.isFinite(s.intervalDays) && s.intervalDays > 0 ? s.intervalDays : cadence + 1;
  return Math.min(14, base);
}
function recordNudgeResult(state, opened) {
  const s = Object.assign({ intervalDays: null, unanswered: 0, consecutiveOpens: 0 }, state || {});
  if (opened) {
    s.consecutiveOpens = (s.consecutiveOpens || 0) + 1;
    s.unanswered = 0;
    if (s.consecutiveOpens >= 2) s.intervalDays = null;      // two opens restore cadence
  } else {
    s.consecutiveOpens = 0;
    s.unanswered = (s.unanswered || 0) + 1;
    const cadence = Math.min(7, Math.max(1, Number(s.cadence) || 1));
    const cur = Number.isFinite(s.intervalDays) && s.intervalDays > 0 ? s.intervalDays : cadence + 1;
    s.intervalDays = Math.min(14, cur * 2);                  // double, cap 14
  }
  return s;
}

/**
 * The Never-Say list (08 §2, Sentinel-enforced; 07 acceptance #27 greps at the string level).
 * The gap is an input, never a topic. Patterns are lowercase substring/regex checks applied to
 * any member-facing string Riley (or a template) produces around returns and check-ins.
 */
const NEVER_SAY = [
  /you'?ve been (gone|away)/i,
  /\bwe missed you\b/i,
  /it'?s been \d+ (day|week|month)/i,
  /\bbeen \d+ days?\b/i,
  /\bstreak\b/i,
  /back on track/i,
  /\byou were gone\b/i,
  /\bdays? since\b/i,
];
function violatesNeverSay(text) {
  const t = String(text == null ? "" : text);
  for (const re of NEVER_SAY) if (re.test(t)) return re.source;
  return null;
}

module.exports = { returnTier, relightFor, directionMuteDaysFor, personalCadence, nextNudgeIntervalDays, recordNudgeResult, NEVER_SAY, violatesNeverSay };
