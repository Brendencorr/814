-- 035: Account menu — phone number on user_profiles + avatars storage bucket
-- Profile page lets members edit name / email / phone / photo.

-- 1) phone column (name, email, avatar_url already exist on user_profiles)
alter table user_profiles add column if not exists phone text;

-- 2) Public "avatars" storage bucket for profile photos
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3) RLS: anyone can read; each user writes only inside their own uid/ folder
drop policy if exists "Avatar read"        on storage.objects;
drop policy if exists "Avatar insert own"  on storage.objects;
drop policy if exists "Avatar update own"  on storage.objects;
drop policy if exists "Avatar delete own"  on storage.objects;

create policy "Avatar read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "Avatar insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
