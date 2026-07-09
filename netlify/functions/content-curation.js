/**
 * content-curation.js - pure, dependency-free curation vocabulary + validation.
 *
 * Shared by admin-content.js (bulk_suggest) and reusable by the Library Scout, so
 * "what is a valid, safe, non-duplicate library item" has ONE definition. No
 * Supabase/network imports → unit-testable in isolation (test-curation.js).
 *
 * Ground truth (verified against live code/DB 2026-07-05):
 *   personas = reset-day.js PERSONAS + universal · tone-block = griever/drinker
 *   content types = admin-content.js CONTENT_TYPES (12)
 */

// The 12 content types (authoritative; mirrors the managed library).
const CONTENT_TYPES = ["book","podcast","video","music","meditation","breathwork","workout","recipe","article","journal_prompt","community_prompt","quote"];
const PERSONAS      = ["griever","drinker","burnt_out","stretched","body_first","universal"];
const TONES         = ["grounded","manifestation","spiritual","clinical"];
const TIERS         = ["guide","companion","coach","mentor"];
const TONE_BLOCKED  = new Set(["griever","drinker"]); // personas we never PUSH non-grounded tone at

const lc  = (v) => String(v == null ? "" : v).trim().toLowerCase();
const arr = (v) => Array.isArray(v) ? v : (typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const num = (v) => (v === "" || v == null || isNaN(+v)) ? null : +v;
const rint = (v) => { const n = num(v); return n == null ? null : Math.round(n); };            // integer or null
const eint = (v) => { const n = num(v); return n == null ? null : Math.max(1, Math.min(5, Math.round(n))); }; // 1..5 or null
function isHttpUrl(u) {
  if (!u || typeof u !== "string") return false;
  try { const p = new URL(u.trim()); return p.protocol === "http:" || p.protocol === "https:"; } catch { return false; }
}

// Coerce a raw batch/suggestion item into the curation-aware content_library row shape.
function normalizeItem(raw) {
  raw = raw || {};
  const personas = arr(raw.personas).map(lc).filter(Boolean);
  return {
    title:            raw.title ? String(raw.title).trim().slice(0, 300) : "",
    creator:          raw.creator ? String(raw.creator).slice(0, 200) : null,
    content_type:     lc(raw.content_type),
    topic:            raw.topic ? String(raw.topic).slice(0, 100) : null,
    mood:             arr(raw.mood),
    tags:             arr(raw.tags).map(lc).filter(Boolean).slice(0, 12),
    personas:         personas.length ? personas : ["universal"],
    pillars:          arr(raw.pillars).map(lc).filter(Boolean),
    tone:             raw.tone ? lc(raw.tone) : "grounded",
    time_of_day:      arr(raw.time_of_day).map(lc).filter(Boolean),
    tier_access:      raw.tier_access ? lc(raw.tier_access) : "companion",
    duration_minutes: rint(raw.duration_minutes),                 // integer minutes or null
    content_url:      raw.content_url ? String(raw.content_url).trim().slice(0, 1000) : null,
    description:      raw.description ? String(raw.description).slice(0, 2000) : null,
    emotional_intensity: eint(raw.emotional_intensity),           // clamped 1..5 smallint or null
    suggestion_reason:   raw.suggestion_reason ? String(raw.suggestion_reason).slice(0, 500) : null,
  };
}

// Returns [] when valid, else human-readable problems (shown per-item to the operator).
// ctx: { registry:Set<tag>, existing:Set<title_lc>, batch:Set<title_lc> }
function validateItem(item, ctx) {
  const p = [];
  const registry = (ctx && ctx.registry) || new Set();
  const existing = (ctx && ctx.existing) || new Set();
  const batch    = (ctx && ctx.batch) || new Set();
  if (!item.title) p.push("missing title");
  if (!CONTENT_TYPES.includes(item.content_type)) p.push("invalid content_type '" + item.content_type + "'");
  if (!isHttpUrl(item.content_url)) p.push("missing/invalid http(s) URL");
  if (!TONES.includes(item.tone)) p.push("invalid tone '" + item.tone + "'");
  if (!TIERS.includes(item.tier_access)) p.push("invalid tier_access '" + item.tier_access + "'");
  const badPersona = item.personas.find((x) => !PERSONAS.includes(x));
  if (badPersona) p.push("invalid persona '" + badPersona + "'");
  const freeform = item.tags.filter((t) => !registry.has(t));
  if (freeform.length) p.push("unregistered tag(s): " + freeform.join(", "));
  // The guardrail: manifestation content can never target griever/drinker personas.
  if (item.tone === "manifestation" && item.personas.some((x) => TONE_BLOCKED.has(x))) {
    p.push("manifestation tone cannot target griever/drinker personas");
  }
  const key = item.title.toLowerCase();
  if (existing.has(key)) p.push("duplicate of an existing library item");
  else if (batch.has(key)) p.push("duplicate within this batch");
  return p;
}

module.exports = { CONTENT_TYPES, PERSONAS, TONES, TIERS, TONE_BLOCKED, lc, arr, num, isHttpUrl, normalizeItem, validateItem };
