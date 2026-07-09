/**
 * model-router.js - single source of truth for which model runs which job (Spec §8.2).
 *
 * The member CONVERSATION stays on Sonnet - quality is felt there, non-negotiable.
 * Utility / background jobs (memory distillation, session summaries, classification,
 * synthesis, the reliability fallback) run on Haiku 4.5 for cost. Changing a model is
 * ONE edit here, never a grep across the fleet.
 *
 * NOTE: this intentionally supersedes CLAUDE.md's older "all functions use sonnet"
 * blanket rule for UTILITY calls only - per Master Build Spec v2 §8.2. Conversation
 * remains claude-sonnet-4-6. Every Haiku call site is non-blocking / fail-open, so a
 * bad utility model can never break a member's reply.
 */

const SONNET = "claude-sonnet-4-6";
const HAIKU  = "claude-haiku-4-5-20251001";

const MODELS = {
  chat:      SONNET,   // member conversation - never downgrade
  memory:    HAIKU,    // reconcile-not-insert extraction
  summary:   HAIKU,    // session summaries (Phase 2)
  classify:  HAIKU,    // move-tagging + post-hoc crisis scan (Phase 4 / 7.3)
  synthesis: HAIKU,    // behavior / interaction / longitudinal (Phase 3/4/5)
  utility:   HAIKU,
  fallback:  HAIKU,    // reliability fallback for chat (Phase 9.1)
};

module.exports = { MODELS, SONNET, HAIKU };
