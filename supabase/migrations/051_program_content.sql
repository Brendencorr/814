-- ============================================================
-- 051_program_content.sql — Self-guided Program content model
--
-- The actual course content behind the à la carte "Program Add-ons" (Sobriety,
-- Grief & Life Transitions, Body Rebuild — and future Riley-guided programs).
-- Content is READ SERVER-SIDE ONLY (program-content.js verifies the caller owns
-- the program via entitlements before returning it) — these tables hold no member
-- data and must never be exposed to non-owners, so RLS is ON with no policies
-- (anon/authenticated get nothing; the service key bypasses RLS as usual).
-- Run AFTER 050. Safe to re-run.
-- ============================================================

-- The 14 modules per program: READ (lesson) -> DO (action) -> optional KEEP (a tool
-- kept forever). riley_layer renders only for Companion/Coach entitlements.
CREATE TABLE IF NOT EXISTS program_modules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_key    text NOT NULL,               -- matches products.product_key (prog_sobriety, prog_grief, prog_body, ...)
  module_number  smallint NOT NULL,           -- 1..14
  part_number    smallint,                    -- 1..4
  part_title     text,                        -- e.g. "UNDERSTAND IT"
  title          text NOT NULL,
  read_body      text NOT NULL,               -- the lesson (READ)
  do_body        text,                        -- the action (DO)
  keep_title     text,                        -- KEEP tool title (nullable — flagship-tool modules only)
  keep_body      text,                        -- KEEP tool content (nullable)
  riley_layer    text,                        -- Companion/Coach-only adaptation (nullable)
  safety_footer  text,                        -- per-module safety line
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_key, module_number)
);
CREATE INDEX IF NOT EXISTS idx_program_modules_key ON program_modules (program_key, module_number) WHERE is_active;

-- Body Rebuild's structured workouts (A/B/C + the 8-Minute Reset). Reused later by the
-- Coach Workout Engine; also surfaced in the reader's "My Tools" shelf.
CREATE TABLE IF NOT EXISTS workout_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_key      text NOT NULL,
  template_key     text NOT NULL,             -- 'workout_a','workout_b','workout_c','reset_8min'
  title            text NOT NULL,
  duration_minutes smallint,
  steps            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{label, detail}]
  notes            text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_key, template_key)
);

-- Body Rebuild's 28 meal concepts. Reused later by the Coach Nutrition Engine.
CREATE TABLE IF NOT EXISTS meal_concepts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_key   text NOT NULL,
  slot          text NOT NULL,                -- 'breakfast','lunch','dinner','snack'
  name          text NOT NULL,
  ingredients   text[] NOT NULL DEFAULT '{}',
  steps         text,
  minutes       smallint,
  sort_order    smallint DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meal_concepts_key ON meal_concepts (program_key, slot) WHERE is_active;

-- Per-module completion: a simple "done" tap. No streaks for standalone buyers
-- (the brief's promise) — this is a checklist only. One row per user+program+module.
CREATE TABLE IF NOT EXISTS program_module_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  program_key   text NOT NULL,
  module_number smallint NOT NULL,
  done_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, program_key, module_number)
);
CREATE INDEX IF NOT EXISTS idx_pmp_user ON program_module_progress (user_id, program_key);

-- Content tables: server-only. RLS ON + no policies = locked to anon/authenticated;
-- program-content.js (service key) gates on entitlement before returning content.
ALTER TABLE program_modules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_concepts     ENABLE ROW LEVEL SECURITY;

-- Progress: a member owns their own rows (client may read/write via RLS).
ALTER TABLE program_module_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pmp_own ON program_module_progress;
CREATE POLICY pmp_own ON program_module_progress
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
