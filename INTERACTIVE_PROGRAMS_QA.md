# Interactive Riley-Led Programs — QA Gates (Phase 6)

Acceptance tests from the build handoff (doc 06 §Phase 6), the seed/entitlement spec (doc 04 §7), and the
Staying Free spec (doc 05 §8). Verified 2026-07-06 against the live deploy + DB. **Legend:** ✅ pass ·
🔷 code-verified (needs a logged-in member for a full live pass) · ⏸ deferred (blocked on infra).

## Safety gates (the un-skippable ones)

| # | Gate | Status | How verified |
|---|---|---|---|
| 1 | Crisis language mid-session suspends everything + routes | ✅ | Live: L3 self-harm → deterministic 988 response, before any model call. Code: session directive is injected into the base prompt; crisis/safety directives prepend *on top* → crisis always wins; L3 short-circuits and returns. |
| 2 | Guide cap-exemption unreachable from non-program chat | 🔷 | Code: `sessionExempt` only flips true when `context.enrollment_id` is present AND `loadSessionContext` confirms `enr.user_id === userId`. No context → cap applies. Forged/other-user enrollment → null → no exemption. |
| 3 | Lapse disclosure → founder canon **verbatim**, never empty | ✅ | Live: "I drank last night" → Riley opened with the interim canon line word-for-word. `getCanonLapseLine` falls back to the hardcoded interim string if the DB read fails. |
| 4 | Admin shows FOUNDER COPY PENDING until founder copy set | 🔷 | Code: operator `iseCanon()` renders the badge while `canon_copy.author !== 'founder'`; author is `'interim'` now (DB-confirmed). |
| 5 | RLS verified user-to-user | ✅ | DB: all 11 tables `rowsecurity=on`. The 9 member tables have owner-scoped (`auth.uid()`) policies; `int_sessions` + `canon_copy` are RLS-on with **no** policy (server-only — anon/authenticated read nothing). |
| 6 | Nudge cap 1/day across channels | ✅ | Code: cron builds `nudgedToday` from `int_nudges.sent_date` and skips any enrollment already nudged today, before any channel. |
| 7 | No notification ever names program-sensitive content | ✅ | Code: every nudge/alert string (`dateAlert`, `commitmentAlert`, `lapseFollowupAlert`) is generic — never the loss, the substance, or the commitment text; it just points back into the program. |

## Entitlement gates (doc 04 §7)

| # | Gate | Status | How verified |
|---|---|---|---|
| 8 | Coach includes all four interactive programs | ✅ | DB: `user_active_products` view definition covers `program_interactive` in the `implies_all_programs` branch. |
| 9 | Guide **and** Companion buy at $18.14; not tier-included | ✅ | DB: 4 products type `program_interactive`, `price_cents=1814`; `feature_map` rows `locked_upsell` (required_any = the product OR coach). |
| 10 | 60 sessions authored, milestones correct | ✅ | DB: 15 sessions each × 4 programs; milestones = Move Nourish 4/8/11/14, others 4/8/14. All JSONB valid. |

## Staying Free gates (doc 05 §8)

| # | Gate | Status | How verified |
|---|---|---|---|
| 11 | Guide (no purchase) slip → free stabilization pack, zero upsell, next-day check-in | ✅ / ⏸ | Live: slip fires the lapse path at **any** tier (anonymous test fired it); directive forbids selling; Level-2 directive names the free Emergency Craving Protocol / 8-Minute Reset. Next-day touch built in the cron (⏸ fires once the cron is scheduled). |
| 12 | Staying Free enrollee slip → canon first, ladder suspends, resume-not-restart | 🔷 | Code: `markLapseActive` arms `lapse_state` (cron skips lapse-active enrollments → ladder suspended); a new commit/confirm clears it (resume, never restart); `current_session` is never reset. |
| 13 | Heavy-daily-use intake → medical-detox guidance before planning | ✅ | Content: Session Zero of Staying Free (064) leads with "if you're using alcohol, benzos, or opioids heavily every day, stopping cold can be dangerous — Riley will walk you to a doctor first." |
| 14 | Milestone date T-2 → celebration tone (not risk tone) | ✅ | Code: `dateAlert` branches on `date_type`; `milestone` → celebration copy + 🎉, grief/risk → care copy + 🤍. Date math unit-tested (8 cases incl. year boundary). |

## Detection quality

- Slip-disclosure detector: **22/22** unit cases (11 true positives, 11 true negatives incl. "I almost drank but didn't", "I drank water", "I want to drink").
- Crisis detection unchanged and re-verified live after every `riley-chat` edit (L3 → 988 each time).

## Deferred (not gates — tracked)

- ⏸ **Push/email delivery** — blocked on `RESEND_API_KEY` (+ Metricool). In-app channel (`client_alerts`) is built; the cron is **unscheduled** — preview with `POST {dry_run:true}` then add a `netlify.toml` schedule.
- ⏸ **Exact stabilization-pack module text** — currently served from Riley's knowledge (directive-steered), not the verbatim `program_modules` text.
- ⏸ **Full two-floor-day exit** — implemented as: commit/confirm clears the lapse + a 3-day auto-clear backstop (never sticks).
- 🔴 **Clinical review of crisis + lapse detection** — flagged in `crisis-detection.js`; the architecture requires a clinician sign-off before public exposure. Programs stay **draft** (un-purchasable) until the founder reviews content + flips Live.

## Migrations run order (all applied unless noted)

060 (✅ run) → 061 → 062 → 063 → 064 (✅ run) → **065 (lapse_at — RUN THIS)**.
