-- ============================================================
-- 008_content_library.sql
-- The 8:14 Project — Content Library + Recommendation History
-- Sprint 1: the tagging system Riley recommends from
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE (5,000 users / 1 year):
--   content_library: admin-managed, shared by all users (~500-5,000 rows)
--   recommendation_history: ~1 rec/user/day = ~1.8M rows/year — indexed for
--     fast "what did we already show this user" lookups + cleanup by date.
-- ============================================================

-- ─── CONTENT LIBRARY ────────────────────────────────────────
-- Every recommendable piece of content, fully tagged.
CREATE TABLE IF NOT EXISTS content_library (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  creator             text,
  content_type        text NOT NULL,            -- book, podcast, video, music, meditation, breathwork, workout, recipe, article, journal_prompt, community_prompt
  topic               text,                     -- recovery, sleep, grief, fitness, nutrition, purpose, relationships, mental_health, etc.
  subtopic            text,
  mood                text[] DEFAULT '{}',      -- which moods this fits: ['sad','anxious','overwhelmed']
  energy_level        text,                     -- low, medium, high
  duration_minutes    smallint,
  program_match       text[] DEFAULT '{}',      -- program slugs this supports
  journey_match       text[] DEFAULT '{}',      -- journey types this supports
  season              text[] DEFAULT '{}',      -- ['spring','winter'] or empty = any
  weather_match       text[] DEFAULT '{}',      -- ['rain','snow','clear'] or empty = any
  time_of_day         text[] DEFAULT '{}',      -- ['morning','evening'] or empty = any
  content_url         text,
  description         text,
  recommended_when    text[] DEFAULT '{}',      -- human-readable trigger notes
  avoid_when          text[] DEFAULT '{}',
  tags                text[] DEFAULT '{}',
  difficulty_level    smallint,                 -- 1-5
  emotional_intensity smallint,                 -- 1-5 (how heavy is this content)
  is_active           boolean NOT NULL DEFAULT true,
  approval_status     text NOT NULL DEFAULT 'approved',  -- draft, pending, approved, retired
  quality_rating      numeric(2,1),             -- admin/user quality score 0.0-5.0
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Indexes tuned for the recommendation engine's filter patterns:
CREATE INDEX IF NOT EXISTS idx_content_type_active   ON content_library(content_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_content_topic         ON content_library(topic) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_content_approval      ON content_library(approval_status);
-- GIN indexes make array-overlap queries fast: WHERE mood && ARRAY['sad']
CREATE INDEX IF NOT EXISTS idx_content_mood_gin      ON content_library USING GIN(mood);
CREATE INDEX IF NOT EXISTS idx_content_tags_gin      ON content_library USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_content_program_gin   ON content_library USING GIN(program_match);
CREATE INDEX IF NOT EXISTS idx_content_season_gin    ON content_library USING GIN(season);

ALTER TABLE content_library ENABLE ROW LEVEL SECURITY;
-- Everyone can read approved/active content; only service key writes (admin).
DROP POLICY IF EXISTS "Content is public read" ON content_library;
CREATE POLICY "Content is public read" ON content_library
  FOR SELECT USING (is_active = true AND approval_status = 'approved');

-- ─── RECOMMENDATION HISTORY ─────────────────────────────────
-- The Learning Engine: what Riley already showed each user, and how they reacted.
-- Powers the "never recommend the same thing twice unless loved" rule and
-- the repetition_penalty in the recommendation score.
CREATE TABLE IF NOT EXISTS recommendation_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id      uuid REFERENCES content_library(id) ON DELETE SET NULL,
  module_key      text,                         -- if it was a module rec, not library content
  recommended_on  date NOT NULL DEFAULT CURRENT_DATE,
  reaction        text,                         -- null, 'loved', 'liked', 'dismissed', 'completed'
  reacted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The hot query: "what has this user seen recently" — user_id + date.
CREATE INDEX IF NOT EXISTS idx_rec_history_user_date    ON recommendation_history(user_id, recommended_on DESC);
CREATE INDEX IF NOT EXISTS idx_rec_history_user_content ON recommendation_history(user_id, content_id);
-- Find loved items fast (these CAN be re-recommended):
CREATE INDEX IF NOT EXISTS idx_rec_history_loved        ON recommendation_history(user_id, content_id) WHERE reaction = 'loved';

ALTER TABLE recommendation_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own rec history" ON recommendation_history;
CREATE POLICY "Users manage own rec history" ON recommendation_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── updated_at trigger ─────────────────────────────────────
DROP TRIGGER IF EXISTS set_content_updated_at ON content_library;
CREATE TRIGGER set_content_updated_at
  BEFORE UPDATE ON content_library
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
