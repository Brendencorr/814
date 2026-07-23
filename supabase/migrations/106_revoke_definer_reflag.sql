-- 106: re-revoke SECURITY DEFINER functions the advisor re-flagged (the 096/097/101 class -
-- recreating a function restores the default PUBLIC execute grant, so every re-create must
-- re-revoke). Server-only operator/trigger fns lose anon+authenticated; log_engagement keeps
-- authenticated (client-called by design) and loses anon. The anon-chat counter RPCs
-- (get/increment_anon_counter) are intentionally anon-callable and stay untouched.
revoke execute on function public.admin_home_analytics() from anon, authenticated;
revoke execute on function public.admin_home_detail(text, text) from anon, authenticated;
revoke execute on function public.sync_profile_from_auth() from anon, authenticated;
revoke execute on function public.sync_sobriety_date_from_tracker() from anon, authenticated;
revoke execute on function public.log_engagement(text, jsonb) from anon;
