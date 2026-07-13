-- 090_crisis_log_anon.sql
-- H-3 compliance fix: make ANONYMOUS crises visible to the safety system.
-- An anonymous visitor (no account) can hit a Level 2/3 crisis. The deterministic 988
-- response already fires for them - but logCrisis() early-returned without a user_id, so
-- there was NO crisis_log row and NO operator alert for the exact population most likely to
-- be testing whether Riley is safe. This also matters for the incident-record expectations
-- in the Oregon-style reporting laws taking effect in 2027.
--
-- Fix: allow crisis_log rows keyed to the same anon_id / ip_hash already computed for the
-- rate caps - never to identity. Service-key write only; RLS still blocks all client reads.

alter table public.crisis_log alter column user_id drop not null;
alter table public.crisis_log add column if not exists anon_id text;
alter table public.crisis_log add column if not exists ip_hash text;

-- Every row must be attributable to SOMETHING - a member (user_id) or an anonymous key.
alter table public.crisis_log drop constraint if exists crisis_log_subject_present;
alter table public.crisis_log add constraint crisis_log_subject_present
  check (user_id is not null or anon_id is not null or ip_hash is not null);

comment on column public.crisis_log.anon_id is
  'H-3: anonymous-visitor key (localStorage UUID, or ip-<hash> fallback) when user_id is null. Never identity.';
comment on column public.crisis_log.ip_hash is
  'H-3: FNV-32a hash of the client IP for an anonymous crisis. Never the raw IP.';
