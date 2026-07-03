-- ============================================================
-- 037_security_hardening.sql
-- The 8:14 Project — privacy/security remediation (Phase 0 audit findings)
--
-- Run in: Supabase -> SQL Editor. Safe to re-run. REVIEW the M1 (storage)
-- section before running it — it is left commented on purpose.
--
-- Claude could not auto-apply this (production-DB guardrail); Brenden runs it.
-- ============================================================

-- ── H1 (HIGH): user_active_products view leaked cross-user data ──────────────
-- The view was SECURITY DEFINER with no per-user filter, so any caller could
-- enumerate every member's user_id + owned products via /rest/v1/. Switching it
-- to SECURITY INVOKER makes it respect the caller's RLS: a signed-in member sees
-- only their own entitlements; server code (service role) still sees everything.
ALTER VIEW public.user_active_products SET (security_invoker = true);

-- ── Function search_path hardening (WARN): pin search_path to public ─────────
-- Prevents search_path injection, especially for the SECURITY DEFINER function.
ALTER FUNCTION public.log_engagement(text, jsonb)                       SET search_path = public;
ALTER FUNCTION public.increment_usage_counter(uuid, text, timestamptz)  SET search_path = public;
ALTER FUNCTION public.prune_expired_memory()                            SET search_path = public;
ALTER FUNCTION public.refresh_engagement_states()                       SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()                        SET search_path = public;

-- ── M1 (MEDIUM) — avatars storage bucket allows LISTING all files ────────────
-- The public `avatars` bucket has a broad SELECT policy on storage.objects that
-- lets clients LIST every file (enumerate avatar filenames / user ids). Public
-- object URLs do NOT need a SELECT policy to work, so the listing grant can be
-- removed. LEFT COMMENTED because storage-policy names vary and a wrong change
-- could break avatar display. Brenden: verify the policy name in
-- Supabase -> Storage -> avatars -> Policies, apply, then confirm avatars still
-- load in the app.
--
--   -- 1) find the policy:
--   -- select policyname, cmd, qual from pg_policies
--   --   where schemaname='storage' and tablename='objects' and policyname ILIKE '%avatar%';
--   -- 2) then drop the broad list/select grant (app loads avatars by URL, which keeps working):
--   -- DROP POLICY "Avatar read" ON storage.objects;

-- ── NOTE (no action needed) ──────────────────────────────────────────────────
-- Tables with RLS enabled + 0 policies (admins, app_settings, crisis_log,
-- echo_scores, grants_log, pipeline_runs, published_posts, scout_history) are
-- INTENTIONALLY locked to the service role only (server-side). That is secure;
-- the advisor's INFO flag is expected. community_waitlist's open INSERT is the
-- intended public waitlist signup (consider rate-limiting at the edge).
