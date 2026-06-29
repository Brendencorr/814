-- ============================================================
-- 005_programs_rebrand.sql
-- The 8:14 Project — Align programs table with brand guide
-- Run in: Supabase → SQL Editor
-- Safe to re-run: uses ON CONFLICT DO UPDATE
-- ============================================================

-- Remove old placeholder programs that don't match the brand
DELETE FROM programs
WHERE slug IN ('foundation-program', 'project-55', 'mindset-mastery', 'riley-life-coach');

-- Insert/update the brand guide programs
INSERT INTO programs (slug, title, description, emoji, duration_days, price_cents, sort_order)
VALUES
  ('7-day-reset',       '7-Day Reset',       'A free week to begin again. No commitment required — just one step forward each day.',                          '🌅', 7,   0,    1),
  ('recovery-journey',  'Recovery Journey',  'Structured daily support through your first 90 days. One day at a time, with Riley beside you.',                '🌲', 90,  3700, 2),
  ('move-and-nourish',  'Move & Nourish',    'Home workouts and gut-brain nutrition for recovery. Gentle. Practical. Built for real life.',                    '🤍', 30,  3700, 3),
  ('carry-both',        'Carry Both',        'For those holding grief and recovery at the same time. You do not have to choose which one matters more.',       '🕊️', 30,  3700, 4),
  ('companion',         'Riley Companion',   'Daily check-ins, the full program library, and community. Riley adapts to where you are — and stays.',          '🧭', 365, 1900, 5),
  ('concierge',         'Riley Concierge',   'Everything in Companion plus deeper personalization and priority support. Your most complete path forward.',     '✨', 365, 3900, 6)
ON CONFLICT (slug) DO UPDATE SET
  title       = EXCLUDED.title,
  description = EXCLUDED.description,
  emoji       = EXCLUDED.emoji,
  price_cents = EXCLUDED.price_cents,
  sort_order  = EXCLUDED.sort_order,
  is_active   = true;
