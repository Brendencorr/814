/**
 * library-suggest-background.js — Netlify Background Function (no timeout)
 *
 * The Content Library's research agent. Uses Claude + the Anthropic native
 * web_search tool to recommend NEW, on-brand resources for the member library —
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

const { contentDb, loadPrompt, callClaude, extractJson, notify, CORS } = require("./content-lib");

// Must match admin-content.js CONTENT_TYPES (the DB has no enum on this column).
const CONTENT_TYPES = ["book","podcast","video","music","meditation","breathwork","workout","recipe","article","journal_prompt","community_prompt","quote"];

const clampInt = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const toTags = (v) => {
  const a = Array.isArray(v) ? v : (typeof v === "string" ? v.split(",") : []);
  return a.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
};

async function runSuggest({ count = 6, focus = "" } = {}) {
  const db = contentDb();

  // 1. What's already in the library — so we never re-suggest a dupe.
  const { data: existing, error: exErr } = await db
    .from("content_library")
    .select("title, content_type")
    .limit(500);
  if (exErr) throw new Error(`read library failed: ${exErr.message}`);
  const seen = new Set((existing || []).map((r) => norm(r.title)));
  const inventory = (existing || [])
    .slice(0, 200)
    .map((r) => `- ${r.title} (${r.content_type})`)
    .join("\n");

  // 2. Load the versioned agent prompt (never hardcoded).
  const system = await loadPrompt("library_scout");

  // 3. Build the request.
  const n = clampInt(count, 1, 10, 6);
  const focusLine = focus && focus.trim()
    ? `Operator focus for this batch: "${focus.trim()}". Bias suggestions toward this, but every item still needs a live link.`
    : `No specific focus — spread suggestions across several content types and topics.`;
  const user =
    `Suggest ${n} new resources for the library.\n\n` +
    `${focusLine}\n\n` +
    `Do NOT suggest anything already in the library. Existing items:\n` +
    `${inventory || "(library is currently empty)"}\n\n` +
    `Remember: verify every URL is real and live with web search. Drop any item you cannot confirm. Return ONLY the JSON object.`;

  // 4. Call Claude with live web search.
  const text = await callClaude({ system, user, maxTokens: 4000, webSearch: true });
  const parsed = extractJson(text);
  const rawItems = (parsed && Array.isArray(parsed.items)) ? parsed.items : (Array.isArray(parsed) ? parsed : []);

  // 5. Validate + de-dupe. Only rows with a real http(s) URL survive.
  const rows = [];
  const dropped = [];
  const batchSeen = new Set();
  for (const it of rawItems) {
    const title = (it && it.title || "").toString().trim();
    let type = norm(it && it.content_type).replace(/s$/, ""); // tolerate "videos" -> "video"
    if (type === "meditations") type = "meditation";
    const url = (it && it.content_url || "").toString().trim();

    if (!title) { dropped.push({ title: it && it.title, why: "no title" }); continue; }
    if (!CONTENT_TYPES.includes(type)) { dropped.push({ title, why: `bad type '${it && it.content_type}'` }); continue; }
    if (!/^https?:\/\/.+\..+/i.test(url)) { dropped.push({ title, why: "no live URL" }); continue; }
    const key = norm(title);
    if (seen.has(key) || batchSeen.has(key)) { dropped.push({ title, why: "duplicate" }); continue; }
    batchSeen.add(key);

    rows.push({
      title: title.slice(0, 300),
      creator: it.creator ? String(it.creator).slice(0, 200) : null,
      content_type: type,
      topic: it.topic ? String(it.topic).slice(0, 100) : null,
      duration_minutes: (it.duration_minutes == null || isNaN(+it.duration_minutes)) ? null : Math.round(+it.duration_minutes),
      content_url: url.slice(0, 1000),
      description: it.description ? String(it.description).slice(0, 2000) : null,
      emotional_intensity: (it.emotional_intensity == null || isNaN(+it.emotional_intensity)) ? null : Math.max(1, Math.min(5, Math.round(+it.emotional_intensity))),
      tags: toTags(it.tags),
      suggestion_reason: it.reason ? String(it.reason).slice(0, 500) : null,
      source: "agent",
      approval_status: "pending",
      is_active: false,
      suggested_at: new Date().toISOString(),
    });
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
    (dropped.length ? ` (${dropped.length} dropped — no live link / dupe)` : "") +
    `. Review at admin.eight14.us → Content Library → Suggestions.`
  );

  return { ok: true, inserted, dropped: dropped.length, dropped_detail: dropped };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
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
