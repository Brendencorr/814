-- 057_data_integrity_checks.sql
-- DATA INTEGRITY PASS — Wave 4 (the standing guarantee).
-- A single view that surfaces ANY divergence between a canonical source and its
-- mirror. It returns ZERO rows when the whole dataset is consistent. Wire a nightly
-- check (or an operator panel) to `select count(*) from data_integrity_report` and
-- alert if it's ever > 0 — that's the safety net that catches the next drift before
-- a member does. Read-only; safe to re-create.

create or replace view public.data_integrity_report as
  -- Sobriety: profile mirror must equal the active tracker row.
  select 'sobriety_date_mismatch'::text as check_name,
         p.id                            as user_id,
         p.sobriety_date::text           as mirror_value,
         st.start_date::text             as canonical_value
  from public.user_profiles p
  join lateral (
    select start_date from public.sobriety_tracker
    where user_id = p.id and is_active = true
    order by start_date desc, created_at desc limit 1
  ) st on true
  where p.sobriety_date is distinct from st.start_date

  union all
  -- Identity: profile email mirror must equal auth (source of truth).
  select 'email_mismatch', p.id, p.email, u.email
  from public.user_profiles p
  join auth.users u on u.id = p.id
  where p.email is distinct from u.email

  union all
  -- Program progress: the legacy/canonical column pairs must be in lockstep.
  select 'program_progress_col_mismatch', upp.user_id,
         concat_ws('/', upp.day_completed, upp.started_at::text, upp.last_activity::text),
         concat_ws('/', upp.days_completed, upp.enrolled_at::text, upp.last_activity_at::text)
  from public.user_program_progress upp
  where upp.day_completed  is distinct from upp.days_completed
     or upp.started_at     is distinct from upp.enrolled_at
     or upp.last_activity  is distinct from upp.last_activity_at

  union all
  -- Safety: a resolved crisis must not leave a day permanently flagged. Flags a
  -- user whose latest crisis_log is resolved but who still has crisis_flag=true today.
  select 'stale_crisis_flag', s.user_id, 'crisis_flag=true'::text, 'latest crisis resolved'::text
  from public.user_daily_state s
  where s.crisis_flag = true
    and s.date = (current_date)
    and not exists (
      select 1 from public.crisis_log c
      where c.user_id = s.user_id and coalesce(c.resolved, false) = false
    )
    and exists (
      select 1 from public.crisis_log c where c.user_id = s.user_id
    )

  union all
  -- Check-in completeness: a row with a logged mood IS a completed check-in, so the
  -- flag must agree. (mood present ⟹ checkin_completed=true.)
  select 'checkin_completed_mismatch', d.user_id,
         'mood set, checkin_completed=' || coalesce(d.checkin_completed::text, 'null'),
         'expected true'::text
  from public.daily_checkins d
  where d.mood is not null and coalesce(d.checkin_completed, false) = false;

comment on view public.data_integrity_report is
  'Data-integrity drift monitor. Zero rows = all canonical sources and their mirrors agree. Any row = a divergence to investigate. Added by migration 057.';
