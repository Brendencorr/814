-- ============================================================
-- 024_user_daily_state.sql
-- The 8:14 Project — Dashboard State Engine v1.0, Section 1
--
-- ONE living profile per user per day. Every dashboard section writes here via
-- the State-Change Engine; nothing reads stale, section-local data. Clarity was
-- previously computed client-side and thrown away each load — now it is
-- persisted and recalculated only on Tier 1 (state-changing) events.
--
-- crisis_flag is the one addition beyond the dimension scores: set true the
-- instant a Level 2/3 trigger fires, and checked BEFORE any other layer runs
-- (the engine's Step 0). It inherits the Trust & Crisis Architecture as a hard
-- override — this table does not redefine that logic, it records its result.
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_daily_state (
  user_id            uuid NOT NULL,
  date               date NOT NULL,
  mood               smallint,          -- 1-5 (latest check-in)
  sleep_score        smallint,          -- 0-100 per dimension
  movement_score     smallint,
  nourishment_score  smallint,
  reflection_score   smallint,
  goal_score         smallint,
  community_score    smallint,
  recovery_score     smallint,
  clarity_score      smallint,          -- 0-100 weighted composite
  active_journey     text,
  crisis_flag        boolean NOT NULL DEFAULT false,
  last_updated       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_uds_user_date ON user_daily_state (user_id, date DESC);

-- RLS: members read their own state (dashboard uses the anon client). The State
-- Engine writes with the service key (bypasses RLS). Mirrors 003_auth.sql.
ALTER TABLE user_daily_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own state"   ON user_daily_state;
DROP POLICY IF EXISTS "Users can insert own state" ON user_daily_state;
DROP POLICY IF EXISTS "Users can update own state" ON user_daily_state;

CREATE POLICY "Users can view own state"   ON user_daily_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own state" ON user_daily_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own state" ON user_daily_state FOR UPDATE USING (auth.uid() = user_id);
