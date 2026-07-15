-- 097_harden_definer_functions_and_view.sql
-- Follow-up to 096. Closes the remaining Supabase security advisories:
--   * anon_security_definer_function_executable / authenticated_..._executable
--   * security_definer_view (public.user_active_products)
--
-- All of these functions are server-only (called by netlify/functions via the service key) or are
-- trigger functions; user_active_products is read ONLY by server functions (verified: no client page
-- reads it). Revoking API-role access + switching the view to security_invoker removes the exposure
-- without touching server behaviour (the service_role bypasses these grants). Verified after apply:
-- user_active_products still returns rows via the service key; 0 anon/authenticated grants remain.

-- Operator dashboard RPCs (only admin-home.js / service key). Revoking closes a DB-level path that
-- bypassed the Netlify operator gate.
revoke execute on function public.admin_home_analytics() from anon, authenticated;
revoke execute on function public.admin_home_detail(text, text) from anon, authenticated;

-- Anon rate-limit counters (only riley-chat.js / service key).
revoke execute on function public.get_anon_counter(text, text, date) from anon, authenticated;
revoke execute on function public.increment_anon_counter(text, text, date) from anon, authenticated;

-- Data-integrity trigger functions (fire on triggers, never RPC).
revoke execute on function public.sync_profile_from_auth() from anon, authenticated;
revoke execute on function public.sync_sobriety_date_from_tracker() from anon, authenticated;

-- log_engagement is legitimately called by SIGNED-IN app pages (brief/clarity-setup/dashboard),
-- so keep authenticated; drop anon only.
revoke execute on function public.log_engagement(text, jsonb) from anon;

-- user_active_products: server-only view. Lock it to the service key and switch to security_invoker
-- so it no longer runs with the definer's privileges.
revoke all on public.user_active_products from anon, authenticated;
alter view public.user_active_products set (security_invoker = true);
