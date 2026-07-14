/**
 * tier-labels.js - DISPLAY names for tiers.  v2.3.1 rename (Brenden 2026-07-14): JUST the display names
 * changed; the internal plan keys, entitlements, Stripe lookups and DB values were deliberately NOT touched
 * (no data migration, no tier-logic churn, founding members keep full access).  The mapping is therefore a
 * pure presentation layer:
 *
 *   internal free tier  (guide / reset_free)        -> "Companion"   (free)
 *   internal paid tier  (companion, $19/mo)          -> "Coach"       ($19/mo)   <- founding members live here
 *   internal coming-soon (coach / mentor / concierge) -> "Mentor"      (coming soon, dashboard-only)
 *
 * BECAUSE the internal keys were not renamed, the map looks inverted (companion->"Coach", coach->"Mentor").
 * That is intentional.  RULE: anything user-facing MUST render through tierLabel(); never capitalize the raw
 * internal key (e.g. `tier.toUpperCase()`), or the wrong name will show.  Client HTML keeps its own inline
 * copy of this map (search: RILEY_TIER_LABELS) since it cannot require() this module.
 */
'use strict';

const TIER_DISPLAY = {
  guide: "Companion", reset_free: "Companion", free: "Companion",
  companion: "Coach", coach: "Mentor", mentor: "Mentor", concierge: "Mentor",
  alacarte: "Self-guided",
};

// internal tier key -> user-facing display name (e.g. "companion" -> "Coach").
function tierLabel(internal) {
  if (!internal) return "Companion";
  const k = String(internal).toLowerCase();
  return TIER_DISPLAY[k] || (k.charAt(0).toUpperCase() + k.slice(1));
}

module.exports = { tierLabel, TIER_DISPLAY };
