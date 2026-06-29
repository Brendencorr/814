-- ============================================================
-- 004_dashboard.sql
-- The 8:14 Project — Life Coach System Dashboard Tables
-- Run in: Supabase → SQL Editor
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards
-- ============================================================

-- ─── DAILY CHECK-INS ────────────────────────────────────────
-- One row per user per day. Mood, sobriety, water, sleep, screen time.

CREATE TABLE IF NOT EXISTS daily_checkins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checkin_date    date NOT NULL DEFAULT CURRENT_DATE,
  mood            smallint CHECK (mood BETWEEN 1 AND 5),   -- 1=rough 5=on fire
  sobriety_day    boolean NOT NULL DEFAULT false,          -- did they stay sober today?
  water_oz        smallint,                                -- oz consumed
  sleep_hours     numeric(3,1),                            -- e.g. 7.5
  screen_time_min smallint,                                -- minutes
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, checkin_date)                            -- one per day per user
);

-- ─── DAILY BRIEFS ───────────────────────────────────────────
-- One row per user per day. Stores the assembled brief + per-module completion.

CREATE TABLE IF NOT EXISTS daily_briefs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brief_date      date NOT NULL DEFAULT CURRENT_DATE,
  delivered_at    timestamptz,                             -- when the brief was generated
  modules         jsonb NOT NULL DEFAULT '{}',             -- assembled module content keyed by type
  completion      jsonb NOT NULL DEFAULT '{}',             -- { "mindset": true, "workout": false, ... }
  total_modules   smallint NOT NULL DEFAULT 0,
  completed_modules smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, brief_date)
);

-- ─── USER GOALS ─────────────────────────────────────────────
-- Weekly / monthly goals with a current value and target.

CREATE TABLE IF NOT EXISTS user_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category        text NOT NULL,                           -- 'subscribers', 'followers', 'financial', 'fitness', etc.
  title           text NOT NULL,                           -- human-readable label
  target_value    numeric,
  current_value   numeric NOT NULL DEFAULT 0,
  unit            text,                                    -- 'subscribers', 'lbs', 'dollars', etc.
  period          text NOT NULL DEFAULT 'weekly',          -- 'daily', 'weekly', 'monthly', 'lifetime'
  period_start    date NOT NULL DEFAULT CURRENT_DATE,
  period_end      date,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── HABITS ─────────────────────────────────────────────────
-- Habit definitions + daily completion log.

CREATE TABLE IF NOT EXISTS habits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL,                           -- 'Morning meditation', 'Cold shower', etc.
  emoji           text,                                    -- display icon
  category        text,                                    -- 'mindset', 'fitness', 'nutrition', 'sleep'
  frequency       text NOT NULL DEFAULT 'daily',           -- 'daily', 'weekdays', 'weekly'
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS habit_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id        uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_date  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(habit_id, completed_date)
);

-- ─── SOBRIETY TRACKER ───────────────────────────────────────
-- Separate from daily_checkins — tracks the streak anchor date and milestones.

CREATE TABLE IF NOT EXISTS sobriety_tracker (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date      date NOT NULL,                           -- when current streak began
  is_active       boolean NOT NULL DEFAULT true,
  milestone_days  jsonb NOT NULL DEFAULT '[]',             -- [30, 60, 90, 112] days hit
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── PROGRAMS TABLE (extends user_program_progress) ─────────
-- Master list of available programs. user_program_progress already tracks enrollment.

CREATE TABLE IF NOT EXISTS programs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,                    -- 'foundation-program', 'project-55'
  title           text NOT NULL,
  description     text,
  emoji           text,
  duration_days   smallint,
  price_cents     integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the 8:14 programs (aligned with brand guide)
INSERT INTO programs (slug, title, description, emoji, duration_days, price_cents, sort_order)
VALUES
  ('7-day-reset',       '7-Day Reset',       'A free week to begin again. No commitment required — just one step forward each day.',                            '🌅', 7,   0,    1),
  ('recovery-journey',  'Recovery Journey',  'Structured daily support through your first 90 days. One day at a time, with Riley beside you.',                  '🌲', 90,  3700, 2),
  ('move-and-nourish',  'Move & Nourish',    'Home workouts and gut-brain nutrition for recovery. Gentle. Practical. Built for real life.',                      '🤍', 30,  3700, 3),
  ('carry-both',        'Carry Both',        'For those holding grief and recovery at the same time. You do not have to choose which one matters more.',         '🕊️', 30,  3700, 4),
  ('companion',         'Riley Companion',   'Daily check-ins, the full program library, and community. Riley adapts to where you are — and stays.',            '🧭', 365, 1900, 5),
  ('concierge',         'Riley Concierge',   'Everything in Companion plus deeper personalization and priority support. Your most complete path forward.',       '✨', 365, 3900, 6)
ON CONFLICT (slug) DO NOTHING;

-- ─── UPDATED_AT TRIGGERS ────────────────────────────────────

-- Reuse the existing trigger function if it exists (created in 003_auth.sql)
-- Only create if it doesn't exist yet
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_updated_at ON daily_checkins;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON daily_checkins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON daily_briefs;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON daily_briefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON user_goals;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON user_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON habits;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON habits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON sobriety_tracker;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON sobriety_tracker
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────
-- Users can only see and modify their own data.

ALTER TABLE daily_checkins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_briefs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_completions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sobriety_tracker    ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs            ENABLE ROW LEVEL SECURITY;

-- daily_checkins
DROP POLICY IF EXISTS "Users manage own checkins" ON daily_checkins;
CREATE POLICY "Users manage own checkins" ON daily_checkins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- daily_briefs
DROP POLICY IF EXISTS "Users manage own briefs" ON daily_briefs;
CREATE POLICY "Users manage own briefs" ON daily_briefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_goals
DROP POLICY IF EXISTS "Users manage own goals" ON user_goals;
CREATE POLICY "Users manage own goals" ON user_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- habits
DROP POLICY IF EXISTS "Users manage own habits" ON habits;
CREATE POLICY "Users manage own habits" ON habits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- habit_completions
DROP POLICY IF EXISTS "Users manage own habit completions" ON habit_completions;
CREATE POLICY "Users manage own habit completions" ON habit_completions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- sobriety_tracker
DROP POLICY IF EXISTS "Users manage own sobriety" ON sobriety_tracker;
CREATE POLICY "Users manage own sobriety" ON sobriety_tracker
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- programs — everyone can read, nobody can write from the client
DROP POLICY IF EXISTS "Programs are public read" ON programs;
CREATE POLICY "Programs are public read" ON programs
  FOR SELECT USING (true);

-- ─── INDEXES ────────────────────────────────────────────────
-- Speed up the most common lookups

CREATE INDEX IF NOT EXISTS idx_checkins_user_date     ON daily_checkins(user_id, checkin_date DESC);
CREATE INDEX IF NOT EXISTS idx_briefs_user_date       ON daily_briefs(user_id, brief_date DESC);
CREATE INDEX IF NOT EXISTS idx_goals_user_active      ON user_goals(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_habits_user_active     ON habits(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_completions_habit_date ON habit_completions(habit_id, completed_date DESC);
CREATE INDEX IF NOT EXISTS idx_completions_user_date  ON habit_completions(user_id, completed_date DESC);
CREATE INDEX IF NOT EXISTS idx_sobriety_user_active   ON sobriety_tracker(user_id, is_active);
