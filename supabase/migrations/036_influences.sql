-- ============================================================
-- 036_influences.sql
-- The 8:14 Project — capture each member's heroes & favorites
--
-- Asked in Riley-led onboarding ("Who are some of your people?
-- Heroes, favorite authors or artists, a song or a book that's
-- stayed with you"). Riley uses it two ways:
--   1. to know the member better, and
--   2. to close a conversation with a short quote from one of
--      THEIR favorites — and only when the member ends the chat.
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS influences text;  -- heroes, favorite people, authors, artists, coaches, songs, books
