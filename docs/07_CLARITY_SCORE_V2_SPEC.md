# 07 — CLARITY SCORE v2.3
### "Distance traveled, not distance from perfect." · July 2026 · Code-ready
Supersedes v2.2. Adds: return-cadence framework (§2b) and dynamic check-in spine/skin (§2c) — designed for the every-few-days member, not the daily idealization.
Positioning (canon): **every app counts your steps against 10,000 — Riley is the only score that knows what a walk cost you this week.**

---

## 1 · ARCHITECTURE

`Clarity_core = (40·F + 40·P) / 80` → `Clarity_displayed = clamp(0.8·core + 0.2·D, 0, 100)`, integer.

| Layer | Wt | Measures | Frame |
|---|---|---|---|
| **F Foundation** | 40 | State of life: steadiness, rest, fuel | Absolute (same bar for all) |
| **P Practice** | 40 | Showing up: movement, habits, reflection, program | Personal band vs own 28-day baseline |
| **D Direction** | 20 | Trend of core vs own recent past | Self-referenced |

Lanes (sobriety etc.) opt-in inside P (§5). Weights renormalize over enabled dims with freshness decay (§6).

## 2 · THE DAILY CHECK-IN (canonical field set — ~20 seconds)

| Field | Type | Feeds |
|---|---|---|
| Mood | 1–5 | F1 steadiness |
| **Energy (NEW)** | 1–5 | F1 (early-warning line; energy moves before mood) |
| Sleep hours | number | F2 |
| **Sleep quality (NEW)** | 1–5 | F2 modifier |
| **"How heavy was today?" (NEW)** | 1–5 | F1 calm signal (volatility in brand vocabulary) |
| One honest sentence | text | Reflection (presence-credit only, never graded) |
| **Got outside (NEW)** | tap | Practice: outside |
| **Talked to a human (NEW)** | tap | Practice: connection |
| **"Today was a hard day" (NEW — compassion flag)** | tap | §9 rules-changer, never a score input |
| Craving intensity (lane members only) | 0–5 | Sobriety lane leading indicator; ≥4 gently surfaces Emergency Craving Protocol |

**Weekly (dashboard, Sunday):** "Compared to last week, this week felt: lighter / about the same / heavier" (the perceived-direction correlate — validation gold, §13) · "One small win this week" (text → Riley memory + weekly recap).

## 2b · RETURN CADENCE FRAMEWORK (designed for the return, not the streak)

`gap = days since last app-day with any activity`. Every session resolves a tier that shifts Riley's register, the check-in shape, and Clarity behavior:

| Gap | Register | Check-in | Clarity |
|---|---|---|---|
| ≤1d | normal | standard daily (§2) | normal |
| 2–3d | easy continuity | reframed to "the last few days, overall" — ONE check-in, never per-day backfill | normal |
| 4–7d | warm welcome-back; Riley leads with one remembered thing | condensed (mood, energy, heaviness-of-stretch, one sentence) | return day gets hard-day band widening automatically; Direction narration suppressed this session |
| 8–29d | welcome, zero guilt | fresh-start micro (mood, energy, one sentence) | **Re-Light**: 7-day rise-only display; provisional "warming up" state reused if confidence low |
| 30+d | new chapter; durable-memory greeting | fresh-start micro + optional life-event recalibration offer ("a lot can change in a month — want Clarity to meet you where you are now?") | Re-Light 14 days; recalibration resets bands if accepted |

**Hard rules:** Riley NEVER states the gap length or that one exists ("it's been X days" / "you were gone" banned at the string level — a counted absence is a summons, not a welcome). Return check-ins count once — no retroactive day filling. **Notification anti-nag schedule:** 3 unanswered nudges → weekly gentle; 30 days → one "the light's on" message, then quarterly max. De-escalation is the retention strategy.
Schema: `relight_until date` on profile; events `return_tier_observed`, `relight_started/ended`, `recalibration_offered/accepted`.

## 2c · DYNAMIC CHECK-INS — FIXED SPINE, PERSONAL SKIN

