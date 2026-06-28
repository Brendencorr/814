-- ============================================================
-- The 8:14 Project — Migration for client dashboard tables
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── fitness_logs ─────────────────────────────────────────────
create table if not exists fitness_logs (
  id               uuid        default gen_random_uuid() primary key,
  user_id          uuid        not null references auth.users(id) on delete cascade,
  logged_date      date        not null default current_date,
  activity_type    text        not null,   -- 'Run','Lift','Bike','Walk','Swim','Other'
  duration_minutes integer,
  distance_miles   numeric(6,2),
  notes            text,
  created_at       timestamptz default now()
);

alter table fitness_logs enable row level security;

create policy "Users manage own fitness logs" on fitness_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_fitness_logs_user_date
  on fitness_logs (user_id, logged_date desc);

-- ── nutrition_logs ───────────────────────────────────────────
create table if not exists nutrition_logs (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  logged_date date        not null default current_date,
  label       text,                   -- meal name / description
  calories    integer,
  protein_g   integer,
  carbs_g     integer,
  fat_g       integer,
  notes       text,
  created_at  timestamptz default now()
);

alter table nutrition_logs enable row level security;

create policy "Users manage own nutrition logs" on nutrition_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_nutrition_logs_user_date
  on nutrition_logs (user_id, logged_date desc);

-- ── sobriety_checkins ────────────────────────────────────────
create table if not exists sobriety_checkins (
  id             uuid        default gen_random_uuid() primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  check_in_date  date        not null default current_date,
  created_at     timestamptz default now(),
  unique (user_id, check_in_date)
);

alter table sobriety_checkins enable row level security;

create policy "Users manage own checkins" on sobriety_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_sobriety_checkins_user_date
  on sobriety_checkins (user_id, check_in_date desc);

-- ── Existing tables: ensure RLS is on ───────────────────────
-- (Skip if already configured)
-- alter table riley_conversations enable row level security;
-- create policy "Users manage own conversations" on riley_conversations
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- alter table user_program_progress enable row level security;
-- create policy "Users manage own progress" on user_program_progress
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
