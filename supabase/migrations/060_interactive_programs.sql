-- ============================================================
-- 060_interactive_programs.sql — Interactive Riley-led programs: DATA LAYER (Phase 1)
--
-- Four interactive, Riley-LED programs (distinct from the self-guided ones):
--   Move Nourish · Living Forward (grief) · Building Happiness · Staying Free — $18.14 each, draft.
-- Commercial (LOCKED): Guide AND Companion buy at $18.14; included FREE in Coach ONLY; require an
-- active Riley-chat account. Seeded 'draft' — admin flips Live in the Programs tab when content loads.
--
-- Reconciled to THIS repo's real schema (the handoff's `v_user_effective_entitlements` = our real
-- `user_active_products` view; feature_map/notification_consents already exist). Run AFTER 059. Safe to re-run.
-- ============================================================

-- 1) products type constraint: add 'program_interactive'.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE products ADD CONSTRAINT products_type_check
  CHECK (type = ANY (ARRAY['free','subscription','program','bundle','program_interactive']));

-- 2) The 4 interactive products (draft; admin flips Live). price_cents + status NOT overwritten on conflict.
INSERT INTO products (product_key, display_name, type, price_cents, recurring, status, blurb, sort_order, visible_on_menu, implies_all_programs, tier_level) VALUES
 ('prog_int_move_nourish','Move Nourish','program_interactive',1814,false,'draft',
  'Riley-led body coaching: your plan, built with you, adapted weekly. Session Zero + 14 sessions. True accountability.',80,true,false,0),
 ('prog_int_grief','Living Forward','program_interactive',1814,false,'draft',
  'Riley-led grief companionship. Riley remembers your person, knows your dates, and walks the road with you. Session Zero + 14 sessions.',81,true,false,0),
 ('prog_int_happiness','Building Happiness','program_interactive',1814,false,'draft',
  'Riley-led positive psychology: evidence-based practices, tested on your life, kept only if they work for YOU. Session Zero + 14 sessions.',82,true,false,0),
 ('prog_int_staying_free','Staying Free','program_interactive',1814,false,'draft',
  'Riley-led staying-on-track coaching: know what knocks you off course, what gets you back, and who you''re becoming. Session Zero + 14 sessions.',83,true,false,0)
ON CONFLICT (product_key) DO UPDATE SET
  display_name=EXCLUDED.display_name, blurb=EXCLUDED.blurb, sort_order=EXCLUDED.sort_order, visible_on_menu=EXCLUDED.visible_on_menu;

-- 3) feature_map rows (4 interactive locked-upsell + family_portal coming-soon).
INSERT INTO feature_map (feature_key, required_any, unentitled_state) VALUES
 ('int_move_nourish',      ARRAY['prog_int_move_nourish','coach'],  'locked_upsell'),
 ('int_living_forward',    ARRAY['prog_int_grief','coach'],         'locked_upsell'),
 ('int_building_happiness',ARRAY['prog_int_happiness','coach'],     'locked_upsell'),
 ('int_staying_free',      ARRAY['prog_int_staying_free','coach'],  'locked_upsell'),
 ('family_portal',         ARRAY['coach'],                          'coming_soon')
ON CONFLICT (feature_key) DO UPDATE SET required_any=EXCLUDED.required_any, unentitled_state=EXCLUDED.unentitled_state;

-- 4) Entitlement view: implies_all_programs now covers program_interactive too, so COACH includes all
--    interactive programs. Guide/Companion use implies[] (specific self-guided) and NEVER gain interactive
--    via tier — only via direct purchase. (Only change vs 052: the type filter in the implies_all branch.)
CREATE OR REPLACE VIEW user_active_products AS
WITH active AS (
  SELECT user_id, product_key FROM entitlements
  WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
), expanded AS (
  SELECT user_id, product_key FROM active
  UNION
  SELECT a.user_id, p.product_key
    FROM active a
    JOIN products c ON c.product_key = a.product_key AND c.implies_all_programs = true
    JOIN products p ON p.type = ANY (ARRAY['program','program_interactive'])
  UNION
  SELECT a.user_id, unnest(c.implies)
    FROM active a
    JOIN products c ON c.product_key = a.product_key
   WHERE c.implies IS NOT NULL AND array_length(c.implies, 1) > 0
  UNION
  SELECT DISTINCT user_id, 'reset_free'::text FROM active
)
SELECT DISTINCT user_id, product_key FROM expanded;

-- 5) Session-engine tables (doc 00 §7). Content (int_sessions) is server-authored data, not code.
CREATE TABLE IF NOT EXISTS int_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_key    text NOT NULL,                       -- prog_int_*
  session_number smallint NOT NULL,                   -- 0..14 (0 = Session Zero / intake)
  phase          text,                                -- GROUND / PROTECT / ... (program-specific)
  title          text NOT NULL,
  open_template  text,                                -- OPEN copy (Riley opens from memory)
  learn_body     text,                                -- LEARN teaching
  work_spec      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- WORK exercise (artifact name + prompts)
  commit_options jsonb NOT NULL DEFAULT '[]'::jsonb,  -- COMMIT drafted options
  is_milestone   boolean NOT NULL DEFAULT false,      -- sessions 4/8/11/14
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_key, session_number)
);