**Spine (immutable, feeds Clarity):** the §2 fields, scales, anchors, and meanings. Never reworded in substance, never reordered in meaning, identical across all members forever — this is what keeps the score comparable and defensible.
**Skin (Riley's, per member):** phrasing in the member's vocabulary; toggle labels localized to their actual life ("got outside" may render "make it to the river?" — still logs `outside=true`); field ordering adapted to their focus; seasonal/weather awareness (optional, consented, city-level only). 
**The dynamic slot:** at most ONE contextual question per check-in, chosen by Riley from memory — yesterday's sentence, an approaching hard date, their named interest. Feeds memory and conversation only. **Never scored.**
**v1 constraint (defensibility):** skins and dynamic questions come from an approved, Sentinel-passed template bank with memory slots — not free generation. Every rendered check-in is reproducible via `checkin_context jsonb` (template ids + slot values) stored on the row. Free generation is a v2 candidate once a review loop exists.
**Invariants:** 20-second rule holds at every tier; hard-day flag present in every variant; spine-semantics lock is acceptance-tested.

**Context inputs (never scored):** hard-dates calendar (anniversaries — Riley checks in *before*; nearby dips annotated, not narrated as decline) · life-event tag (offers band recalibration: "life changed — should Clarity meet you where you are now?").

## 3 · FOUNDATION (absolute)

Internal split 16 (F1) : 14 (F2) : 10 (F3).

**F1 Steadiness** — `level = ((EMA7(mood)−1)/4)·100`; `energy_lvl = ((EMA7(energy)−1)/4)·100`; `calm = 100·max(0, 1−σ7(heaviness)/1.5)` → `F1 = 0.5·level + 0.2·energy_lvl + 0.3·calm`.
**F2 Rest** — plateau on EMA7 hours `h`: 100 if 7≤h≤9, else `100−22·hours_outside`, floor 20; × quality modifier `0.8 + 0.05·EMA7(quality)` capped at 1.0. *(Deliberately non-monotonic: more sleep is not always better — documented exception to §12 monotonicity.)*
**F3 Fuel** — `min(1, meals_7d/14)·100`. **Care rule:** member-disableable (`fuel_opt_out`); when off, weight redistributes and no food targets appear anywhere, including Riley's suggestions.

## 4 · PRACTICE (personal bands — the growth mechanic)

Per enabled dim, `v` = trailing-7d value. Baseline `B`, band `[0.7B, 1.15B]`, `lo ≥ dim_floor` (movement 1 · reflection 1 · habits 20% of active×7 · program 1 step · outside 1 · connection 1).
- `v ≥ hi` → `85 + 15·min(1,(v−hi)/hi)`
- `lo ≤ v < hi` → `65 + 20·(v−lo)/(hi−lo)`
- `v < lo` → `max(30, 65·v/lo)` — bends, never craters.
**Asymmetric ratchet:** `B ← B + α(v−B)`, `α_up=0.10`, `α_down=0.02`. Bar rises in 2–3 good weeks; a hard month lowers it gently; never collapses to easy wins.
Defaults: movement (walks count — enforced), habits, reflection.

## 5 · FOCUS LANES (opt-in only)

**Sobriety:** `density = sober_days_30/30`; `lane = 100·density^0.8` (day-60 slip → ≈97). Takes 12 of P's 40 when enabled. **Freeze (non-negotiable):** during lapse-repair, lane and displayed Clarity hold at pre-slip values until Slip Response completes (max 72h). The algorithm never shames a slip. Craving-density (share of ≤2 days) available as lane detail.
**Grief:** presence-based contribution only. **We never score grief** — there is no grieving correctly.
Future lanes: same contract — opt-in, density-not-streak, freeze-aware.

## 6 · MISSING DATA, FRESHNESS & PROVISIONAL STATE

- Per-dim confidence `conf = 0.5^(gap_days/6)`; `layer = Σ(w·conf·s)/Σ(w·conf)` on last-known `s`; dim drops at `conf < 0.1`. (Formalized carry-forward-with-decay — the documented imputation policy.)
- **Provisional state (NEW):** if `Σ(w·conf)/Σ(w) < 0.35`, the day's score is stored but displayed as **"Clarity is warming up"** (no number). A confident-looking score is never built on two data points.

## 7 · INPUT HYGIENE — PLAUSIBILITY BOUNDS & OUTLIERS (NEW)

| Input | Accepted | Counted cap/day |
|---|---|---|
| Sleep hours | 0–14 | analysis clamp 3–12 |
| Mood/energy/quality/heaviness | 1–5 enforced | — |
| Movement sessions | — | 2/day toward `v` |
| Meals | — | 4/day |
| Habit completions | ≤ active habits | — |
| Reflection entries | — | 2/day |

Single-day spikes additionally smoothed by the 7-day windows; property test: one extreme day moves any layer < 12 points. Out-of-range submissions accepted into raw logs (never scold), clamped in scoring.

## 8 · DIRECTION

`Δ = EMA7(core) − EMA28(core)`; `D = 50 + clamp(Δ,−15,15)/15·50`. What Riley narrates; what the Week One Letter cites; the B2B2C headline ("member clarity trend after 60 days").

## 9 · FIRST LIGHT & THE HARD-DAY FLAG

**First Light (days 1–14 of membership, and of any newly added dim):** tiny thresholds (1 movement day = full band; 1 check-in = full reflection); displayed score **rise-only**; narration never negative. Events `first_light_started/ended`.
**Hard-day flag:** for that app-day — bands widen (`lo → 0.5·B`), negative narration suppressed, Riley's tone shifts, day excluded from σ7 volatility. It never lowers anything. The Care Principles as an input field.

## 10 · CUSTOMIZATION & THE ONBOARDING FLOW

**Rules (unchanged):** Foundation fixed (fuel opt-out excepted, care-framed). Practice: choose 3–5 from catalog. Lanes explicit opt-in. Changes apply next app-day (4am rollover); max one config change / 7 days (onboarding choices exempt from this limit); `config_version` increments; newly added dims start in First Light. Settings entry always available: "Clarity watches what you're working on. Choose what matters right now — you can change it as you change."

**The three-touch flow:**

**Touch 1 — first login (awareness).** Member completes their first check-in → Clarity computes in real time from Foundation + defaults → the score appears → an in-screen card (not a modal that blocks the number):
> *"This is your Clarity score — it just calculated from what you shared. Here's the part that matters: you can choose what it watches."*
> Buttons: **[Customize now] [Later]**
- **Customize now** → the pane (below).
- **Later** → *"No problem. Next time you sign in, we'll set it up together — takes about 30 seconds."* Event `clarity_customize_deferred`.

**Touch 2 — second login (choice, never a wall).** After the day's check-in completes, the pane opens automatically. Completion = making a choice, and **"Keep the standard setup" is a one-tap valid choice** (defaults are written as the member's config; flow never auto-shows again). The pane is never shown before the check-in and never blocks access to Riley chat — a member who navigates away simply sees it after their next check-in until any choice is made. No countdown, no nag copy.

