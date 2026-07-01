-- ============================================================
-- 031_member_docs.sql
-- The 8:14 Project — Riley-generated documents about the member
--
-- Holds the Personal Operating Manual ("My User Manual") and, later, the annual
-- Story ("This is who you became"). Riley writes these FOR the member from
-- everything she's learned — the Life Map, Human OS, patterns, wins.
--
-- Run in: Supabase → SQL Editor. Creates a table → RLS dialog is legitimate;
-- choose "Run and enable RLS".
-- ============================================================

CREATE TABLE IF NOT EXISTS member_docs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  doc_type   text NOT NULL,          -- manual | story
  period     text,                   -- e.g. '2027' for a story; null for the manual
  body       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_docs ON member_docs (user_id, doc_type, is_active, created_at DESC);

ALTER TABLE member_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own member_docs" ON member_docs;
CREATE POLICY "own member_docs" ON member_docs USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
