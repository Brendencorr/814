/**
 * member-memory.js — "What Riley knows" (Master Build Spec §6).
 *
 * The member's own view of the durable memory Riley carries (riley_memory + life_map),
 * with Correct and Delete. This is a trust surface: "Fix anything wrong. Remove anything
 * you'd rather Riley let go."
 *
 * SECURITY: identity from the verified token ONLY; every row op is scoped to that user
 * (IDOR-guarded). crisis_log is NEVER exposed, edited, or exported here.
 *   Correct → supersede the old row + insert the fix at confidence 1.0, source member_correction.
 *   Delete  → status='deleted', is_active=false, content redacted → excluded from recall + prompts.
 * Corrections/deletions log to system_incidents (kind='memory_correction') = the operator's
 * memory-quality metric.
 */

const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");
const crypto = require("crypto");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const TABLES = new Set(["riley_memory", "life_map"]);
const hashId = (id) => { try { return crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 16); } catch (_) { return null; } };

function logCorrection(sb, userId, kind, table) {
  try { sb.from("system_incidents").insert({ kind: "memory_correction", function_name: "member-memory", detail: { user_hash: hashId(userId), action: kind, table } }).then(() => {}, () => {}); } catch (_) {}
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  let sb; try { sb = getSupabaseClient(); } catch (_) { return json(500, { error: "config" }); }
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  const action = body.action || "list";
  const now = new Date().toISOString();

  try {
    // ── LIST: everything Riley actively carries (crisis_log NEVER included) ──
    if (action === "list") {
      const [mem, map] = await Promise.all([
        sb.from("riley_memory").select("id,memory_type,content").eq("user_id", userId).eq("is_active", true).eq("status", "active").order("last_reinforced_at", { ascending: false, nullsFirst: false }).limit(200),
        sb.from("life_map").select("id,facet,content").eq("user_id", userId).eq("is_active", true).eq("status", "active").order("created_at", { ascending: false }).limit(200),
      ]);
      return json(200, {
        memories: (mem.data || []).map((r) => ({ id: r.id, table: "riley_memory", kind: r.memory_type, content: r.content })),
        lifemap: (map.data || []).map((r) => ({ id: r.id, table: "life_map", kind: r.facet, content: r.content })),
      });
    }

    // ── Row ops require an owned row (IDOR guard) ──
    const table = body.table;
    if (!TABLES.has(table) || !body.id) return json(400, { error: "table + id required" });
    const { data: row } = await sb.from(table).select("*").eq("id", body.id).eq("user_id", userId).maybeSingle();
    if (!row) return json(404, { error: "not found" });

    if (action === "delete") {
      await sb.from(table).update({ is_active: false, status: "deleted", content: "[removed by member]" }).eq("id", body.id).eq("user_id", userId);
      logCorrection(sb, userId, "delete", table);
      return json(200, { ok: true, deleted: true });
    }

    if (action === "correct") {
      const content = String(body.content || "").trim().slice(0, 300);
      if (content.length < 2) return json(400, { error: "content required" });
      const newRow = table === "life_map"
        ? { user_id: userId, facet: row.facet, content, source: "member_correction", is_active: true, status: "active", confidence: 1.0, last_reinforced_at: now }
        : { user_id: userId, memory_type: row.memory_type || "long_term", content, source: "member_correction", is_active: true, status: "active", confidence: 1.0, last_reinforced_at: now, last_confirmed_at: now };
      const { data: ins } = await sb.from(table).insert(newRow).select("id").maybeSingle();
      await sb.from(table).update({ is_active: false, status: "superseded", superseded_by: (ins && ins.id) || null }).eq("id", body.id).eq("user_id", userId);
      logCorrection(sb, userId, "correct", table);
      return json(200, { ok: true, corrected: true, id: ins && ins.id });
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    console.error("member-memory:", e.message);
    return json(500, { error: "server" });
  }
};
