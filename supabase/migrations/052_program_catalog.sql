-- ============================================================
-- 052_program_catalog.sql — Program Add-ons catalog + entitlement model
--
-- Final model (per Brenden):
--   • Guide (reset_free): owns nothing; can buy any of the 5 programs.
--   • Companion: INCLUDES the 3 self-guided (Sobriety/Grief/Body); can buy the 2 guided.
--   • Coach: INCLUDES all 5 programs.
--   Pricing: self-guided $8.14 each · self-guided bundle (all 3) $18.14 · guided $18.14 each.
--
-- Mechanism: teach user_active_products to expand products.implies[] (specific grants,
-- e.g. Companion → the 3 self-guided) IN ADDITION to implies_all_programs (Coach → all
-- type='program'). Run AFTER 051. Safe to re-run.
--
-- NOTE: free_access_mode is currently 'true' (testers see everything), so this changes
-- nothing live today; it defines the model that takes effect when free access is turned off.
-- ============================================================

-- 0) Allow a 'bundle' product type (bundles are excluded from implies_all_programs sweeps).
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE products ADD CONSTRAINT products_type_check
  CHECK (type = ANY (ARRAY['free'::text, 'subscription'::text, 'program'::text, 'bundle'::text]));

-- 1) View: expand implies_all_programs (all programs) AND implies[] (specific grants).
CREATE OR REPLACE VIEW user_active_products AS
WITH active AS (
  SELECT user_id, product_key FROM entitlements
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
), expanded AS (
  SELECT user_id, product_key FROM active
  UNION
  -- implies_all_programs=true  ->  every individual program SKU (Coach)
  SELECT a.user_id, p.product_key
    FROM active a
    JOIN products c ON c.product_key = a.product_key AND c.implies_all_programs = true
    JOIN products p ON p.type = 'program'
  UNION
  -- implies[] (text[])  ->  the specific listed SKUs (Companion → 3 self-guided; a bundle → its 3)
  SELECT a.user_id, unnest(c.implies)
    FROM active a
    JOIN products c ON c.product_key = a.product_key
   WHERE c.implies IS NOT NULL AND array_length(c.implies, 1) > 0
  UNION
  SELECT DISTINCT user_id, 'reset_free'::text FROM active
)
SELECT DISTINCT user_id, product_key FROM expanded;

-- 2) Self-guided programs ($8.14, live) — ensure canonical pricing/type/flags.
UPDATE products
   SET price_cents = 814, type = 'program', status = 'live',
       visible_on_menu = true, is_hidden = false, implies_all_programs = false, recurring = false
 WHERE product_key IN ('prog_sobriety','prog_grief','prog_body');

-- 3) Self-guided bundle — all 3 for $18.14 (implies the 3 individual programs).
INSERT INTO products
  (product_key, display_name, type, price_cents, recurring, implies, is_hidden, sort_order, status, blurb, visible_on_menu, implies_all_programs, tier_level)
VALUES
  ('prog_bundle_selfguided','Self-Guided Bundle — all 3','bundle',1814,false,
   '{prog_sobriety,prog_grief,prog_body}',false,55,'live',
   'All three self-guided programs — Sobriety, Grief & Life Transitions, Body Rebuild. Lifetime access. Save on buying separately.',
   true,false,0)
ON CONFLICT (product_key) DO UPDATE SET
  display_name=EXCLUDED.display_name, type=EXCLUDED.type, price_cents=EXCLUDED.price_cents,
  implies=EXCLUDED.implies, status=EXCLUDED.status, blurb=EXCLUDED.blurb,
  visible_on_menu=EXCLUDED.visible_on_menu, recurring=false;

-- 4) Riley-guided add-ons ($18.14 each). Content not written yet → status 'draft' (shown as
--    "coming soon", not purchasable) until their modules exist and status flips to 'live'.
INSERT INTO products
  (product_key, display_name, type, price_cents, recurring, implies, is_hidden, sort_order, status, blurb, visible_on_menu, implies_all_programs, tier_level)
VALUES
  ('prog_move_nourish','Move & Nourish (Riley-guided)','program',1814,false,'{}',false,80,'draft',
   'Riley-guided home workouts + gut-brain nutrition, adaptive to your week. The guided companion to Body Rebuild.',
   true,false,0),
  ('prog_carry_both','Carry Both (Riley-guided)','program',1814,false,'{}',false,81,'draft',
   'Riley-guided support for holding grief and recovery at the same time. You do not have to choose which one matters more.',
   true,false,0)
ON CONFLICT (product_key) DO UPDATE SET
  display_name=EXCLUDED.display_name, type='program', price_cents=1814, status=EXCLUDED.status,
  blurb=EXCLUDED.blurb, visible_on_menu=true, recurring=false, implies_all_programs=false;

-- 5) Membership inclusion: Companion → 3 self-guided ONLY; Coach → all programs.
UPDATE products SET implies = '{prog_sobriety,prog_grief,prog_body}', implies_all_programs = false
 WHERE product_key = 'companion';
UPDATE products SET implies = '{}', implies_all_programs = true
 WHERE product_key = 'coach';

-- 6) Retire superseded / legacy program SKUs so the catalog has a single truth.
UPDATE products SET status = 'retired', visible_on_menu = false, is_hidden = true
 WHERE product_key IN ('prog_move','prog_eat','prog_first30','prog_sobriety_90','prog_body_90','concierge');

-- 7) Retire the superseded guided-sobriety journey in the enrollable-programs table
--    (the model has self-guided Sobriety + the 2 guided add-ons; no guided-sobriety journey).
UPDATE programs SET is_active = false WHERE slug = 'recovery-journey';
