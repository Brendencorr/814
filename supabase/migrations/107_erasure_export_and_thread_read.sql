-- 107: complete member erasure/export + member_threads read repair (audit 2026-07-24).
--
-- (a) admin_purge_member / admin_export_member: introspection-based - they cover EVERY
--     public base table with a user_id column, so a newly added table can never again be
--     forgotten from the delete/export lists (the audit found 6+ missing, incl. hard_dates).
--     SECURITY DEFINER + revoked in this same file per house rule; called only via service key
--     from auth-handler. p_exclude carries the deliberate carve-outs (crisis_log stays as the
--     documented de-identified ~12-month safety record; payments is a financial record with
--     Stripe authoritative; admins is operator infra).
-- (b) member_threads: migration 101 made the table service-only, but the member home reads it
--     directly for the "what Riley's carrying" card - restore READ-ONLY owner access (writes
--     stay service-only, preserving 101's intent that mutation is server-mediated).

create or replace function public.admin_purge_member(p_user_id uuid, p_exclude text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
  result jsonb := '{}'::jsonb;
begin
  for r in
    select t.table_name
    from information_schema.tables t
    join information_schema.columns c
      on c.table_schema = t.table_schema and c.table_name = t.table_name
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.column_name = 'user_id'
      and not (t.table_name = any (p_exclude))
  loop
    execute format('delete from public.%I where user_id = $1', r.table_name) using p_user_id;
    get diagnostics n = row_count;
    if n > 0 then result := result || jsonb_build_object(r.table_name, n); end if;
  end loop;
  return result;
end;
$$;

create or replace function public.admin_export_member(p_user_id uuid, p_exclude text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  rows jsonb;
  result jsonb := '{}'::jsonb;
begin
  for r in
    select t.table_name
    from information_schema.tables t
    join information_schema.columns c
      on c.table_schema = t.table_schema and c.table_name = t.table_name
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.column_name = 'user_id'
      and not (t.table_name = any (p_exclude))
  loop
    -- Bounded per table so one huge table can't blow up the payload; embeddings are
    -- internal representation, not member content - strip them from the export.
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) - ''embedding''), ''[]''::jsonb) from (select * from public.%I where user_id = $1 limit 5000) x',
      r.table_name) into rows using p_user_id;
    if rows <> '[]'::jsonb then result := result || jsonb_build_object(r.table_name, rows); end if;
  end loop;
  return result;
end;
$$;

-- House rule: (re)created SECURITY DEFINER functions are revoked IN THE SAME FILE.
revoke all on function public.admin_purge_member(uuid, text[]) from public, anon, authenticated;
revoke all on function public.admin_export_member(uuid, text[]) from public, anon, authenticated;

-- (b) member_threads: read-only owner access for the member home card.
grant select on public.member_threads to authenticated;
do $$ begin
  create policy mt_owner_read on public.member_threads
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
