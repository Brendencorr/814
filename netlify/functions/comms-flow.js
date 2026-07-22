/**
 * comms-flow.js - PURE Guide-flow candidate selection (no DB, no clock, no env). Extracted from
 * evaluate-comms.js so the day-by-day behavior is unit-testable (tests/comms/guide-flow.test.js).
 *
 * WHY THIS EXISTS (the reset_daily bug): the old else-if chain put the guide_4 branch
 * (resetDay >= 4 || daysSinceSignup >= 4) above reset_daily. Once day 4 passed, that branch
 * matched on EVERY run - and since guide_4 had already been sent, the chain short-circuited and
 * sent nothing. reset_daily for days 5-7 never fired, and anyone starting the Reset after day 4
 * never got a single reset_daily email.
 *
 * MODEL: each template declares an ELIGIBILITY predicate (with an explicit calendar window where
 * the old chain implied one) and a PRIORITY. Each run: build the eligible list, filter already-
 * sent (once-per-template-ever; per-RESET-DAY for reset_daily), return the single highest-priority
 * candidate. The caller sends it under the one-per-day cap.
 *
 * CONFLICT RULE (spec): on a day where a calendar guide (e.g. guide_4) and reset_daily are both
 * eligible, the calendar guide wins and that day's reset number is SKIPPED - never deferred - so
 * a later reset_daily always announces the member's ACTUAL next Reset day.
 *
 * ctx = {
 *   daysSinceSignup : whole days since signup
 *   resetStarted    : boolean
 *   resetDay        : highest completed Reset day (0 = none)
 *   pushOptedIn     : boolean (push users get push nudges instead of reset_daily email)
 *   plan            : INTERNAL plan key ('guide' = free tier; anything paid skips the pitch)
 *   sentKeys        : Set of template keys actually sent (once-per-template-ever)
 *   sentResetDays   : Set of reset-day NUMBERS already announced by reset_daily
 *   dayFor(key,def) : operator-editable day threshold (comms_templates.trigger_days override)
 *   tplOff(key)     : operator disabled this template in the dashboard
 * }
 * Returns { key, n? } for the one candidate to send this run, or null.
 */
"use strict";

function pickGuideCandidate(ctx) {
  const days = ctx.daysSinceSignup;
  const resetDay = ctx.resetDay || 0;
  const dayFor = ctx.dayFor || ((k, d) => d);
  const tplOff = ctx.tplOff || (() => false);
  const sent = ctx.sentKeys || new Set();
  const sentResetDays = ctx.sentResetDays || new Set();

  const g2day = dayFor("guide_2", 1);
  const g4day = dayFor("guide_4", 4);
  const g6day = dayFor("guide_6", 12);
  const g5day = dayFor("guide_5", 29);

  // Priority descending - mirrors the old chain's order, minus the deadlock. Windows make each
  // calendar email fire only in its own era (never back-fill a stale one), which is what the old
  // chain's short-circuiting was actually there to guarantee.
  const candidates = [
    // Month One founder letter - active users only (Gone-Quiet owns the absent), every tier.
    { key: "guide_5", prio: 100, ok: days >= g5day },
    // The one paid pitch - free (internal 'guide') tier only, in its window. Paid members simply
    // have no eligible candidate here, preserving "never upsell a paid member the tier they have".
    { key: "guide_6", prio: 90, ok: days >= g6day && days < g5day && ctx.plan === "guide" },
    // The 8:14 story - day 4 era (by Reset progress or calendar), before the pitch era.
    { key: "guide_4", prio: 80, ok: (resetDay >= g4day || days >= g4day) && days < g6day },
    // Reset days 2-7, daily, for non-push members - REGARDLESS of signup day (the fix). Each
    // day-number sends at most once (sentResetDays); a day skipped for a calendar guide is not
    // deferred. n = the next uncompleted Reset day.
    {
      key: "reset_daily", prio: 70, n: resetDay + 1,
      ok: !!ctx.resetStarted && resetDay >= 1 && resetDay < 7 && !ctx.pushOptedIn && !sentResetDays.has(resetDay + 1),
    },
    // "Day 1, done" - only while their progress actually IS day 1 (a stale congratulation is worse
    // than none). Reachable for push members (reset_daily ineligible) or when reset_daily's number
    // was already announced.
    { key: "guide_3", prio: 60, ok: resetDay === 1 },
    // "One sentence counts" - day 1 era, before the day-4 era.
    { key: "guide_2", prio: 50, ok: days >= g2day && days < g4day },
    // Welcome - first day only. Routed through the cron (not a signup hook) so it honors quiet
    // hours + the member's timezone.
    { key: "guide_1", prio: 40, ok: days < 1 },
  ];

  for (const c of candidates.sort((a, b) => b.prio - a.prio)) {
    if (!c.ok) continue;
    if (tplOff(c.key)) continue;
    if (c.key !== "reset_daily" && sent.has(c.key)) continue; // once-per-template-ever
    return c.n != null ? { key: c.key, n: c.n } : { key: c.key };
  }
  return null;
}

module.exports = { pickGuideCandidate };
