# 08 — RHYTHM & RETURN
### Cadence-aware Riley + the living check-in + the continuity loop · v1.1 · July 2026 · Code-ready
Principle (canon): **Riley keeps the member's rhythm, not a calendar's.** Nobody is ever late to their own life.

---

## 1 · THE PROBLEM THIS SOLVES

Every system assumption of "daily user" is wrong for most real members — and every surface that silently assumes it (greetings, check-in copy, notifications, score narration) becomes a small accusation when someone returns after four days. The wellness-app graveyard is built on apps that punished gaps. Riley's doctrine (missed days met with welcome; fallbacks smaller, never sterner) becomes *system behavior* here.

## 2 · RETURN TIERS (computed at session start from `last_active_at`, app-day aware)

| Tier | Gap | Name | Riley's opening posture |
|---|---|---|---|
| R0 | same app-day | continuing | No greeting ceremony — pick up the thread mid-conversation. |
| R1 | 1–2 days | rhythm | Normal warm open. Reference yesterday/last time naturally. Most members live here; this IS daily-equivalent. |
| R2 | 3–6 days | drifting in | Warm, zero remark on the gap. May reference the *last conversation's content*, never its date: "Last time you were working up to that call with your sister — no pressure, but I remembered." |
| R3 | 7–29 days | returning | Open with welcome-as-fact: "Good to see you." Then genuinely useful re-entry: one-line recap offer ("Want a quick where-we-left-off, or just start fresh?"). Check-in shortens (§4). |
| R4 | 30+ days | coming back | The homecoming. "Welcome back. Everything's where you left it." Offer fresh start explicitly — including the option to archive old goals without ceremony. Clarity re-enters via First Light-lite (§5). |

**The Never-Say list (Sentinel-enforced in riley_layer):** "you've been gone/away," "we missed you" (guilt-adjacent), "it's been X days," streak language of any kind, "let's get back on track" (implies off-track), any gap arithmetic shown to the member. The gap is an input, never a topic — unless the *member* raises it, in which case Riley meets it honestly and moves forward.

## 3 · NOTIFICATION RHYTHM (adaptive — the churn-killer)

Static daily pings to a twice-a-week member = uninstall training. Replace with observed-rhythm mirroring:
- Maintain `personal_cadence` = median inter-session gap over trailing 28 days (min 1, cap 7).
- Nudge schedule = personal_cadence + 1 day of quiet before the first gentle touch; anchor to their historical hour-of-day (existing first-login-time anchor extends here).
- **Backoff ladder:** each unanswered notification doubles the next interval (max 14 days). Two consecutive opens restore cadence. After 3 ignored → drop to one quiet weekly touch; after 30 days silent → monthly "the light's on" note, indefinitely. Riley never goes fully dark (the door stays visibly open) and never escalates volume to force a return.
- Content matches tier: R1 nudges are practice-anchored ("your quiet close is ready"); R3+ are presence-anchored ("no agenda — just leaving the light on").
- Hard-dates calendar (Doc 07 §2) overrides cadence: pre-date check-ins send regardless of rhythm, because that's care, not marketing.

## 3b · THE CONTINUITY LOOP (v1.1 — the "mom test")

Origin: first real-user feedback (founder's mother): *"Riley remembers what we talked about — but the daily check-ins are the same and don't reflect it."* Memory that is stored but not behaved isn't memory to the member. The loop: **conversation → threads → check-in → answers → memory/goals → score config → next conversation.** Every arrow below is buildable.

**Thread extraction (after every conversation).** riley_layer extracts open loops into `member_threads`: commitments ("going to call my sister"), upcoming events ("interview Thursday"), worries, goals, joys. Each: text, kind, salience, `surface_after` date, source conversation, status open/closed. Members can ask Riley what she's carrying for them; any thread is deletable on request ("let that one go").

**Check-in scoping (supersedes single-question rule in §4).** The dynamic layer draws up to **two** items per check-in (20-second rule holds), priority: 1) due open threads ("Did the call with your sister happen?") · 2) hard-date proximity · 3) active goal pulse ("Third week of the morning walks — still serving you?") · 4) program stage · 5) context color (opt-in weather/interests). Follow-up answers close or advance threads automatically. Both slots always skippable; skipped threads resurface once, then rest.

