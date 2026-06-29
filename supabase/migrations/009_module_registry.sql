-- ============================================================
-- 009_module_registry.sql
-- The 8:14 Project — Dashboard Module Registry
-- Sprint 1: the modular blocks Riley assembles Home from
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE: shared config table (~25 rows). Read by every Home load,
--   so it's tiny + fully cacheable. No per-user data here.
-- ============================================================

CREATE TABLE IF NOT EXISTS module_registry (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key           text UNIQUE NOT NULL,    -- morning_brief, mood_check, breathwork, etc.
  title                text NOT NULL,
  module_type          text NOT NULL,           -- wellness_action, content, reflection, support, celebration, data
  default_priority     smallint NOT NULL DEFAULT 5,  -- 1 = highest
  state_match          text[] DEFAULT '{}',     -- which moods/states surface this: ['sad','stressed','tired']
  suppress_in_states   text[] DEFAULT '{}',     -- states where this should be hidden
  duration_minutes     smallint,
  cta                  text,                     -- button label
  icon                 text,
  entitlement_required text,                     -- feature key, or null = free
  description          text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_module_active ON module_registry(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_module_state_gin ON module_registry USING GIN(state_match);

ALTER TABLE module_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Modules are public read" ON module_registry;
CREATE POLICY "Modules are public read" ON module_registry
  FOR SELECT USING (is_active = true);

-- ─── Seed the core modules from the architecture spec ───────
INSERT INTO module_registry (module_key, title, module_type, default_priority, state_match, suppress_in_states, duration_minutes, cta, icon, entitlement_required, description)
VALUES
  ('morning_brief',     'Your Morning Brief',      'data',            1, '{}',                              '{}',                    NULL, 'Open Brief',        '🌅', 'adaptive_programming', 'Personalized 45-second daily briefing'),
  ('mood_check',        'How are you feeling?',    'data',            1, '{}',                              '{}',                    NULL, NULL,                '💭', NULL,                   'Daily mood check-in that shapes everything'),
  ('clarity_score',     'Clarity Score',           'data',            2, '{}',                              '{}',                    NULL, NULL,                '🎯', NULL,                   '8-dimension alignment score'),
  ('daily_blueprint',   'Today''s Blueprint',      'wellness_action', 2, '{}',                              '{}',                    NULL, NULL,                '📋', 'adaptive_programming', 'Today''s focus areas'),
  ('breathwork',        'Take five slow breaths',  'wellness_action', 1, '{sad,stressed,tired,anxious}',    '{}',                    5,    'Start Breathwork',  '🫁', NULL,                   'Box breathing for the nervous system'),
  ('journal_prompt',    'Today''s Reflection',     'reflection',      3, '{sad,stressed,struggling}',       '{}',                    NULL, 'Write',             '📖', NULL,                   'A prompt to sit with today'),
  ('walk',              'A ten-minute walk',       'wellness_action', 3, '{sad,tired,stressed}',            '{}',                    10,   'Log a Walk',        '🚶', NULL,                   'Movement that loosens heavy days'),
  ('music',             'Today''s Music',          'content',         4, '{}',                              '{}',                    NULL, 'Listen',            '🎵', NULL,                   'A playlist matched to your state'),
  ('podcast',           'Today''s Podcast',        'content',         4, '{}',                              '{}',                    NULL, 'Listen',            '🎧', NULL,                   'A short episode for where you are'),
  ('book',              'Today''s Reading',        'content',         5, '{}',                              '{stressed,struggling}', NULL, 'Read',              '📚', NULL,                   'A book recommendation'),
  ('video',             'Today''s Video',          'content',         5, '{}',                              '{}',                    NULL, 'Watch',             '🎥', NULL,                   'A short video for today'),
  ('meditation',        'Guided Meditation',       'wellness_action', 3, '{sad,stressed,anxious,tired}',    '{}',                    10,   'Begin',             '🧘', NULL,                   'A guided sit'),
  ('recipe',            'Today''s Nourishment',    'content',         5, '{}',                              '{}',                    NULL, 'View Recipe',       '🍳', NULL,                   'A recovery-supporting recipe'),
  ('workout',           'Today''s Movement',       'wellness_action', 4, '{great,good}',                    '{sad,struggling,tired}',NULL, 'Start',             '🏋️', NULL,                   'A workout matched to your energy'),
  ('community_prompt',  'Connect Today',           'support',         4, '{lonely,sad}',                    '{}',                    NULL, 'Visit Community',   '🤝', NULL,                   'A nudge toward connection'),
  ('recovery_support',  'Recovery Support',        'support',         1, '{struggling}',                    '{}',                    NULL, 'Talk with Riley',   '🌲', NULL,                   'Extra support when it''s hard'),
  ('grief_support',     'Carry Both',              'support',         1, '{grieving}',                      '{}',                    NULL, 'Talk with Riley',   '🕊️', NULL,                   'Presence in grief'),
  ('celebration',       'A Moment Worth Marking',  'celebration',     1, '{}',                              '{}',                    NULL, NULL,                '✨', NULL,                   'Quiet milestone recognition'),
  ('weather_suggestion','Today''s Weather',        'content',         5, '{}',                              '{}',                    NULL, NULL,                '🌤️', NULL,                   'A suggestion shaped by the weather'),
  ('program_step',      'Your Next Step',          'wellness_action', 2, '{}',                              '{}',                    NULL, 'Continue',          '🏔️', NULL,                   'The next step in your journey'),
  ('riley_message',     'A Note from Riley',       'support',         2, '{}',                              '{}',                    NULL, NULL,                '💛', NULL,                   'A personal message'),
  ('life_timeline',     'Your Life Timeline',      'data',            6, '{}',                              '{}',                    NULL, 'View Timeline',     '🏔️', NULL,                   'How far you''ve come'),
  ('important_date',    'Today',                   'support',         1, '{}',                              '{}',                    NULL, NULL,                '📅', NULL,                   'Recognition for a date that matters')
ON CONFLICT (module_key) DO UPDATE SET
  title = EXCLUDED.title,
  module_type = EXCLUDED.module_type,
  default_priority = EXCLUDED.default_priority,
  state_match = EXCLUDED.state_match,
  suppress_in_states = EXCLUDED.suppress_in_states,
  description = EXCLUDED.description;
