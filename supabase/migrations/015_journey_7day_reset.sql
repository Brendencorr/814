-- ============================================================
-- 015_journey_7day_reset.sql
-- The 8:14 Project — "Begin Again" — the 7-Day Reset, fully written
-- Run AFTER 014. Safe to re-run.
--
-- The free entry journey. Seven days. Each step: lesson, action,
-- journal prompt, and a message from Riley. Brand voice throughout.
-- ============================================================

INSERT INTO journey_steps (program_slug, day_number, title, lesson, action, journal_prompt, riley_message, recommended_content_types, completion_trigger)
VALUES
  ('7-day-reset', 1, 'Arrive',
   'You do not have to have it figured out. You do not have to feel ready. You just have to be here — and you are. That is day one. Beginning is the hardest part, and you already did it.',
   'Drink one full glass of water and take three slow breaths. That is the whole assignment today.',
   'What brought you here today? No wrong answers. Just be honest with yourself.',
   'Hi. I''m glad you''re here. You don''t need to do anything big today — just arrive. That counts more than you know.',
   ARRAY['breathwork','music'], 'manual'),

  ('7-day-reset', 2, 'Notice',
   'Change does not start with fixing. It starts with noticing. Today you are not trying to be different — you are just paying attention, without judgment, to how things actually are.',
   'Take a ten-minute walk. No goal, no pace. Just notice five things you see, hear, or feel.',
   'What is one thing you noticed today that you usually move past too fast?',
   'You showed up again. Two days. Most people never make it past the first. Today, just notice — that''s the practice.',
   ARRAY['walk','journal_prompt'], 'manual'),

  ('7-day-reset', 3, 'Rest',
   'Everything rebuilds during rest. Your brain, your body, your steadiness. Sleep is not the reward for a good day — it is the foundation that makes a good day possible.',
   'Tonight, put your phone down thirty minutes before bed. Let your mind land before you sleep.',
   'What does real rest feel like for you? When was the last time you felt it?',
   'Halfway to a week. The quiet days matter as much as the loud ones. Tonight, let yourself rest. You''ve earned it.',
   ARRAY['breathwork','music','podcast'], 'manual'),

  ('7-day-reset', 4, 'Nourish',
   'What you eat changes how you feel — not someday, today. Ninety percent of your serotonin is made in your gut. Feeding yourself well is not vanity. It is how you steady your own mind.',
   'Eat one meal today with protein and something green. That is it. One meal, built to hold you up.',
   'How does food usually make you feel — before, during, and after? What would you want it to feel like?',
   'Four days in. You''re building something quietly. Today, nourish yourself — not perfectly, just intentionally.',
   ARRAY['recipe','journal_prompt'], 'manual'),

  ('7-day-reset', 5, 'Move',
   'Movement is not about burning calories or earning anything. It is about momentum. The eight-minute mark is where mood starts to shift — that is neuroscience, not motivation.',
   'Move your body for ten minutes today. Walk, stretch, dance in the kitchen. Anything. Just move.',
   'When do you feel most alive in your body? What gets in the way of feeling that more often?',
   'Five days. You''re past the hard part now. Today we move — not for the mirror, for the momentum. Celebrate the showing up.',
   ARRAY['workout','walk','music'], 'manual'),

  ('7-day-reset', 6, 'Connect',
   'Loneliness activates the same pathways as physical pain. We are not built to rebuild alone. Reaching out is not weakness — it is the bravest, most human thing you can do.',
   'Text one person who matters to you. No agenda. Just "thinking of you" is enough.',
   'Who is in your corner? And who might need to know they''re in yours?',
   'Almost a full week. Look at you. Today, reach toward someone. You don''t have to carry any of this alone — and you were never meant to.',
   ARRAY['community_prompt','journal_prompt'], 'manual'),

  ('7-day-reset', 7, 'Begin Again',
   'This is not an ending. The whole point of "Begin Again" is that beginning is always available — every morning, every choice, every breath. You did not finish a program. You proved to yourself that you can start.',
   'Choose one thing from this week to carry forward. Just one. Write it down where you''ll see it.',
   'What did this week teach you about yourself? What are you carrying forward?',
   'Seven days. You began again — and you finished. That''s not nothing. That''s everything. Whatever you carry forward, carry it gently. I''ll be right here.',
   ARRAY['celebration','journal_prompt','music'], 'manual')
ON CONFLICT (program_slug, day_number) DO UPDATE SET
  title=EXCLUDED.title, lesson=EXCLUDED.lesson, action=EXCLUDED.action,
  journal_prompt=EXCLUDED.journal_prompt, riley_message=EXCLUDED.riley_message,
  recommended_content_types=EXCLUDED.recommended_content_types;
