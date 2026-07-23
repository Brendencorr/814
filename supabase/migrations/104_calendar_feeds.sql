-- 104: Calendar Phase 1 - private ICS feed tokens (CALENDAR_INTEGRATION handoff §1.1).
-- The handoff SQL references profiles(id); this repo's member table is user_profiles
-- (observed reality beats the document). One ACTIVE row per member by convention:
-- "Regenerate link" = stamp revoked_at on the old row, insert a fresh one.

create table if not exists calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references user_profiles(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  include_milestones boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table calendar_feeds enable row level security;

-- Members manage their own feed row from the app (create, read the token, toggle
-- milestones, revoke). The ICS endpoint itself reads with the SERVICE key.
drop policy if exists "own feed" on calendar_feeds;
create policy "own feed" on calendar_feeds for all
  using (auth.uid() = member_id) with check (auth.uid() = member_id);

create index if not exists calendar_feeds_token_active
  on calendar_feeds (token) where revoked_at is null;

-- anon must never touch feed tokens; authenticated is constrained by RLS above.
revoke all on calendar_feeds from anon;