CREATE TABLE IF NOT EXISTS int_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  program_key     text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  cadence_pref    text NOT NULL DEFAULT 'twice_weekly',    -- twice_weekly | weekly
  nudge_channels  text[] NOT NULL DEFAULT '{}',            -- popup / push / email
  state           text NOT NULL DEFAULT 'active',          -- active | maintenance | paused
  lapse_state     text,                                    -- null | lapse_active | recovering (Staying Free)
  current_session smallint NOT NULL DEFAULT 0,
  graduated_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, program_key)
);

CREATE TABLE IF NOT EXISTS int_session_progress (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  session_number smallint NOT NULL,
  completed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, session_number)
);

CREATE TABLE IF NOT EXISTS int_commitments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id   uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  session_number  smallint NOT NULL,
  text            text NOT NULL,
  due_at          timestamptz,
  confirmed_state text,                                -- null | done | partly | not_yet
  confirmed_at    timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_int_commit_due ON int_commitments (due_at) WHERE confirmed_state IS NULL;

CREATE TABLE IF NOT EXISTS int_artifacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  session_number smallint,
  name           text NOT NULL,
  body           text,
  version        smallint NOT NULL DEFAULT 1,
  pinned         boolean NOT NULL DEFAULT false,       -- "My Tools" shelf
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_int_artifacts_enr ON int_artifacts (enrollment_id);

CREATE TABLE IF NOT EXISTS int_nudges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  ladder_step   text NOT NULL,                         -- popup_dayof / push_2d / email_4d / email_10d
  channel       text NOT NULL,                         -- popup / push / email
  sent_at       timestamptz NOT NULL DEFAULT now(),
  sent_date     date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date)  -- 1/day cap key
);
CREATE INDEX IF NOT EXISTS idx_int_nudges_enr_day ON int_nudges (enrollment_id, sent_date);

-- Date-aware proactive layer (Living Forward + Staying Free). date_type: grief / risk / milestone.
CREATE TABLE IF NOT EXISTS int_dates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  label         text NOT NULL,
  date          date NOT NULL,
  date_type     text NOT NULL DEFAULT 'milestone',     -- grief | risk | milestone
  recurrence    text NOT NULL DEFAULT 'annual',        -- annual | once
  last_touch    date,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_int_dates_enr ON int_dates (enrollment_id);

-- Trigger map + trusted people (Staying Free).
CREATE TABLE IF NOT EXISTS int_triggers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  category      text NOT NULL,                          -- people | places | times | feelings
  label         text NOT NULL,
  intensity     smallint,
  notes         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS int_trusted_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES int_enrollments(id) ON DELETE CASCADE,
  name          text NOT NULL,
  relationship  text,
  contact       text,                                   -- optional, only with explicit consent
  consented     boolean NOT NULL DEFAULT false,
  guide_sent_at timestamptz,                            -- when the "What I Need You to Know" guide was sent
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 6) Founder canon copy — lapse_first_response ships as interim (verbatim, doc 07 §A) until Brenden's
--    version replaces it. author='interim' drives the admin "FOUNDER COPY PENDING" badge. Never overwrite a founder row.
CREATE TABLE IF NOT EXISTS canon_copy (
  key        text PRIMARY KEY,
  body       text NOT NULL,
  author     text NOT NULL DEFAULT 'interim',           -- interim | founder
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO canon_copy (key, body, author) VALUES
 ('lapse_first_response',
  $canon$Thank you for telling me. That took more courage than you're giving yourself credit for right now. Nothing you built is erased — every day you had still happened, and I'm still here. Tonight has one job: water, something to eat, sleep. Tomorrow, in daylight, we'll look at what happened together — no shame in this room, not now, not ever.$canon$,
  'interim')
ON CONFLICT (key) DO NOTHING;

-- 7) Family Portal demand-capture (coming soon — placeholder only).
CREATE TABLE IF NOT EXISTS feature_interest (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  feature_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature_key)
);

-- 8) RLS. Server-only content (RLS on, no policies → served by entitlement-gated functions):
ALTER TABLE int_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canon_copy   ENABLE ROW LEVEL SECURITY;

-- Member owns their own enrollment.
ALTER TABLE int_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS int_enr_own ON int_enrollments;
CREATE POLICY int_enr_own ON int_enrollments FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE feature_interest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fi_own ON feature_interest;
CREATE POLICY fi_own ON feature_interest FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Child tables: owned via the parent enrollment (a member touches only rows under their own enrollment).
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['int_session_progress','int_commitments','int_artifacts','int_nudges','int_dates','int_triggers','int_trusted_people'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_own ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_own ON %I FOR ALL TO authenticated '
      'USING (enrollment_id IN (SELECT id FROM int_enrollments WHERE user_id = auth.uid())) '
      'WITH CHECK (enrollment_id IN (SELECT id FROM int_enrollments WHERE user_id = auth.uid()))',
      t, t);
  END LOOP;
END
$rls$;
