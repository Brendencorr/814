-- ============================================================
-- 065_lapse_at.sql — timestamp for the lapse-repair follow-up + auto-clear (Phase 4 follow-ups)
--
-- When riley-chat arms lapse_state='lapse_active' on a Staying Free enrollment (slip disclosed), it
-- also stamps lapse_at = now(). int-proactive-cron uses this to (a) send ONE next-day care check-in,
-- and (b) auto-clear a lapse that's been active too long (so it never sticks and silently suspends the
-- member's nudges forever). Cleared to NULL whenever lapse_state clears (resume-not-restart). Safe to re-run.
-- ============================================================
ALTER TABLE int_enrollments ADD COLUMN IF NOT EXISTS lapse_at timestamptz;
