-- 088_clarity_preview_flag.sql
-- Clarity Score v2.2 — per-member dogfood flag for the v2 engine.
-- When true, that member sees the v2 Clarity score/display while everyone else stays on
-- v1 (governed by site_content clarity/engine). Lets us validate v2 on a real account
-- before the public flag flip. Additive + idempotent; owner-only RLS already covers reads.

alter table public.user_profiles
  add column if not exists clarity_preview boolean not null default false;
