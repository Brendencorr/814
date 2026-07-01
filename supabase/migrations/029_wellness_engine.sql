-- ============================================================
-- 029_wellness_engine.sql
-- The 8:14 Project — Workout & Nutrition Plan engine
--
-- Three tables:
--  1. wellness_profile — the member's saved goals + preferences (the intake).
--     One row per user. This is what Riley learns and personalizes from.
--  2. wellness_plans — generated 7-day workout / nutrition plans (jsonb), one
--     active per type per user. Regenerated weekly or on adaptation.
--  3. wellness_weekly — the weekly check-in feedback that drives adaptation.
--
-- Run in: Supabase → SQL Editor. These CREATE tables → the RLS dialog is
-- legitimate; choose "Run and enable RLS" (the SQL enables it + adds policies).
-- ============================================================

-- ── 1. Saved goals + preferences (the intake) ───────────────────────────────
CREATE TABLE IF NOT EXISTS wellness_profile (
  user_id             uuid PRIMARY KEY,
  -- workout intake
  workout_goal        text,     -- weight_loss | muscle_gain | strength | general_health | stress_reduction | mobility | recovery_support | athletic_performance
  fitness_level       text,     -- beginner | intermediate | advanced
  days_per_week       smallint,
  minutes_per_session smallint,
  equipment           text,     -- none | dumbbells | full_gym
  injuries            text,
  workout_types       text[] DEFAULT '{}',   -- enjoyed types
  success_30d         text,
  -- nutrition intake
  nutrition_goal      text,     -- fat_loss | muscle_gain | maintenance | more_energy | better_sleep | recovery_support | blood_sugar | reduced_cravings | general_health
  dietary_restrictions text,
  meals_per_day       smallint,
  cooks_at_home       boolean,
  foods_love          text,
  foods_hate          text,
  craving_times       text,
  typical_day         text,
  workout_intake_done boolean NOT NULL DEFAULT false,
  nutrition_intake_done boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Generated plans (workout / nutrition), jsonb ─────────────────────────
CREATE TABLE IF NOT EXISTS wellness_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  plan_type     text NOT NULL,         -- workout | nutrition
  plan          jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty    smallint NOT NULL DEFAULT 3,   -- 1-5, nudged by weekly adaptation
  week_of       date NOT NULL DEFAULT (now())::date,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wellness_plans_active ON wellness_plans (user_id, plan_type, is_active) WHERE is_active = true;

-- ── 3. Weekly check-in feedback → adaptation ────────────────────────────────
CREATE TABLE IF NOT EXISTS wellness_weekly (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  plan_type     text NOT NULL,
  week_of       date NOT NULL DEFAULT (now())::date,
  completed_pct smallint,
  too_easy      text,
  too_hard      text,
  pain          text,
  energy        text,
  sleep         text,
  cravings      text,
  meals_enjoyed text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wellness_weekly_user ON wellness_weekly (user_id, plan_type, created_at DESC);

-- ── RLS: members read/write their own; State Engine + generator use service key ──
ALTER TABLE wellness_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellness_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wellness_weekly  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own wellness_profile" ON wellness_profile;
CREATE POLICY "own wellness_profile" ON wellness_profile USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own wellness_plans" ON wellness_plans;
CREATE POLICY "own wellness_plans" ON wellness_plans USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own wellness_weekly" ON wellness_weekly;
CREATE POLICY "own wellness_weekly" ON wellness_weekly USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
