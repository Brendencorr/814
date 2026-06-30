-- ============================================================
-- 018_reengagement.sql
-- The 8:14 Project — Re-engagement email tracking
-- "A week after first login, only if they haven't come back."
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

-- When we last sent a win-back email. NULL = eligible (never sent, or they
-- came back since). Set when sent; cleared automatically when they re-engage,
-- so a future lapse can trigger another gentle nudge.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS reengagement_sent_at timestamptz;

-- Updated log_engagement(): on any activity, mark active AND clear the
-- re-engagement flag (they're back — reset the win-back so it can fire again
-- if they lapse later).
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
    reengagement_sent_at = NULL,  -- they came back; re-arm the win-back
    session_count    = session_count + (CASE WHEN p_event_type = 'app_open' THEN 1 ELSE 0 END),
    brief_open_count = brief_open_count + (CASE WHEN p_event_type = 'brief_opened' THEN 1 ELSE 0 END),
    last_brief_opened_at = (CASE WHEN p_event_type = 'brief_opened' THEN now() ELSE last_brief_opened_at END),
    riley_msg_count  = riley_msg_count + (CASE WHEN p_event_type = 'riley_message' THEN 1 ELSE 0 END)
  WHERE id = uid;
END;
$$;
