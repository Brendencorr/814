-- ============================================================
-- 034_sobriety_interest.sql
-- Flags members who selected "I am working on my sobriety." in
-- onboarding's Section 2 (why_here). Drives the Phase 2 dashboard
-- follow-up that asks whether they're already sober or hoping to
-- get there, without assuming either — see dashboard.html s_status.
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS sobriety_interest boolean NOT NULL DEFAULT false;