**The return sequence (R2+ — replaces a cold spine with a conversation):**
1. *"Good to see you. How have the last few days been?"* — one tap: rough / mixed / okay / good (+ optional sentence)
2. *"Anything I should know?"* — free text, skippable → writes to memory
3. *"Those goals from last week — keep going, adjust, or start something new?"* — keep / adjust / fresh. *Adjust/fresh* opens the goal editor (and may trigger the Doc 07 §10 tune-up pane — return joins day-14 as a tune-up moment)
4. Then the shortened spine per tier (§4.3).

**Data-integrity guardrail (non-negotiable):** gap answers create **context, never scores.** "The last few days were rough" is stored as a `gap_summary` annotation — it shapes Riley's narration ("you said the weekend was heavy — the score's just warming back up, no rush") and her tone, but no retroactive daily rows are fabricated and no dimension is back-scored from a one-tap summary. Clarity's history stays honest; the relationship gets the information.

**What the loop updates:** member history (memory events from answers), goals (versioned on keep/adjust/fresh), threads (closed/advanced), Clarity config (tune-up on return), and the next check-in's scoping — which is the part her mother will feel tomorrow morning.

## 4 · THE LIVING CHECK-IN (dynamic layer over a fixed spine)

**The spine never varies** — Doc 07 §2's scored fields (mood, energy, sleep, heaviness, toggles, flags) keep identical semantics and scales forever. Comparability is the score's spine; personalization that mutates the instrument destroys the data. **What varies is everything around the spine:**

1. **Framing copy** — every prompt's wording is riley_layer-generated from member context, within guardrails. "How's your energy?" becomes "Long shift yesterday — how's the tank this morning?" Same 1–5 slider underneath.
2. **The Living Question** — one rotating, unscored slot after the spine, chosen by priority: (a) hard-date proximity ("Sunday's the anniversary — how are you holding it this week?"), (b) open thread from last conversation ("Did the walk with Marcus happen?"), (c) program stage ("Day 4 of the Reset — how did the quiet close land?"), (d) context color: weather/season via coarse location — opt-in only ("First snow in Missoula — did you get outside anyway?"), (e) interests from memory ("Garden still giving you tomatoes?"). Answer is free text → Riley memory + reflection presence-credit. Never scored, never required — skippable in one tap.
3. **Length adapts to tier:** R0/R1 full spine · R3 shortened re-entry (mood + energy + one sentence; rest marked "we'll pick these back up") · R4 minimal (mood + "what season are you in?" free text) — the person coming back after two months gets three questions, not nine.
4. **Hard-day flag aftermath:** the morning after a flagged hard day, the check-in opens with acknowledgment, not metrics: "Yesterday was heavy. Scale of 'still heavy' to 'lighter' — where's this morning?"

**Generation guardrails:** riley_layer composes framing + Living Question per member per app-day; Sentinel gates output (banned lexicon + Never-Say list + no medical framing); fallback to canonical static copy on any generation failure (check-in must never block on the LLM); fuel_opt_out members never receive food-related Living Questions; location is opt-in, coarse (city-level), used only for warmth — stated plainly in the privacy policy.

## 5 · CLARITY INTERPLAY (mostly already built — wire the seams)

