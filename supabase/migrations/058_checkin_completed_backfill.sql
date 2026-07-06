-- 058_checkin_completed_backfill.sql
-- DATA INTEGRITY PASS — Wave 3 (check-in completeness).
-- Canonical definition of "checked in today" = a daily_checkins row with a logged mood.
-- Some writers (the mood quick-save + the tracker check-in) set mood without the flag,
-- so readers that gate on checkin_completed could under-report. Enforce the invariant
-- mood-present ⟹ checkin_completed=true, and backfill existing rows. (Note-only program
-- flows — reset/journey — intentionally do NOT set the flag; they aren't daily check-ins.)
-- Idempotent.

update public.daily_checkins
   set checkin_completed = true, updated_at = now()
 where mood is not null
   and coalesce(checkin_completed, false) = false;
