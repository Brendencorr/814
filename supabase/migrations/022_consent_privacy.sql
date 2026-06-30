-- ============================================================
-- 022_consent_privacy.sql
-- The 8:14 Project — Consent & privacy (Trust architecture §1.4)
--
-- Records that a member saw and accepted the plain-language consent screen
-- before Phase 1 onboarding. consent_version lets us re-prompt if the policy
-- text materially changes. Backs the onboarding consent gate + the dashboard
-- one-time catch for members who onboarded before consent existed.
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS consent_at      timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS consent_version text;

-- When a member deletes their data, we stamp this so the app knows the wipe
-- happened (and can show "your data was cleared") without keeping the content.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS data_deleted_at timestamptz;
