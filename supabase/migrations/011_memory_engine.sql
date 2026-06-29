-- ============================================================
-- 011_memory_engine.sql
-- The 8:14 Project — Memory Engine
-- Sprint 1: intentional, typed memory Riley carries across sessions
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE (5,000 users / 1 year):
--   ~10-50 memories per user = 50K-250K rows. Indexed by (user_id, type)
--   for fast retrieval. expires_at lets short-term memory self-clean.
-- ============================================================

CREATE TABLE IF NOT EXISTS riley_memory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type       text NOT NULL,            -- short_term, session, journey, long_term, sensitive, preference
  content           text NOT NULL,            -- the actual thing remembered
  confidence        numeric(3,2) DEFAULT 1.0, -- 0.0-1.0 how sure Riley is
  source            text,                     -- conversation, behavior, explicit, inferred
  context_ref       text,                     -- session_id or journey_id this came from
  is_active         boolean NOT NULL DEFAULT true,
  last_confirmed_at timestamptz DEFAULT now(),
  expires_at        timestamptz,              -- short_term memory self-expires; null = permanent
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The hot path: load a user's active memory by type, freshest first.
CREATE INDEX IF NOT EXISTS idx_memory_user_type ON riley_memory(user_id, memory_type, last_confirmed_at DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_memory_user_all  ON riley_memory(user_id) WHERE is_active = true;
-- Cleanup query for expired short-term memory:
CREATE INDEX IF NOT EXISTS idx_memory_expires   ON riley_memory(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE riley_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own memory" ON riley_memory;
CREATE POLICY "Users manage own memory" ON riley_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Helper: prune expired short-term memory ────────────────
-- Call periodically (cron or on write). Keeps the table lean at scale.
CREATE OR REPLACE FUNCTION prune_expired_memory()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE riley_memory
  SET is_active = false
  WHERE expires_at IS NOT NULL
    AND expires_at < now()
    AND is_active = true;
END;
$$;
