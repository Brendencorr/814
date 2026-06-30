-- ============================================================
-- 023_operator_safety_queue.sql
-- The 8:14 Project — Operator safety queue (Trust architecture, safety workflow)
--
-- Adds operator_handled_at so a human marking a crisis flag "handled" in the
-- operator dashboard is tracked SEPARATELY from the automated follow-up
-- sequence (crisis_log.resolved, which the follow-up cron uses). A member can
-- be personally handled by the operator while gentle automated check-ins
-- continue — or not — without the two states colliding.
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

ALTER TABLE crisis_log ADD COLUMN IF NOT EXISTS operator_handled_at timestamptz;
ALTER TABLE crisis_log ADD COLUMN IF NOT EXISTS operator_note       text;

-- Fast "open queue" lookup: unhandled flags, newest first.
CREATE INDEX IF NOT EXISTS idx_crisis_log_open
  ON crisis_log (operator_handled_at, created_at DESC)
  WHERE operator_handled_at IS NULL;
