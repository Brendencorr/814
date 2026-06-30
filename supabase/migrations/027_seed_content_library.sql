-- ============================================================
-- 027_seed_content_library.sql
-- The 8:14 Project — Seed real content into content_library
--
-- Plain INSERT into the EXISTING content_library (no new table — content_library
-- was created + secured in migration 008). mood[] uses the exact riley-brain
-- state vocabulary (struggling, sad, okay, good, great, grieving) so items
-- actually surface. Mostly original 8:14 content (copyright-safe, no URL needed);
-- a few real, accurately-attributed books/podcasts with content_url left NULL.
--
-- Run ONCE. (Re-running duplicates; to reset the seed first run:
--   DELETE FROM content_library WHERE 'seed_v1' = ANY(tags);)
-- Run in: Supabase → SQL Editor. If a Row Level Security dialog appears, this
-- is an INSERT into an existing table — choose "Run without RLS".
-- ============================================================

INSERT INTO content_library
  (title, creator, content_type, topic, mood, energy_level, duration_minutes, content_url, description, emotional_intensity, tags, is_active, approval_status)
VALUES
  ('A quiet win','The 8:14 Project','journal_prompt','reflection','{okay,good,great}','low',NULL,NULL,'What is one thing today that asked nothing of you, and gave you a little something anyway?',1,'{seed_v1}',true,'approved'),
  ('What the feeling needs','The 8:14 Project','journal_prompt','mental_health','{struggling,sad}','low',NULL,NULL,'If this hard feeling could speak, what would it say it needs right now?',3,'{seed_v1}',true,'approved'),
  ('Proud of one small thing','The 8:14 Project','journal_prompt','recovery','{okay,sad,struggling}','low',NULL,NULL,'Name one small thing you did today that your past self would be proud of.',2,'{seed_v1}',true,'approved'),
  ('What is not yours to carry','The 8:14 Project','journal_prompt','mental_health','{sad,okay,struggling}','low',NULL,NULL,'What are you carrying right now that was never yours to carry?',3,'{seed_v1}',true,'approved'),
  ('A flicker of peace','The 8:14 Project','journal_prompt','mental_health','{okay,sad,struggling}','low',NULL,NULL,'Where did you feel even a flicker of peace today? Stay there a moment.',1,'{seed_v1}',true,'approved'),
  ('Box Breathing','The 8:14 Project','breathwork','mental_health','{struggling,sad,okay}','low',5,NULL,'Four counts in, four hold, four out, four hold. Repeat for five minutes to settle the nervous system.',1,'{seed_v1}',true,'approved'),
  ('The Physiological Sigh','The 8:14 Project','breathwork','mental_health','{struggling,sad,okay}','low',2,NULL,'Two quick inhales through the nose, one long exhale through the mouth. The fastest way to calm a spike of stress.',1,'{seed_v1}',true,'approved'),
  ('4-7-8 Wind-Down Breath','The 8:14 Project','breathwork','sleep','{okay,sad}','low',4,NULL,'Inhale for 4, hold for 7, exhale for 8. A gentle on-ramp to sleep.',1,'{seed_v1}',true,'approved'),
  ('A Five-Minute Grounding Sit','The 8:14 Project','meditation','mental_health','{struggling,sad,okay}','low',5,NULL,'Name five things you can see, four you can hear, three you can touch. Come back to the room, and to yourself.',2,'{seed_v1}',true,'approved'),
  ('Loving-Kindness for Hard Days','The 8:14 Project','meditation','grief','{struggling,sad,grieving}','low',8,NULL,'A quiet practice of offering yourself the same gentleness you would offer a friend who was hurting.',3,'{seed_v1}',true,'approved'),
  ('Body Scan for Restless Nights','The 8:14 Project','meditation','sleep','{okay,sad}','low',10,NULL,'Move attention slowly from your feet to your head, letting each part soften. For nights the mind will not quiet.',2,'{seed_v1}',true,'approved'),
  ('The Ten-Minute Reset Walk','The 8:14 Project','workout','fitness','{struggling,sad,okay}','low',10,NULL,'No pace to hit, no distance to cover. Ten minutes outside tends to loosen the heavy days.',1,'{seed_v1}',true,'approved'),
  ('Morning Strength Foundations','The 8:14 Project','workout','fitness','{good,great}','high',20,NULL,'A no-equipment bodyweight circuit to build momentum on the days the energy is there.',2,'{seed_v1}',true,'approved'),
  ('Gut-Brain Breakfast Bowl','The 8:14 Project','recipe','nutrition','{okay,good,sad}','medium',10,NULL,'Greek yogurt, walnuts, and berries. Protein and omega-3s to steady blood sugar and feed the gut where most serotonin is made.',1,'{seed_v1}',true,'approved'),
  ('Magnesium Evening Snack','The 8:14 Project','recipe','nutrition','{okay,sad,struggling}','low',5,NULL,'A square of dark chocolate and a small handful of almonds. Magnesium to help the body downshift before bed.',1,'{seed_v1}',true,'approved'),
  ('Be the quiet','The 8:14 Project','quote','purpose','{struggling,sad,okay}','low',NULL,NULL,'Hope is rarely loud. It is almost always quiet. Be the quiet.',2,'{seed_v1}',true,'approved'),
  ('You came back','The 8:14 Project','quote','recovery','{struggling,sad}','low',NULL,NULL,'You came back. That is enough.',2,'{seed_v1}',true,'approved'),
  ('This Naked Mind','Annie Grace','book','recovery','{struggling,okay,good}','medium',NULL,NULL,'A clear, non-judgmental look at the psychology of drinking and how to change your relationship with alcohol.',2,'{seed_v1}',true,'approved'),
  ('Atomic Habits','James Clear','book','purpose','{okay,good,great}','medium',NULL,NULL,'A practical framework for building small habits that compound into lasting change over time.',1,'{seed_v1}',true,'approved'),
  ('Huberman Lab','Andrew Huberman','podcast','mental_health','{okay,good}','medium',NULL,NULL,'Science-based tools for sleep, stress, focus, and mood from a Stanford neuroscientist.',1,'{seed_v1}',true,'approved'),
  ('Share one win','The 8:14 Project','community_prompt','community','{okay,good,great}','low',NULL,NULL,'Post one win from this week in the community, however small. Naming it out loud makes it stick.',1,'{seed_v1}',true,'approved');