**The pane (single screen):**
1. *Foundation* — shown locked with one line: "The basics every score shares: steadiness, rest, fuel." Fuel row carries a quiet "not helpful for you? turn it off" (care-framed, no ED terminology).
2. *What you're working on* — practice catalog as toggles, defaults pre-on (movement, habits, reflection), pick 3–5, live counter.
3. *Focus lanes* — opt-in section (sobriety etc.), one-line explanations, off by default unless program-enrolled.
4. Footer: "You can change any of this, any time, in Settings."

**Touch 3 — end of First Light (day 14, recognition).** Riley suggests a tune-up from observed behavior, pre-toggled: *"You've been moving and writing most days — want Clarity to watch those?"* Accept / adjust / dismiss; dismiss is silent. This is the memory-powered moment competitors can't copy. Event `clarity_tuneup_offered/accepted`.

Events: `clarity_customize_shown / deferred / completed(mode: custom|defaults)`, `clarity_tuneup_offered / accepted`.

## 11 · SIGNAL CATALOG (registry-extensible: one row in `clarity_dims`, no formula changes)

| Dim | Layer | Source | Status |
|---|---|---|---|
| Steadiness / Rest / Fuel | F | daily_checkins (+energy, quality, heaviness), nutrition_logs | **live/expanded** |
| Movement · Habits · Reflection · Program | P | fitness_logs, habit_completions, notes/journal, program_progress | **live** |
| Sobriety lane | lane | sobriety_tracker + craving field | **live/expanded** |
| Outside · Connection | P | check-in toggles | **ships with v2.1** — connection rewards leaving the app; no competitor will copy it |
| Hydration · Creativity/play | P | toggles | backend-ready / future |
| Check-in rhythm (time-consistency) | P optional | checkin timestamps | future (zero new input) |
| Steps/device | P | HealthKit via Capacitor | Phase 3 — bands make it shame-free on arrival |
| WHO-5 | validation only | monthly optional | **ships with v2.1**, never in score |

**THE NEVER LIST (canon, publish on methodology page):** never weight/calorie tracking · never medication tracking · **never chat-sentiment scoring** — conversations with Riley are a confessional, not an assessment; chat may invite a check-in, it is never itself one.

## 12 · SCHEMA, EVENTS, MONITORING

Schema as v2.0 (`user_clarity_config`, `user_dim_baselines`, `user_daily_state` additions) plus: `daily_checkins` columns `energy int, sleep_quality int, heaviness int, outside bool, connection bool, hard_day bool, craving int`; `user_daily_state.provisional bool`; `hard_dates(user_id, date, label)`; `life_events(user_id, tagged_at, kind, recalibrated bool)`.
Events: `clarity_recomputed` (Tier-1 only), `clarity_config_changed`, `clarity_frozen/unfrozen`, `first_light_started/ended`, `hard_day_flagged`, `clarity_provisional`.
**Monitoring (NEW, right-sized):** monthly Supabase job — input & score distribution vs prior month (mean/σ/quantiles), WHO-5 correlation refresh, alert to admin digest on >1σ population shift. `clarity_version` stamping = the recalibration audit trail.
**Transparency line (NEW):** methodology page + Terms state Clarity is an automated, algorithmic wellbeing signal — never a health measurement or diagnostic. (Pairs with SB 243 AI disclosure; EU AI Act-friendly.)

