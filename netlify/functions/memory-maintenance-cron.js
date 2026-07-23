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
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");

const BACKFILL_PER_TABLE = 200; // bounded per run; weekly cadence chips away at any backlog

// 4. Theme promotion (upgrade #6, 2026-07-23): recurring riley_memory themes get promoted into
// Life Map facets so the member-facing map keeps deepening even when they never edit it.
// Haiku, conservative (max 2/member, only strong recurring themes not already on the map),
// works with or without embeddings. Bounded members per run; fail-open per member.
const PROMOTE_MEMBERS_PER_RUN = 25;
const PROMOTE_FACETS = ["why", "vision", "recovery_dna", "win", "joy", "relationship", "fear", "value", "strength", "energy"];

async function promoteThemes(supabase) {
  let promoted = 0;
  try {
    const { data: members } = await supabase.from("user_profiles").select("id")
      .gte("last_active_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("last_active_at", { ascending: false }).limit(PROMOTE_MEMBERS_PER_RUN);
    for (const m of members || []) {
      try {
        const [{ data: mems }, { data: maps }] = await Promise.all([
          supabase.from("riley_memory").select("content").eq("user_id", m.id).eq("is_active", true).limit(120),
          supabase.from("life_map").select("content").eq("user_id", m.id).eq("is_active", true).limit(60),
        ]);
        if (!mems || mems.length < 20) continue; // not enough signal to find a theme
        const sys = `You look at everything a wellness companion remembers about one person and find at most TWO strong RECURRING themes that belong on their Life Map but aren't there yet. Facets: ${PROMOTE_FACETS.join(", ")}.
Return ONLY a JSON array (possibly empty): [{"facet": "...", "content": "one concise entry in plain words"}].
Rules: only themes supported by SEVERAL memories (a pattern, not a mention); never anything already on the map below; never grief/loss/trauma details; plain hyphens only. When in doubt, return [].
ALREADY ON THE MAP: ${(maps || []).map((r) => r.content).join(" | ") || "nothing"}`;
        let raw;
        try {
          const r = await callClaude({ system: sys, messages: [{ role: "user", content: (mems || []).map((x) => x.content).join("\n") }], max_tokens: 200, model: MODELS.memory, functionName: "memory-theme-promote", userId: m.id, supabase });
          raw = r.text || "[]";
        } catch (_) { continue; }
        raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
        const a = raw.indexOf("["), b = raw.lastIndexOf("]");
        if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
        let items; try { items = JSON.parse(raw); } catch { continue; }
        for (const it of (Array.isArray(items) ? items : []).slice(0, 2)) {
          if (!it || !PROMOTE_FACETS.includes(it.facet) || !it.content || String(it.content).length < 5) continue;
          const content = String(it.content).replace(/—|–/g, "-").slice(0, 300);
          const { data: dup } = await supabase.from("life_map").select("id").eq("user_id", m.id)
            .eq("is_active", true).ilike("content", content.slice(0, 40) + "%").limit(1);
          if (dup && dup.length) continue;
          await supabase.from("life_map").insert({ user_id: m.id, facet: it.facet, content, source: "consolidation", is_active: true, status: "active", confidence: 0.8 });
          promoted++;
        }
      } catch (e) { /* per-member fail-open */ }
    }
  } catch (e) { console.warn("[memory-maintenance] promote failed (non-fatal):", e.message); }
  return promoted;
}

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

  const result = { embeddings_enabled: embeddingsEnabled(), backfilled: 0, merged: 0, decayed: 0, promoted: 0 };

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

  // 4. Promote recurring themes into Life Map facets (Haiku; works without embeddings).
  result.promoted = await promoteThemes(supabase);

  // Log the run (system_incidents - operator-visible; never member content).
  try { await supabase.from("system_incidents").insert({ kind: "maintenance_run", function_name: "memory-maintenance-cron", detail: result }); } catch (_) {}

  console.log("[memory-maintenance] done:", JSON.stringify(result));
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, ...result }) };
};
