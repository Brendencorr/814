/**
 * rhythm.js - PURE Rhythm & Return logic (docs/08 v1.1 + docs/07 v2.3 §2b). No DB, no clock, no env.
 * Unit-tested in tests/rhythm/rhythm.test.js. Callers (riley-chat, checkin-prompts, reset-nudge-cron,
 * clarity-v2-write) gate on RHYTHM_ENABLED and pass state in.
 *
 * Canon: Riley keeps the member's rhythm, not a calendar's. The gap is an INPUT, never a topic.
 *
 * SPEC AMBIGUITIES RESOLVED HERE (recorded, not silent):
 * 1. Tier bands: Doc 08 §2 (R0 same app-day / R1 1-2 / R2 3-6 / R3 7-29 / R4 30+) is canonical -
 *    its acceptance tests pin the 2/3, 6/7, 29/30 boundaries. Doc 07 §2b's slightly different gap
 *    table (2-3 / 4-7 / 8-29) maps onto these tiers for check-in shape + Clarity behavior.
 * 2. Re-Light window at 30+ days: Doc 07 v2.3 §2b says 14 days; Doc 08 §5 says "7 (not 14)".
 *    Doc 07 v2.3 is the NEWER document (supersedes v2.2, written with §2b specifically for this) -
 *    R4 gets 14 days, R3 gets 7. First-Light-lite tiny thresholds apply at R4 either way.
 */
"use strict";

// ── Return tiers (Doc 08 §2). gapDays = whole app-days since last activity (0 = same app-day). ──
function returnTier(gapDays) {
  const g = Math.max(0, Math.floor(Number(gapDays) || 0));
  if (g <= 0) return "R0";
  if (g <= 2) return "R1";
  if (g <= 6) return "R2";
  if (g <= 29) return "R3";
  return "R4";
}

// App-day gap from two 'YYYY-MM-DD' member app-day strings (callers use memberDay()).
function appDayGap(todayYmd, lastActiveYmd) {
  if (!lastActiveYmd) return null; // unknown last activity - treat as no-gap (R0-safe)
  const diff = Math.round((Date.parse(todayYmd) - Date.parse(lastActiveYmd)) / 86400000);
  return Number.isNaN(diff) ? null : Math.max(0, diff);
}

// ── Per-tier behavior: check-in shape + Clarity interplay (07 §2b · 08 §4-5) ───────────────────
function tierBehavior(tier) {
  switch (tier) {
    case "R1": return { checkin: "standard", reframe: null, relightDays: 0, directionSuppressDays: 0, hardDayWiden: false, tinyThresholds: false };
    case "R2": return { checkin: "standard", reframe: "stretch", relightDays: 0, directionSuppressDays: 1, hardDayWiden: true, tinyThresholds: false };
    case "R3": return { checkin: "condensed", reframe: "stretch", relightDays: 7, directionSuppressDays: 14, hardDayWiden: true, tinyThresholds: false };
    case "R4": return { checkin: "micro", reframe: "season", relightDays: 14, directionSuppressDays: 14, hardDayWiden: true, tinyThresholds: true };
    default: return { checkin: "standard", reframe: null, relightDays: 0, directionSuppressDays: 0, hardDayWiden: false, tinyThresholds: false };
  }
}

