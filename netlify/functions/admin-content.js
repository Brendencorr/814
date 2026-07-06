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
 * POST { action: "list" }                        // library + agent suggestions + counts
 * POST { action: "upsert", item: {...} }           // id present → update, else insert
 * POST { action: "retire" | "activate", id }
 * POST { action: "approve_suggestion", id }        // suggestion → live + client alert
 * POST { action: "reject_suggestion", id }         // suggestion → dismissed
 * POST { action: "bulk_suggest", items: [...] }    // import a sourcing-pass batch → pending queue
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });

// Curation vocabulary + shared validator (pure, tested) — one definition, reused by Scout too.
const { CONTENT_TYPES, arr, num, normalizeItem, validateItem } = require("./content-curation");

// Friendly nouns + icons for client-facing alert copy ("New 5-minute meditation added").
const TYPE_LABEL = {
  book: "book", podcast: "podcast", video: "video", music: "playlist",
  meditation: "meditation", breathwork: "breathwork practice", workout: "workout",
  recipe: "recipe", article: "article", journal_prompt: "journal prompt",
  community_prompt: "community prompt", quote: "reflection",
};
const TYPE_ICON = {
  book: "📖", podcast: "🎧", video: "🎬", music: "🎵", meditation: "🧘",
  breathwork: "🫁", workout: "🏃", recipe: "🥗", article: "📝",
  journal_prompt: "✍️", community_prompt: "💬", quote: "✨",
};
const SELECT_COLS = "id,title,creator,content_type,topic,mood,tags,duration_minutes,content_url,description,emotional_intensity,is_active,approval_status,source,suggestion_reason,suggested_at,updated_at";

async function listContent(supabase) {
  const { data, error } = await supabase
    .from("content_library")
    .select(SELECT_COLS)
    .order("updated_at", { ascending: false })
    .limit(600);
  if (error) throw error;
  const all = data || [];

  // Split: agent suggestions awaiting review vs the managed library.
  const suggestions = all
    .filter((r) => r.approval_status === "pending")
    .sort((a, b) => new Date(b.suggested_at || 0) - new Date(a.suggested_at || 0));
  const items = all.filter((r) => r.approval_status !== "pending");

  // Per-type counts over the LIVE library (active + approved) for the filter chips,
  // plus how many live items are missing a link (the gap we want to close).
  const counts = {};
  let missing_links = 0;
  for (const r of items) {
    if (r.is_active && r.approval_status === "approved") {
      counts[r.content_type] = (counts[r.content_type] || 0) + 1;
      if (!r.content_url) missing_links++;
    }
  }

  return json(200, {
    items,
    suggestions,
    counts,
    missing_links,
    content_types: CONTENT_TYPES,
    type_labels: TYPE_LABEL,
  });
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
    tags: arr(item.tags).slice(0, 12).map((t) => String(t).slice(0, 40)),
    duration_minutes: num(item.duration_minutes),
    content_url: item.content_url ? String(item.content_url).slice(0, 1000) : null,
    description: item.description ? String(item.description).slice(0, 2000) : null,
    emotional_intensity: num(item.emotional_intensity),
    approval_status: ["draft","pending","approved","retired"].includes(item.approval_status) ? item.approval_status : "approved",
    updated_at: new Date().toISOString(),
  };

  // Curation fields — only override when explicitly provided, so a partial edit
  // never clobbers persona/pillar/tone/tier the operator didn't touch.
  if (item.personas    !== undefined) row.personas    = arr(item.personas).map((s) => String(s).trim().toLowerCase());
  if (item.pillars     !== undefined) row.pillars     = arr(item.pillars).map((s) => String(s).trim().toLowerCase());
  if (item.time_of_day !== undefined) row.time_of_day = arr(item.time_of_day).map((s) => String(s).trim().toLowerCase());
  if (item.tone        !== undefined) row.tone        = String(item.tone).trim().toLowerCase();
  if (item.tier_access !== undefined) row.tier_access = String(item.tier_access).trim().toLowerCase();
  if (item.guide_starter !== undefined) row.guide_starter = !!item.guide_starter;

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

