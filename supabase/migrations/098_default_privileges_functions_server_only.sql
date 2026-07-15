-- 098_default_privileges_functions_server_only.sql
-- PREVENTION (structural). Root cause of the auth_users_exposed / anon-executable-RPC leaks: Supabase's
-- default privileges (set for the postgres role) auto-grant EXECUTE on every new public function to the
-- anon + authenticated API roles. This revokes that default so a NEW function is SERVER-ONLY by default
-- (callable only via the service key). Member-facing RPCs must now opt in explicitly, e.g.:
--   grant execute on function public.my_member_rpc(<argtypes>) to authenticated;
--
-- Note for all build sessions: after this, if a new member-facing RPC "doesn't work for logged-in users",
-- it just needs an explicit grant. See CLAUDE.md > Supabase > Database security.

alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;
