/**
 * stripe-catalog.js — the SINGLE SOURCE OF TRUTH for Riley's Stripe catalog.
 *
 * Pure config (no keys, no execution). Referenced by:
 *   1. stripe-setup.js    — creates/updates every Product + Price in Stripe (idempotent by lookup_key).
 *   2. stripe-webhook.js  — maps a paid Stripe price (by lookup_key) back to a Riley grant.
 *   3. stripe-checkout.js — resolves what the member clicked to the Stripe Price to open Checkout with.
 *
 * Mirrors the live `products` table (Guide is free → no Stripe product). Subscription monthly amounts
 * come from that table; annual amounts are canonical (Companion $175/yr, Coach $350/yr). Amounts are cents.
 */
const CURRENCY = "usd";

// ── Recurring subscription tiers → Products with monthly + annual Prices ──
const SUBSCRIPTIONS = [
  {
    riley_plan: "companion",
    name: "Riley Companion",
    description: "Riley remembers your conversations and carries them forward.",
    prices: [
      { lookup_key: "companion_monthly", unit_amount: 1900,  interval: "month", nickname: "Companion · Monthly" },
      { lookup_key: "companion_annual",  unit_amount: 17500, interval: "year",  nickname: "Companion · Annual" },
    ],
  },
  {
    riley_plan: "coach",
    name: "Riley Coach",
    description: "Everything in Companion, plus the interactive coached programs.",
    prices: [
      { lookup_key: "coach_monthly", unit_amount: 3400,  interval: "month", nickname: "Coach · Monthly" },
      { lookup_key: "coach_annual",  unit_amount: 35000, interval: "year",  nickname: "Coach · Annual" },
    ],
  },
];

// ── One-time programs → Products with a single one-time Price. lookup_key = product_key (unique/stable).
// program_id (= product_key) is what the webhook writes to `purchases` on payment.
const PROGRAMS = [
  { product_key: "prog_sobriety",          name: "Sobriety (self-guided)",              unit_amount: 814 },
  { product_key: "prog_grief",             name: "Grief & Life Transitions (self-guided)", unit_amount: 814 },
  { product_key: "prog_body",              name: "Body Rebuild (self-guided)",          unit_amount: 814 },
  { product_key: "prog_bundle_selfguided", name: "Self-Guided Bundle — all 3",          unit_amount: 1814 },
  { product_key: "prog_int_move_nourish",  name: "Move Nourish",                         unit_amount: 1814 },
  { product_key: "prog_int_grief",         name: "Living Forward",                       unit_amount: 1814 },
  { product_key: "prog_int_happiness",     name: "Building Happiness",                   unit_amount: 1814 },
  { product_key: "prog_int_staying_free",  name: "Staying Free",                         unit_amount: 1814 },
];

// ── Resolution maps ──
// Subscription price lookup_key → the Riley grant (plan + term). The webhook uses this so it grants
// the exact tier/term with no amount-guessing; term drives the expires_at grace on renewal.
const PLAN_BY_LOOKUP = {
  companion_monthly: { plan: "companion", term: "monthly" },
  companion_annual:  { plan: "companion", term: "annual" },
  coach_monthly:     { plan: "coach",     term: "monthly" },
  coach_annual:      { plan: "coach",     term: "annual" },
};

// Program price lookup_key → program_id (product_key) the webhook grants as a one-time purchase.
const PROGRAM_BY_LOOKUP = Object.fromEntries(PROGRAMS.map((p) => [p.product_key, p.product_key]));

// Reverse: "<plan>_<term>" → subscription lookup_key, for checkout to pick the right price.
const LOOKUP_BY_PLAN = Object.fromEntries(
  Object.entries(PLAN_BY_LOOKUP).map(([lk, v]) => [v.plan + "_" + v.term, lk])
);

module.exports = { CURRENCY, SUBSCRIPTIONS, PROGRAMS, PLAN_BY_LOOKUP, PROGRAM_BY_LOOKUP, LOOKUP_BY_PLAN };
