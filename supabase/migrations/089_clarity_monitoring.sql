-- 089_clarity_monitoring.sql
-- Clarity Score v2.2 — Phase D monitoring. Stores each drift-cron run's distribution stats
-- + validation correlations (WHO-5, perceived-direction) so we can watch the v2 engine over
-- time and catch drift before/after cutover. Service-writes only; operator reads via service
-- key. Additive + idempotent.

create table if not exists public.clarity_monitoring (
  id          uuid primary key default gen_random_uuid(),
  run_on      date not null,
  window_days smallint not null default 90,
  metrics     jsonb not null,          -- {n, mean, p10/50/90, provisional_rate, frozen_rate, F/P/D means, who5_r, perceived_agreement, drift_flags}
  created_at  timestamptz not null default now()
);

alter table public.clarity_monitoring enable row level security;  -- no anon/auth policy = service-role only
create index if not exists clarity_monitoring_run_idx on public.clarity_monitoring(run_on desc);
