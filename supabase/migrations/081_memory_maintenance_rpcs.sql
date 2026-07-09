-- 081_memory_maintenance_rpcs.sql
-- Weekly memory-maintenance primitives (Spec §1.2). Called by memory-maintenance-cron.
-- Additive + idempotent. Never deletes — retires via status so everything is auditable.

-- Decay: low-confidence memories that were never reinforced in 90 days go dormant.
create or replace function public.decay_memories()
returns int language plpgsql as $$
declare n int := 0; m int := 0;
begin
  update public.riley_memory set status='decayed', is_active=false
    where status='active' and coalesce(confidence,0.7) < 0.4
      and coalesce(last_reinforced_at, created_at) < now() - interval '90 days';
  get diagnostics m = row_count; n := n + m;

  update public.life_map set status='decayed', is_active=false
    where status='active' and coalesce(confidence,0.7) < 0.4
      and coalesce(last_reinforced_at, created_at) < now() - interval '90 days';
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;

-- Merge: within a member, retire the weaker of any near-duplicate pair (cosine > threshold).
-- Conservative — riley_memory only (general facts are where bloat lives); keeps the higher
-- confidence, tie-broken by newer. superseded_by preserves the trail.
create or replace function public.merge_duplicate_memories(p_threshold float default 0.92)
returns int language plpgsql as $$
declare n int := 0;
begin
  with pairs as (
    select a.id as keep_id, b.id as drop_id
    from public.riley_memory a
    join public.riley_memory b
      on a.user_id = b.user_id and a.id <> b.id
     and a.status = 'active' and b.status = 'active'
     and a.embedding is not null and b.embedding is not null
     and (1 - (a.embedding <=> b.embedding)) > p_threshold
     and ( coalesce(a.confidence,0.7) > coalesce(b.confidence,0.7)
        or (coalesce(a.confidence,0.7) = coalesce(b.confidence,0.7) and a.created_at >= b.created_at and a.id < b.id) )
  ),
  dedup as ( select drop_id, min(keep_id) as keep_id from pairs group by drop_id )
  update public.riley_memory t
     set status='superseded', is_active=false, superseded_by=d.keep_id
    from dedup d
   where t.id = d.drop_id and t.status='active';
  get diagnostics n = row_count;
  return n;
end $$;
