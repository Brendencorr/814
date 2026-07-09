/**
 * memory-maintenance-cron.js - weekly memory hygiene (Master Build Spec §1.2).
 *
 * Three jobs, all non-fatal / fail-open:
 *   1. Backfill embeddings for memories written before the semantic layer was live
 *      (bounded per run; the one-time cost at scale should move to the Batch API).
 *   2. Merge near-duplicate memories (cosine > 0.92 → retire the weaker; superseded_by trail).
 *   3. Decay: low-confidence memories never reinforced in 90 days go dormant.
 *
 * Gated with requireScheduledOrOperator (only the scheduler or the operator key run it).
 * Does nothing meaningful until an embedding key is set - safe to ship dark.
 *
 * Schedule: netlify.toml [functions."memory-maintenance-cron"] = "0 9 * * 1" (Mon 09:00 UTC).
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const { embed, toVectorLiteral, embeddingsEnabled } = require("./embeddings");

const BACKFILL_PER_TABLE = 200; // bounded per run; weekly cadence chips away at any backlog

async function backfillTable(supabase, table) {
  let done = 0;
  try {
    const { data: rows } = await supabase.from(table)
      .select("id,content").is("embedding", null).eq("is_active", true).limit(BACKFILL_PER_TABLE);
    for (const r of rows || []) {
      const emb = toVectorLiteral(await embed(r.content));
      if (emb) { await supabase.from(table).update({ embedding: emb }).eq("id", r.id); done++; }
    }
  } catch (e) { console.warn(`[memory-maintenance] backfill ${table} failed (non-fatal):`, e.message); }
  return done;
}

exports.handler = async function (event) {
  const gate = requireScheduledOrOperator(event); if (gate) return gate;

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: "config" }) }; }

  const result = { embeddings_enabled: embeddingsEnabled(), backfilled: 0, merged: 0, decayed: 0 };

  // 1. Backfill - only meaningful when the semantic layer is live.
  if (embeddingsEnabled()) {
    result.backfilled += await backfillTable(supabase, "riley_memory");
    result.backfilled += await backfillTable(supabase, "life_map");
  }

  // 2. Merge near-duplicates (SQL RPC; conservative, riley_memory only).
  try { const { data } = await supabase.rpc("merge_duplicate_memories", { p_threshold: 0.92 }); result.merged = typeof data === "number" ? data : (data || 0); }
  catch (e) { console.warn("[memory-maintenance] merge failed (non-fatal):", e.message); }

  // 3. Decay stale low-confidence memories.
  try { const { data } = await supabase.rpc("decay_memories"); result.decayed = typeof data === "number" ? data : (data || 0); }
  catch (e) { console.warn("[memory-maintenance] decay failed (non-fatal):", e.message); }

  // Log the run (system_incidents - operator-visible; never member content).
  try { await supabase.from("system_incidents").insert({ kind: "maintenance_run", function_name: "memory-maintenance-cron", detail: result }); } catch (_) {}

  console.log("[memory-maintenance] done:", JSON.stringify(result));
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, ...result }) };
};
