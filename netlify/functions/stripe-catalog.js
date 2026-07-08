/**
 * stripe-catalog.js — the SINGLE SOURCE OF TRUTH for Riley's Stripe subscription catalog.
 *
 * This is a pure config module (no execution, no keys). Three things reference it:
 *   1. stripe-setup.js   — creates/updates these Products + Prices in Stripe (idempotent by lookup_key).
 *   2. stripe-webhook.js — maps a paid Stripe price (by lookup_key) back to a Riley plan+term to grant.
 *   3. stripe-checkout.js — resolves a plan+term to the Stripe Price to open Checkout with.
 *
 * Prices are canonical (Companion $19/$175, Coach $34/$350). Amounts are in cents. The $8.14 one-time
 * programs live in the DB pricing table (public-pricing) and are added as one-time prices in a second
 * pass — kept out of here until we confirm the exact program key list so we don't guess.
 */
const CURRENCY = "usd";

// Products → recurring Prices. lookup_key is the stable idempotency + resolution anchor.
const CATALOG = {
  products: [
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
  ],
};

// Stripe price lookup_key → the Riley grant. The webhook resolves a paid line item to this so it
// grants the exact tier/term (no amount-guessing). expires_at grace is applied by the webhook per term.
const PLAN_BY_LOOKUP = {
  companion_monthly: { plan: "companion", term: "monthly" },
  companion_annual:  { plan: "companion", term: "annual" },
  coach_monthly:     { plan: "coach",     term: "monthly" },
  coach_annual:      { plan: "coach",     term: "annual" },
};

// Reverse: (plan, term) → lookup_key, for checkout to pick the right price.
const LOOKUP_BY_PLAN = Object.fromEntries(
  Object.entries(PLAN_BY_LOOKUP).map(([lk, v]) => [v.plan + "_" + v.term, lk])
);

module.exports = { CURRENCY, CATALOG, PLAN_BY_LOOKUP, LOOKUP_BY_PLAN };
