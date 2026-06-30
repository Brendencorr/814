-- ============================================================
-- 017_engagement.sql
-- The 8:14 Project — Engagement & Learning Layer
-- Capture how each person actually engages, so Riley can learn and adapt.
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE (5,000 users / 1 year):
--   engagement_events: ~10 events/user/day ≈ 18M rows/year. Indexed by
--   (user_id, created_at). Detail lives here; FAST reads use the denormalized
--   counters on user_profiles so we never scan 18M rows to know "are they active".
--   Add a 90-day retention job later (events older than 90d can be pruned; the
--   rolled-up counters persist).
-- ============================================================

-- ─── ENGAGEMENT EVENTS (the raw signal) ─────────────────────
CREATE TABLE IF NOT EXISTS engagement_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  text NOT NULL,        -- app_open, brief_opened, brief_action_done, brief_generated,
                                      -- riley_message, rec_clicked, journey_step, mood_logged, page_view
  event_data  jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eng_user_time ON engagement_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eng_type_time ON engagement_events(event_type, created_at DESC);

ALTER TABLE engagement_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users insert own events" ON engagement_events;
CREATE POLICY "Users insert own events" ON engagement_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users read own events" ON engagement_events;
CREATE POLICY "Users read own events" ON engagement_events
  FOR SELECT USING (auth.uid() = user_id);

-- ─── Denormalized engagement counters on user_profiles ──────
-- Fast-read summary so engagement state never requires scanning the events table.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_active_at      timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS engagement_state    text DEFAULT 'new';   -- new, active, cooling, dormant
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS session_count       integer NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS brief_open_count    integer NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_brief_opened_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS riley_msg_count     integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON user_profiles(last_active_at);
CREATE INDEX IF NOT EXISTS idx_profiles_engagement ON user_profiles(engagement_state);

-- ─── log_engagement(): one call logs the event + bumps counters ──
-- Client calls this RPC so a single round-trip both records detail and updates
-- the fast-read summary. SECURITY DEFINER so counters update under RLS safely.
CREATE OR REPLACE FUNCTION log_engagement(p_event_type text, p_event_data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  INSERT INTO engagement_events (user_id, event_type, event_data) VALUES (uid, p_event_type, p_event_data);
  UPDATE user_profiles SET
    last_active_at = now(),
    engagement_state = 'active',
    session_count    = session_count + (CASE WHEN p_event_type = 'app_open' THEN 1 ELSE 0 END),
    brief_open_count = brief_open_count + (CASE WHEN p_event_type = 'brief_opened' THEN 1 ELSE 0 END),
    last_brief_opened_at = (CASE WHEN p_event_type = 'brief_opened' THEN now() ELSE last_brief_opened_at END),
    riley_msg_count  = riley_msg_count + (CASE WHEN p_event_type = 'riley_message' THEN 1 ELSE 0 END)
  WHERE id = uid;
END;
$$;

-- ─── refresh_engagement_states(): nightly cadence to mark cooling/dormant ──
-- Run on a schedule (or call from a cron function). Cheap — indexed scan.
CREATE OR REPLACE FUNCTION refresh_engagement_states()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE user_profiles SET engagement_state =
    CASE
      WHEN last_active_at IS NULL THEN 'new'
      WHEN last_active_at > now() - interval '2 days'  THEN 'active'
      WHEN last_active_at > now() - interval '7 days'  THEN 'cooling'
      ELSE 'dormant'
    END
  WHERE onboarding_completed = true;
END;
$$;
