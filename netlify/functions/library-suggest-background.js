/**
 * library-suggest-background.js - Netlify Background Function (no timeout)
 *
 * The Content Library's research agent. Uses Claude + the Anthropic native
 * web_search tool to recommend NEW, on-brand resources for the member library -
 * every one carrying a REAL, live, verified URL (members open items via a link).
 *
 * Suggestions are written to content_library as:
 *   source='agent', approval_status='pending', is_active=false
 * so they sit in the operator's "Suggestions" queue awaiting a human approve
 * click. Approval (in admin-content.js) is what makes them live + fires the
 * client-dashboard alert. Nothing an agent proposes reaches members unreviewed.
 *
 * Triggered by:
 *   - POST from the dashboard "Suggest new content" button (fire-and-forget)
 *   - (future) a scheduled cron calling runSuggest()
 *
 * Prompt: loaded at runtime from content_prompt_versions (agent='library_scout').
 */

const { contentDb, loadPrompt, callClaude, extractJson, notify, CORS, requireOperator } = require("./content-lib");
// Shared, tested curation validator (same rules as bulk_suggest) - single source of truth.
const { normalizeItem, validateItem } = require("./content-curation");

const clampInt = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
// Content-type validation + tag normalization now come from the shared ./content-curation validator.

async function runSuggest({ count = 6, focus = "" } = {}) {
  const db = contentDb();

  // 1. What's already in the library - so we never re-suggest a dupe.
  const { data: existing, error: exErr } = await db
    .from("content_library")
    .select("title, content_type")
    .limit(500);
  if (exErr) throw new Error(`read library failed: ${exErr.message}`);
  const existingKeys = new Set((existing || []).map((r) => String(r.title || "").trim().toLowerCase()));
  const inventory = (existing || [])
    .slice(0, 200)
    .map((r) => `- ${r.title} (${r.content_type})`)
    .join("\n");

  // 1b. The canonical tag vocabulary - Scout's tags must be a subset (no freeform).
  const { data: _reg } = await db.from("tag_registry").select("tag").eq("is_active", true);
  const registry = new Set((_reg || []).map((r) => r.tag));

  // 2. Load the versioned agent prompt (never hardcoded).
  const system = await loadPrompt("library_scout");

  // 3. Build the request.
  const n = clampInt(count, 1, 10, 6);
  const focusLine = focus && focus.trim()
    ? `Operator focus for this batch: "${focus.trim()}". Bias suggestions toward this, but every item still needs a live link.`
    : `No specific focus - spread suggestions across several content types and topics.`;
  const allowedTags = [...registry].sort().join(", ");
  const user =
    `Suggest ${n} new resources for the library.\n\n` +
    `${focusLine}\n\n` +
    `Do NOT suggest anything already in the library. Existing items:\n` +
    `${inventory || "(library is currently empty)"}\n\n` +
    `ALLOWED TAGS - use ONLY tags from this list (lowercase, exact). An item whose tags aren't in this list is DROPPED:\n${allowedTags}\n\n` +
    `Remember: verify every URL is real and live with web search. Drop any item you cannot confirm. Return ONLY the JSON object.`;

  // 4. Call Claude with live web search.
  const text = await callClaude({ system, user, maxTokens: 4000, webSearch: true });
  const parsed = extractJson(text);
  const rawItems = (parsed && Array.isArray(parsed.items)) ? parsed.items : (Array.isArray(parsed) ? parsed : []);

  // 5. Validate + de-dupe with the SHARED curation validator (identical rules to bulk import):
  //    live http(s) URL, valid type, tags ⊆ registry, valid persona/tone/tier, no dupe,
  //    and the guardrail - manifestation content never targets griever/drinker personas.
  const rows = [];
  const dropped = [];
  const batch = new Set();
  for (const it of rawItems) {
    const raw = Object.assign({}, it);
    if (raw.content_type) raw.content_type = norm(raw.content_type).replace(/s$/, ""); // tolerate "videos" → "video"
    if (raw.reason && !raw.suggestion_reason) raw.suggestion_reason = raw.reason;       // Scout used `reason`
    const item = normalizeItem(raw);
    const problems = validateItem(item, { registry, existing: existingKeys, batch });
    if (problems.length) { dropped.push({ title: (it && it.title) || "(untitled)", why: problems.join("; ") }); continue; }
    batch.add(item.title.toLowerCase());
    rows.push(Object.assign({}, item, {
      source: "agent",
      approval_status: "pending",
      is_active: false,
      suggested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }

  // 6. Insert the survivors as pending suggestions.
  let inserted = 0;
  if (rows.length) {
    const { data, error } = await db.from("content_library").insert(rows).select("id");
    if (error) throw new Error(`insert suggestions failed: ${error.message}`);
    inserted = (data || []).length;
  }

  await notify(
    `Library Scout: ${inserted} new suggestion${inserted === 1 ? "" : "s"} added to the approval queue` +
    (dropped.length ? ` (${dropped.length} dropped - no live link / dupe)` : "") +
    `. Review at admin.meetriley.us → Content Library → Suggestions.`
  );

  return { ok: true, inserted, dropped: dropped.length, dropped_detail: dropped };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const _gate = requireOperator(event); if (_gate) return _gate;
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* defaults */ }
  try {
    const result = await runSuggest({ count: body.count, focus: body.focus });
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (err) {
    console.error("library-suggest error:", err.message);
    await notify(`⚠ Library Scout FAILED: ${err.message}`);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

exports.runSuggest = runSuggest;
