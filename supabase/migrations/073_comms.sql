-- 073_comms.sql — Lifecycle Communications (handoff Task 2). Backend-only: RLS enabled, NO client
-- policies (service-role only). Renumbered from the handoff's "005" to fit repo sequence.
-- APPLIED live via Supabase MCP (migration: comms_lifecycle).
-- Uniqueness rule (each non-reset_daily template sends at most ONCE per user, ever) is enforced in
-- the evaluate-comms function code, NOT a DB constraint.

create table if not exists public.user_comms_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  door text,
  signup_at timestamptz not null default now(),
  last_login_at timestamptz,
  last_riley_message_at timestamptz,
  reset_started boolean not null default false,
  reset_day smallint not null default 0,
  reset_completed_at timestamptz,
  visited_about boolean not null default false,
  push_opted_in boolean not null default false,
  plan text not null default 'guide',
  subscription_started_at timestamptz,
  ladder_position smallint not null default 0,
  lapse_repair boolean not null default false,
  monthly_letter_optin boolean not null default false,
  unsubscribed_lifecycle boolean not null default false,
  timezone text,
  anchor_hour smallint,
  updated_at timestamptz not null default now()
);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_key text not null,
  flow text not null,
  sent_at timestamptz not null default now(),
  resend_id text,
  suppressed boolean not null default false,
  suppression_reason text
);

alter table public.user_comms_state enable row level security;
alter table public.email_sends enable row level security;

create index if not exists idx_email_sends_user_sent on public.email_sends (user_id, sent_at desc);
create index if not exists idx_email_sends_user_tmpl on public.email_sends (user_id, template_key);
create index if not exists idx_ucs_last_login on public.user_comms_state (last_login_at);
create index if not exists idx_ucs_ladder on public.user_comms_state (ladder_position);

grant all privileges on table public.user_comms_state to service_role, postgres;
grant all privileges on table public.email_sends to service_role, postgres;
notify pgrst, 'reload schema';
