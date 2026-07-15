-- 096_fix_auth_users_exposed.sql
-- Closes the Supabase "auth_users_exposed" security advisory (CRITICAL) on project 814.
--
-- public.data_integrity_report (from 057) is an operator/server-only monitoring view. Its
-- email_mismatch check joins auth.users and selects u.email, so the view can surface member
-- emails. It had inherited the default public-schema SELECT grant to the anon + authenticated
-- roles, meaning that data was reachable via PostgREST with the public (anon) API key.
--
-- Fix: revoke all API-role access. The service_role (server functions + the operator dashboard's
-- service key) is unaffected, and nothing client-side reads this view, so operator monitoring
-- (select count(*) from data_integrity_report) keeps working via the service key.

revoke all on public.data_integrity_report from anon;
revoke all on public.data_integrity_report from authenticated;
revoke all on public.data_integrity_report from public;
