-- 109: the REAL fix for the recurring SECURITY DEFINER exposure. 106 revoked from
-- anon/authenticated but the functions carry a PUBLIC grant, which those roles inherit -
-- so the advisor kept flagging them. Revoke from PUBLIC as well (the lesson: always
-- "revoke ... from public, anon, authenticated"). log_engagement keeps an explicit
-- authenticated grant (client-called by design); the anon-chat counter RPCs stay
-- intentionally anon-callable.
revoke all on function public.admin_home_analytics() from public, anon, authenticated;
revoke all on function public.admin_home_detail(text, text) from public, anon, authenticated;
revoke all on function public.sync_profile_from_auth() from public, anon, authenticated;
revoke all on function public.sync_sobriety_date_from_tracker() from public, anon, authenticated;
revoke all on function public.log_engagement(text, jsonb) from public, anon;
grant execute on function public.log_engagement(text, jsonb) to authenticated;
