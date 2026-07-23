-- 105: progress_mirrors - the "distance traveled" notes (memory/recall upgrade #4).
-- A weekly cron (progress-mirror-cron.js) writes at most one Never-Say-safe then-vs-now
-- reflection per member per ~28 days; riley-chat surfaces each note ONCE, on a calm day only.
-- SERVER-ONLY (house security canon): written by cron, read by riley-chat via service key -
-- no client ever reads it directly, so anon/authenticated are revoked in the same migration.

create table if not exists public.progress_mirrors (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  note         text not null,
  period_start date,
  period_end   date,
  shown_at     timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists progress_mirrors_user_idx on public.progress_mirrors (user_id, created_at desc);

alter table public.progress_mirrors enable row level security;
revoke all on table public.progress_mirrors from anon, authenticated;
grant all privileges on table public.progress_mirrors to service_role, postgres;

notify pgrst, 'reload schema';
