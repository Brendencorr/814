-- ============================================================
-- 014_journey_architecture.sql
-- The 8:14 Project — Journey Architecture (Sprint 3)
-- Programs become Journeys: per-day steps, Riley prompts, completion.
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE (5,000 users):
--   journey_steps is SHARED content (steps per program, not per user) —
--   ~7-90 rows per journey, a few hundred total. Tiny, fully cacheable.
--   Per-user progress already lives in user_program_progress.
-- ============================================================

-- ─── Extend programs with journey metadata ──────────────────
ALTER TABLE programs ADD COLUMN IF NOT EXISTS journey_type        text;          -- reset, recovery, body, grief, subscription
ALTER TABLE programs ADD COLUMN IF NOT EXISTS primary_goal        text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS target_user_state   text;          -- who this is for
ALTER TABLE programs ADD COLUMN IF NOT EXISTS completion_message  text;          -- the completion experience
ALTER TABLE programs ADD COLUMN IF NOT EXISTS next_program_slug   text;          -- what Riley recommends next
ALTER TABLE programs ADD COLUMN IF NOT EXISTS tagline             text;          -- "Begin Again", "Build Strength"

-- ─── Journey steps — the daily experience ───────────────────
CREATE TABLE IF NOT EXISTS journey_steps (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_slug            text NOT NULL,        -- references programs.slug
  day_number              smallint NOT NULL,
  title                   text NOT NULL,
  lesson                  text,                 -- the teaching for the day
  action                  text,                 -- the one thing to do today
  journal_prompt          text,
  riley_message           text,                 -- what Riley says on this day
  recommended_content_types text[] DEFAULT '{}',-- which content types to surface this day
  completion_trigger      text DEFAULT 'manual',-- manual, action_logged, journal_written
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(program_slug, day_number)
);

CREATE INDEX IF NOT EXISTS idx_journey_steps_slug ON journey_steps(program_slug, day_number);

ALTER TABLE journey_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Journey steps are public read" ON journey_steps;
CREATE POLICY "Journey steps are public read" ON journey_steps
  FOR SELECT USING (true);

-- ─── Journey step completions — per-user, per-day ───────────
-- Tracks which specific steps a user finished + their journal response.
CREATE TABLE IF NOT EXISTS journey_step_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  program_slug    text NOT NULL,
  day_number      smallint NOT NULL,
  journal_response text,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, program_slug, day_number)
);

CREATE INDEX IF NOT EXISTS idx_step_completions_user ON journey_step_completions(user_id, program_slug, day_number);

ALTER TABLE journey_step_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own step completions" ON journey_step_completions;
CREATE POLICY "Users manage own step completions" ON journey_step_completions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── Update programs with journey metadata ──────────────────
UPDATE programs SET journey_type='reset', tagline='Begin Again', primary_goal='Reset and start fresh',
  target_user_state='new, overwhelmed, starting over',
  completion_message='Seven days. You began again — and you finished. That is not nothing. That is the whole thing. Whatever you carry forward from this week, carry it gently.',
  next_program_slug='recovery-journey'
  WHERE slug='7-day-reset';

UPDATE programs SET journey_type='recovery', tagline='One Day at a Time', primary_goal='Structured support through early recovery',
  target_user_state='in recovery, rebuilding',
  completion_message='Ninety days. Where identity begins to shift. Look how far you have come — and how much steadier the ground feels now.',
  next_program_slug='move-and-nourish'
  WHERE slug='recovery-journey';

UPDATE programs SET journey_type='body', tagline='Move & Nourish', primary_goal='Rebuild the body gently',
  target_user_state='ready to care for the body',
  completion_message='Thirty days of showing up for your body. Not for performance — for momentum. That is how a life gets rebuilt.',
  next_program_slug=NULL
  WHERE slug='move-and-nourish';

UPDATE programs SET journey_type='grief', tagline='Carry Both', primary_goal='Hold grief and recovery together',
  target_user_state='grieving while rebuilding',
  completion_message='You carried both. The grief and the rebuilding, at the same time. That takes a strength most people never have to find.',
  next_program_slug=NULL
  WHERE slug='carry-both';
