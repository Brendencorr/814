-- ============================================================
-- 032_legacy_vault.sql
-- The 8:14 Project — The Legacy Vault
--
-- The things worth keeping for decades: letters to children/spouses, life
-- lessons, values, advice, recipes. Text entries in v1 (voice/photo media is a
-- later extension via Supabase Storage). This is where members' stories become
-- something they keep for good.
--
-- Run in: Supabase → SQL Editor. Creates a table → RLS dialog is legitimate;
-- choose "Run and enable RLS".
-- ============================================================

CREATE TABLE IF NOT EXISTS legacy_vault (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  entry_type text NOT NULL DEFAULT 'note',  -- letter | lesson | value | advice | recipe | note | story
  title      text,
  recipient  text,                          -- "my daughter Ava", etc.
  body       text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legacy_user ON legacy_vault (user_id, is_active, created_at DESC);

ALTER TABLE legacy_vault ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own legacy_vault" ON legacy_vault;
CREATE POLICY "own legacy_vault" ON legacy_vault USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
