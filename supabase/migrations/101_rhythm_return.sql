-- 101_rhythm_return.sql - Rhythm & Return v1.1 (docs/08) + Clarity v2.3 additions (docs/07 §2b-2c).
-- Additive only; every new surface is DARK until RHYTHM_ENABLED=true in Netlify env.
--
-- SPEC DELTA (recorded, not silent): Doc 08 §6 says `ALTER TABLE users` - this repo keys all member
-- state to public.user_profiles (auth.users is Supabase-managed), and user_profiles.last_active_at
-- already exists (reengagement-cron reads it). Columns land on user_profiles.
--
-- SECURITY: per CLAUDE.md, every new table is RLS-enabled with ZERO client policies (service-role
-- only) and explicitly revoked from anon/authenticated. Threads are member-visible THROUGH Riley
-- (server-mediated), never via direct PostgREST reads.

-- ── Cadence + return state on the member profile ──────────────────────────────────────────────
alter table public.user_profiles
  add column if not exists last_active_at   timestamptz,          -- kept for env parity; already live
  add column if not exists personal_cadence numeric default 1,    -- median inter-session gap, 28d (min 1, cap 7)
  add column if not exists location_city    text,                 -- opt-in, coarse, warmth only
  add column if not exists location_opt_in  boolean not null default false,
  add column if not exists relight_until    date,                 -- rise-only display window (07 §2b)
  add column if not exists relight_tier     text,                 -- R3|R4 - R4 adds First-Light-lite thresholds (08 §5)
  add column if not exists direction_suppressed_until date,       -- no trend talk on gaps (08 §5)
  add column if not exists nudge_unanswered smallint not null default 0,  -- backoff ladder state (08 §3)
  add column if not exists next_nudge_after timestamptz;          -- earliest next nudge per the ladder

-- ── Reproducible dynamic check-ins (07 §2c): template ids + slot values per rendered check-in ──
alter table public.daily_checkins
  add column if not exists checkin_context jsonb;

-- ── The continuity loop (08 §3b) ──────────────────────────────────────────────────────────────
create table if not exists public.member_threads (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  kind                text not null check (kind in ('commitment','event','worry','goal','joy')),
  text                text not null,
  salience            int not null default 1,
  surface_after       date,
  status              text not null default 'open' check (status in ('open','closed','deleted')),
  surfaced_count      int not null default 0,      -- skipped threads resurface once, then rest (08 §3b)
  source_conversation uuid,
  created_at          timestamptz not null default now(),
  closed_at           timestamptz
);
create index if not exists idx_member_threads_due on public.member_threads (user_id, status, surface_after);

create table if not exists public.gap_summaries (
  user_id     uuid not null references auth.users(id) on delete cascade,
  returned_on date not null,
  gap_days    int,
  summary     text check (summary in ('rough','mixed','okay','good')),
  note        text,
  primary key (user_id, returned_on)
);
comment on table public.gap_summaries is
  'Return-sequence answers: context for Riley''s narration ONLY. Never creates or modifies scored daily rows (08 §3b guardrail).';

create table if not exists public.checkin_prompts (
  user_id       uuid not null references auth.users(id) on delete cascade,
  app_day       date not null,
  framing       jsonb,          -- template ids + slot values (reproducibility, 07 §2c)
  dynamic_items jsonb,          -- up to 2: {text, source: thread|harddate|goal|program|context, thread_id?}
  answered      jsonb,
  created_at    timestamptz not null default now(),
  primary key (user_id, app_day)
);

-- ── Context inputs, never scored (07 §2c) ─────────────────────────────────────────────────────
-- SPEC DELTA (observed reality beats the document): hard_dates and life_events ALREADY EXIST in
-- production with different shapes - hard_dates(user_id,date,label,source,created_at) is read by
-- clarity-v2-write, and life_events(event_type,event_date,emotional_weight,...) feeds riley-brain /
-- daily-brief / riley-chat. Recalibration ALSO already exists via clarity_life_events(recalibrate).
-- So: hard_dates gains ONLY the additive `recurrence` column the check-in's proximity math needs;
-- life_events is left untouched (the spec's recalibration flag is clarity_life_events.recalibrate).
alter table public.hard_dates
  add column if not exists recurrence text not null default 'annual';
create index if not exists idx_hard_dates_user on public.hard_dates (user_id, date);

-- ── Lockdown (service-role only; house rule) ──────────────────────────────────────────────────
alter table public.member_threads  enable row level security;
alter table public.gap_summaries   enable row level security;
alter table public.checkin_prompts enable row level security;
revoke all on table public.member_threads, public.gap_summaries, public.checkin_prompts
  from anon, authenticated;
grant all privileges on table public.member_threads, public.gap_summaries, public.checkin_prompts
  to service_role, postgres;

notify pgrst, 'reload schema';
