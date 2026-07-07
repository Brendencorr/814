-- 075_email_log.sql — one record for EVERY client email we attempt.
--
-- WHY: emails were fired-and-forgotten across ~8 functions (welcome, briefs, program
-- nudges, re-engagement, crisis follow-up, waitlist, story) — each POSTed to Resend and
-- discarded the result, so "did we email this client / did it land?" was unanswerable.
-- This table is the single correspondence record; the shared email-send.js helper writes
-- one row per send by construction, so nothing can be forgotten.
--
-- PRIVACY: metadata only — recipient, subject line, kind, status, provider id/error.
-- NEVER the email body (crisis follow-ups etc. must not have content pooled here), matching
-- the operator trust boundary (operators see metadata, not content). Subjects are already
-- written to be non-sensitive on a lock screen.
--
-- SECURITY: RLS enabled with ZERO policies → anon + authenticated denied. Service role
-- (server functions) writes; the operator reads via the OPERATOR_KEY-gated
-- admin-correspondence.js endpoint. Distinct from lifecycle-comms' email_sends (that table
-- is a once-per-template DEDUP ledger with NOT NULL user_id/template_key/flow; this is the
-- general delivery log that also covers prospects and failures).

create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,                                   -- nullable: prospects (waitlist/story) have none
  to_email    text not null,
  kind        text not null default 'other',          -- welcome | brief | program_nudge | reengagement | crisis_followup | waitlist | story | story_alert | other
  subject     text,
  status      text not null default 'sent',           -- sent | failed | skipped
  provider    text not null default 'resend',
  provider_id text,                                    -- Resend message id on success
  error       text,                                    -- reason/detail on failure or skip
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.email_log is
  'Every client email attempt (metadata only, never body). Service-role writes via email-send.js; operator reads via admin-correspondence.js.';

create index if not exists idx_email_log_user    on public.email_log(user_id, created_at desc);
create index if not exists idx_email_log_to      on public.email_log(lower(to_email), created_at desc);
create index if not exists idx_email_log_created on public.email_log(created_at desc);

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
