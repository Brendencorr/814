-- 038_home_analytics_trends.sql
-- Adds a `prev` (prior 7-day) block to admin_home_analytics() so the operator
-- Home tab can show trend deltas (▲/▼ % vs the previous week) on its stat cards.
-- Applied live via the Supabase MCP on 2026-07-03; this file mirrors it for history.
-- (Engagement-tab trends are computed in netlify/functions/admin-engagement.js,
--  which now scans a 14-day window and returns `deltas` + `series_14d`.)

create or replace function public.admin_home_analytics()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with
  clients as (
    select
      count(*) as total,
      count(*) filter (where updated_at > now() - interval '7 days') as active_7d,
      count(*) filter (where created_at > now() - interval '7 days') as new_7d,
      count(*) filter (where created_at > now() - interval '30 days') as new_30d
    from public.user_profiles
  ),
  clients_prev as (
    select
      count(*) filter (where updated_at > now() - interval '14 days' and updated_at <= now() - interval '7 days') as active_7d,
      count(*) filter (where created_at > now() - interval '14 days' and created_at <= now() - interval '7 days') as new_7d
    from public.user_profiles
  ),
  logins_by_day as (
    select to_char(d::date,'MM-DD') as label, coalesce(c.n,0) as n
    from generate_series(current_date - 13, current_date, interval '1 day') d
    left join (
      select created_at::date as day, count(*) n
      from public.client_events where event_type='login' and created_at > now() - interval '14 days'
      group by 1
    ) c on c.day = d::date
    order by d
  ),
  msgs_by_day as (
    select to_char(d::date,'MM-DD') as label, coalesce(c.n,0) as n
    from generate_series(current_date - 13, current_date, interval '1 day') d
    left join (
      select created_at::date as day, count(*) n
      from public.riley_conversations where role='user' and created_at > now() - interval '14 days'
      group by 1
    ) c on c.day = d::date
    order by d
  ),
  top_pages as (
    select page, count(*) n from public.client_events
    where event_type='page_view' and page is not null and created_at > now() - interval '30 days'
    group by page order by n desc limit 8
  ),
  top_clicks as (
    select target, count(*) n from public.client_events
    where event_type='click' and target is not null and created_at > now() - interval '30 days'
    group by target order by n desc limit 10
  ),
  last_active as (
    select ce.user_id, max(ce.created_at) as last_at,
           count(*) filter (where ce.created_at > now() - interval '7 days') as events_7d
    from public.client_events ce where ce.user_id is not null
    group by ce.user_id order by last_at desc limit 12
  ),
  last_active_named as (
    select la.user_id, la.last_at, la.events_7d,
           coalesce(up.full_name, up.email, 'Member') as name,
           coalesce(array_length(up.programs_purchased,1),0) as programs
    from last_active la left join public.user_profiles up on up.id = la.user_id
  ),
  totals as (
    select
      (select count(*) from public.client_events where event_type='login' and created_at > now() - interval '7 days') as logins_7d,
      (select count(*) from public.client_events where event_type='page_view' and created_at > now() - interval '7 days') as pageviews_7d,
      (select count(*) from public.riley_conversations where role='user' and created_at > now() - interval '7 days') as riley_7d
  ),
  prev as (
    select
      (select count(*) from public.client_events where event_type='login' and created_at > now() - interval '14 days' and created_at <= now() - interval '7 days') as logins_7d,
      (select count(*) from public.client_events where event_type='page_view' and created_at > now() - interval '14 days' and created_at <= now() - interval '7 days') as pageviews_7d,
      (select count(*) from public.riley_conversations where role='user' and created_at > now() - interval '14 days' and created_at <= now() - interval '7 days') as riley_7d,
      (select active_7d from clients_prev) as active_7d,
      (select new_7d from clients_prev) as new_7d
  )
  select jsonb_build_object(
    'clients', (select row_to_json(clients) from clients),
    'totals', (select row_to_json(totals) from totals),
    'prev', (select row_to_json(prev) from prev),
    'logins_14d', (select coalesce(jsonb_agg(row_to_json(logins_by_day)),'[]') from logins_by_day),
    'messages_14d', (select coalesce(jsonb_agg(row_to_json(msgs_by_day)),'[]') from msgs_by_day),
    'top_pages', (select coalesce(jsonb_agg(row_to_json(top_pages)),'[]') from top_pages),
    'top_clicks', (select coalesce(jsonb_agg(row_to_json(top_clicks)),'[]') from top_clicks),
    'last_active', (select coalesce(jsonb_agg(row_to_json(last_active_named)),'[]') from last_active_named)
  );
$function$;