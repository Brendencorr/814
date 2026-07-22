# CODE HANDOFF — CLARITY v2.2 + RHYTHM & RETURN v1.1
### Paste-ready prompt + system impact matrix + definition of done · July 2026

---

## THE PROMPT (paste this into Claude Code)

> **Implement Doc 07 (Clarity Score v2.2) and Doc 08 (Rhythm & Return v1.1) together — they share the check-in surface.** Both spec files are in this message/folder; commit them to `docs/` first as the source of truth (07_CLARITY_SCORE_V2_SPEC.md, 08_RHYTHM_AND_RETURN_SPEC.md), and add CLAUDE.md pointers: "Clarity engine: docs/07 (v2.2 — bands, lanes, First Light, provisional). Cadence & check-ins: docs/08 (v1.1 — return tiers, Never-Say list, continuity loop). The scored check-in spine is invariant; personalization is additive only."
>
> **Work on branch `clarity-v2` — do not touch the launch-critical path (payments, site, campaign).** Build in four phases, PR per phase, in this order:
>
> **Phase 1 — Schema & migrations (both docs' §schema, additive only):** daily_checkins new columns; user_clarity_config; user_dim_baselines; user_daily_state additions (clarity_version, config_version, core, direction, displayed, dims, frozen, provisional); clarity_dims registry; hard_dates; life_events; member_threads; gap_summaries; checkin_prompts; users.last_active_at/personal_cadence/location fields. Backfill migration: existing accounts keep v1 rows stamped clarity_version=1; baselines seeded from last 28 days where data exists.
>
> **Phase 2 — The Clarity v2 engine (replaces v1 math in state-engine.js):** implement Doc 07 §1–§9 exactly — Foundation formulas (incl. sleep plateau + quality modifier), band scoring with asymmetric ratchet, sobriety lane as density with lapse-repair freeze wiring, freshness decay + provisional threshold, Direction layer, First Light + First Light-lite, input plausibility clamps (§7 table). Keep Tier-1-only recompute economics. Print the day-1/7/30/90 lane values in the PR description (closes the v1 curve bug on the record).
>
> **Phase 3 — Surfaces:** check-in UI with the Doc 07 §2 field set (20-second budget) + Doc 08 dynamic layer (riley_layer framing with static fallback, two dynamic slots, return sequence R2+, hard-day-aftermath opening); customization onboarding (Doc 07 §10 three-touch flow); dashboard additions (weekly lighter/heavier, small win, hard dates, life events, provisional "warming up" display); adaptive notifications with backoff ladder; thread-extraction job after conversations; narration v2 rules in explainChange.
>
> **Phase 4 — Guardrails & telemetry:** Sentinel config additions (Doc 08 Never-Say list + Doc 07 narration rules); all new events wired to the canonical events table + PostHog properties; monthly drift job → admin digest; methodology page stub with the transparency line and the Never List; privacy policy line for opt-in coarse location.
>
> **Definition of done = every acceptance criterion in both docs (07: #1–26, 08: #1–12) implemented as automated tests where marked as property/schema tests** — including the slip test, the gaming suite, the mom test (#9), spine invariance (#4/#10), and the fuel_opt_out grep audits. Also verify three invariants unchanged: admin can never read conversation content; Tier-2 events never trigger recompute; 4am app-day rollover respected everywhere new.
>
> When done: PR summaries per phase, the lane-curve printout, and a list of any spec ambiguities you resolved (with your resolution) rather than silently choosing.

---

## SYSTEM IMPACT MATRIX (what else gets updated — the ripple you asked about)

| System | Impact | Source |
|---|---|---|
| **Clarity engine** (state-engine.js) | Full v2 rewrite: bands, lanes, decay, Direction, First Light, provisional | 07 §1–9 |
| **Daily check-in** | New fields (energy, quality, heaviness, toggles, hard-day, craving); dynamic framing; return sequence; length by tier | 07 §2 · 08 §3b–4 |
| **Memory** | NEW post-conversation thread-extraction job; writes from "anything I should know" + gap notes; member-visible/deletable threads | 08 §3b |
| **Goals** | Keep/adjust/fresh fork at return; goal versioning on change; goal-pulse questions | 08 §3b |
| **Habits** | Habit dim now band-scored on completion *rate* vs personal baseline (not absolute /7); walks-count enforcement in fitness_logs | 07 §4 |
| **Sobriety tracker** | Becomes opt-in lane; density math; freeze wired to lapse-repair state; craving field feeds lane detail + Emergency Craving Protocol surface | 07 §5 · 08 §2 |
| **Notifications** | Static schedule → personal_cadence mirror + backoff ladder; hard-date override; content by return tier | 08 §3 |
| **riley_layer prompts** | Check-in framing generator; thread extractor; return-sequence copy; Never-Say enforcement in system prompt | 08 §2, §4 |
| **Sentinel config** | Never-Say list; narration rules (no gap math, no negative in First Light, band language) | 07 §11 · 08 §2 |
| **Dashboard/UI** | Customization pane + onboarding touches; weekly correlate; small win; hard dates; life events; provisional display | 07 §2, §10 |
| **explainChange / narration** | v2 rules: Direction-first, frozen-lane silence, presence-not-deltas at re-entry | 07 §11 · 08 §5 |
| **Admin / Mission Control** | Drift digest; new event visibility; no new member-content access (invariant) | 07 §12 |
| **PostHog** | ~15 new events + person props (config, tiers, tune-up funnel, Living-Question answer rates) | both |
| **Week One Letter** | Dependency note: cites Direction layer — letter generator reads D, not raw composite | 07 §8 |
| **Methodology page + Privacy policy** | Transparency line; Never List; location opt-in language | 07 §12 · 08 §4 |

## FOUNDER ITEMS RIDING WITH THE PR (yours, non-blocking)
1. Migration message copy (07 §12.4 placeholder: "Clarity got smarter — it now measures you against you") — your voice.
2. Confirm the **never-score-grief** rule as written (07 §5).
3. Methodology-page prose pass once Code stubs it.
4. Sequencing call: `clarity-v2` branch can build in parallel, but **merges after launch blockers** (payments, campaign, site) unless you say otherwise.
