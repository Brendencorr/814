-- 100_rhythm_return_v1.sql
-- Rhythm & Return v1.1 (docs/08) + Clarity v2.3 return-cadence schema (docs/07 §2b, §12).
-- 100% additive + idempotent, same contract as 086: v1 keeps working, nothing member-visible
-- until surfaces ship. Specs: docs/07_CLARITY_SCORE_V2_SPEC.md · docs/08_RHYTHM_AND_RETURN_SPEC.md.

-- ── user_daily_state: engine-version stamping (07 §12 — the recalibration audit trail) ──
alter table public.user_daily_state
  add column if not exists clarity_version smallint;
-- Backfill: every pre-existing row was produced by the v1 engine.
update public.user_daily_state set clarity_version = 1 where clarity_version is null;

-- ── user_profiles: cadence + return state (08 §3, §6 · 07 §2b) ──────────────────────────
-- last_active_at already exists (017_engagement.sql).
alter table public.user_profiles
  add column if not exists personal_cadence   numeric default 1,      -- median inter-session gap, 28d (min 1, cap 7)
  add column if not exists location_city      text,                    -- opt-in, coarse (city) — warmth only, never scored
  add column if not exists location_opt_in    boolean not null default false,
  add column if not exists relight_until      date,                    -- rise-only display window after R3/R4 return (07 §2b)
  add column if not exists relight_mode       text,                    -- 'relight' (R3) | 'first_light_lite' (R4, tiny thresholds)
  add column if not exists direction_mute_until date,                  -- no trend narration until 14d of post-return data (08 §5)
  -- notification rhythm (08 §3): backoff ladder state — never louder, never fully dark
  add column if not exists nudge_interval_days numeric,                -- current interval; null = personal_cadence + 1
  add column if not exists nudge_unanswered    smallint not null default 0,
  add column if not exists last_nudge_at       timestamptz,
  add column if not exists last_nudge_opened_at timestamptz;

-- ── member_threads: what Riley is carrying for the member (08 §3b) ──────────────────────
-- Member-visible via Riley ("what are you carrying for me?") and deletable on request.
create table if not exists public.member_threads (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  kind                text not null check (kind in ('commitment','event','worry','goal','joy')),
  text                text not null,
  salience            smallint not null default 3,     -- 1-5
  surface_after       date,                            -- earliest app-day this may surface in a check-in
  status              text not null default 'open' check (status in ('open','closed','deleted')),
  surfaced_count      smallint not null default 0,     -- skipped thread resurfaces exactly ONCE, then rests (08 acc #11)
  source_conversation uuid,
  created_at          timestamptz not null default now(),
  closed_at           timestamptz
);
create index if not exists member_threads_user_open on public.member_threads (user_id, status, surface_after);

-- ── gap_summaries: return-sequence answers — CONTEXT, NEVER SCORES (08 §3b guardrail) ───
-- No trigger, no code path may write scored daily rows from these (schema-level acceptance #10).
create table if not exists public.gap_summaries (
  user_id     uuid not null,
  returned_on date not null,               -- app-day of the return
  gap_days    smallint not null,
  summary     text check (summary in ('rough','mixed','okay','good')),
  note        text,                        -- "anything I should know?" free text (also written to memory)
  created_at  timestamptz not null default now(),
  primary key (user_id, returned_on)
);

-- ── checkin_prompts: every rendered check-in is reproducible (07 §2c checkin_context) ───
create table if not exists public.checkin_prompts (
  user_id       uuid not null,
  app_day       date not null,
  return_tier   text,                      -- R0..R4 observed at render
  framing       jsonb,                     -- {field: template_id} — skin over the immutable spine
  dynamic_items jsonb,                     -- up to 2: [{text, source: thread|harddate|goal|program|context, template_id, thread_id?}]
  answered      jsonb,                     -- dynamic-slot answers (NEVER enter any dimension computation — 07 acc #33)
  checkin_context jsonb,                   -- template ids + slot values: full reproduction record (07 §2c)
  created_at    timestamptz not null default now(),
  primary key (user_id, app_day)
);

-- ── RLS: owner-scoped, same pattern as 086 ──────────────────────────────────────────────
alter table public.member_threads  enable row level security;
alter table public.gap_summaries   enable row level security;
alter table public.checkin_prompts enable row level security;
do $$ begin create policy mt_owner on public.member_threads  for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy gs_owner on public.gap_summaries   for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy cp_owner on public.checkin_prompts for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;

-- Security canon (CLAUDE.md): these are member-owned rows read/written via the member's own
-- JWT or the service key; RLS owner policies above are the gate. No public views added here.
