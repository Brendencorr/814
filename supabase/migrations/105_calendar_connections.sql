-- 105: Calendar Phase 2 - read-only Google Calendar connections (handoff §2.3).
-- SERVICE-ROLE ONLY tables: RLS enabled with NO member policies; members act through
-- the calendar-connect / calendar-disconnect functions. Per the house security law,
-- explicitly revoke anon + authenticated so nothing in public is client-reachable.

create table if not exists calendar_connections (
  member_id uuid primary key references user_profiles(id) on delete cascade,
  provider text not null default 'google',
  refresh_token_enc text not null,   -- AES-256-GCM blob; key lives in Netlify env CAL_TOKEN_KEY
  granted_scopes text not null,
  connected_at timestamptz not null default now()
);
alter table calendar_connections enable row level security;
revoke all on calendar_connections from anon, authenticated;

-- Short-lived digest cache (<= 15 minutes). NEVER stores raw event payloads -
-- only the reduced digest {count, first_start, last_end, blocks[{start,end,label<=40}]}.
create table if not exists calendar_digest_cache (
  member_id uuid primary key,
  digest jsonb not null,
  expires_at timestamptz not null
);
alter table calendar_digest_cache enable row level security;
revoke all on calendar_digest_cache from anon, authenticated;
