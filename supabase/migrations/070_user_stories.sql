-- 070_user_stories.sql — Task 6 / Decision #14: public "Share your story" submissions.
-- Inserts happen ONLY via the story-submit Netlify function (service role, bypasses RLS).
-- RLS enabled + NO policies = deny-all for anon/authenticated, so direct client inserts are blocked.
-- APPLIED live via Supabase MCP (migration name: user_stories).

create table if not exists public.user_stories (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  story text not null,
  consent boolean not null default false,
  status text not null default 'submitted'
    check (status in ('submitted','reviewed','consented','published','rejected')),
  source text,
  created_at timestamptz not null default now()
);

alter table public.user_stories enable row level security;

create index if not exists idx_user_stories_status_created
  on public.user_stories (status, created_at desc);

grant all privileges on table public.user_stories to service_role, postgres;
notify pgrst, 'reload schema';
