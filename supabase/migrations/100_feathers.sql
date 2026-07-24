-- 100_feathers.sql - feather keepsakes (founder decision, 2026-07-23)
--
-- A feather marks a MOMENT: a win Riley noticed, a program step, a Reset day,
-- showing up for a check-in. NEVER logins, NEVER streaks ("not because anyone
-- is keeping score" - the collection only ever grows; nothing here expires,
-- resets, or decrements).
--
-- Visibility: the member (RLS, own rows only) and the operator (service key).
-- Never other members. Writes are SERVER-ONLY via the service key - there are
-- deliberately no insert/update/delete policies for client roles.

create table if not exists public.feathers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,             -- showed_up | reset_day | reset_complete | program_step | win
  ref text not null default '',   -- idempotency key within kind (member-day, module, content slug)
  moment text,                    -- the human line shown in the member's keepsake view
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);

create index if not exists idx_feathers_user on public.feathers (user_id, created_at desc);

alter table public.feathers enable row level security;
create policy feathers_member_read on public.feathers
  for select to authenticated using (auth.uid() = user_id);

-- Standing DB-security rule (CLAUDE.md): explicit grants in the same migration.
grant select on public.feathers to authenticated;
revoke all on public.feathers from anon;
