-- ============================================================
-- 041_master_admin.sql — Master Admin flag
-- Adds user_profiles.is_admin. Admins get full access to every feature + an
-- `admin` flag in the entitlements response that drives the tier-preview toggle
-- and edit controls in the app. Run AFTER 040. Safe to re-run.
-- ============================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Brenden — master admin.
UPDATE user_profiles SET is_admin = true WHERE id = '37cca324-ca9a-405e-b89a-779983888ab0';
