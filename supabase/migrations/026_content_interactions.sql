-- ============================================================
-- 026_content_interactions.sql
-- The 8:14 Project — State Engine Phase 3 (§7 Content Completion + §7.1 Feedback)
--
-- Every piece of content a member interacts with is tracked here — the status
-- set (§7) and the structured feedback (§7.1). This is what feeds Riley's future
-- recommendations: without it, a card's "recommended_reason" has nothing real to
-- draw from. recommendation_history (reactions) still drives novelty in
-- riley-brain; this is the richer completion + feedback record on top.
--
-- Run in: Supabase → SQL Editor. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS content_interactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  content_id   text,          -- content_library id, card_id, or module_key
  content_type text,
  status       text,          -- started | completed | skipped | saved | disliked | recommended_again
  feedback     text,          -- helpful | not_helpful | wrong_timing | too_intense | more_like_this | dont_show
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_interactions_user ON content_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_interactions_content ON content_interactions (content_id);

ALTER TABLE content_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own interactions"   ON content_interactions;
DROP POLICY IF EXISTS "Users can insert own interactions" ON content_interactions;
CREATE POLICY "Users can view own interactions"   ON content_interactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own interactions" ON content_interactions FOR INSERT WITH CHECK (auth.uid() = user_id);
