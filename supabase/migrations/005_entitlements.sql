-- ============================================================
-- 005_entitlements.sql
-- The 8:14 Project — Entitlements system
-- Products → Entitlements → Feature Map
-- Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ─── PRODUCTS (config / seed) ────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  product_key  text PRIMARY KEY,
  display_name text NOT NULL,
  type         text NOT NULL CHECK (type IN ('free','subscription','program')),
  price_cents  integer NOT NULL DEFAULT 0,
  recurring    boolean NOT NULL DEFAULT false,
  implies      text[]  NOT NULL DEFAULT '{}',
  is_hidden    boolean NOT NULL DEFAULT false,   -- Riley-surfaced à la carte
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── ENTITLEMENTS (source of truth) ──────────────────────────
CREATE TABLE IF NOT EXISTS entitlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_key  text NOT NULL REFERENCES products(product_key),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','expired')),
  source       text NOT NULL DEFAULT 'manual_grant' CHECK (source IN ('purchase','subscription','manual_grant','implied')),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,            -- null = lifetime
  external_ref text,                   -- payment processor id
  UNIQUE (user_id, product_key)
);

-- ─── FEATURE MAP (config) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_map (
  feature_key  text PRIMARY KEY,
  required_any text[] NOT NULL DEFAULT '{}',
  gate_mode    text NOT NULL DEFAULT 'hidden' CHECK (gate_mode IN ('hidden','locked_upsell')),
  display_name text,
  sort_order   smallint NOT NULL DEFAULT 0
);

-- ─── SEED: PRODUCTS ──────────────────────────────────────────
INSERT INTO products (product_key, display_name, type, price_cents, recurring, is_hidden, sort_order) VALUES
  ('reset_free',       'The 7-Day Rebuild Reset',        'free',          0,   false, false, 1),
  ('companion',        'Riley Companion',                 'subscription', 1900, true,  false, 2),
  ('concierge',        'Riley Concierge',                 'subscription', 3900, true,  false, 3),
  ('prog_sobriety_90', '90-Day Sobriety Challenge',       'program',      9700, false, false, 4),
  ('prog_grief',       'Carry Both — Grief & Transitions','program',      3700, false, false, 5),
  ('prog_body_90',     'Move & Nourish — Body Rebuild',   'program',      9700, false, false, 6),
  ('prog_first30',     'First 30 Days',                   'program',      3700, false, true,  7),
  ('prog_eat',         'Eat to Rebuild',                  'program',      3700, false, true,  8),
  ('prog_move',        'Move to Rebuild',                 'program',      3700, false, true,  9)
ON CONFLICT (product_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  type         = EXCLUDED.type,
  price_cents  = EXCLUDED.price_cents,
  recurring    = EXCLUDED.recurring,
  is_hidden    = EXCLUDED.is_hidden,
  sort_order   = EXCLUDED.sort_order;

-- ─── SEED: FEATURE MAP ───────────────────────────────────────
INSERT INTO feature_map (feature_key, required_any, gate_mode, display_name, sort_order) VALUES
  ('reset_7day',                ARRAY['reset_free','companion','concierge','prog_sobriety_90','prog_grief','prog_body_90','prog_first30','prog_eat','prog_move'], 'hidden', '7-Day Reset', 1),
  ('daily_checkin',             ARRAY['companion','concierge'],                 'locked_upsell', 'Daily Check-In',          2),
  ('community',                 ARRAY['companion','concierge'],                 'locked_upsell', 'Community',               3),
  ('riley_responds_community',  ARRAY['companion','concierge'],                 'hidden',        'Riley in Community',      4),
  ('adaptive_programming',      ARRAY['companion','concierge'],                 'locked_upsell', 'Adaptive Daily Brief',    5),
  ('program_library',           ARRAY['concierge'],                             'locked_upsell', 'Full Program Library',    6),
  ('program_sobriety_90',       ARRAY['prog_sobriety_90','concierge'],          'locked_upsell', '90-Day Sobriety',         7),
  ('program_grief',             ARRAY['prog_grief','concierge'],                'locked_upsell', 'Carry Both',              8),
  ('program_body_90',           ARRAY['prog_body_90','concierge'],              'locked_upsell', 'Move & Nourish',          9),
  ('program_first30',           ARRAY['prog_first30','concierge'],              'hidden',        'First 30 Days',          10),
  ('riley_concierge_support',   ARRAY['concierge'],                             'hidden',        'Concierge Support',      11),
  -- Life-data trackers: part of the ongoing subscriber relationship
  ('tracker_fitness',           ARRAY['companion','concierge','prog_body_90'],  'locked_upsell', 'Workouts',               12),
  ('tracker_nutrition',         ARRAY['companion','concierge','prog_body_90'],  'locked_upsell', 'Nutrition',              13),
  ('tracker_sleep',             ARRAY['companion','concierge'],                 'locked_upsell', 'Sleep',                  14),
  ('tracker_finance',           ARRAY['concierge'],                             'locked_upsell', 'Financial Goals',        15),
  ('tracker_calendar',          ARRAY['companion','concierge'],                 'locked_upsell', 'Calendar',               16),
  ('roadmap',                   ARRAY['companion','concierge'],                 'locked_upsell', 'Roadmap',                17)
ON CONFLICT (feature_key) DO UPDATE SET
  required_any = EXCLUDED.required_any,
  gate_mode    = EXCLUDED.gate_mode,
  display_name = EXCLUDED.display_name,
  sort_order   = EXCLUDED.sort_order;

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_map ENABLE ROW LEVEL SECURITY;

-- products + feature_map: public read (config)
DROP POLICY IF EXISTS "Products public read" ON products;
CREATE POLICY "Products public read" ON products FOR SELECT USING (true);
DROP POLICY IF EXISTS "Feature map public read" ON feature_map;
CREATE POLICY "Feature map public read" ON feature_map FOR SELECT USING (true);

-- entitlements: users read their own; only service role writes
DROP POLICY IF EXISTS "Users read own entitlements" ON entitlements;
CREATE POLICY "Users read own entitlements" ON entitlements FOR SELECT USING (auth.uid() = user_id);

-- ─── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entitlements_user   ON entitlements(user_id, status);
CREATE INDEX IF NOT EXISTS idx_entitlements_active ON entitlements(user_id) WHERE status = 'active';

-- ─── HELPER VIEW: resolved active entitlements per user ──────
-- Expands concierge → all programs, adds reset_free to everyone with any row.
CREATE OR REPLACE VIEW user_active_products AS
WITH active AS (
  SELECT user_id, product_key
  FROM entitlements
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
),
expanded AS (
  -- direct holdings
  SELECT user_id, product_key FROM active
  UNION
  -- concierge implies all programs (dynamic)
  SELECT a.user_id, p.product_key
  FROM active a
  JOIN products p ON p.type = 'program'
  WHERE a.product_key = 'concierge'
  UNION
  -- everyone with any entitlement also gets the free reset
  SELECT DISTINCT user_id, 'reset_free' FROM active
)
SELECT DISTINCT user_id, product_key FROM expanded;
