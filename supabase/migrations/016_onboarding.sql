-- ============================================================
-- 016_onboarding.sql
-- The 8:14 Project — Riley Onboarding System v2.0
-- Hybrid progressive profiling: Phase 1 (Day 0) + Phase 2 (Days 1-7)
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE: all per-user, indexed on user_id. Resumable state lives on
--   user_profiles so a half-finished onboarding restores exactly.
-- ============================================================

-- ─── Onboarding state + Phase 1 structured fields ──────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_step      smallint NOT NULL DEFAULT 0;   -- 0=welcome, 1-5=sections, 6=building, 7=done
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_started_at  timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Identity (Section 1)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS pronouns   text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS birthday   date;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS city       text;

-- Story (Section 2)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS why_here        text;       -- the chosen reason
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS why_here_detail text;       -- "something else" / free elaboration

-- Goals (Section 3) — primary_goals already exists for focus areas
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS one_year_vision text;       -- "success one year from today"

-- Human OS (Section 4) — also written to riley_memory; mirrored here for resume/display
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS human_os jsonb DEFAULT '{}'::jsonb;  -- {energy,drains,proud,change,dream}

-- Check-in timing (Section 5)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notification_schedule text DEFAULT 'morning';  -- morning/lunch/afternoon/evening/on_demand

-- Phase 2 progressive discovery — which buckets are complete
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phase2_progress jsonb DEFAULT '{}'::jsonb;  -- {physical:true, personality:false, ...}

-- Last engagement reference — powers the Return Moment
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_engagement_note text;

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding ON user_profiles(onboarding_completed);

-- Backfill: everyone who existed before onboarding predates the feature.
-- Mark them complete so they are NOT forced through onboarding. Runs once;
-- only affects rows present at migration time. New signups default to false.
UPDATE user_profiles SET onboarding_completed = true, onboarding_step = 7
  WHERE onboarding_started_at IS NULL AND onboarding_completed = false;

-- ─── Wellness baseline (Phase 2, Day 5-7) ───────────────────
-- 1-10 self-ratings. The baseline all future progress measures against.
CREATE TABLE IF NOT EXISTS wellness_baseline (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  sleep             smallint CHECK (sleep BETWEEN 1 AND 10),
  stress            smallint CHECK (stress BETWEEN 1 AND 10),
  energy            smallint CHECK (energy BETWEEN 1 AND 10),
  motivation        smallint CHECK (motivation BETWEEN 1 AND 10),
  confidence        smallint CHECK (confidence BETWEEN 1 AND 10),
  purpose           smallint CHECK (purpose BETWEEN 1 AND 10),
  relationships     smallint CHECK (relationships BETWEEN 1 AND 10),
  nutrition         smallint CHECK (nutrition BETWEEN 1 AND 10),
  fitness           smallint CHECK (fitness BETWEEN 1 AND 10),
  overall_happiness smallint CHECK (overall_happiness BETWEEN 1 AND 10),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wellness_baseline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own baseline" ON wellness_baseline;
CREATE POLICY "Users manage own baseline" ON wellness_baseline
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Phase 2 answers (physical, personality, preferences) ───
-- Flexible key/value so the progressive questions can grow without migrations.
CREATE TABLE IF NOT EXISTS profile_details (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    text NOT NULL,        -- physical, personality, preferences
  detail_key  text NOT NULL,        -- age, height, encouragement_style, favorite_music, ...
  detail_value text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, detail_key)
);

CREATE INDEX IF NOT EXISTS idx_profile_details_user ON profile_details(user_id, category);

ALTER TABLE profile_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own details" ON profile_details;
CREATE POLICY "Users manage own details" ON profile_details
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
