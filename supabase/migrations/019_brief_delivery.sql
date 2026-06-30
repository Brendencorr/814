-- ============================================================
-- 019_brief_delivery.sql
-- The 8:14 Project — Morning brief email delivery tracking
-- Sends Riley's brief at each person's chosen check-in time.
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

-- Which date we last emailed this person their brief (prevents double-send).
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS brief_email_sent_date date;

-- Fast lookup for the hourly delivery scan: who hasn't been sent today, by schedule.
CREATE INDEX IF NOT EXISTS idx_profiles_brief_delivery
  ON user_profiles(notification_schedule, brief_email_sent_date)
  WHERE onboarding_completed = true;
