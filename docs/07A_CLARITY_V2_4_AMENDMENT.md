# 07A - CLARITY v2.4 AMENDMENT - THE PRESENCE LANE + INSIGHT NUDGES
Founder-approved 2026-07-23 (closes the open question in PRODUCT_BRIEF_2026-07-23 §6) · Code-ready
Implemented on top of shipped Clarity v2.3. NO member-facing announcement (per the 07-22 decision) -
the lane simply appears in lane options; grief-program members receive the quiet auto-offer with
opt-out (same pattern as the sobriety lane).

## 1 · THE PRESENCE LANE (grief - opt-in only; program-linked or settings toggle)
Member-facing name: **"Presence."** (Canon echo: "Presence outlasts loss." - the permanently pinned
post.) Internal key: `lane_presence`.

**Principle, restated as law: we never grade grief itself - there is no grieving correctly.**
Presence scores the showing up, as behavior density, harder than the prior presence-credit did.

Scored behaviors (occurrence density over a trailing 14 days):
- Check-in completed on a member-flagged hard day (hard_day flag, or heaviness >= 4)
- Hard-date engagement: responding to the pre-date check-in, or any check-in within the hard-date window
- "Kept the ritual" - a one-tap check-in element shown to lane members only (the candle, the song,
  the mug - counted, never described, never graded)
- Grief-program step completed (Living Forward / Grief & Life Transitions)
- Daily Grief Check-In tool use
- Connection toggle ("talked to a human") on a heavy day
- Conversation with Riley on a hard date - OCCURRENCE only. That the member came counts as
  presence; what they said is never scored. The Never-Say/never-chat-sentiment law applies
  absolutely: the door counts, the words don't.

Math: `presence_density = distinct qualifying days_14 / 14`, `lane = 100 · density^0.8`, standard
lane floor. A qualifying day requires >= 1 behavior above (multiple behaviors one day = one day;
this measures returning, not volume).

**Weight & the multi-lane rule (new, GLOBAL):** one active lane takes 12 of Practice's 40; two
active lanes take 10 each (20 combined); maximum two lanes - chosen practice dims always retain
real weight. Applies to sobriety + presence today and all future lanes.

**Hard-date protection:** within any member-flagged hard day and a 3-day window around any hard
date (day before -> day after): the lane may rise or hold only - never fall - and freshness decay
pauses. Outside protected windows, density eases normally with the standard floor (a lane that can
never decline is decorative; protected on the brutal days, honest the rest of the year).

**Re-Light interaction:** during a Re-Light window (7+ day return), Presence follows the global
rise-only display rule; qualifying days during the gap are not retro-scored (context, never scores).

## 2 · INSIGHT NUDGES (narration capability - all members, not grief-specific)
Riley may use the member's own measured patterns to reach toward them. Five laws, enforced at
generation (v1 = approved bank in insight-nudge.js, red-teamed in tests/presence):
1. Their own pattern, stated as observation - never a generic consistency lecture.
2. Invitation, never assignment. No "how can we make sure you show up every day."
3. The score is never cited as caused by absence.
4. Never inside protected windows - hard-date windows and flagged hard days get presence, not coaching.
5. Always ends by handing agency back. Canonical closer (verbatim-family): "What would help?"

Delivery surfaces: chat narration and the Daily Brief card only; max one insight nudge per 7 days
per member; suppressed entirely for any member with an L2/L3 crisis event in the last 7 days (on
check error, suppress). Events: `insight_nudge_shown/engaged`.

## 3 · SCHEMA & EVENTS (additive - migration 102)
- `daily_checkins.kept_ritual boolean` (lane members' check-in element)
- `clarity_dims` row `lane_presence`
- Events: `presence_lane_enabled/disabled`, `presence_qualifying_day(kind)`, `insight_nudge_shown/engaged`

## 4 · ACCEPTANCE CRITERIA (tests/presence/runner.js)
1. Anniversary test: a brutal hard-date day with zero activity does not lower the lane (incl. ±1 boundary).
2. Occurrence-only: identical lane result regardless of conversation content/sentiment.
3. Multi-lane weights: sobriety+presence -> 10/10, practice dims retain 20; a third lane impossible in API.
4. "Kept the ritual" renders only for lane members; taps count max one qualifying day.
5. Insight-nudge red-team: zero score-blame, zero gap arithmetic, zero nudges in protected/post-crisis
   windows; every nudge ends with the agency-return question.
6. Re-Light + Presence: no retro-scoring of gap days.
7. Brief updated (grief removed from open questions); messaging canon check passes.

## Implementation notes (2026-07-23)
- Engine: generalized lane block in clarity-engine.js computePractice (multi-lane weights) +
  pure helpers in presence-lane.js. Gathering in clarity-v2-write.js (fail-open).
- "Daily Grief Check-In tool" qualifying source: v1 counts grief-program steps
  (user_program_progress) + hard-date conversations; a dedicated grief-tool source can be added
  to presence-lane extraDays when that tool ships.
- Insight nudges v1 surface: chat narration (riley-chat prompt injection). The Daily Brief card
  is the sanctioned second surface - wire via insight-nudge.maybeInsightNudge in daily-brief.js.
