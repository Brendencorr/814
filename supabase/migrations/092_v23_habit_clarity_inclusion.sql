-- 092_v23_habit_clarity_inclusion.sql
-- Riley v2.3 B.2: per-habit "counts toward Clarity" inclusion. Additive + safe (default true = no
-- change to existing scoring). The Habits dim (Companion/full mode) computes over only included habits.

ALTER TABLE public.habits ADD COLUMN IF NOT EXISTS counts_toward_clarity boolean NOT NULL DEFAULT true;

-- Audit of inclusion changes (per B.2.1).
CREATE TABLE IF NOT EXISTS public.habit_scoring_changes (
  id          bigserial PRIMARY KEY,
  habit_id    uuid NOT NULL,
  user_id     uuid NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  old_value   boolean,
  new_value   boolean
);
ALTER TABLE public.habit_scoring_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own habit scoring changes" ON public.habit_scoring_changes;
CREATE POLICY "own habit scoring changes" ON public.habit_scoring_changes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_habit_scoring_changes_user ON public.habit_scoring_changes(user_id, changed_at DESC);
