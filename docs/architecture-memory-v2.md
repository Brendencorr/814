# Riley Memory v2 — as-built (Master Build Spec v2, Part 1 + cost/reliability foundation)

Companion to the full-stack knowledge base PDF. Everything here ships **fail-open / dark**:
with no embedding key set, production behavior is byte-identical to pre-v2.

## What's live (this build)
- **Semantic recall** — `match_member_memory(user, query_embedding, limit)` RPC; hybrid rank
  `0.6·cosine + 0.25·freshness + 0.15·confidence`, always appends `why`/`vision` anchors. Called
  from `riley-chat.js` keyed on the member's current message; fail-open to recency.
- **Reconcile-not-insert** — `extractMemories` now NEW / REINFORCE (`nearest_memory` cosine>0.92 →
  bump confidence + `last_reinforced_at`) / SUPERSEDE (explicit contradiction retires the old row
  via `superseded_by`). Embeds each new fact on write. Runs on Haiku via `anthropic-client`.
- **Maintenance** — `memory-maintenance-cron` (weekly Mon 09:00 UTC): embedding backfill,
  `merge_duplicate_memories`, `decay_memories`. Logs to `system_incidents`.
- **Prompt caching** — persona cached as a stable prefix on unmodified turns (`useCached`); any
  prepended directive (session/safety/near-limit) uses the exact full string, uncached.
- **Cost + reliability** — `anthropic-client.js` wraps every call: caching, `api_cost_log` (hashed
  ids), retry → Haiku fallback → graceful line, `system_incidents` for fallbacks. `model-router.js`
  routes Sonnet=chat / Haiku=utility.
- **Safety net** — `tests/crisis` (human-authored corpus; blocks build until populated) +
  `tests/golden` (voice/rules). `.github/workflows/ci.yml` runs both + syntax + secret scan.
- **Post-hoc crisis backstop** — `post-hoc-crisis-scan` (nightly, standard Haiku, never batched):
  flags possible missed crisis language to the operator queue; never touches the live path.

## Schema (migrations 079–081)
- `riley_memory` + `life_map`: `embedding vector(1024)`, `confidence`, `last_reinforced_at`,
  `superseded_by`, `status`, `source`. HNSW cosine indexes.
- New tables: `session_summaries`, `chat_turn_signals`, `api_cost_log`, `system_incidents`.
- RPCs: `match_member_memory`, `nearest_memory`, `decay_memories`, `merge_duplicate_memories`.

## To activate the semantic layer
1. Set `EMBEDDINGS_PROVIDER` (openai|voyage) + `EMBEDDINGS_API_KEY` (or `OPENAI_API_KEY` /
   `VOYAGE_API_KEY`) in Netlify. 2. Run `memory-maintenance-cron` once (backfills embeddings).
3. Verify on a test account. Until then it's fully dark.

## Not yet built (see punch list / spec Part 1)
Session summaries (Phase 2), member-visible memory page (Phase 6), behavior synthesis +
plan-adaptation cron (Phase 3), chat turn-signal logging + move classification (Phase 4),
longitudinal insights (Phase 5). Plus the human/external items (crisis corpus, clinician,
counsel, pen test, staging, uptime/status/Sentry, load test).
