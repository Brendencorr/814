-- ============================================================
-- 033_pricing_v4.sql
-- The 8:14 Project — Membership & Pricing v4
-- Riley Guide (free, forever) / Companion ($29) / Coach ($49) /
-- Mentor (future, draft) + à la carte ($9 each, content-only).
-- Built from The_Riley_Memberships_and_Product_Philosophy.docx via the
-- Program&Pricing updateV4 build package. No domain-locking, ever — every
-- active tier still unlocks every domain (sobriety/grief/body). Tiers differ
-- in relationship depth, not topic access.
--
-- SAFE MIGRATION, NOT A FRESH RESEED: this repo already has real entitlement
-- rows (Brenden's own Concierge grant, at minimum). This script:
--   1. Adds new columns/tables ADDITIVELY (nothing dropped).
--   2. Remaps any existing entitlement rows from the old product_keys to the
--      new ones BEFORE anything could reference a stale key, so nobody loses
--      access mid-migration.
--   3. Retires (never deletes) the old renamed product rows.
--   4. Leaves prog_first30/prog_eat/prog_move untouched — not part of v4's
--      spec, but no reason to break anything that might already reference them.
--
-- Run in: Supabase → SQL Editor. Safe to re-run (idempotent). New tables
-- (usage_limits, usage_counters, admins, grants_log) will trigger the RLS
-- dialog — choose "Run and enable RLS".
-- ============================================================

-- ── 1. New columns on products (additive) ───────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'live'
  CHECK (status IN ('draft','locked','live','retired'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS blurb                text DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS visible_on_menu      boolean NOT NULL DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS implies_all_programs boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tier_level           integer NOT NULL DEFAULT 0;
-- (existing columns kept as-is: product_key, display_name, type, price_cents,
--  recurring, implies text[], is_hidden, sort_order, created_at — is_hidden and
--  implies[] are superseded by visible_on_menu / implies_all_programs going
--  forward but left in place; nothing else in the app reads them.)

-- ── 2. New column on feature_map (additive) ─────────────────────────────────
ALTER TABLE feature_map ADD COLUMN IF NOT EXISTS unentitled_state text
  CHECK (unentitled_state IN ('hidden','locked_upsell','capped'));
-- Backfill from the existing gate_mode so nothing regresses before the reseed below.
UPDATE feature_map SET unentitled_state = gate_mode WHERE unentitled_state IS NULL;

-- ── 3. New tables — usage caps for the persistent free tier ─────────────────
CREATE TABLE IF NOT EXISTS usage_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key  text NOT NULL REFERENCES products(product_key),
  feature_key  text NOT NULL REFERENCES feature_map(feature_key),
  limit_amount integer NOT NULL,
  limit_period text NOT NULL DEFAULT 'week' CHECK (limit_period IN ('day','week','month','lifetime')),
  UNIQUE (product_key, feature_key)
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  feature_key  text NOT NULL,
  period_start timestamptz NOT NULL,
  count_used   integer NOT NULL DEFAULT 0,
  UNIQUE (user_id, feature_key, period_start)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_user ON usage_counters (user_id, feature_key, period_start);

-- ── 4. Admins + grants audit log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  user_id uuid PRIMARY KEY,
  role    text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff'))
);

CREATE TABLE IF NOT EXISTS grants_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid,
  target_user_id uuid NOT NULL,
  product_key    text NOT NULL,
  action         text NOT NULL CHECK (action IN ('grant','revoke')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grants_log_target ON grants_log (target_user_id, created_at DESC);

-- ── 5. Insert the NEW product rows the v4 catalog needs ─────────────────────
-- (companion/reset_free/prog_grief already exist — updated separately below.)
INSERT INTO products (product_key, display_name, type, price_cents, recurring, status, blurb, sort_order, visible_on_menu, implies_all_programs, tier_level, is_hidden) VALUES
  ('coach',         'Riley Coach',          'subscription', 4900, true,  'live',  'Everything in Companion, plus adaptive workout & nutrition plans, proactive check-ins, Knowledge Graph, progress dashboards, trend analysis.', 30, true,  true,  3, false),
  ('prog_sobriety', 'Sobriety (self-guided)', 'program',    900,  false, 'live',  'Full sobriety program content, self-guided. Lifetime access. No Riley, no tracking.', 50, true, false, 0, false),
  ('prog_body',     'Body Rebuild (self-guided)', 'program', 900, false, 'live',  'Full body rebuild program content, self-guided. Lifetime access. No Riley, no tracking.', 70, true, false, 0, false),
  ('mentor',        'Riley Mentor',         'subscription', 0,    true,  'draft', 'Future release. Human coach integration, quarterly strategy sessions, annual Life Review, mastermind groups, family coaching, white-glove onboarding.', 40, false, true, 4, true)
ON CONFLICT (product_key) DO NOTHING;  -- if this migration re-runs, don't clobber admin edits made since

-- ── 6. Remap any EXISTING entitlement rows from old keys to new ones ────────
-- Must happen AFTER step 5 (new product rows must exist for the FK), and
-- BEFORE we touch/retire the old product rows. Guards against creating a
-- duplicate (user,product) pair if someone somehow already held both.
UPDATE entitlements e SET product_key = 'coach'
  WHERE product_key = 'concierge'
    AND NOT EXISTS (SELECT 1 FROM entitlements e2 WHERE e2.user_id = e.user_id AND e2.product_key = 'coach');
DELETE FROM entitlements WHERE product_key = 'concierge';  -- any leftover dupes

UPDATE entitlements e SET product_key = 'prog_sobriety'
  WHERE product_key = 'prog_sobriety_90'
    AND NOT EXISTS (SELECT 1 FROM entitlements e2 WHERE e2.user_id = e.user_id AND e2.product_key = 'prog_sobriety');
DELETE FROM entitlements WHERE product_key = 'prog_sobriety_90';

UPDATE entitlements e SET product_key = 'prog_body'
  WHERE product_key = 'prog_body_90'
    AND NOT EXISTS (SELECT 1 FROM entitlements e2 WHERE e2.user_id = e.user_id AND e2.product_key = 'prog_body');
DELETE FROM entitlements WHERE product_key = 'prog_body_90';

-- ── 7. Retire the old, now-unreferenced product rows (never delete — keeps
--     grants_log / historical rows valid if anything ever pointed at them) ──
UPDATE products SET status = 'retired', visible_on_menu = false
  WHERE product_key IN ('concierge', 'prog_sobriety_90', 'prog_body_90');
-- prog_first30 / prog_eat / prog_move are intentionally left untouched —
-- not part of v4's spec, but nothing forces their removal either.

-- ── 8. Update the columns on products that DO carry forward (price/status) ──
-- (Explicit UPDATEs — the reseed below intentionally does NOT touch
--  price_cents/status on conflict, so the pricing change needs a one-time set.)
UPDATE products SET price_cents = 2900, status = 'live', blurb =
  'Unlimited Riley conversations. All curriculum, all domains. Community, light tracking, monthly workshops, full resource library.',
  tier_level = 2, implies_all_programs = true, visible_on_menu = true
  WHERE product_key = 'companion';

UPDATE products SET price_cents = 0, status = 'live', blurb =
  'Free, forever. Riley chat (limited), the 7-Day Reset, community previews, weekly check-in, resource library (limited), basic tracking.',
  tier_level = 1, implies_all_programs = true, visible_on_menu = true, display_name = 'Riley Guide'
  WHERE product_key = 'reset_free';

UPDATE products SET price_cents = 900, status = 'live', blurb =
  'Full grief & life transitions program content, self-guided. Lifetime access. No Riley, no tracking.',
  tier_level = 0, implies_all_programs = false, visible_on_menu = true,
  display_name = 'Grief & Life Transitions (self-guided)'
  WHERE product_key = 'prog_grief';

-- Keep sort_order sane across the new catalog.
UPDATE products SET sort_order = 10 WHERE product_key = 'reset_free';
UPDATE products SET sort_order = 20 WHERE product_key = 'companion';
UPDATE products SET sort_order = 30 WHERE product_key = 'coach';
UPDATE products SET sort_order = 40 WHERE product_key = 'mentor';
UPDATE products SET sort_order = 50 WHERE product_key = 'prog_sobriety';
UPDATE products SET sort_order = 60 WHERE product_key = 'prog_grief';
UPDATE products SET sort_order = 70 WHERE product_key = 'prog_body';

-- ── 9. Feature map — update EXISTING rows to include 'coach' (keep 'concierge'
--     in required_any too; harmless since no one holds it anymore post-remap,
--     and it costs nothing to leave as a defensive legacy fallback) ─────────
UPDATE feature_map SET required_any = ARRAY['reset_free','companion','concierge','coach','prog_sobriety_90','prog_grief','prog_body_90','prog_first30','prog_eat','prog_move','prog_sobriety','prog_body']
  WHERE feature_key = 'reset_7day';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'daily_checkin';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'community';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'riley_responds_community';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'adaptive_programming';
UPDATE feature_map SET required_any = ARRAY['concierge','coach']            WHERE feature_key = 'program_library';
UPDATE feature_map SET required_any = ARRAY['prog_sobriety_90','prog_sobriety','concierge','coach'] WHERE feature_key = 'program_sobriety_90';
UPDATE feature_map SET required_any = ARRAY['prog_grief','concierge','coach']                        WHERE feature_key = 'program_grief';
UPDATE feature_map SET required_any = ARRAY['prog_body_90','prog_body','concierge','coach']         WHERE feature_key = 'program_body_90';
UPDATE feature_map SET required_any = ARRAY['prog_first30','concierge','coach']                      WHERE feature_key = 'program_first30';
UPDATE feature_map SET required_any = ARRAY['concierge','coach']            WHERE feature_key = 'riley_concierge_support';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach','prog_body_90','prog_body'] WHERE feature_key = 'tracker_fitness';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach','prog_body_90','prog_body'] WHERE feature_key = 'tracker_nutrition';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'tracker_sleep';
UPDATE feature_map SET required_any = ARRAY['concierge','coach']            WHERE feature_key = 'tracker_finance';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'tracker_calendar';
UPDATE feature_map SET required_any = ARRAY['companion','concierge','coach'] WHERE feature_key = 'roadmap';

-- ── 10. New v4 feature rows — the genuinely new concepts ────────────────────
INSERT INTO feature_map (feature_key, required_any, gate_mode, unentitled_state, display_name, sort_order) VALUES
  ('riley_chat',          ARRAY['reset_free','companion','concierge','coach'], 'locked_upsell', 'capped',        'Riley Chat',              18),
  ('resource_library',    ARRAY['reset_free','companion','concierge','coach'], 'locked_upsell', 'capped',        'Resource Library',        19),
  ('monthly_workshops',   ARRAY['companion','concierge','coach'],              'locked_upsell', 'locked_upsell', 'Monthly Workshops',       20),
  ('adaptive_workouts',   ARRAY['concierge','coach'],                          'locked_upsell', 'locked_upsell', 'Adaptive Workout Plans',  21),
  ('adaptive_nutrition',  ARRAY['concierge','coach'],                          'locked_upsell', 'locked_upsell', 'Adaptive Nutrition Plans',22),
  ('proactive_checkins',  ARRAY['concierge','coach'],                          'locked_upsell', 'locked_upsell', 'Proactive Check-Ins',     23),
  ('knowledge_graph',     ARRAY['concierge','coach'],                          'locked_upsell', 'locked_upsell', 'Knowledge Graph',         24),
  ('progress_dashboards', ARRAY['concierge','coach'],                          'locked_upsell', 'locked_upsell', 'Progress Dashboards',     25),
  ('trend_analysis',      ARRAY['concierge','coach'],                          'locked_upsell', 'locked_upsell', 'Trend Analysis',          26),
  ('human_coach',         ARRAY['mentor'], 'hidden', 'hidden', 'Human Coach Integration',   30),
  ('quarterly_strategy',  ARRAY['mentor'], 'hidden', 'hidden', 'Quarterly Strategy Session',31),
  ('annual_life_review',  ARRAY['mentor'], 'hidden', 'hidden', 'Annual Life Review',        32),
  ('mastermind_groups',   ARRAY['mentor'], 'hidden', 'hidden', 'Mastermind Groups',         33),
  ('family_coaching',     ARRAY['mentor'], 'hidden', 'hidden', 'Family Coaching',           34)
ON CONFLICT (feature_key) DO UPDATE SET
  required_any     = EXCLUDED.required_any,
  gate_mode        = EXCLUDED.gate_mode,
  unentitled_state = EXCLUDED.unentitled_state,
  display_name     = EXCLUDED.display_name,
  sort_order       = EXCLUDED.sort_order;

-- ── 11. Usage limits — Riley Guide's caps (admin-tunable, no deploy needed) ──
INSERT INTO usage_limits (product_key, feature_key, limit_amount, limit_period) VALUES
  ('reset_free', 'riley_chat',       10, 'week'),
  ('reset_free', 'resource_library',  5, 'lifetime')
ON CONFLICT (product_key, feature_key) DO NOTHING;  -- don't clobber admin tuning on re-run

-- ── 12. RLS for the new tables ───────────────────────────────────────────────
ALTER TABLE usage_limits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE grants_log     ENABLE ROW LEVEL SECURITY;
-- usage_limits: public read (config, like feature_map/products already are)
DROP POLICY IF EXISTS "Usage limits public read" ON usage_limits;
CREATE POLICY "Usage limits public read" ON usage_limits FOR SELECT USING (true);
-- usage_counters: users can read their own (for a live "N messages left" UI); writes are service-key only
DROP POLICY IF EXISTS "Users read own usage" ON usage_counters;
CREATE POLICY "Users read own usage" ON usage_counters FOR SELECT USING (auth.uid() = user_id);
-- admins, grants_log: NO client policies — service-key (operator endpoints) only, by design.

-- ── 13. Atomic usage-counter increment (avoids a race under concurrent
--       requests — matches the entitlements_and_webhooks_spec's upsert pattern) ──
CREATE OR REPLACE FUNCTION increment_usage_counter(p_user_id uuid, p_feature_key text, p_period_start timestamptz)
RETURNS void AS $$
  INSERT INTO usage_counters (user_id, feature_key, period_start, count_used)
  VALUES (p_user_id, p_feature_key, p_period_start, 1)
  ON CONFLICT (user_id, feature_key, period_start)
    DO UPDATE SET count_used = usage_counters.count_used + 1;
$$ LANGUAGE sql;

-- ── 14. Refresh the effective-entitlements view to use implies_all_programs
--       (Guide/Companion/Coach all imply every 'program' product) instead of
--       a hardcoded concierge check ─────────────────────────────────────────
CREATE OR REPLACE VIEW user_active_products AS
WITH active AS (
  SELECT user_id, product_key
  FROM entitlements
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
),
expanded AS (
  SELECT user_id, product_key FROM active
  UNION
  SELECT a.user_id, p.product_key
  FROM active a
  JOIN products c ON c.product_key = a.product_key AND c.implies_all_programs = true
  JOIN products p ON p.type = 'program'
  UNION
  SELECT DISTINCT user_id, 'reset_free' FROM active
)
SELECT DISTINCT user_id, product_key FROM expanded;
