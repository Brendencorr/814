-- 093_crisis_log_is_test.sql
-- Riley v2.3 Batch 0.1: mark synthetic crisis-pipeline self-test events so they are excluded from the
-- real operator safety queue and analytics. Default false = existing + real events are unaffected.
ALTER TABLE public.crisis_log ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
