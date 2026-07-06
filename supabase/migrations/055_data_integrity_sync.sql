-- 055_data_integrity_sync.sql
-- DATA INTEGRITY PASS — Wave 1 backbone.
-- Establishes DB-ENFORCED single-source-of-truth for personal data that had been
-- mirrored into user_profiles and could silently diverge. The app can keep reading
-- the fast mirror columns; these triggers make it IMPOSSIBLE for the mirror to drift
-- from the canonical source. Idempotent (safe to re-run).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SOBRIETY  — canonical = sobriety_tracker (models resets/relapses + milestones).
--    user_profiles.sobriety_date becomes an enforced MIRROR of the active tracker row.
--    Fixes: Settings wrote user_profiles.sobriety_date while Dashboard/Progress/Riley
--    read sobriety_tracker.start_date — they only agreed by coincidence.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_sobriety_date_from_tracker()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(NEW.user_id, OLD.user_id);
begin
  update public.user_profiles p
     set sobriety_date = (
       select st.start_date
       from public.sobriety_tracker st
       where st.user_id = uid and st.is_active = true
       order by st.start_date desc, st.created_at desc
       limit 1
     ),
     updated_at = now()
   where p.id = uid;
  return null;
end $$;

drop trigger if exists trg_sync_sobriety_date on public.sobriety_tracker;
create trigger trg_sync_sobriety_date
  after insert or update or delete on public.sobriety_tracker
  for each row execute function public.sync_sobriety_date_from_tracker();

-- Backfill: promote any profile-only sobriety date into the canonical tracker,
-- then re-sync every mirror from the active tracker row.
insert into public.sobriety_tracker (user_id, start_date, is_active, milestone_days)
select p.id, p.sobriety_date, true, '[]'::jsonb
from public.user_profiles p
where p.sobriety_date is not null
  and not exists (select 1 from public.sobriety_tracker st
                  where st.user_id = p.id and st.is_active = true);

update public.user_profiles p
   set sobriety_date = st.start_date
from (select distinct on (user_id) user_id, start_date
      from public.sobriety_tracker where is_active = true
      order by user_id, start_date desc, created_at desc) st
where st.user_id = p.id
  and p.sobriety_date is distinct from st.start_date;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. IDENTITY  — canonical = auth.users. user_profiles.{email,full_name,avatar_url}
--    are mirrors. Fixes: changing email updated auth but not the profile copy, so
--    crons (daily brief, crisis follow-up, re-engagement) emailed the OLD address.
--    Also keeps name/avatar aligned when auth metadata refreshes (e.g. Google re-login).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_profile_from_auth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.user_profiles p
     set email      = NEW.email,
         full_name  = coalesce(NEW.raw_user_meta_data->>'full_name',
                               NEW.raw_user_meta_data->>'name', p.full_name),
         avatar_url = coalesce(NEW.raw_user_meta_data->>'avatar_url',
                               NEW.raw_user_meta_data->>'picture', p.avatar_url),
         updated_at = now()
   where p.id = NEW.id;
  return NEW;
end $$;

drop trigger if exists trg_sync_profile_from_auth on auth.users;
create trigger trg_sync_profile_from_auth
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_profile_from_auth();

-- Backfill: reconcile any profile whose email drifted from auth (auth wins).
update public.user_profiles p
   set email = u.email, updated_at = now()
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TIER  — drop the dead, drift-prone column. Real tier is derived from the
--    entitlements/subscriptions resolution (shared tier-utils.currentTier()).
--    Only writer was admin-create-user.js:89 (removed); only reader was
--    riley-brain.js which already ignored it. Safe to remove.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.user_profiles drop column if exists subscription_tier;
