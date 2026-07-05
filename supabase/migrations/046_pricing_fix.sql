-- 046_pricing_fix.sql
-- Align products.price_cents to the CURRENT live pricing.
--
-- Root cause: migration 033 (v4) set Companion=2900, Coach=4900, programs=900. The price was
-- LATER dropped to Companion $19 / Coach $34 / programs $8.14 on the marketing site (home.html,
-- chat.html), but the DB and several code copies (riley-chat.js prompt + PRODUCT_NAMES, the three
-- Coach-lock upsells, operator.html) were never updated — so Riley was quoting $29/$49 to members
-- while the site promised $19/$34. This migration fixes the DB half; the code half is fixed in the
-- same commit. Idempotent — safe to re-run.

UPDATE products SET price_cents = 1900 WHERE product_key = 'companion';                 -- $19/mo
UPDATE products SET price_cents = 3400 WHERE product_key = 'coach';                      -- $34/mo
UPDATE products SET price_cents = 814  WHERE product_key IN
  ('prog_sobriety', 'prog_grief', 'prog_body');                                          -- $8.14 each

-- Verify after running:
--   SELECT product_key, display_name, price_cents FROM products
--   WHERE product_key IN ('companion','coach','prog_sobriety','prog_grief','prog_body')
--   ORDER BY price_cents DESC;
-- Expect: coach 3400, companion 1900, programs 814.
