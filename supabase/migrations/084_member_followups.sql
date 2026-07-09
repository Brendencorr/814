-- 084: member_followups - date-triggered "open loop" follow-ups so Riley can ask
-- "how did Thursday go?" AFTER the fact. Kept SEPARATE from riley_memory (durable facts)
-- so the reconcile / decay / embedding logic never touches these time-bound, resolvable items.
--
-- Lifecycle: extractMemories (riley-chat) captures {content, due_at} -> status 'open'.
-- getClientData surfaces open rows whose due_at <= today into Riley's prompt, then marks them
-- 'surfaced' so Riley asks ONCE (not every session). Erased on account deletion via
-- ACCOUNT_DELETE_TABLES (no auth.users FK, matching the rest of the schema).
create table if not exists public.member_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  content text not null,
  due_at date not null,
  status text not null default 'open',        -- open | surfaced | resolved
  source text default 'conversation',
  surfaced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists member_followups_due_idx on public.member_followups (user_id, status, due_at);
-- Riley-internal only: service-role functions read/write; no client/anon access needed.
alter table public.member_followups enable row level security;
