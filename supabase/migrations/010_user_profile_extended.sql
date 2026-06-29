-- ============================================================
-- 010_user_profile_extended.sql
-- The 8:14 Project — Human Operating System layer
-- Sprint 1: extend user_profiles with Riley's long-term context
-- Run in: Supabase → SQL Editor. Safe to re-run (ADD COLUMN IF NOT EXISTS).
--
-- SCALE NOTE: one row per user (~5,000 rows). JSONB used for sparse/flexible
--   fields so we don't bloat the schema; text[] for things we filter on.
-- ============================================================

-- Identity & basics
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_name        text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS timezone              text DEFAULT 'America/Denver';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS subscription_tier     text DEFAULT 'free';

-- Goals & focus
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS primary_goals         text[] DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS secondary_goals       text[] DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS current_focus         text;

-- Themes Riley has detected from journals/conversations
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS journal_themes        text[] DEFAULT '{}';

-- Content preferences (the recommendation engine reads these)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS content_preferences   jsonb DEFAULT '{}'::jsonb;  -- {music:['acoustic'], podcast_length:'short', ...}
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS favorite_content      text[] DEFAULT '{}';        -- content_ids they loved
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS disliked_content      text[] DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS do_not_recommend      text[] DEFAULT '{}';        -- topics/types to never surface

-- How Riley should communicate with this person
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS communication_style   text;                        -- direct, gentle, encouraging, brief
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_encouragement text;

-- Safety & continuity
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS risk_flags            text[] DEFAULT '{}';         -- ['recent_crisis','grief_active'] — shapes Riley's tone
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_riley_summary    text;                        -- rolling summary of who this person is
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_summary_at       timestamptz;

-- Index for tier-based queries (admin dashboards, cohort analysis at scale)
CREATE INDEX IF NOT EXISTS idx_profiles_tier ON user_profiles(subscription_tier);
-- GIN index so Riley Brain can quickly find users with specific risk flags
CREATE INDEX IF NOT EXISTS idx_profiles_risk_gin ON user_profiles USING GIN(risk_flags);
