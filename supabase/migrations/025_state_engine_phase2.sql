-- ============================================================
-- 025_state_engine_phase2.sql
-- The 8:14 Project — State Engine Phase 2 (visible clarity + ranking inputs)
--
-- clarity_note stores the most recent "why did this change?" explainer so the
-- dashboard can show it without recomputing. Set by the State Engine on each
-- Tier 1 event (null when the move wasn't worth narrating).
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

ALTER TABLE user_daily_state ADD COLUMN IF NOT EXISTS clarity_note text;
