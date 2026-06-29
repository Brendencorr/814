-- ============================================================
-- 007_community_waitlist.sql
-- The 8:14 Project — Community waitlist
-- Run in: Supabase → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS community_waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Public insert (anyone can join the waitlist)
ALTER TABLE community_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can join waitlist" ON community_waitlist;
CREATE POLICY "Anyone can join waitlist" ON community_waitlist
  FOR INSERT WITH CHECK (true);
