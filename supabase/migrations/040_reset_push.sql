-- ============================================================
-- 040_reset_push.sql — Web-push AM/PM nudge dedup for The 8:14 Reset
-- Adds per-day send tracking to notification_consents so the delivery cron
-- sends the morning (~8:14am) and evening (~8pm) nudge at most once each per
-- local day. Run AFTER 039. Safe to re-run.
-- ============================================================
ALTER TABLE notification_consents
  ADD COLUMN IF NOT EXISTS last_am_date date,
  ADD COLUMN IF NOT EXISTS last_pm_date date;
