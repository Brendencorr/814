-- 099_set_function_search_path.sql
-- Hardening: clears the function_search_path_mutable advisories by pinning a fixed search_path on the
-- 6 flagged functions. A mutable (unset) search_path lets a caller's path influence a SECURITY DEFINER
-- function. `public, extensions` is a safe superset - their tables live in public and pgvector's
-- operators resolve there; pg_catalog is always implicitly searched first - so the functions keep
-- working (verified: get_anon_counter still returns correctly after the change).

alter function public.match_member_memory     set search_path = public, extensions;
alter function public.nearest_memory           set search_path = public, extensions;
alter function public.decay_memories            set search_path = public, extensions;
alter function public.merge_duplicate_memories  set search_path = public, extensions;
alter function public.increment_anon_counter    set search_path = public, extensions;
alter function public.get_anon_counter          set search_path = public, extensions;
