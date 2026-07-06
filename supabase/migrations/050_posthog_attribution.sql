-- 040_posthog_attribution.sql
-- Nightly mirror of PostHog funnel counts, grouped by first-touch UTM.
-- Written by posthog-conversion-cron.js; read by the operator dashboard + weekly
-- learnings digest. PostHog stays the collection lens; this is the canonical copy.

create table if not exists posthog_daily_conversions (
  id            bigint generated always as identity primary key,
  day           date        not null,
  utm_source    text        not null default '(none)',
  utm_campaign  text        not null default '(none)',
  metric        text        not null,   -- 'pageview' | 'signup_guide' | 'reset_completed' | 'upgrade'
  count         integer     not null default 0,
  pulled_at     timestamptz not null default now(),
  unique (day, utm_source, utm_campaign, metric)
);

create index if not exists idx_posthog_daily_day    on posthog_daily_conversions (day desc);
create index if not exists idx_posthog_daily_source on posthog_daily_conversions (utm_source);

-- Server-only table (service key writes, operator reads via service key). RLS on,
-- no public policies — consistent with the other analytics tables.
alter table posthog_daily_conversions enable row level security;
