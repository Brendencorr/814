-- 070_site_content.sql
-- Operator-editable overrides for the public marketing site ("Customize Website" tab).
-- One row per instrumented element/section on a marketing page. The pages ship with
-- hardcoded defaults; a row here OVERRIDES that slot at runtime (no redeploy needed).
--
--   kind = 'text'    → props {text}
--   kind = 'image'   → props {src, alt}
--   kind = 'section' → props {hidden, sort, bg, color, accent}
--
-- Reads are public (marketing pages fetch anonymously). Writes go ONLY through the
-- operator function admin-site-content.js (service key, OPERATOR_KEY-gated) — there is
-- no anon write path, so loading a page in ?cms=edit mode can never persist anything.

create table if not exists public.site_content (
  page       text        not null,
  key        text        not null,
  kind       text        not null check (kind in ('text','image','section')),
  props      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (page, key)
);

alter table public.site_content enable row level security;

-- Public read: the marketing pages fetch their overrides anonymously.
-- (No auth.* call in the predicate, so no rls_initplan concern — cf. migration 069.)
drop policy if exists site_content_public_read on public.site_content;
create policy site_content_public_read on public.site_content
  for select to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated on purpose:
-- all writes come from the operator function via the Supabase SERVICE key, which
-- bypasses RLS. This keeps the public site read-only from the browser.

-- Public storage bucket for operator-uploaded logos / images.
insert into storage.buckets (id, name, public)
values ('site-media', 'site-media', true)
on conflict (id) do nothing;

-- Public read of the media objects (public bucket already serves via public URL;
-- this makes anon listing/read explicit and harmless).
drop policy if exists site_media_public_read on storage.objects;
create policy site_media_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-media');
