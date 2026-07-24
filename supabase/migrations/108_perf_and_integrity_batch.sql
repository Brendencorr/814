-- 108: performance-advisor + data-integrity batch (audit 2026-07-24).
--
-- (a) sobriety_tracker: the deactivate-then-insert pattern (settings/tracker/dashboard +
--     admin-create-user) had no uniqueness on the active row, so a race could leave TWO
--     is_active rows and readers relied on .limit(1) ordering. Dedupe (keep newest start),
--     then enforce one-active-per-member with a partial unique index.
-- (b) duplicate indexes (advisor): drop the redundant twin of each identical pair.
-- (c) redundant double permissive policies on fitness_logs / nutrition_logs (advisor):
--     each had two identical owner ALL policies - drop the older one of each pair.
--     member_threads: drop the inert pre-101 mt_owner ALL policy (grants were revoked in
--     101; read access is the 107 mt_owner_read SELECT policy) so SELECT has ONE policy.
-- (d) auth_rls_initplan (advisor): recreate the newer owner policies with
--     (select auth.uid()) so Postgres evaluates it once per query, not once per row.

-- (a) one active sobriety row per member
with ranked as (
  select id, row_number() over (partition by user_id order by start_date desc, id desc) as rn
  from public.sobriety_tracker where is_active = true
)
update public.sobriety_tracker set is_active = false
where id in (select id from ranked where rn > 1);
create unique index if not exists sobriety_tracker_one_active
  on public.sobriety_tracker (user_id) where is_active;

-- (b) duplicate indexes
drop index if exists public.idx_fitness_user_date;
drop index if exists public.idx_nutrition_user_date;
drop index if exists public.idx_member_threads_due;

-- (c) redundant permissive policies
drop policy if exists "Users manage own fitness" on public.fitness_logs;
drop policy if exists "Users manage own nutrition" on public.nutrition_logs;
drop policy if exists mt_owner on public.member_threads;

-- (d) initplan-friendly owner policies (drop + recreate with (select auth.uid()))
drop policy if exists ucc_owner on public.user_clarity_config;
create policy ucc_owner on public.user_clarity_config for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists udb_owner on public.user_dim_baselines;
create policy udb_owner on public.user_dim_baselines for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists hd_owner on public.hard_dates;
create policy hd_owner on public.hard_dates for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists cle_owner on public.clarity_life_events;
create policy cle_owner on public.clarity_life_events for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists cw_owner on public.clarity_weekly;
create policy cw_owner on public.clarity_weekly for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own habit scoring changes" on public.habit_scoring_changes;
create policy "own habit scoring changes" on public.habit_scoring_changes for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists gs_owner on public.gap_summaries;
create policy gs_owner on public.gap_summaries for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists cp_owner on public.checkin_prompts;
create policy cp_owner on public.checkin_prompts for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- (calendar_feeds is NOT keyed by user_id - its "own feed" policy is left untouched;
--  the initplan advisory there is accepted.)

drop policy if exists mp_owner on public.member_people;
create policy mp_owner on public.member_people for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists mt_owner_read on public.member_threads;
create policy mt_owner_read on public.member_threads for select
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
