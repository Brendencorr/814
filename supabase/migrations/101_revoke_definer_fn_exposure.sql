-- 101_revoke_definer_fn_exposure.sql
-- Security canon (CLAUDE.md): SECURITY DEFINER functions in public are anon/authenticated-callable
-- unless revoked. Advisor re-flagged these (the 096/097 class). Server-only fns lose both roles;
-- log_engagement keeps `authenticated` (called client-side from dashboard/brief/clarity-setup by
-- signed-in members) and loses only `anon`.
-- APPLIED to production 2026-07-22 via MCP alongside migration 100 (rhythm_return_v1).
revoke execute on function public.admin_home_analytics() from anon, authenticated;
revoke execute on function public.admin_home_detail(text, text) from anon, authenticated;
revoke execute on function public.get_anon_counter(text, text, date) from anon, authenticated;
revoke execute on function public.increment_anon_counter(text, text, date) from anon, authenticated;
revoke execute on function public.sync_profile_from_auth() from anon, authenticated;
revoke execute on function public.sync_sobriety_date_from_tracker() from anon, authenticated;
revoke execute on function public.log_engagement(text, jsonb) from anon;
