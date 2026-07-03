-- ============================================================
-- 045_week_one_letter.sql — Doc 4: the Week One Letter (Day-7 Conversion Engine centerpiece).
--
-- One letter per user, generated ONCE server-side at Day-7 completion and stored here.
-- Re-opens render the stored body. The fixed P.S. is appended in code (never stored, never
-- generated) so it is byte-identical on every letter. `viewed_at`/`saved_at` gate the
-- one-per-user funnel events (week_one_letter_viewed / week_one_letter_saved).
--
-- Writes are SERVICE-KEY ONLY (week-one-letter.js) — no anon insert/update policy. Members
-- may read their own letter (it is their data, never gated later). Run AFTER 044. Safe to re-run.
-- ============================================================
CREATE TABLE IF NOT EXISTS week_one_letters (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  body         text NOT NULL,               -- letter body WITHOUT the P.S. (P.S. appended verbatim at read time)
  is_fallback  boolean NOT NULL DEFAULT false,
  model        text,
  input_hash   text,                        -- hash of the assembled inputs (audit/debug)
  generated_at timestamptz NOT NULL DEFAULT now(),
  viewed_at    timestamptz,                 -- first open → emits week_one_letter_viewed once
  saved_at     timestamptz                  -- first save → emits week_one_letter_saved once
);

ALTER TABLE week_one_letters ENABLE ROW LEVEL SECURITY;
-- Members can read their own letter; all writes go through the service key (no anon write policy).
DROP POLICY IF EXISTS "own week one letter" ON week_one_letters;
CREATE POLICY "own week one letter" ON week_one_letters
  FOR SELECT USING (auth.uid() = user_id);
