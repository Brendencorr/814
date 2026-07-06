# Data Contract — single source of truth for member data

Members' personal data (recovery, identity, progress) must read the **same** value on
every surface: the app, Riley, and the operator portal. This is the standard that keeps
that true. Read it before adding a field or a write path.

## The four rules

1. **One canonical source per fact.** A given fact lives in exactly one table.column.
   Everything reads from there (or from an enforced mirror of it — rule 2).
2. **Mirrors only via DB triggers.** If a fast denormalized copy is needed (e.g. an admin
   list reads `user_profiles.sobriety_date` instead of joining `sobriety_tracker`), a
   **database trigger** keeps the mirror in lockstep. Never rely on app code to update two
   places — it *will* drift. Mirrors are read-only from the app's perspective.
3. **Derivations via one shared helper.** A value computed from others (e.g. tier from owned
   products) has ONE implementation, imported everywhere. Never copy-paste the logic.
4. **Drift is monitored.** `data_integrity_report` (migration 057) returns a row for any
   divergence. It must always be empty. Check it after any data-model change.

## Canonical sources (current)

| Fact | Canonical source | Mirror (enforced) | Enforced by |
|---|---|---|---|
| Sobriety start date | `sobriety_tracker.start_date` (active row) | `user_profiles.sobriety_date` | trigger `trg_sync_sobriety_date` (055) |
| Email | `auth.users.email` | `user_profiles.email` | trigger `trg_sync_profile_from_auth` (055) |
| Name / avatar | `auth.users` metadata ↔ `user_profiles` | (kept aligned) | trigger `trg_sync_profile_from_auth` (055) + profile.html writes both |
| Member tier | resolved from `user_active_products` + `subscriptions` | (none — never stored) | `tier-utils.currentTier()` |
| Program progress | `days_completed` / `enrolled_at` / `last_activity_at` | legacy `day_completed` / `started_at` / `last_activity` | trigger `trg_mirror_program_progress` (056) |
| Crisis state | `crisis_log` (authoritative) | `user_daily_state.crisis_flag` (per-day) | cleared on resolve by `crisis-followup-cron` |
| Mood / sleep / water | `daily_checkins` | — | single source |
| Habits / goals / completions | `habits` / `user_goals` / `habit_completions` | — | single source |
| Wellness (fitness/nutrition/plans/intake) | `fitness_logs` / `nutrition_logs` / `wellness_*` | — | single source |

## Rules for new work

- **Adding a member field?** Put it in ONE table. If any surface needs a fast copy, add a
  trigger — don't write it from two places.
- **Never write tier onto `user_profiles`.** It's derived. Use `currentTier()`.
- **Sobriety edits go to `sobriety_tracker`**, never `user_profiles.sobriety_date` (that's the mirror).
- **Adding a derived value used in 2+ files?** Put the function in a shared util and import it.
- **After any schema/write change**, run: `select * from data_integrity_report;` — expect 0 rows.
- **Anything date/day-related uses the ONE member-day helper** (below) — never `Date.now()` math or
  `toISOString().slice(0,10)` (UTC) for a member's day.

## The member day — ONE definition (never recompute it inline)

A member's day = their **local calendar day with a 4am rollover** (a 1–3am action still counts as
yesterday). This is the single anchor for check-in date-keys, "checked in today?", streaks, and the
sober-day count. Do NOT hand-roll it — every place that had its own `Date.now()`/UTC math is why the
sober-day count read a stale/off number.

- **Client:** `window.RileyDay.appDay()` (today's key), `window.RileyDay.soberDays(startYmd)` — in `pwa.js`.
  For a top-level `TODAY` const (parses before pwa.js loads), use the identical inline form
  `new Date(Date.now()-4*3600*1000).toLocaleDateString('en-CA')`.
- **Server:** `memberDay(timezone)` / `soberDaysForMember(startYmd, timezone)` — in `supabase-client.js`.
  Always pass the member's `user_profiles.timezone` (falls back to Mountain). Never key a member's day off UTC.
- **Counts** use date-string subtraction (`Date.parse(dayA) - Date.parse(dayB)`) so they're exact
  calendar days with no time-of-day/timezone drift. Sobriety start = day 0 (today shows elapsed days).

## Resolved (verified correct or standardized)

- **Push preference** — already the correct **hierarchy** (not a duplicate): `push_notifications`
  is the master switch, `notification_consents` is per-program. `reset-nudge-cron` already gates
  every send on `master-on AND per-program-consent`, and toggling the master off preserves the
  granular consents. No change needed — the send path was built right.
- **`daily_checkins.checkin_completed`** — canonical definition = **a row with a logged mood is a
  completed check-in**. The two real check-in writers that missed the flag (dashboard mood
  quick-save + tracker check-in) now set it; note-only program flows (reset/journey) correctly
  don't. Backfilled (058) and drift-checked (`checkin_completed_mismatch` in the report).
