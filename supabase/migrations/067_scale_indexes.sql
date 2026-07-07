-- ============================================================
-- 067_scale_indexes.sql — hot-path indexes for scale (from the 2026-07 performance audit)
--
-- Supabase's performance advisor flagged these foreign keys as lacking a covering index. At a few
-- users it's invisible; at thousands it's a sequential scan on every read. All are plain btree adds
-- (non-breaking, safe to re-run):
--
-- 1. int_commitments.enrollment_id — HOT. Read on every session/map load (int-session buildState),
--    the OPEN-from-memory prior-commitment lookup (riley-chat loadSessionContext), the proactive cron,
--    and every confirm. This is the one that matters most.
-- 2/3. int_triggers / int_trusted_people.enrollment_id — low traffic (Staying Free only) but same shape.
-- 4. user_program_progress.user_id — PRE-EXISTING gap; read on every Riley chat message (getClientData).
--    Adding it speeds up the single busiest function in the app.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_int_commit_enr    ON int_commitments (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_int_triggers_enr  ON int_triggers (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_int_trusted_enr   ON int_trusted_people (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_upp_user          ON user_program_progress (user_id);