// Approve an agent suggestion → it goes live in the library AND a broadcast
// alert lands in every client's dashboard ("New 5-minute meditation added…").
async function approveSuggestion(supabase, id) {
  if (!id) return json(400, { error: "id required" });

  const { data: item, error: getErr } = await supabase
    .from("content_library").select(SELECT_COLS + ",tier_access").eq("id", id).maybeSingle();
  if (getErr)  return json(500, { error: getErr.message });
  if (!item)   return json(404, { error: "suggestion not found" });

  const { error: upErr } = await supabase
    .from("content_library")
    .update({ approval_status: "approved", is_active: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (upErr) return json(500, { error: upErr.message });

  // Build the member-facing alert.
  const label = TYPE_LABEL[item.content_type] || "resource";
  const dur   = item.duration_minutes ? `${item.duration_minutes}-minute ` : "";
  const alert = {
    audience: "all",
    user_id: null,
    kind: "library",
    title: `New ${dur}${label} added to the library`,
    body: item.title + (item.creator ? ` · ${item.creator}` : ""),
    url: item.content_url || "/resources",
    icon: TYPE_ICON[item.content_type] || "✨",
    ref_table: "content_library",
    ref_id: item.id,
    is_active: true,
    // Tier-aware (eligible-only): only members at/above the item's tier see this alert.
    // Guide teaser alerts are intentionally NOT sent here (shipped flagged-off).
    min_tier: item.tier_access || "guide",
  };
  // Alert is best-effort: approval must still succeed even if the alert insert fails.
  let alerted = false;
  try {
    const { error: alErr } = await supabase.from("client_alerts").insert(alert);
    if (alErr) console.error("client_alerts insert failed (non-fatal):", alErr.message);
    else alerted = true;
  } catch (e) { console.error("client_alerts insert threw (non-fatal):", e.message); }

  return json(200, { ok: true, alerted, alert_title: alert.title });
}

async function rejectSuggestion(supabase, id) {
  if (!id) return json(400, { error: "id required" });
  const { error } = await supabase
    .from("content_library")
    .update({ approval_status: "rejected", is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

// ── bulk_suggest — import a sourcing-pass batch through the shared validator ──
// The vocabulary + normalizeItem/validateItem live in ./content-curation (pure, tested).
async function getActiveTags(supabase) {
  const { data } = await supabase.from("tag_registry").select("tag").eq("is_active", true);
  return new Set((data || []).map((r) => r.tag));
}
async function getLibraryTitleSet(supabase) {
  const { data } = await supabase.from("content_library").select("title").limit(2000);
  return new Set((data || []).map((r) => String(r.title || "").trim().toLowerCase()));
}
// bulk_suggest: import a JSON batch from a Claude sourcing pass. Same validation as
// Scout; everything lands pending + inactive — operator approval stays the only gate.
// Note: URL *shape* is validated here; true liveness is the nightly link-health job
// (which handles HEAD→GET + redirects, and won't false-reject bot-blocking hosts).
async function bulkSuggest(supabase, items) {
  const list = Array.isArray(items) ? items.slice(0, 30) : [];
  if (!list.length) return json(400, { error: "items array required (max 30 per batch)" });
  const [registry, existing] = await Promise.all([getActiveTags(supabase), getLibraryTitleSet(supabase)]);
  const batch = new Set();
  const results = { inserted: 0, dropped: [] };
  for (const raw of list) {
    const item = normalizeItem(raw || {});
    const problems = validateItem(item, { registry, existing, batch });
    if (problems.length) { results.dropped.push({ title: (raw && raw.title) || "(untitled)", problems }); continue; }
    const { error } = await supabase.from("content_library").insert({
      ...item,
      source: "agent",
      approval_status: "pending",
      is_active: false,
      suggestion_reason: item.suggestion_reason || "Claude sourcing pass (bulk import)",
      suggested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) { results.dropped.push({ title: item.title, problems: ["insert failed: " + error.message] }); continue; }
    const key = item.title.toLowerCase();
    existing.add(key); batch.add(key);
    results.inserted++;
  }
  return json(200, results);
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
      case "list":               return await listContent(supabase);
      case "upsert":             return await upsertContent(supabase, body.item);
      case "retire":             return await setActive(supabase, body.id, false);
      case "activate":           return await setActive(supabase, body.id, true);
      case "approve_suggestion": return await approveSuggestion(supabase, body.id);
      case "reject_suggestion":  return await rejectSuggestion(supabase, body.id);
      case "bulk_suggest":       return await bulkSuggest(supabase, body.items);
      default:                   return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-content error:", err.message);
    return json(500, { error: err.message });
  }
};
