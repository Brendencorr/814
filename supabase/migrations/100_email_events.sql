-- 100_email_events.sql - the UNIFIED send ledger every email-governance rule reads.
--
-- WHY: the send paths could not see each other. email_sends is the lifecycle dedup ledger,
-- email_log is the correspondence record, and briefs / crisis follow-ups / program nudges /
-- re-engagement each had their own private dedup - so "did we already email this member today,
-- across everything?" was unanswerable, and guide_1's "never more than one note a day" promise
-- was only enforced within one flow. email-send.js (the single choke point) now writes one row
-- here per attempt and reads ONLY this table for:
--   1. the GLOBAL daily cap over categories lifecycle / reengagement / program_nudge
--   2. logging crisis-window suppressions (the crisis check itself reads crisis_log)
-- Categories: transactional | crisis | brief | lifecycle | reengagement | program_nudge | operator.
-- brief, crisis, transactional and operator are exempt from the cap but still logged here.
--
-- PRIVACY: metadata only (recipient, template key, category, status, reason) - never the body.
-- SECURITY: RLS enabled, ZERO client policies - service-role only, per the migration 098 default
-- and the CLAUDE.md database-security rule.

create table if not exists public.email_events (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid,                        -- nullable: prospects (waitlist/story) have none
  to_email  text,
  template  text,                        -- template_key when known, else the caller's kind
  category  text not null check (category in
              ('transactional','crisis','brief','lifecycle','reengagement','program_nudge','operator')),
  status    text not null default 'sent' check (status in ('sent','failed','skipped','suppressed')),
  reason    text,                        -- suppression/failure reason (daily_cap, crisis_window, ...)
  sent_at   timestamptz not null default now()
);

comment on table public.email_events is
  'Unified per-attempt send ledger (metadata only, never body). Written and read by email-send.js: global daily cap + crisis-window suppression over lifecycle/reengagement/program_nudge.';

-- The cap query: (user_id, category, status, sent_at) - covered by this index.
create index if not exists idx_email_events_user_cat_sent
  on public.email_events (user_id, category, sent_at desc);

alter table public.email_events enable row level security;
revoke all on table public.email_events from anon, authenticated;
grant all privileges on table public.email_events to service_role, postgres;

-- email_sends.meta: evaluate-comms now dedups reset_daily PER RESET DAY (spec: each day's number
-- sends at most once, and a skipped day is never deferred) - the sent day number lives here.
alter table public.email_sends add column if not exists meta jsonb;

notify pgrst, 'reload schema';
