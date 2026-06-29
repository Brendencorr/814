-- ============================================================
-- 012_life_events.sql
-- The 8:14 Project — Life Events Engine + Emotional Calendar
-- Sprint 1 / Sprint 4 foundation
-- Run in: Supabase → SQL Editor. Safe to re-run.
--
-- SCALE NOTE (5,000 users / 1 year):
--   life_events: ~5-20 per user = 25K-100K rows
--   important_dates: ~5-10 per user = 25K-50K rows
--   Both indexed by user_id; important_dates also indexed by (month, day)
--   so the daily "is today sensitive for anyone" check is fast.
-- ============================================================

-- ─── LIFE EVENTS ────────────────────────────────────────────
-- Major things happening in someone's life that should shape Riley's approach.
CREATE TABLE IF NOT EXISTS life_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type           text NOT NULL,          -- loss, divorce, new_job, job_loss, moving, health_issue, retirement, parenthood, breakup, recovery_milestone, vacation, returning, other
  event_date           date,
  emotional_weight     smallint DEFAULT 3,     -- 1 (light) - 5 (heavy)
  notes                text,
  active_support_needed boolean NOT NULL DEFAULT true,
  riley_strategy       text,                   -- how Riley should hold this
  resolved_at          timestamptz,            -- when the active-support window closed
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_life_events_user        ON life_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_life_events_active      ON life_events(user_id) WHERE active_support_needed = true;

ALTER TABLE life_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own life events" ON life_events;
CREATE POLICY "Users manage own life events" ON life_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── IMPORTANT DATES (Emotional Calendar) ───────────────────
-- Recurring dates that carry emotional weight for a specific person.
-- Stored as month+day so recurrence is trivial and indexable.
CREATE TABLE IF NOT EXISTS important_dates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label             text NOT NULL,             -- "Mom's birthday", "Sobriety anniversary"
  date_type         text NOT NULL,             -- birthday, anniversary, loss, sobriety, divorce, holiday, custom
  event_month       smallint NOT NULL CHECK (event_month BETWEEN 1 AND 12),
  event_day         smallint NOT NULL CHECK (event_day BETWEEN 1 AND 31),
  event_year        smallint,                  -- original year, optional (for "X years ago")
  emotional_weight  smallint DEFAULT 3,        -- 1-5
  is_sensitive      boolean NOT NULL DEFAULT false,  -- if true, soften celebratory language platform-wide
  riley_strategy    text,                      -- how to approach this date
  recurring         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_important_dates_user      ON important_dates(user_id);
-- The daily check: "does today (month/day) match anything for this user?"
CREATE INDEX IF NOT EXISTS idx_important_dates_md        ON important_dates(event_month, event_day);
CREATE INDEX IF NOT EXISTS idx_important_dates_user_md   ON important_dates(user_id, event_month, event_day);

ALTER TABLE important_dates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own important dates" ON important_dates;
CREATE POLICY "Users manage own important dates" ON important_dates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── SHARED EMOTIONAL CALENDAR (global holidays) ────────────
-- Holidays that carry weight for many people. Riley softens around these.
-- Shared config, read by all. Admin-managed.
CREATE TABLE IF NOT EXISTS emotional_calendar (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label             text NOT NULL,
  event_month       smallint NOT NULL CHECK (event_month BETWEEN 1 AND 12),
  event_day         smallint,                  -- null for floating holidays (handled in code)
  is_sensitive      boolean NOT NULL DEFAULT true,
  riley_strategy    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emotional_cal_md ON emotional_calendar(event_month, event_day);

ALTER TABLE emotional_calendar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Emotional calendar is public read" ON emotional_calendar;
CREATE POLICY "Emotional calendar is public read" ON emotional_calendar
  FOR SELECT USING (true);

-- Seed the common emotionally-heavy dates (fixed-date ones).
INSERT INTO emotional_calendar (label, event_month, event_day, is_sensitive, riley_strategy)
VALUES
  ('New Year''s Eve',   12, 31, true, 'Reflection over resolution. Some find this date heavy. Offer presence, not pressure.'),
  ('New Year''s Day',    1,  1, true, 'A fresh page, gently. No hustle. Honor where they actually are.'),
  ('Valentine''s Day',   2, 14, true, 'Can be lonely. Lead with self-kindness, not romance assumptions.'),
  ('Christmas Eve',     12, 24, true, 'Family and loss live close together here. Soften. Offer community.'),
  ('Christmas Day',     12, 25, true, 'Joyful for some, hard for others. Never assume. Quiet support available.'),
  ('Thanksgiving (US)', 11, 27, true, 'Gratitude and grief both surface. Hold space for both.')
ON CONFLICT DO NOTHING;
