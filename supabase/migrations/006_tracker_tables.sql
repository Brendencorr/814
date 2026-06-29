-- ============================================================
-- 006_tracker_tables.sql
-- The 8:14 Project — Fitness logs, nutrition logs, sleep logs
-- Run in: Supabase → SQL Editor
-- Safe to re-run: all use IF NOT EXISTS guards
-- ============================================================

-- ─── FITNESS LOGS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fitness_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_date      date NOT NULL DEFAULT CURRENT_DATE,
  activity_type    text NOT NULL,
  duration_minutes smallint,
  distance_miles   numeric(6,2),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fitness_user_date ON fitness_logs(user_id, logged_date DESC);

ALTER TABLE fitness_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own fitness" ON fitness_logs;
CREATE POLICY "Users manage own fitness" ON fitness_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── NUTRITION LOGS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  logged_date date NOT NULL DEFAULT CURRENT_DATE,
  label       text,
  calories    smallint,
  protein_g   smallint,
  carbs_g     smallint,
  fat_g       smallint,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_user_date ON nutrition_logs(user_id, logged_date DESC);

ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own nutrition" ON nutrition_logs;
CREATE POLICY "Users manage own nutrition" ON nutrition_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── SLEEP LOGS (standalone, separate from daily_checkins) ──
-- daily_checkins already has sleep_hours, so this is optional
-- but adding a quality field that daily_checkins lacks
CREATE TABLE IF NOT EXISTS sleep_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sleep_date   date NOT NULL DEFAULT CURRENT_DATE,
  hours_slept  numeric(4,1),
  quality      smallint CHECK (quality BETWEEN 1 AND 5),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sleep_date)
);

CREATE INDEX IF NOT EXISTS idx_sleep_user_date ON sleep_logs(user_id, sleep_date DESC);

ALTER TABLE sleep_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own sleep" ON sleep_logs;
CREATE POLICY "Users manage own sleep" ON sleep_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
