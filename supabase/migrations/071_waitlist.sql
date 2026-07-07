-- 071_waitlist.sql — Task 7: durable, deduped waitlist (was events-only).
-- Inserts happen via the waitlist-join Netlify function (service role, bypasses RLS).
-- APPLIED live via Supabase MCP (migrations: waitlist, waitlist_email_unique).

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  plan_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Plain unique index on email so PostgREST upsert (onConflict=email) works; the function
-- always lowercases the email before insert, so this is an effective case-insensitive dedup.
create unique index if not exists idx_waitlist_email on public.waitlist (email);

grant all privileges on table public.waitlist to service_role, postgres;
notify pgrst, 'reload schema';
