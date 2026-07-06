-- 047_onboarding_checkin_v2.sql
-- Schema for Onboarding & Daily Check-In v2 (July 2026 spec).
-- Additive + idempotent — safe to run alongside v1 (v1 ignores these columns).

-- ── user_profiles: v2 onboarding fields ──────────────────────────────────────
alter table public.user_profiles
  add column if not exists primary_focus      text,      -- the one thing we start with (human label)
  add column if not exists focus_lane         text,      -- sobriety | grief | body | other  (drives goal Q + resolver)
  add column if not exists secondary_focuses  jsonb,     -- everything else they chose, held for later
  add column if not exists motivation         text,      -- "two weeks from now" answer
  add column if not exists readiness          smallint,  -- 0-10 ruler (branch: <=4 reflection-first)
  add column if not exists confidence         smallint,  -- 0-10 ruler (branch: <=4 suppress streaks)
  add column if not exists note_storage_consent boolean default false, -- opt-in for storing free-text reflections
  add column if not exists support_preference  text,      -- self | reminders | weekly | outside (Reset Day 4)
  add column if not exists onboarding_version smallint default 1;

-- ── daily_checkins: v2 fields (mood/notes/daily_log already exist) ────────────
alter table public.daily_checkins
  add column if not exists secondary      jsonb,   -- {key,value}: time-aware secondary (sleep AM / stress midday / overall eve)
  add column if not exists goal_answer    text,    -- focus-keyed goal question answer (yes | hard_yes | slip | partly | not_yet)
  add column if not exists influences     jsonb,   -- optional tags array (categories only)
  add column if not exists recommendation text;    -- id of the "one thing back" card Riley surfaced

-- ── WHO-5 wellbeing baseline (0-25 raw; shown as change-vs-baseline, no single composite score) ──
create table if not exists public.who5_scores (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null,
  score    smallint,       -- 0-25 raw
  domains  jsonb,          -- per-item breakdown
  taken_at timestamptz not null default now()
);
create index if not exists who5_scores_user_idx on public.who5_scores(user_id, taken_at desc);

-- ── PHQ-2 / GAD-2 (consent-gated; emotional-focus users only; personalization, never diagnosis) ──
create table if not exists public.phq_gad_scores (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null,
  phq2      smallint,
  gad2      smallint,
  consented boolean not null default false,
  taken_at  timestamptz not null default now()
);
create index if not exists phq_gad_user_idx on public.phq_gad_scores(user_id, taken_at desc);

-- ── RLS: owner-only (service key bypasses; mirrors existing member tables) ────
alter table public.who5_scores    enable row level security;
alter table public.phq_gad_scores enable row level security;
do $$ begin
  create policy who5_owner on public.who5_scores for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy phqgad_owner on public.phq_gad_scores for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