// ── The Never-Say list (Doc 08 §2, Sentinel-enforced). Patterns, not just strings, so "it's been
//    9 days" is caught at any number. A counted absence is a summons, not a welcome. ─────────────
const NEVER_SAY_PATTERNS = [
  { re: /\byou'?ve been (gone|away)\b/i, label: "you've been gone/away" },
  { re: /\byou were (gone|away)\b/i, label: "you were gone/away" },
  { re: /\bwe('?ve)? missed you\b/i, label: "we missed you" },
  { re: /\bit'?s been \d+\s*(day|week|month)s?\b/i, label: "it's been X days" },
  { re: /\b\d+\s*days? (since|ago) (we|you|your last)\b/i, label: "gap arithmetic" },
  { re: /\bstreak\b/i, label: "streak language" },
  { re: /\b(get|got|getting) back on track\b/i, label: "back on track (implies off-track)" },
  { re: /\bwhere (have|were) you\b/i, label: "where were you" },
  { re: /\blong time no\b/i, label: "long time no see" },
];
// Returns the first violated pattern's label, or null when the text is clean.
function violatesNeverSay(text) {
  const t = String(text || "");
  for (const p of NEVER_SAY_PATTERNS) if (p.re.test(t)) return p.label;
  return null;
}

// ── Riley's opening register per tier - the system-prompt block riley-chat injects (08 §2) ─────
function registerBlock(tier, remembered) {
  const NEVER =
    "HARD RULES (Never-Say, non-negotiable): never state or imply how long they were away - no " +
    "\"you've been gone\", \"we missed you\", \"it's been X days\", no streak language, no \"back on " +
    "track\", no gap arithmetic of any kind. The gap is an input, never a topic - unless THEY raise " +
    "it, in which case meet it honestly and move forward. Missed days are met with welcome; nobody " +
    "is ever late to their own life.";
  const mem = remembered ? (" One thing you're carrying for them, if it fits naturally (content, never its date): \"" + String(remembered).slice(0, 200) + "\".") : "";
  switch (tier) {
    case "R0": return "RETURN REGISTER: same-day continuation. No greeting ceremony - pick up the thread mid-conversation.\n" + NEVER;
    case "R1": return "RETURN REGISTER: normal rhythm. Warm open; reference last time naturally. This member's cadence IS daily-equivalent - treat it as such.\n" + NEVER;
    case "R2": return "RETURN REGISTER: drifting in. Warm, zero remark on any gap. You may reference the last conversation's CONTENT, never its date." + mem + "\n" + NEVER;
    case "R3": return "RETURN REGISTER: returning. Open with welcome-as-fact (\"Good to see you.\"), then be genuinely useful: offer a one-line where-we-left-off or a fresh start - their choice." + mem + "\n" + NEVER;
    case "R4": return "RETURN REGISTER: coming back - the homecoming. \"Welcome back. Everything's where you left it.\" Offer a fresh start explicitly, including quietly archiving old goals, no ceremony." + mem + "\n" + NEVER;
    default: return NEVER;
  }
}

// ── Notification rhythm (08 §3): observed-cadence mirror + backoff ladder ──────────────────────
// personalCadence: median inter-session gap (days) over the trailing window, clamped [1, 7].
function personalCadence(gaps) {
  const xs = (gaps || []).map(Number).filter((n) => !Number.isNaN(n) && n >= 0).sort((a, b) => a - b);
  if (!xs.length) return 1;
  const mid = Math.floor(xs.length / 2);
  const med = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.min(7, Math.max(1, med));
}

// Days until the next allowed nudge. Ladder: base = cadence + 1 quiet day; each unanswered nudge
// doubles it (cap 14); >= 3 ignored -> one quiet weekly touch; >= 30 days silent -> monthly
// "the light's on", indefinitely. Riley never goes fully dark and never gets louder.
function nextNudgeGap(cadence, unanswered, daysSilent) {
  if ((daysSilent || 0) >= 30) return 30;
  if ((unanswered || 0) >= 3) return 7;
  const base = Math.min(7, Math.max(1, Number(cadence) || 1)) + 1;
  return Math.min(14, base * Math.pow(2, Math.max(0, unanswered || 0)));
}

// ── Re-Light rise-only display (07 §2b · 08 §5). During the window the shown number never drops
//    below what was already shown this window; outside it, the computed value passes through. ───
function relightDisplay(computed, prevShownInWindow, inWindow) {
  if (!inWindow) return computed;
  if (prevShownInWindow == null) return computed;
  return Math.max(Number(prevShownInWindow), Number(computed));
}

module.exports = {
  returnTier, appDayGap, tierBehavior, registerBlock,
  NEVER_SAY_PATTERNS, violatesNeverSay,
  personalCadence, nextNudgeGap, relightDisplay,
};
