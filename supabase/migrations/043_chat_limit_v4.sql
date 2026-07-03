-- ============================================================
-- 043_chat_limit_v4.sql — Doc 0 §4: Riley Guide chat cap → 20 replies/DAY
--
-- The existing Guide cap (migration 033) was 10 per WEEK. The v4 canonical spec
-- (Doc 0 §4) sets it to 20 per DAY, resetting 5:00 AM user-local. This aligns the
-- data; the enforcement already lives in usage-limits.js + riley-chat.js and is
-- crisis-safe (Levels 1-3 bypass the cap). Idempotent. Run AFTER 042.
--
-- NOTE (still code, tracked in the build log): the 5:00 AM *user-local* boundary
-- needs usage-limits.js currentPeriodStart('day') to honor the user's tz + 5am
-- offset (today it's a plain day boundary), and the client caption + input-disable
-- (Doc 2 §3) are a chat.html change. Those are separate from this data change.
-- ============================================================
UPDATE usage_limits
   SET limit_amount = 20, limit_period = 'day'
 WHERE product_key = 'reset_free' AND feature_key = 'riley_chat';

-- Belt-and-suspenders: if the row somehow doesn't exist yet, create it.
INSERT INTO usage_limits (product_key, feature_key, limit_amount, limit_period)
SELECT 'reset_free', 'riley_chat', 20, 'day'
WHERE NOT EXISTS (
  SELECT 1 FROM usage_limits WHERE product_key = 'reset_free' AND feature_key = 'riley_chat'
);
