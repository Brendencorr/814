-- ============================================================
-- 013_content_seed.sql
-- The 8:14 Project — Starter Content Library
-- Sprint 1: a real (if small) library so Riley can recommend day one
-- Run in: Supabase → SQL Editor AFTER 008. Safe to re-run.
--
-- This is a starter set. The Phase 3 CMS (admin uploads) expands it.
-- Tagged so the recommendation engine can match on mood/topic/type.
-- ============================================================

INSERT INTO content_library
  (title, creator, content_type, topic, mood, energy_level, duration_minutes, time_of_day, description, recommended_when, tags, emotional_intensity, approval_status)
VALUES
  -- ── Breathwork ──
  ('Five-Minute Grounding Breath', 'Riley', 'breathwork', 'stress',
   ARRAY['sad','anxious','overwhelmed','stressed'], 'low', 5, ARRAY['morning','evening'],
   'Box breathing — four counts in, four hold, four out, four hold. Settles the nervous system fast.',
   ARRAY['mood is low','stress is high','sleep was poor'], ARRAY['breathwork','calming','grounding'], 1, 'approved'),

  ('The Physiological Sigh', 'Riley', 'breathwork', 'anxiety',
   ARRAY['anxious','overwhelmed'], 'low', 2, ARRAY['morning','afternoon','evening'],
   'Double inhale through the nose, long exhale. The fastest way to lower anxiety in real time.',
   ARRAY['anxiety spikes','craving hits'], ARRAY['breathwork','anxiety','quick'], 1, 'approved'),

  -- ── Journal prompts ──
  ('What feels heavy today?', 'Riley', 'journal_prompt', 'reflection',
   ARRAY['sad','struggling','overwhelmed'], 'low', 5, ARRAY['morning','evening'],
   'Name the weight. You do not have to lift it — just look at it honestly.',
   ARRAY['heavy mood','hard stretch'], ARRAY['journal','reflection','grief'], 2, 'approved'),

  ('One thing I am grateful for', 'Riley', 'journal_prompt', 'gratitude',
   ARRAY['okay','good','great'], 'medium', 3, ARRAY['morning','evening'],
   'However small. Gratitude is a muscle, not a mood.',
   ARRAY['steady day','building momentum'], ARRAY['journal','gratitude'], 1, 'approved'),

  ('Who am I becoming?', 'Riley', 'journal_prompt', 'purpose',
   ARRAY['good','great'], 'high', 5, ARRAY['morning'],
   'Not who you were. Not who you''re afraid you are. Who are you actually becoming?',
   ARRAY['strong stretch','identity work'], ARRAY['journal','purpose','identity'], 2, 'approved'),

  -- ── Music ──
  ('Gentle Acoustic Mornings', 'Curated', 'music', 'calm',
   ARRAY['sad','okay','tired'], 'low', 30, ARRAY['morning'],
   'Soft acoustic and piano. Asks nothing of you. Just company for a quiet start.',
   ARRAY['low energy','heavy morning'], ARRAY['music','acoustic','calm'], 1, 'approved'),

  ('Momentum', 'Curated', 'music', 'energy',
   ARRAY['good','great'], 'high', 45, ARRAY['morning','afternoon'],
   'Upbeat without being frantic. For days you''re ready to build.',
   ARRAY['high energy','goal work'], ARRAY['music','upbeat','focus'], 1, 'approved'),

  ('Rain and Piano', 'Curated', 'music', 'sleep',
   ARRAY['tired','sad','overwhelmed'], 'low', 60, ARRAY['evening'],
   'Rain sounds layered with slow piano. For winding down or letting go.',
   ARRAY['poor sleep','evening wind-down','snowy day','rainy day'], ARRAY['music','sleep','rain'], 1, 'approved'),

  -- ── Podcasts ──
  ('Resilience in 10 Minutes', 'Curated', 'podcast', 'mental_health',
   ARRAY['sad','struggling'], 'low', 10, ARRAY['morning','afternoon'],
   'A short, honest episode on getting through the hard stretches. No toxic positivity.',
   ARRAY['heavy stretch','need hope'], ARRAY['podcast','resilience','short'], 2, 'approved'),

  ('The Science of Sleep', 'Curated', 'podcast', 'sleep',
   ARRAY['tired'], 'low', 30, ARRAY['evening'],
   'Why alcohol wrecks REM and how recovery sleep rebuilds, week by week.',
   ARRAY['poor sleep','recovery'], ARRAY['podcast','sleep','science'], 1, 'approved'),

  -- ── Books ──
  ('The Body Keeps the Score', 'Bessel van der Kolk', 'book', 'mental_health',
   ARRAY['struggling','sad'], 'medium', NULL, ARRAY['morning','evening'],
   'A clear-eyed look at how trauma and recovery live in the body. Foundational.',
   ARRAY['trauma work','deep recovery'], ARRAY['book','trauma','recovery'], 3, 'approved'),

  ('This Naked Mind', 'Annie Grace', 'book', 'recovery',
   ARRAY['okay','good'], 'medium', NULL, ARRAY['morning','evening'],
   'Reframes the relationship with alcohol without shame or willpower battles.',
   ARRAY['early sobriety','sober curious'], ARRAY['book','sobriety','mindset'], 2, 'approved'),

  -- ── Movement ──
  ('Ten-Minute Recovery Walk', 'Riley', 'workout', 'fitness',
   ARRAY['sad','tired','stressed','okay'], 'low', 10, ARRAY['morning','afternoon'],
   'Not exercise. Just movement. The 8-minute mark is where mood starts to shift.',
   ARRAY['low mood','craving','stuck'], ARRAY['movement','walk','gentle'], 1, 'approved'),

  ('Morning Strength Foundations', 'Riley', 'workout', 'fitness',
   ARRAY['good','great'], 'high', 20, ARRAY['morning'],
   'Bodyweight basics, progressive, starting from zero. No equipment, no shame.',
   ARRAY['high energy','building'], ARRAY['movement','strength','home'], 2, 'approved'),

  -- ── Meditation ──
  ('Five-Minute Reset', 'Riley', 'meditation', 'stress',
   ARRAY['stressed','anxious','overwhelmed'], 'low', 5, ARRAY['morning','afternoon','evening'],
   'A short guided sit to come back to the present when the day gets loud.',
   ARRAY['overwhelm','scattered'], ARRAY['meditation','reset','short'], 1, 'approved'),

  -- ── Recipe ──
  ('Gut-Brain Breakfast Bowl', 'Riley', 'recipe', 'nutrition',
   ARRAY['okay','good','tired'], 'medium', 15, ARRAY['morning'],
   'Eggs, leafy greens, fermented kraut, berries. Protein and probiotics to steady mood and blood sugar.',
   ARRAY['morning','recovery nutrition'], ARRAY['recipe','breakfast','gut-health'], 1, 'approved')
ON CONFLICT DO NOTHING;
