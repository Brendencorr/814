-- ============================================================
-- 021_crisis_safety.sql
-- The 8:14 Project — Trust, Limitations & Crisis Support layer
--
-- Backs crisis-detection.js + riley-chat.js crisis override and the
-- crisis follow-up cron. Per the Trust architecture §1.4, crisis-flagged
-- data has RESTRICTED access — logged for safety/follow-up ONLY, never
-- surfaced in marketing analytics, content personalization, or shared
-- outside the safety workflow.
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- ⚠️  The detection LOGIC in crisis-detection.js requires clinical /
--     crisis-response review before this is exposed to real members.
-- ============================================================

-- ── crisis_log — restricted safety record ────────────────────────────────────
CREATE TABLE IF NOT EXISTS crisis_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  session_id        text,
  level             smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  matched_rules     jsonb   DEFAULT '[]'::jsonb,   -- which patterns fired (for QA/recall tuning)
  message_excerpt   text,                          -- truncated; restricted access only
  followup_stage    smallint NOT NULL DEFAULT 0,   -- 0 none · 1 same-day · 2 next-morning · 3 day-3 · 4 day-7
  last_followup_at  timestamptz,
  declined_followup boolean NOT NULL DEFAULT false, -- member asked not to revisit (§2.4)
  resolved          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crisis_log_user        ON crisis_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crisis_log_followup    ON crisis_log (resolved, declined_followup, level, created_at)
  WHERE resolved = false AND declined_followup = false;

-- RESTRICTED ACCESS: enable RLS and create NO client policies.
-- With RLS on and no permissive policy, the anon and authenticated roles get
-- ZERO rows. Only the service key (used server-side in functions) bypasses RLS.
-- This is intentional — crisis data must never be client-readable.
ALTER TABLE crisis_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE crisis_log IS
  'RESTRICTED. Safety/follow-up only. Never join into analytics, personalization, or marketing. Service-key access only.';

-- ── Profile safety flags — operator safety queue (no crisis content here) ────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_crisis_at          timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_crisis_level       smallint;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS crisis_followup_opt_out boolean NOT NULL DEFAULT false;
