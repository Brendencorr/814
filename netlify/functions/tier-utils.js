/**
 * tier-utils.js — the ONE place a member's tier is derived from what they own.
 *
 * Before this, the mentor>coach>companion>guide logic was copy-pasted in
 * entitlements.js, riley-brain.js, riley-chat.js and admin-engagement.js — four
 * chances to drift. Everything now imports currentTier() from here.
 *
 * Canonical inputs = the resolved set of owned product_keys (from user_active_products
 * + the subscriptions bridge). NOT the dead user_profiles.subscription_tier column
 * (dropped in migration 055).
 *
 * Accepts either a Set or an Array of product_keys.
 */

function currentTier(owned) {
  const has = (k) => (Array.isArray(owned) ? owned.includes(k) : owned && owned.has(k));
  if (has("mentor")) return "mentor";
  if (has("coach") || has("concierge")) return "coach"; // concierge = retired alias for coach
  if (has("companion")) return "companion";
  if (has("reset_free")) return "guide";
  const size = Array.isArray(owned) ? owned.length : (owned ? owned.size : 0);
  return size ? "alacarte" : null; // owns à-la-carte program(s) but no membership tier
}

module.exports = { currentTier };
