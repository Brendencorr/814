-- 082_app_settings_public_read.sql
-- app_settings had RLS ON but NO policies → the anon key (home.html) and the authenticated client
-- (dashboard.html) both got zero rows, so `payments_live` read as false and the buy funnel stayed on
-- the waitlist even after the flag was flipped true. Fix: a SCOPED public SELECT policy exposing ONLY
-- the two client-facing runtime flags. Any other/future key stays service-role-only. Writes unchanged
-- (no write policy → service key only).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='app_settings' and policyname='app_settings_public_read') then
    create policy app_settings_public_read on public.app_settings
      for select using (key in ('payments_live', 'free_access_mode'));
  end if;
end $$;