## 13 · VALIDATION — STAGED TO REALITY

- **Stage 0 (pre-launch, synthetic):** stress/outlier suite (§7 property tests); monotonicity checks on every input (sleep plateau = documented exception); weight perturbation ±25% + normalization variants → Spearman rank stability ≥ 0.9; gaming suite (decline-then-easy-win; single-spike; config-dump attempts); individual-fairness property test — identical behavior sequences yield identical scores.
- **Stage 1 (first 90 days):** WHO-5 correlation (target r ≥ 0.5 to publish); **perceived-direction validity** — weekly lighter/heavier answer vs computed D sign (agreement ≥ 65% = the "really shows change" proof, self-anchored); narration ±5 threshold audit (fires on signal, not noise).
- **Stage 2 (~1,000 members):** variance-based sensitivity (Sobol-style) if Stage-0 perturbation showed instability; calibration *review* (not probability calibration — see §14); weight tuning informed by outcome correlations, decided by founder, versioned.

## 14 · EXTERNAL REVIEW — ADOPTED / REJECTED RECORD (July 2026)

**Adopted:** explicit normalization documentation (§3–4, §7 tables) · plausibility bounds & outlier capping (§7) · formal missing-data policy + provisional state (§6) · monotonicity acceptance tests (§13) · drift monitoring, right-sized (§12) · algorithmic-transparency disclosure (§12) · individual-fairness property test (§13) · staged sensitivity analysis (§13).
**Rejected, with reasons:** *Probability calibration (Platt/isotonic)* — category error: Clarity is a formative motivational index, not a predictive classifier; mapping it to "probability of wellness" manufactures a quasi-clinical claim the product must never make. *PCA/FA-derived weights* — optimizes variance explained, not the motivational construct; expert/value weighting is legitimate composite practice when documented and sensitivity-tested (now is). *Demographic fairness audits (parity/equalized odds by age/gender/ethnicity)* — impossible by design: Riley collects no protected attributes, and collecting them to audit would be the worse privacy harm. Fairness stance = **fairness by architecture**: personal baselines, individual accommodations (customization, fuel opt-out, hard-day flag), individual-fairness testing. Stated publicly on the methodology page. *Numeric F/P/D decomposition in-app* — conflicts with locked "never shows the math" doctrine; narration + public methodology carry transparency. (Founder-reversible.) *Age-stratified sleep norms* — deferred; 7–9h adult plateau + individual accommodation suffices without demographic collection.

## 15 · MIGRATION & ACCEPTANCE (delta from v2.0)

Migration unchanged (version stamping; baseline backfill; sobriety lane auto-offer with opt-out; founder-voiced upgrade message).
Acceptance criteria = v2.0's thirteen, plus: (14) check-in ships §2 fields ≤20s median completion; (15) hard-day flag widens bands/suppresses negative narration/never lowers score (property test); (16) provisional state renders at confidence <0.35 — no number shown; (17) plausibility clamps + spike test (<12-pt layer move from any single day); (18) monotonicity suite passes, sleep exception documented; (19) craving ≥4 surfaces Emergency Craving Protocol within the check-in flow; (20) weekly perceived-direction answer stored and correlated in Stage-1 job; (21) monthly drift job emits to admin digest; (22) methodology page includes transparency line + Never List; (23) first-login card appears only after the score renders and never obscures it; (24) second-login pane appears only post-check-in, never blocks chat, and "Keep the standard setup" completes the flow permanently in one tap; (25) onboarding config choices don't consume the one-change-per-7-days budget; (26) day-14 tune-up suggestion reflects actually-logged behavior (property test: suggested dims ⊆ dims with ≥4 active days in First Light); (27) gap length never appears in any member-facing string (grep-level + narration test across all tiers); (28) return check-in writes exactly one app-day row — no backfill; (29) Re-Light display is rise-only for its window (property test); (30) notification de-escalation schedule enforced (3 unanswered → weekly; 30d → single message then quarterly); (31) every check-in render reproducible from checkin_context; all skin variants pass Sentinel and preserve spine semantics (paraphrase-lock test); (32) each tier's check-in variant completes ≤20s median; (33) dynamic-slot answers never enter any dimension computation (data-path audit).

---
*Design record: v2.3 July 2026 — return-cadence tiers + Re-Light + anti-nag schedule + spine/skin dynamic check-ins (template-bank v1); v2.2 — customization onboarding (three-touch flow: aware → choose-with-defaults-escape → memory-powered tune-up); v2.1 — check-in expansion (energy, quality, heaviness, toggles, compassion flag, craving), provisional state, input hygiene, right-sized monitoring/validation, fairness-by-architecture stance, external review dispositions logged. Principle unchanged: distance traveled, not distance from perfect.*