- Freshness decay + provisional state (Doc 07 §6) already handle gap math. Addition: **returning members are never greeted by a lower number.** At R3/R4 re-entry, the score displays as provisional ("warming up — a few check-ins and it's yours again") until confidence ≥ 0.5, regardless of computed value.
- **R4 → First Light-lite:** 7 days (not 14) of rise-only display + tiny thresholds on return from 30+ days. Baselines resume from decayed values (α_down already made them gentle), not from zero.
- Direction (D) suppressed from narration until 14 days of data post-return — no trend talk built on a gap.
- Narration copy at re-entry references *presence*, never deltas: "You're here. That's the whole assignment today."

## 6 · SCHEMA & EVENTS (additive)

```sql
ALTER TABLE users ADD COLUMN last_active_at timestamptz,
  ADD COLUMN personal_cadence numeric DEFAULT 1,
  ADD COLUMN location_city text,            -- opt-in, nullable
  ADD COLUMN location_opt_in boolean DEFAULT false;
CREATE TABLE checkin_prompts (user_id uuid, app_day date,
  framing jsonb, dynamic_items jsonb,  -- up to 2: {text, source: thread|harddate|goal|program|context, thread_id?}
  answered jsonb, PRIMARY KEY (user_id, app_day));
CREATE TABLE member_threads (id uuid PRIMARY KEY, user_id uuid, kind text, -- commitment|event|worry|goal|joy
  text text, salience int, surface_after date, status text DEFAULT 'open',
  source_conversation uuid, created_at timestamptz, closed_at timestamptz);
CREATE TABLE gap_summaries (user_id uuid, returned_on date, gap_days int,
  summary text,  -- rough|mixed|okay|good
  note text, PRIMARY KEY (user_id, returned_on));
```
Events: `session_return(tier)`, `thread_extracted/surfaced/closed`, `dynamic_item_shown(source)/answered/skipped`, `gap_summary_logged`, `goals_forked(keep|adjust|fresh)`, `notification_backoff_stepped`, `reentry_firstlight_started`. PostHog: return-tier distribution + Living Question answer-rate by source (tells us which personalization actually lands).

## 7 · ACCEPTANCE CRITERIA

1. Tier computed correctly across 4am rollover and timezones (property tests at boundaries: 2/3 days, 6/7, 29/30).
2. Never-Say list: red-team suite of 50 return scenarios — zero gap-references, zero streak language in Riley output (Sentinel gate test).
3. Notification simulator: twice-a-week member receives ≤2 touches/week; fully silent member converges to monthly; two opens restore cadence.
4. Spine invariance: scored field wording may vary, semantics/scales byte-identical in stored rows; schema test rejects any prompt config altering field types.
5. Living Question: skippable in one tap; generation failure falls back to static copy in <200ms budget; fuel_opt_out members never receive food questions (grep-level audit on generation prompts).
6. R4 return: 3-question check-in renders; provisional display until conf ≥ 0.5; First Light-lite 7-day rise-only verified.
7. Hard-date override sends pre-date touch regardless of backoff state.
8. Location off by default; no location-flavored content ever generated for non-opted members (audit).
9. **The mom test:** seeded conversation mentioning a commitment on day N → day N+1 check-in surfaces it as a dynamic item (end-to-end property test). This criterion is named for the person who found the gap.
10. Gap answers never create or modify scored daily rows (schema-level test: gap_summaries writes cannot touch user_daily_state history).
11. Skipped thread resurfaces exactly once, then rests; deleted-on-request threads never resurface.
12. Return sequence total ≤ 4 taps + optional text; renders before spine; every step skippable.

---
*Design record: v1.1 July 2026 — Continuity Loop added from first real-user feedback (founder's mother): thread extraction, two-slot check-in scoping, conversational return sequence (gap summary → anything-I-should-know → goal fork), context-not-scores guardrail. v1.0: Return tiers R0–R4 with Never-Say enforcement; adaptive notification rhythm with backoff ladder ("the light stays on, never louder"); living check-in = fixed scored spine + generated framing + one unscored Living Question; re-entry protections (provisional display, First Light-lite, no trend talk on gaps). Principle: Riley keeps the member's rhythm, not a calendar's.*
