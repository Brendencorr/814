-- 080_nearest_memory_rpc.sql
-- Single-nearest-neighbour lookup for the reconcile-not-insert extractor (Spec §1.3).
-- Returns the one most-similar ACTIVE memory (across both tables) to a candidate fact,
-- so the extractor can REINFORCE a near-duplicate (cosine > 0.92) instead of inserting
-- a second row. Additive + idempotent.
create or replace function public.nearest_memory(
  p_user_id         uuid,
  p_query_embedding vector(1024)
)
returns table (source_table text, id uuid, content text, similarity float)
language sql stable as $$
  select source_table, id, content, sim from (
    select 'riley_memory'::text as source_table, id, content,
           (1 - (embedding <=> p_query_embedding))::float as sim
    from public.riley_memory
    where user_id = p_user_id and coalesce(status,'active')='active' and embedding is not null
    union all
    select 'life_map'::text, id, content,
           (1 - (embedding <=> p_query_embedding))::float
    from public.life_map
    where user_id = p_user_id and coalesce(status,'active')='active' and embedding is not null
  ) q
  order by sim desc
  limit 1;
$$;
