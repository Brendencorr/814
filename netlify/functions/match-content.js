/**
 * match-content.js - pure Riley-Brain rules for surfacing library content.
 *
 * No LLM, no I/O → deterministic + unit-testable. Two modes:
 *   'curated' = what Riley PUSHES ("Curated for you") - full guardrails incl. the tone block.
 *   'search'  = what a member PULLS (manual search/browse) - tone block LIFTED; TIER still enforced.
 * Principle (Brenden 2026-07-05): guardrails gate the push; tier gates the pull.
 * Crisis hard-overrides everything.
 *
 * Ground truth: personas are an ARRAY (reset_enrollment.persona_keys); tier order mirrors
 * entitlements.js RANK; tone block = griever/drinker.
 *
 * matchContent(items, client, ctx)
 *   client: { tier, personas:[], onboarding_tags:[] }
 *   ctx: { mode, pillarOfDay, timeOfDay, remainingSeconds, requiredTag, query,
 *          exploreMode, crisisActive, recentContentIds:Set, limit }
 */
// Tiers collapsed to two (2026-07): Companion is the top real tier (0-based here). Legacy
// coach/mentor/concierge rank EQUAL to companion so "coach-level" content stays visible to companion.
const TIER_RANK    = { guide: 0, companion: 1, coach: 1, mentor: 1, concierge: 1 };
const TONE_BLOCKED = new Set(["griever", "drinker"]); // personas we never PUSH non-grounded tone at

const lc = (s) => String(s == null ? "" : s).toLowerCase();
function overlap(a, b) { const set = new Set((a || []).map(lc)); return (b || []).filter((x) => set.has(lc(x))).length; }
function personaHit(itemPersonas, clientPersonas) {
  if (!itemPersonas || itemPersonas.length === 0 || itemPersonas.includes("universal")) return true;
  const cp = new Set((clientPersonas || []).map(lc));
  return itemPersonas.some((p) => cp.has(lc(p)));
}
function hasTag(item, tag) { return (item.tags || []).map(lc).includes(lc(tag)); }
function textMatch(item, q) {
  if (!q) return true;
  const hay = [item.title, item.creator, item.description, item.topic, (item.tags || []).join(" ")].join(" ").toLowerCase();
  return hay.includes(lc(q));
}

function matchContent(items, client, ctx) {
  items  = Array.isArray(items) ? items : [];
  client = client || {};
  ctx    = ctx || {};
  if (ctx.crisisActive) return []; // crisis flow owns the screen - hard override

  const mode           = ctx.mode === "search" ? "search" : "curated";
  const tier           = client.tier || "guide";
  const personas       = client.personas || [];
  const onboardingTags = client.onboarding_tags || [];
  const requiredTag    = ctx.requiredTag ? lc(ctx.requiredTag) : null;
  const blockedClient  = personas.some((p) => TONE_BLOCKED.has(lc(p)));

  const passes = items.filter((it) => {
    if (!it) return false;
    if (it.approval_status !== "approved" || !it.is_active || it.link_status !== "ok") return false;

    // Tier gate - ALWAYS enforced. Search unlocks tone, NEVER tier.
    if (tier === "guide") { if (!it.guide_starter) return false; }
    else if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[it.tier_access] ?? 0)) return false;

    // Tone gate - PUSH-only. In search mode the member is deliberately pulling, so it's lifted.
    if (mode === "curated" && it.tone && it.tone !== "grounded") {
      if (blockedClient) return false;                                  // never push manifestation at grief/recovery
      if (!ctx.exploreMode && !(requiredTag && hasTag(it, requiredTag))) return false; // others: only if asked/explore
    }

    // Explicit tag filter (tapped tag / tag search) - required when present.
    if (requiredTag && !hasTag(it, requiredTag)) return false;
    // Free-text search filter (search mode only).
    if (mode === "search" && ctx.query && !textMatch(it, ctx.query)) return false;
    return true;
  });

  const scored = passes.map((it) => {
    let s = 0;
    if (personaHit(it.personas, personas)) s += 3;
    s += Math.min(overlap(it.tags, onboardingTags), 3) * 2;
    if (ctx.pillarOfDay && (it.pillars || []).map(lc).includes(lc(ctx.pillarOfDay))) s += 2;
    if ((it.time_of_day || []).map(lc).includes(lc(ctx.timeOfDay)) || (it.time_of_day || []).includes("any")) s += 1;
    if (ctx.remainingSeconds && it.duration_minutes != null && it.duration_minutes * 60 <= ctx.remainingSeconds) s += 1;
    if (ctx.recentContentIds && typeof ctx.recentContentIds.has === "function" && ctx.recentContentIds.has(it.id)) s -= 2;
    return { item: it, score: s };
  });

  // Deterministic: score desc, then title asc (stable tie-break).
  scored.sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title)));
  const limit = ctx.limit != null ? ctx.limit : (mode === "search" ? 24 : 3);
  return scored.slice(0, limit).map((x) => x.item);
}

module.exports = { matchContent, TIER_RANK, TONE_BLOCKED };
