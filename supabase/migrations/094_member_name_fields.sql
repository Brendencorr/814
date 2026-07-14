-- 094_member_name_fields.sql
-- Make First + Last name first-class and required at onboarding. Email is already required by
-- both signup paths (Google OAuth + magic-link), so it is inherently mandatory.
--
-- preferred_name stays the OPTIONAL nickname ("what Riley calls you") and defaults to first_name
-- when no nickname is given, so every existing consumer of preferred_name keeps working unchanged.
--
-- Columns are nullable at the DB level (pre-change profiles have neither); the onboarding UI is
-- what enforces First + Last for new signups. Google users are pre-filled from full_name /
-- given_name / family_name; magic-link users (who only gave an email) enter both.

alter table public.user_profiles add column if not exists first_name text;
alter table public.user_profiles add column if not exists last_name  text;

comment on column public.user_profiles.first_name is
  'Member first name - required at onboarding (Screen 2). Google users pre-filled from full_name/given_name; magic-link users enter it.';
comment on column public.user_profiles.last_name is
  'Member last name - required at onboarding (Screen 2).';
