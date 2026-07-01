-- ============================================================
-- 030_life_map.sql
-- The 8:14 Project — The Life Map (member knowledge graph)
--
-- One flexible, typed facet store that Riley continuously builds AND reads.
-- Every facet of the vision (Wins, Fears, Joys, Relationships, Recovery DNA,
-- Values, Strengths, Why, Vision, Identity, Energy…) is a typed row here.
-- Extends the riley_memory pattern into a structured, visible Life Map.
--
-- Run in: Supabase → SQL Editor. Creates a table → the RLS dialog is
-- legitimate; choose "Run and enable RLS".
-- ============================================================

CREATE TABLE IF NOT EXISTS life_map (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  facet      text NOT NULL,          -- win | fear | joy | relationship | recovery_dna
                                      -- | value | strength | weakness | why | vision
                                      -- | identity | energy | note
  content    text NOT NULL,          -- the entry, in the member's or Riley's words
  detail     jsonb DEFAULT '{}'::jsonb,  -- facet-specific extras (e.g. vision horizon, relationship role)
  source     text NOT NULL DEFAULT 'conversation',  -- conversation | member | onboarding
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_life_map_user_facet ON life_map (user_id, facet, is_active, created_at DESC);

ALTER TABLE life_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own life_map" ON life_map;
CREATE POLICY "own life_map" ON life_map USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
