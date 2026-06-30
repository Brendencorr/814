-- ============================================================
-- 020_daily_checkin.sql
-- The 8:14 Project — Daily Check-In (the daily learning heartbeat)
-- A gentle once-per-24h sequence: feeling, sleep, last night, water,
-- breakfast, dinner, what's on their mind. Captures daily updates so Riley
-- learns about each person every single day.
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- mood + notes already live on daily_checkins (used by Riley/brief/brain).
-- Everything else lands in daily_log jsonb. checkin_completed gates re-show.
-- ============================================================

ALTER TABLE daily_checkins ADD COLUMN IF NOT EXISTS daily_log         jsonb   DEFAULT '{}'::jsonb;
ALTER TABLE daily_checkins ADD COLUMN IF NOT EXISTS checkin_completed boolean NOT NULL DEFAULT false;
