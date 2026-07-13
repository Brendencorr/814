-- 086_clarity_v2_schema.sql
-- Clarity Score v2.2 — Phase A: the ENTIRE additive schema for the v2 engine.
-- 100% additive + idempotent. v1 columns/tables are untouched; v1 keeps working.
-- Nothing here is member-visible until the cutover flag flips (site_content clarity/engine).
-- Full spec: docs/CLARITY_SCORE_v2.2.md. Plan: .claude/plans/typed-foraging-seahorse.md.

-- ── daily_checkins: canonical v2 fields (§2) ─────────────────────────────────
alter table public.daily_checkins
  add column if not exists energy        smallint,   -- 1-5
  add column if not exists sleep_quality smallint,   -- 1-5
  add column if not exists heaviness     smallint,   -- 1-5 (always; was midday-only in the `secondary` blob)
  add column if not exists outside       boolean,    -- got-outside tap (Practice)
  add column if not exists connection    boolean,    -- talked-to-a-human tap (Practice)
  add column if not exists hard_day      boolean,    -- compassion flag (§9) — NEVER a score input
  add column if not exists craving       smallint;   -- 0-5, sobriety lane only

-- ── user_daily_state: v2 columns alongside v1 (v1 columns untouched) ─────────
alter table public.user_daily_state
  add column if not exists clarity_v2      smallint,
  add column if not exists clarity_v2_note text,
  add column if not exists provisional     boolean not null default false,
  add column if not exists clarity_core    smallint,
  add column if not exists f_score         smallint,
  add column if not exists p_score         smallint,
  add column if not exists d_score         smallint,
  add column if not exists v2_breakdown    jsonb,     -- per-dim P bands, conf weights, freshness
  add column if not exists config_version  smallint not null default 1,
  add column if not exists frozen          boolean not null default false,
  add column if not exists frozen_until    timestamptz,
  add column if not exists frozen_snapshot jsonb;     -- displayed + lane held during lapse-repair (§5)

-- ── user_clarity_config: per-member customization (§10 three-touch onboarding)
create table if not exists public.user_clarity_config (
  user_id          uuid primary key,
  config           jsonb not null default '{}'::jsonb,  -- enabled practice dims, fuel_opt_out, lane opt-ins
  config_version   smallint not null default 1,
  pending_config   jsonb,                                -- applies next app-day (4am rollover)
  pending_apply_on date,
  last_changed_at  timestamptz,                          -- enforces max 1 change / 7d (onboarding-origin exempt)
  onboarding_stage smallint not null default 0,          -- 0 none · 1 first-login card · 2 pane · 3 day-14 tune-up
  created_at       timestamptz not null default now()
);

-- ── user_dim_baselines: 28-day personal baseline B + asymmetric-ratchet state (§4)
create table if not exists public.user_dim_baselines (
  user_id                uuid not null,
  dim                    text not null,   -- movement|habits|reflection|program|outside|connection|<registry>
  baseline               real,            -- B (28-day)
  ema_up                 real,            -- ratchet state, alpha_up = 0.10
  ema_down               real,            -- ratchet state, alpha_down = 0.02
  first_light_started_on date,            -- days 1-14 rise-only window for THIS dim
  sample_days            smallint default 0,
  updated_at             timestamptz not null default now(),
  primary key (user_id, dim)
);

-- ── clarity_dims: registry-extensible dimension catalog (§11) — a row = a dim
create table if not exists public.clarity_dims (
  dim         text primary key,
  layer       text not null,             -- foundation | practice | direction
  label       text not null,
  scored      boolean not null default true,   -- grief dims: false (never scored)
  default_on  boolean not null default true,
  weight_hint real,
  created_at  timestamptz not null default now()
);

-- ── hard_dates: member-flagged hard days (§9) — widen bands, suppress negative narration
create table if not exists public.hard_dates (
  user_id    uuid not null,
  date       date not null,
  label      text,
  source     text,                        -- 'checkin_tap' | 'calendar' | 'auto'
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ── clarity_life_events: v2's OWN table (distinct from the existing life_events)
create table if not exists public.clarity_life_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null,             -- move|loss|job_change|... (band recalibration trigger)
  occurred_on date not null,
  recalibrate boolean not null default true,
  window_days smallint default 14,
  created_at  timestamptz not null default now()
);

-- ── clarity_weekly: Sunday perceived-direction + one-small-win (§2, Stage-1 validation)
create table if not exists public.clarity_weekly (
  user_id      uuid not null,
  week_of      date not null,             -- Sunday (member local)
  perceived    text,                      -- 'lighter' | 'same' | 'heavier'
  small_win    text,
  created_at   timestamptz not null default now(),
  primary key (user_id, week_of)
);

-- ── RLS: owner-only on member tables (service key bypasses for the engine) ───
alter table public.user_clarity_config enable row level security;
alter table public.user_dim_baselines  enable row level security;
alter table public.hard_dates           enable row level security;
alter table public.clarity_life_events  enable row level security;
alter table public.clarity_weekly        enable row level security;
do $$ begin create policy ucc_owner on public.user_clarity_config for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy udb_owner on public.user_dim_baselines  for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy hd_owner  on public.hard_dates          for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy cle_owner on public.clarity_life_events for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;
do $$ begin create policy cw_owner  on public.clarity_weekly       for all using (auth.uid()=user_id) with check (auth.uid()=user_id); exception when duplicate_object then null; end $$;

-- clarity_dims: public read (it's a registry), no client writes (service key only)
alter table public.clarity_dims enable row level security;
do $$ begin create policy clarity_dims_read on public.clarity_dims for select to anon, authenticated using (true); exception when duplicate_object then null; end $$;

create index if not exists udb_user_idx on public.user_dim_baselines(user_id);
create index if not exists hard_dates_user_idx on public.hard_dates(user_id, date desc);
create index if not exists cle_user_idx on public.clarity_life_events(user_id, occurred_on desc);

-- ── Seed: the dimension registry (Foundation fixed; Practice defaults on) ────
insert into public.clarity_dims(dim, layer, label, scored, default_on, weight_hint) values
  ('steadiness','foundation','how you''re feeling', true, true, 16),
  ('rest','foundation','sleep', true, true, 14),
  ('fuel','foundation','nourishment', true, true, 10),
  ('movement','practice','movement', true, true, null),
  ('habits','practice','your habits', true, true, null),
  ('reflection','practice','reflection', true, true, null),
  ('program','practice','your program', true, false, null),
  ('outside','practice','getting outside', true, false, null),
  ('connection','practice','staying connected', true, false, null)
on conflict (dim) do nothing;

-- ── Seed: the engine cutover flag (starts on v1; DARK until flipped) ─────────
-- site_content.kind CHECK allows text|image|section; use 'text' for this config row.
insert into public.site_content(page, key, kind, props)
values ('clarity', 'engine', 'text', '{"engine":"v1","onboarding":false}'::jsonb)
on conflict (page, key) do nothing;
