-- ── User profiles ──────────────────────────────────────────────────────────
create table if not exists user_profiles (
  id                  uuid references auth.users primary key,
  email               text unique,
  full_name           text,
  avatar_url          text,
  sobriety_date       date,
  programs_purchased  text[] default '{}',
  community_member    boolean default false,
  created_at          timestamp default now(),
  updated_at          timestamp default now()
);

alter table user_profiles enable row level security;

drop policy if exists "Users can view own profile"   on user_profiles;
drop policy if exists "Users can insert own profile" on user_profiles;
drop policy if exists "Users can update own profile" on user_profiles;

create policy "Users can view own profile"
  on user_profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on user_profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on user_profiles for update
  using (auth.uid() = id);

-- ── Riley conversation history ───────────────────────────────────────────────
create table if not exists riley_conversations (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users,
  session_id  text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  created_at  timestamp default now()
);

alter table riley_conversations enable row level security;

drop policy if exists "Users can view own conversations"   on riley_conversations;
drop policy if exists "Users can insert own conversations" on riley_conversations;

create policy "Users can view own conversations"
  on riley_conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert own conversations"
  on riley_conversations for insert
  with check (auth.uid() = user_id);

-- Index for fast session lookups
create index if not exists riley_conversations_user_session_idx
  on riley_conversations (user_id, session_id, created_at desc);

-- ── User program progress ────────────────────────────────────────────────────
create table if not exists user_program_progress (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users,
  program_name   text not null,
  day_completed  integer default 0,
  started_at     timestamp default now(),
  last_activity  timestamp default now()
);

alter table user_program_progress enable row level security;

drop policy if exists "Users can view own progress"   on user_program_progress;
drop policy if exists "Users can insert own progress" on user_program_progress;
drop policy if exists "Users can update own progress" on user_program_progress;

create policy "Users can view own progress"
  on user_program_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert own progress"
  on user_program_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update own progress"
  on user_program_progress for update
  using (auth.uid() = user_id);

-- ── Auto-update updated_at on user_profiles ──────────────────────────────────
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on user_profiles;

create trigger user_profiles_updated_at
  before update on user_profiles
  for each row execute procedure update_updated_at_column();
