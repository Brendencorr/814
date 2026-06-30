/**
 * admin-content.js — Admin Content Manager (§8). Team-only.
 *
 * Internal CRUD over content_library so the team can add/edit/retire content
 * (podcasts, videos, books, journal prompts, breathwork, recipes, meditations,
 * …) WITHOUT a code deploy. Separate from the State Engine, exactly as §8 asks.
 *
 * Protected by the same server-side secret as the safety queue (OPERATOR_KEY,
 * sent as the x-operator-key header). FAILS CLOSED if OPERATOR_KEY is unset.
 * Retire is a soft delete (is_active=false / approval_status=retired) — content
 * is never hard-deleted, so recommendation history stays intact.
 *
 * POST { action: "list" }
 * POST { action: "upsert", item: {...} }   // id present → update, else insert
 * POST { action: "retire" | "activate", id }
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });

const CONTENT_TYPES = ["book","podcast","video","music","meditation","breathwork","workout","recipe","article","journal_prompt","community_prompt","quote"];
const arr = (v) => Array.isArray(v) ? v : (typeof v === "string" && v.trim() ? v.split(",").map(s => s.trim()).filter(Boolean) : []);
const num = (v) => (v === "" || v == null || isNaN(+v)) ? null : +v;

async function listContent(supabase) {
  const { data, error } = await supabase
    .from("content_library")
    .select("id,title,creator,content_type,topic,mood,duration_minutes,content_url,description,emotional_intensity,is_active,approval_status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return json(200, { items: data || [], content_types: CONTENT_TYPES });
}

async function upsertContent(supabase, item) {
  if (!item || !item.title || !item.content_type) return json(400, { error: "title and content_type are required" });
  if (!CONTENT_TYPES.includes(item.content_type)) return json(400, { error: "unknown content_type" });

  const row = {
    title: String(item.title).slice(0, 300),
    creator: item.creator ? String(item.creator).slice(0, 200) : null,
    content_type: item.content_type,
    topic: item.topic ? String(item.topic).slice(0, 100) : null,
    mood: arr(item.mood),
    duration_minutes: num(item.duration_minutes),
    content_url: item.content_url ? String(item.content_url).slice(0, 1000) : null,
    description: item.description ? String(item.description).slice(0, 2000) : null,
    emotional_intensity: num(item.emotional_intensity),
    approval_status: ["draft","pending","approved","retired"].includes(item.approval_status) ? item.approval_status : "approved",
    updated_at: new Date().toISOString(),
  };

  if (item.id) {
    const { data, error } = await supabase.from("content_library").update(row).eq("id", item.id).select().maybeSingle();
    if (error) return json(500, { error: error.message });
    return json(200, { item: data });
  }
  const { data, error } = await supabase.from("content_library").insert(row).select().maybeSingle();
  if (error) return json(500, { error: error.message });
  return json(200, { item: data });
}

async function setActive(supabase, id, active) {
  if (!id) return json(400, { error: "id required" });
  const patch = active
    ? { is_active: true,  approval_status: "approved", updated_at: new Date().toISOString() }
    : { is_active: false, approval_status: "retired",  updated_at: new Date().toISOString() };
  const { error } = await supabase.from("content_library").update(patch).eq("id", id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  const expected = process.env.OPERATOR_KEY;
  if (!expected) return json(503, { error: "Content manager not configured. Set OPERATOR_KEY in the environment." });
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  try {
    const supabase = getSupabaseClient();
    switch (body.action) {
      case "list":     return await listContent(supabase);
      case "upsert":   return await upsertContent(supabase, body.item);
      case "retire":   return await setActive(supabase, body.id, false);
      case "activate": return await setActive(supabase, body.id, true);
      default:         return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-content error:", err.message);
    return json(500, { error: err.message });
  }
};
