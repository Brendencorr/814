/**
 * library.js - the member-facing Content Library surface (curated + search).
 *
 * Service-key function (mirrors client-alerts.js / entitlements.js): resolves the
 * member's tier, personas, and onboarding focus from their VERIFIED token, fetches
 * the live (approved + active) library, and runs the PURE match-content rules
 * server-side - so tier/persona/tone logic never reaches the client and can't be forged.
 *
 * Principle: curated = what Riley PUSHES (full guardrails incl. tone block);
 * search = what the member PULLS (tone lifted, TIER still enforced).
 *
 * GET  (Authorization: Bearer <token>)  ?mode=curated&tod=morning
 *        → { tier, curated:[...], locked:[...], tags:{...} }
 * POST { token, mode:'search', query, tag, pillar, tod }
 *        → { tier, results:[...] }
 * Model: n/a
 */
const { getSupabaseClient } = require("./supabase-client");
const { matchContent } = require("./match-content");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(d) });
// Tiers collapsed to two (2026-07): Companion is the top real tier. Legacy coach/mentor/concierge rank
// EQUAL to companion so any content gated at "coach level" stays visible to companion (no feature lost).
const TIER_RANK = { guide: 1, companion: 2, coach: 2, mentor: 2, concierge: 2 };
const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();

const LIB_COLS = "id,title,creator,content_type,content_url,description,duration_minutes,tags,personas,pillars,tone,tier_access,guide_starter,time_of_day,link_status,emotional_intensity,approval_status,is_active";

// Resolve the member's tier + personas + onboarding focus tags (all server-side).
async function memberContext(db, userId, previewTier) {
  let rank = 1, tier = "guide";
  try {
    const { data } = await db.from("subscriptions").select("plan_id, expires_at").eq("user_id", userId).eq("status", "active");
    const now = Date.now();
    (data || []).forEach((s) => {
      const live = !s.expires_at || new Date(s.expires_at).getTime() > now;
      if (live && TIER_RANK[s.plan_id] && TIER_RANK[s.plan_id] > rank) { rank = TIER_RANK[s.plan_id]; tier = s.plan_id; }
    });
  } catch (_) {}

  let personas = [];
  try {
    const { data: en } = await db.from("reset_enrollment").select("persona_keys").eq("user_id", userId).maybeSingle();
    if (en && Array.isArray(en.persona_keys)) personas = en.persona_keys;
  } catch (_) {}

  let onboarding_tags = [], isAdmin = false;
  try {
    const { data: prof } = await db.from("user_profiles").select("primary_focus, secondary_focuses, is_admin").eq("id", userId).maybeSingle();
    if (prof) {
      isAdmin = prof.is_admin === true;
      const t = [];
      if (prof.primary_focus) t.push(lc(prof.primary_focus));
      if (Array.isArray(prof.secondary_focuses)) prof.secondary_focuses.forEach((x) => t.push(lc(x)));
      onboarding_tags = [...new Set(t.filter(Boolean))];
    }
  } catch (_) {}

  // Admin: honor the tier-preview toggle so operator testing is faithful; with no preview an
  // admin sees the whole library (coach-level) and is NEVER shown the upgrade/locked card.
  // preview_tier is client-supplied but only ever applied here for a VERIFIED admin.
  if (isAdmin) {
    if (previewTier && TIER_RANK[previewTier]) tier = previewTier;
    else if (TIER_RANK[tier] < TIER_RANK.coach) tier = "coach";
  }

  return { tier, personas, onboarding_tags };
}

async function liveItems(db) {
  const { data, error } = await db.from("content_library").select(LIB_COLS)
    .eq("approval_status", "approved").eq("is_active", true).limit(1000);
  if (error) throw error;
  return data || [];
}

async function activeTags(db) {
  const out = { onboarding: [], pillar: [], topic: [], system: [] };
  try {
    const { data } = await db.from("tag_registry").select("tag, category, label").eq("is_active", true);
    (data || []).forEach((r) => { (out[r.category] = out[r.category] || []).push({ tag: r.tag, label: r.label || r.tag }); });
  } catch (_) {}
  return out;
}

// Client-facing card (no tier/persona internals leaked).
const card = (it) => ({
  id: it.id, title: it.title, creator: it.creator, type: it.content_type,
  url: it.content_url, description: it.description, duration: it.duration_minutes,
  tags: it.tags || [], tone: it.tone,
});

async function verify(db, tok) {
  if (!tok) return null;
  try { const { data } = await db.auth.getUser(tok); return data?.user?.id || null; } catch (_) { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  try {
    const db = getSupabaseClient();

    let params = {};
    let tok = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    if (event.httpMethod === "POST") {
      try { params = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
      tok = params.token || tok;
    } else {
      params = event.queryStringParameters || {};
    }

    const userId = await verify(db, tok);
    if (!userId) return json(200, { tier: "guide", curated: [], locked: [], results: [], tags: {} }); // logged-out → empty, never error

    const ctx = await memberContext(db, userId, params.preview_tier || null);
    const items = await liveItems(db);
    const mode = params.mode === "search" ? "search" : "curated";
    const common = { requiredTag: params.tag || null, pillarOfDay: params.pillar || null, timeOfDay: params.tod || null };

    if (mode === "search") {
      const results = matchContent(items, ctx, { ...common, mode: "search", query: params.query || "", limit: 48 });
      return json(200, { tier: ctx.tier, results: results.map(card) });
    }

    const curated = matchContent(items, ctx, { ...common, mode: "curated" });
    // Guide upsell: a few above-tier grounded items shown LOCKED (title only) → upgrade signal on tap.
    let locked = [];
    if (ctx.tier === "guide") {
      locked = items
        .filter((it) => it.link_status === "ok" && !it.guide_starter && it.tone === "grounded")
        .slice(0, 4)
        .map((it) => ({ id: it.id, title: it.title, type: it.content_type, tier_access: it.tier_access }));
    }
    const tags = await activeTags(db);
    return json(200, { tier: ctx.tier, curated: curated.map(card), locked, tags });
  } catch (err) {
    console.error("library error:", err.message);
    return json(500, { error: "Failed to load library" });
  }
};
