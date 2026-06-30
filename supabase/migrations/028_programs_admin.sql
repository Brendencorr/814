-- ============================================================
-- 028_programs_admin.sql
-- The 8:14 Project — Program management + free-access switch
--
-- The entitlements model (products / entitlements / feature_map /
-- user_active_products) already exists from 005. This adds:
--   1. app_settings — a tiny key/value config table (service-key only) so
--      non-engineer toggles like free-access mode live in the DB, no deploy.
--   2. free_access_mode = true — friends & family testing: everyone sees every
--      active program/feature for free. Flip to false later to enforce real
--      purchases. entitlements.js reads this and, when true, grants all products.
--   3. Turns every program ON (is_active = true) for the testing phase.
--
-- Run in: Supabase → SQL Editor. Safe to re-run. (Plain statements — no new
-- table that needs RLS prompts beyond app_settings, which is handled below.)
-- ============================================================

-- ── Key/value app settings (service-key only) ───────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
-- No client policies: only the service key (server functions) reads/writes this.

INSERT INTO app_settings (key, value) VALUES ('free_access_mode', 'true')
ON CONFLICT (key) DO NOTHING;   -- don't clobber a later manual change

-- ── Turn every program ON for friends & family testing ──────────────────────
UPDATE programs SET is_active = true;
