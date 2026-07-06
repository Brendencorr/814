-- 054_content_curation_layer.sql
-- Content Library v2 — curation layer ON TOP of the existing pipeline.
-- Additive + idempotent. Nothing here bypasses the approval queue.
--
-- Ground truth (verified against live code/DB 2026-07-05):
--   personas  = reset-day.js PERSONAS (griever, drinker, burnt_out, stretched, body_first) + universal
--   pillars   = the 7 reset_days.theme values (Clear/Connect/Direction/Eat/Move/Rest/Show Up)
--   onboarding tags = onboarding.html FOCUS list (15)
--   time_of_day / emotional_intensity / tags ALREADY EXIST on content_library — NOT re-added here.
--
-- NOTE (037 lesson): tables created via the MCP need explicit grants to service_role or the
-- service key hits 42501 and functions silently return empty. The grants at the bottom are REQUIRED.

-- ── 1. content_library: 7 NET-NEW curation + tier columns ────────────────────
alter table public.content_library
  add column if not exists personas text[] not null default '{universal}'
    check (personas <@ array['griever','drinker','burnt_out','stretched','body_first','universal']::text[]),
  add column if not exists pillars text[] not null default '{}',
  add column if not exists tone text not null default 'grounded'
    check (tone in ('grounded','manifestation','spiritual','clinical')),
  add column if not exists tier_access text not null default 'companion'
    check (tier_access in ('guide','companion','coach','mentor')),
  add column if not exists guide_starter boolean not null default false,
  add column if not exists link_status text not null default 'ok'
    check (link_status in ('ok','broken')),
  add column if not exists link_checked_at timestamptz;

comment on column public.content_library.personas    is 'which reset personas this fits; {universal} = everyone';
comment on column public.content_library.tone         is 'grounded | manifestation | spiritual | clinical — drives the push guardrail';
comment on column public.content_library.tier_access  is 'minimum tier that can access this item (guide=starter-only path)';
comment on column public.content_library.guide_starter is 'true = part of the small free Guide starter set';
comment on column public.content_library.link_status  is 'ok | broken — set by the nightly link-health check; broken drops from surfacing';

-- ── 2. tag_registry: the canonical vocabulary (no freeform tags on ingestion) ─
create table if not exists public.tag_registry (
  tag       text primary key,
  category  text not null check (category in ('onboarding','pillar','system','topic')),
  label     text,
  is_active boolean not null default true
);

-- Seed: 15 onboarding focus tags + 7 reset pillars + 5 system tags. Idempotent.
insert into public.tag_registry (tag, category, label) values
  ('sleep','onboarding','Sleep'),
  ('nutrition','onboarding','Nutrition'),
  ('fitness','onboarding','Fitness'),
  ('purpose','onboarding','Purpose'),
  ('mental health','onboarding','Mental Health'),
  ('stress','onboarding','Stress'),
  ('relationships','onboarding','Relationships'),
  ('recovery','onboarding','Recovery'),
  ('leadership','onboarding','Leadership'),
  ('career','onboarding','Career'),
  ('adventure','onboarding','Adventure'),
  ('creativity','onboarding','Creativity'),
  ('community','onboarding','Community'),
  ('learning','onboarding','Learning'),
  ('financial wellness','onboarding','Financial Wellness'),
  ('clear','pillar','Clear'),
  ('connect','pillar','Connect'),
  ('direction','pillar','Direction'),
  ('eat','pillar','Eat'),
  ('move','pillar','Move'),
  ('rest','pillar','Rest'),
  ('show up','pillar','Show Up'),
  ('sleep_related','system','Sleep-related'),
  ('craving_moment','system','Craving moment'),
  ('grief_specific','system','Grief-specific'),
  ('movement','system','Movement'),
  ('quick_win','system','Quick win (≤5 min)')
on conflict (tag) do nothing;

-- Controlled-RICH vocabulary: promote the existing descriptive content tags to a 'topic'
-- category so Scout + search stay granular (not hamstrung to the 27 canonical tags) while
-- nothing is truly freeform. Seeded from live data; idempotent (dupes skipped).
insert into public.tag_registry (tag, category, label)
select distinct lower(trim(t)), 'topic', initcap(lower(trim(t)))
from public.content_library, unnest(tags) as t
where coalesce(trim(t),'') <> ''
on conflict (tag) do nothing;

-- ── 3. client_tag_events: tag interactions → personalization + upgrade intent ─
-- client_id → user_profiles(id) (the app's member identity; there is NO clients table).
create table if not exists public.client_tag_events (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.user_profiles(id) on delete cascade,
  tag        text,
  context    text not null check (context in ('library_tap','locked_tap','explore_toggle','asset_click','search_open')),
  content_id uuid references public.content_library(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tag_events_client on public.client_tag_events (client_id, created_at desc);
create index if not exists idx_tag_events_context on public.client_tag_events (context, created_at desc);

-- ── 4. matching index — approved + active library reads by tier ──────────────
create index if not exists idx_library_matching on public.content_library (approval_status, is_active, tier_access)
  where approval_status = 'approved' and is_active = true;

-- ── 5. tier-aware alerts: min tier that should see an approve-broadcast ───────
alter table public.client_alerts
  add column if not exists min_tier text not null default 'guide'
    check (min_tier in ('guide','companion','coach','mentor'));
comment on column public.client_alerts.min_tier is 'lowest tier that should receive this alert (client-alerts read filters by member tier)';

-- ── 6. RLS ───────────────────────────────────────────────────────────────────
-- tag_registry: served through service-key functions (like client_alerts). Deny-all to anon/auth.
alter table public.tag_registry enable row level security;
-- client_tag_events: the member writes/reads their OWN taps (mirrors daily_checkins owner pattern).
alter table public.client_tag_events enable row level security;
do $$ begin
  create policy tag_events_owner on public.client_tag_events for all
    using (auth.uid() = client_id) with check (auth.uid() = client_id);
exception when duplicate_object then null; end $$;

-- ── 7. GRANTS — REQUIRED for the service_role key (037 lesson; do not drop) ───
grant all privileges on public.tag_registry      to service_role, postgres;
grant all privileges on public.client_tag_events to service_role, postgres;

-- Reload PostgREST's schema cache so the new columns/tables are visible.
notify pgrst, 'reload schema';
