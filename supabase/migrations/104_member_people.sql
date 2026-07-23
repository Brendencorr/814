-- 104: member_people - the structured people graph behind "People Who Matter".
-- Fed by the chat memory-extraction pass (name/role/sentiment + mention recency) so Riley
-- can ask about a member's people BY NAME at the right cadence. life_map relationship chips
-- stay as the member-facing UI; this table is the richer machine-readable layer.
-- Member-owned data → owner RLS (same pattern as life_map / hard_dates).

create table if not exists public.member_people (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  role              text,                      -- "his sponsor", "her daughter"
  sentiment         text,                      -- warm | strained | complicated (null = unknown)
  notes             text,
  mention_count     int not null default 1,
  last_mentioned_at timestamptz not null default now(),
  is_active         boolean not null default true,
  source            text not null default 'conversation',
  created_at        timestamptz not null default now()
);

create unique index if not exists member_people_user_name on public.member_people (user_id, lower(name));
create index if not exists member_people_user_idx on public.member_people (user_id, last_mentioned_at desc);

alter table public.member_people enable row level security;
do $$ begin
  create policy mp_owner on public.member_people
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
