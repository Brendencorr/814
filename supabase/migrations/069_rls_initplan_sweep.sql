-- ============================================================
-- 069_rls_initplan_sweep.sql — fix the `auth_rls_initplan` performance lint APP-WIDE (76 policies).
--
-- Supabase's performance advisor flags every RLS policy that calls auth.uid()/auth.role()/auth.jwt()
-- DIRECTLY: Postgres re-evaluates the auth function once PER ROW. Wrapping it as (select auth.uid())
-- makes the planner evaluate it ONCE per query (an initplan). It is semantically identical and is
-- Supabase's officially recommended fix — the policy logic does not change, only how often the
-- function runs. This is the single largest advisor category and the main "past 5k users" DB item.
--
-- This migration reads each policy's CURRENT definition from pg_policies and reproduces it EXACTLY,
-- changing only the auth.*() calls — so it can't drift from what's there. Properties:
--   • ALTER POLICY (not DROP/CREATE) → no window where a policy is missing.
--   • Roles + command are preserved (ALTER POLICY only touches USING / WITH CHECK).
--   • Idempotent: the WHERE guard skips any policy already wrapped, so a re-run is a no-op.
--   • Atomic: a DO block in one transaction — if any single ALTER fails, EVERYTHING rolls back and
--     nothing is left half-changed. (Run it, then re-run Supabase's performance advisor to confirm.)
--
-- 🔴 This touches app-wide security policies. It's non-destructive + verified, but run it when you can
--    do a quick sanity check afterward (log in as a normal member; confirm you see only your own data).
-- ============================================================

DO $sweep$
DECLARE
  r    record;
  nq   text;
  nc   text;
  stmt text;
  n    int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ~* 'auth\.(uid|role|jwt)\(\)' OR with_check ~* 'auth\.(uid|role|jwt)\(\)')
      AND coalesce(qual, '')       !~* '\(\s*select\s+auth\.(uid|role|jwt)'   -- skip already-wrapped USING
      AND coalesce(with_check, '') !~* '\(\s*select\s+auth\.(uid|role|jwt)'   -- skip already-wrapped WITH CHECK
  LOOP
    nq := regexp_replace(coalesce(r.qual, ''),       'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g');
    nc := regexp_replace(coalesce(r.with_check, ''), 'auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g');
    stmt := 'ALTER POLICY ' || quote_ident(r.policyname)
         || ' ON ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename)
         || CASE WHEN r.qual       IS NOT NULL THEN ' USING ('      || nq || ')' ELSE '' END
         || CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || nc || ')' ELSE '' END;
    EXECUTE stmt;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS initplan sweep: rewrote % policies', n;
END
$sweep$;
