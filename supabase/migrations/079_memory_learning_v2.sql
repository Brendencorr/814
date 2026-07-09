-- 079_memory_learning_v2.sql
-- Riley Master Build Spec v2 - Part 1 foundation.
-- Adds: pgvector; embedding + reconciliation columns on riley_memory & life_map;
-- HNSW cosine indexes; the unified hybrid-rank recall RPC; and the supporting
-- tables for session memory, response-effectiveness signals, cost observability,
-- and reliability incidents.
--
-- 100% ADDITIVE + IDEMPOTENT. No existing column/row/behavior is changed. Nothing
-- here activates until an embedding key is set (see embeddings.js) - this is the
-- schema so the dark-shipped code has a home to write to.

-- ── pgvector ────────────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── riley_memory: reconciliation + embedding (confidence/source already exist) ─
alter table public.riley_memory
  add column if not exists embedding         vector(1024),
  add column if not exists last_reinforced_at timestamptz,
  add column if not exists superseded_by      uuid,
  add column if not exists status             text default 'active';  -- active | superseded | decayed | deleted

-- ── life_map: same reconciliation surface + embedding ─────────────────────────
alter table public.life_map
  add column if not exists embedding          vector(1024),
  add column if not exists confidence         real default 0.7,
  add column if not exists last_reinforced_at timestamptz,
  add column if not exists superseded_by      uuid,
  add column if not exists status             text default 'active',
  add column if not exists source             text;

-- Backfill status so pre-existing rows are recalled by the RPC (which filters status='active').
update public.riley_memory set status = 'active' where status is null;
update public.life_map     set status = 'active' where status is null;

-- ── HNSW cosine indexes (fast ANN at 5k+ members) ────────────────────────────
create index if not exists riley_memory_embed_idx on public.riley_memory
  using hnsw (embedding vector_cosine_ops);
create index if not exists life_map_embed_idx on public.life_map
  using hnsw (embedding vector_cosine_ops);

-- ── Unified hybrid-rank recall across BOTH memory tables ──────────────────────
-- Rank = 0.6·cosine + 0.25·freshness + 0.15·confidence.
-- The member's WHY + VISION facets are ALWAYS returned (is_anchor=true) regardless
-- of score or even embedding presence - the north star never drops out of context.
-- STABLE + service-role invoked; identity is passed in (the caller derives it from
-- the verified token, never the client).
create or replace function public.match_member_memory(
  p_user_id         uuid,
  p_query_embedding vector(1024),
  p_limit           int default 8
)
returns table (
  source_table text,
  id           uuid,
  kind         text,
  content      text,
  confidence   float,
  hybrid       float,
  similarity   float,
  is_anchor    boolean
)
language sql
stable
as $$
  with anchors as (
    select 'life_map'::text as source_table, id, facet as kind, content,
           coalesce(confidence, 0.7)::float as conf
    from public.life_map
    where user_id = p_user_id
      and coalesce(status, 'active') = 'active'
      and facet in ('why', 'vision')
  ),
  pool as (
    select 'riley_memory'::text as source_table, id, memory_type as kind, content,
           coalesce(confidence, 0.7)::float as conf, embedding, last_reinforced_at, created_at
    from public.riley_memory
    where user_id = p_user_id
      and coalesce(status, 'active') = 'active'
      and embedding is not null
    union all
    select 'life_map'::text, id, facet, content,
           coalesce(confidence, 0.7)::float, embedding, last_reinforced_at, created_at
    from public.life_map
    where user_id = p_user_id
      and coalesce(status, 'active') = 'active'
      and embedding is not null
      and facet not in ('why', 'vision')      -- anchors handled separately above
  ),
  ranked as (
    select source_table, id, kind, content, conf,
           (1 - (embedding <=> p_query_embedding))::float as sim,
           (  0.6 * (1 - (embedding <=> p_query_embedding))
            + 0.25 * (1.0 / (1.0 + (extract(epoch from (now() - coalesce(last_reinforced_at, created_at))) / 86400.0) / 30.0))
            + 0.15 * coalesce(conf, 0.7)
           )::float as hybrid
    from pool
  ),
  top_pool as (
    select * from ranked order by hybrid desc limit p_limit
  )
  select source_table, id, kind, content, conf, null::float, null::float, true from anchors
  union all
  select source_table, id, kind, content, conf, hybrid, sim, false from top_pool;
$$;

-- ── session_summaries (Phase 2 - episodic memory) ─────────────────────────────
create table if not exists public.session_summaries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  session_id     text,
  session_start  timestamptz,
  session_end    timestamptz,
  summary        text,
  open_threads   text[] default '{}',
  emotional_tone text,
  created_at     timestamptz default now()
);
create index if not exists session_summaries_user_idx on public.session_summaries (user_id, created_at desc);
alter table public.session_summaries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='session_summaries' and policyname='ss_own_read') then
    create policy ss_own_read on public.session_summaries for select
      using ((select auth.uid()) = user_id);
  end if;
end $$;

-- ── chat_turn_signals (Phase 4 - response-effectiveness loop) ─────────────────
create table if not exists public.chat_turn_signals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  conversation_id text,
  turn_id         text,
  riley_move      text,      -- asked_question | suggested_action | reflected | referenced_memory | referenced_win | gave_info
  member_replied  boolean,
  reply_latency_ms integer,
  member_reaction text,      -- nullable optional 👍/👎
  created_at      timestamptz default now()
);
create index if not exists chat_turn_signals_user_idx on public.chat_turn_signals (user_id, created_at desc);
alter table public.chat_turn_signals enable row level security;
-- Internal analytics: no anon/member read policy → service-role only.

-- ── api_cost_log (Phase 8.4 - cost observability) ─────────────────────────────
create table if not exists public.api_cost_log (
  id            uuid primary key default gen_random_uuid(),
  function_name text,
  model         text,
  input_tokens  integer default 0,
  output_tokens integer default 0,
  cached_tokens integer default 0,
  cost_usd      numeric(10,6) default 0,
  user_id_hash  text,        -- hashed, never the raw id; never message content
  fell_back     boolean default false,
  created_at    timestamptz default now()
);
create index if not exists api_cost_log_created_idx on public.api_cost_log (created_at desc);
create index if not exists api_cost_log_fn_idx on public.api_cost_log (function_name, created_at desc);
alter table public.api_cost_log enable row level security;
-- Operator-only via service key; no anon/member policy.

-- ── system_incidents (Phase 9.1 - reliability) ────────────────────────────────
create table if not exists public.system_incidents (
  id            uuid primary key default gen_random_uuid(),
  kind          text,        -- model_fallback | api_failure | timeout | maintenance_run | plan_adapt
  function_name text,
  detail        jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists system_incidents_created_idx on public.system_incidents (created_at desc);
alter table public.system_incidents enable row level security;
-- Operator-only via service key; no anon/member policy.
