-- 037_content_library_alerts.sql
-- Content Library upgrade: agent suggestions + member-facing alerts.
-- Applied live via the Supabase MCP on 2026-07-02; this file mirrors it for history.
--
-- NOTE: tables created outside the normal dashboard flow need explicit grants or
-- the service_role key hits "permission denied" (42501) and functions silently
-- return empty. The grants at the bottom are REQUIRED — do not drop them.

-- ── 1. content_library: agent-suggestion metadata ────────────────────────────
alter table public.content_library
  add column if not exists source            text not null default 'operator',
  add column if not exists suggestion_reason text,
  add column if not exists suggested_at      timestamptz;

comment on column public.content_library.source is 'operator | agent — who created the row';
comment on column public.content_library.suggestion_reason is 'agent rationale for suggesting this item';

-- ── 2. client_alerts: notifications surfaced in the client dashboard ──────────
create table if not exists public.client_alerts (
  id         uuid primary key default gen_random_uuid(),
  audience   text not null default 'all' check (audience in ('all','user')),
  user_id    uuid,                                   -- null when audience='all'
  kind       text not null default 'library',        -- library | system | program | ...
  title      text not null,
  body       text,
  url        text,
  icon       text default '✨',
  ref_table  text,
  ref_id     uuid,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_client_alerts_active on public.client_alerts (is_active, created_at desc);
create index if not exists idx_client_alerts_user   on public.client_alerts (user_id) where user_id is not null;

-- ── 3. per-user read/dismiss state (works for broadcast + targeted) ───────────
create table if not exists public.client_alert_reads (
  alert_id uuid not null references public.client_alerts(id) on delete cascade,
  user_id  uuid not null,
  read_at  timestamptz not null default now(),
  primary key (alert_id, user_id)
);
create index if not exists idx_alert_reads_user on public.client_alert_reads (user_id);

-- ── 4. RLS on (deny-all to anon/authenticated; service_role bypasses) ─────────
-- All access is through service-key functions (client-alerts.js, admin-content.js).
alter table public.client_alerts      enable row level security;
alter table public.client_alert_reads enable row level security;

-- ── 5. Allow the library_scout agent in the prompt-versions check constraint ──
alter table public.content_prompt_versions
  drop constraint if exists prompt_versions_agent_check;
alter table public.content_prompt_versions
  add constraint prompt_versions_agent_check
  check (agent = any (array['scout','sage','sage_morning','atlas','sentinel','echo','library_scout']::text[]));

-- ── 6. GRANTS — REQUIRED for the service_role key (see note above) ────────────
grant all privileges on public.client_alerts      to service_role, postgres;
grant all privileges on public.client_alert_reads to service_role, postgres;

-- Reload PostgREST's schema cache so the new columns/tables are visible.
notify pgrst, 'reload schema';

-- Seed the library_scout prompt (idempotent-ish; skip if an active row exists).
insert into public.content_prompt_versions (agent, version, prompt_body, changelog, active)
select 'library_scout', 1,
  'See content-engine docs — the live prompt body is managed in content_prompt_versions.',
  'Initial version — content library suggestion agent', true
where not exists (
  select 1 from public.content_prompt_versions where agent = 'library_scout' and active
);
