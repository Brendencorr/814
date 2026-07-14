# Riley — Deploy & Change Log

**Shared coordination log for parallel Claude Code sessions.** Multiple sessions deploy to
`main` at any given time. Before you start: `git fetch && git log --oneline -5` + read the top of
this file. After you ship to production: **append an entry here (newest first) in the same commit
or the next one, then push.** This is how each session knows what the others already changed.

Format per entry: `date` · `commit` — one-line summary · then bullets of what/why + files touched.
Keep it benign — this file is committed to a public-served repo, so **never put secrets here**.

---

## 2026-07-14

### Signup: First + Last + Email required at onboarding; optional nickname
- **Why:** Brenden wants First, Last, and Email mandatory at signup, with a "what should I call you"
  nickname optional. Signup is Google OAuth + magic-link (no signup form) and both already require an
  email, so the enforcement point for First/Last is onboarding Screen 2 (pre-filled from Google).
- **What:**
  - migration `094_member_name_fields.sql`: `first_name` + `last_name` on user_profiles (nullable at the
    DB - the onboarding UI enforces them; existing pre-change profiles stay valid). APPLIED to prod.
  - `onboarding.html` Screen 2: was a single "what should I call you" field -> now First (required) +
    Last (required), pre-filled from Google given/family name (or split full_name; blank for magic-link),
    email shown read-only, plus an OPTIONAL nickname. `preferred_name` stays the nickname and DEFAULTS to
    first_name when skipped, so every existing consumer of preferred_name works unchanged. full_name is
    kept in sync as "First Last".
  - `auth-handler.js`: profile auto-create now splits Google's name into first_name/last_name; added them
    to the allowed update fields + the account-clear map.
- **Verified:** migration live (columns present); onboarding inline JS syntax clean; name screen rendered
  + driven in a harness - required First/Last guard fires, no-nickname defaults preferred_name to the first
  name, an explicit nickname is kept distinct. Files: onboarding.html, auth-handler.js, migration 094.
- Note: existing pre-change members have null first/last (fine - mostly test accounts; could backfill from
  full_name later). login.html unchanged (email is already required on both signup paths).

## 2026-07-13

### Riley v2.3 - two-tier restructure + Clarity tier split (multi-commit; see V2.3_BUILD_LOG.md)
- **Why:** Collapse to two tiers - Guide (free) + Companion ($19, price held) - folding all Coach features
  into Companion; Mentor removed; "Coach - coming soon" teased (Community + Upload-your-history). Clarity
  gets a free "Foundation" vs paid "full" split. Per the v2.3 handoff spec.
- **Batch 1 (this commit) - two-tier feature collapse (additive, no member loses anything):**
  `entitlements.js` - any paid membership now unlocks every former-Coach feature (Life Map, adaptive plans,
  proactive, program library, finance) by granting the legacy feature-keys into the unlock set; plan resolver
  normalizes coach/mentor/concierge -> companion. `tier-utils.currentTier()` collapses coach/mentor/concierge
  -> companion (no live "coach" role returned). Server gates that were Coach-only now include Companion
  (int-session, program-content, program-list incl. interactive-program ownership, plan-adapt-cron, library/
  match-content/client-alerts TIER_RANK). `riley-chat.js` system prompt rewritten to two tiers +
  tracking-vs-watching language + Coach-coming-soon; selling rules fold Coach into Companion.
- **Still to land tonight:** DB migration (coach/mentor subs -> companion + founding_member comp), Stripe
  catalog collapse, Mentor removal from HTML/operator + Coach-coming-soon teaser, pricing page (behind flag),
  Clarity score_mode split, habit per-habit inclusion, dashboard/nav. Held for sign-off: migration email,
  pricing flip, live Stripe billing changes on real Coach subs. Details/flags in V2.3_BUILD_LOG.md.

### Operator data correctness + missing signup/cancel/refund/crisis alerts (verify-against-DB fix)
- **Why:** Operator reported paid members showing as unpaid and emailed members showing as not, plus never
  receiving signup/cancel/refund/crisis emails. Verified against the live DB: data was correct, the reads
  and the alert wiring were not.
- **Root causes found:** (1) `admin-home.js` + `admin-engagement.js` derive tier/paid from the entitlement
  view `user_active_products` ONLY; a Stripe-checkout Companion/Coach lands in `subscriptions` but not that
  view - so payers rendered as "guide/unpaid" even though `entitlements.js` (member gate) bridges from
  subscriptions and DOES unlock them. Single-source-of-truth violation. (2) The operator "Welcome email"
  column tracked *welcome* only; self-signups never get one, so members with 5-6 briefs read as "never
  emailed". (3) No operator EMAIL on signup (push only) / cancel / refund - the Stripe webhook notified
  no one. (4) `safety-alert.js` emailed `SAFETY_ALERT_EMAIL` and **silently skipped if unset** - almost
  certainly why the one real crisis (Jul 3, L2) never alerted.
- **Fixes:** admin-home/admin-engagement now apply the SAME subscriptions→owned bridge entitlements.js uses
  (payers show paid) + expose `emailed` (any email); operator "Welcome email" column → "Emailed" (any email).
  New `operator-email.js` choke point (`notifyOperator`) with a GUARANTEED address
  (`OPERATOR_ALERT_EMAIL`|`SAFETY_ALERT_EMAIL`|brenden@meetriley.us), logged to email_log by construction;
  wired into signup (auth-handler) + webhook (new sub / program purchase / cancel / refund / dispute).
  `safety-alert.js` now defaults to that same guaranteed address (never silently skips) and logs every alert
  to email_log (kind='safety_alert', METADATA ONLY - no crisis content). New operator-gated
  `admin-test-alert.js` + a "Send test alert" button in the Safety Queue to prove the pipeline live anytime.
  Removed a would-be double welcome (lifecycle guide flow already sends the member welcome).
- **Left for Brenden:** confirm **brenden@meetriley.us** is a deliverable mailbox (alerts default there);
  optionally set `OPERATOR_ALERT_EMAIL` / `SAFETY_ALERT_EMAIL` in Netlify to override; click **Send test
  alert** in the operator Safety Queue to confirm delivery end-to-end.
- **Files:** netlify/functions/operator-email.js (new), admin-test-alert.js (new), safety-alert.js,
  stripe-webhook.js, auth-handler.js, admin-home.js, admin-engagement.js, operator.html.

### M-1: security headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors)
- **Why:** the app shipped no security headers (no _headers file, no [[headers]] in netlify.toml). For
  a PWA holding recovery + mental-health conversations, frame-ancestors alone kills clickjacking on the
  chat. Compliance finding M-1.
- **What:** added a `[[headers]]` block for `/*` in netlify.toml: Strict-Transport-Security (1yr +
  includeSubDomains + preload), X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff,
  Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy (geo/cam/mic off, payment self),
  and Content-Security-Policy frame-ancestors 'self'. Verified ALL app framing is same-origin (chat
  widget + operator site-preview both load relative srcs via location.origin), so SAMEORIGIN/'self'
  does not break them.
- A full script/style/connect CSP is DEFERRED as a Report-Only follow-up - the pages are inline-heavy
  (onclick handlers + inline script/style everywhere), so an enforcing CSP needs 'unsafe-inline' or a
  nonce refactor plus careful testing against Supabase/PostHog/Stripe/Google Fonts. File: netlify.toml.

### M-2: legal entity name corrected to the registered name (The 814 Project, LLC d/b/a Riley)
- **Why:** ToS, Privacy, and page/email footers named "The 8:14 Project, LLC," but the registered
  Montana entity is "The 814 Project, LLC" (Filing C1656090). Naming an unregistered entity in the
  contracts weakens the liability shield. Compliance finding M-2; Brenden chose the d/b/a Riley form.
- **What:** replaced all 24 mentions of "The 8:14 Project, LLC" with "The 814 Project, LLC" across 11
  files (terms, privacy, safety, all marketing-page footers, and the email footers in
  comms-templates.js). Added "d/b/a Riley" at the two defining mentions and the two contact/notice
  blocks in terms.html + privacy.html. The "8:14" origin story is untouched - only the legal entity
  name changed.
- 🔴 Recommend a counsel glance at the final wording. Files: terms.html, privacy.html, safety.html,
  home.html, about.html, blog.html, help.html, data.html, resources.html, pillars.html,
  netlify/functions/comms-templates.js.

### M-3 completion: route 9 inline-gated admin endpoints through hardened requireOperator
- **Why.** The earlier M-3 work hardened `requireOperator()` in `supabase-client.js` (constant-time
  compare + CORS allow-list) and ~27 functions already call it, but these 9 admin endpoints still
  carried their OWN inline gate (`const provided = ...; if (provided !== expected) return 401`) - a
  timing-leaky `!==` string compare AND a wildcard `Access-Control-Allow-Origin: *` on the reject
  reply. Each now calls the shared gate, so the timing-safe compare + origin allow-list apply
  everywhere and there is a single source of truth for operator auth.
- **What.** In each file: added `requireOperator` to the `./supabase-client` require, and replaced the
  inline OPERATOR_KEY-read + 503 + provided-read + 401 block with
  `const gate = requireOperator(event); if (gate) return gate;`. OPTIONS preflight, method checks, the
  `json()` helper, the module-level CORS const, and all business logic/success responses are unchanged.
  Files: `admin-home.js`, `admin-content.js`, `admin-pricing.js`, `admin-safety.js`, `admin-users.js`,
  `admin-programs.js`, `admin-attribution.js`, `admin-membership.js`, `admin-engagement.js`.
- **Follow-up (separate).** Success responses on these endpoints still use `Access-Control-Allow-Origin: *`
  from each function's own CORS const; tightening those to the allow-list is left as its own change so this
  one stays a pure auth-gate consolidation.
- **Verified.** All 9 `node --check` clean; each file has requireOperator twice (require + handler); no
  `provided !== expected` or inline `process.env.OPERATOR_KEY` remains in any of the 9; no em-dashes added.

### Tier repositioning — "how close do you want Riley?" (messaging only, prices unchanged)
- **Why:** The tiers read as feature-count ("what you get"). Repositioned to relationship depth so members
  decide on what they get FROM Riley, not price (money secondary, Brenden-approved). Every plan already
  unlocks every topic; only how much of Riley is beside you changes.
- **What:** One canonical copy deck (`POSITIONING.md`, force-404'd) drives verbatim taglines everywhere:
  Guide = "Riley shows you where you stand." · Companion = "Riley walks with you." (memory → never explain
  yourself twice) · Coach = "Riley moves you forward." Applied to home.html tier cards + compare table; DB
  `products.blurb` (reset_free/companion/coach); Riley's own prompt (riley-chat.js); Stripe catalog
  (stripe-catalog.js); programs.html upgrade modal now leads with the plan tagline. Unified the Coach memory
  pillar to ONE name **Life Map** (was "Knowledge Graph") across 17 app pages + Riley prompt + lifemap lock.
  Dropped inline "$34/mo" from in-app lock cards (lifemap/workouts/nutrition) — value-forward; price lives on
  the pricing page/checkout. Compare-table row "Long-term memory" → "Riley remembers you".
- **Verified:** grep-clean (no old taglines, no stale inline prices in member HTML, no member-facing
  "Knowledge Graph"); no em-dashes in new copy; riley-chat.js + stripe-catalog.js `node --check` pass.
- **Left for Brenden:** re-run **stripe-setup** (operator) to push the new Companion/Coach descriptions to
  LIVE Stripe; confirm Netlify deploy GREEN. Lifecycle emails (comms-templates.js) already embodied the
  framing in first-person Riley voice — intentionally untouched. Prices unchanged.
- **Files:** POSITIONING.md (new), netlify.toml, CLAUDE.md, home.html, netlify/functions/riley-chat.js,
  netlify/functions/stripe-catalog.js, programs.html, lifemap.html, workouts.html, nutrition.html, + 14 more
  pages (Life Map rename); DB `products.blurb` updated live (not in git).
### Fix: nav "Get Started" bypassed tier selection/checkout
- **Why:** The upper-right "Get Started" button on every marketing page linked straight to /login -> Google
  -> onboarding, skipping the membership/plans choice entirely (users only saw tiers if they scrolled). Free
  and paid alike were dropped into free signup with no checkout.
- **What:** Repointed the nav "Get Started" button to the membership section (home: `#programs`; other pages:
  `/home#programs`) so every visitor lands on the plan cards and chooses a tier first. Guide -> free signup;
  Companion/Coach -> the existing data-cta path (waitlist now, Stripe checkout when payments go LIVE). Hero
  "Start free" and the paid card CTAs were already correct and are unchanged. Files: home/about/blog/pillars/
  resources/data/help/terms/privacy/safety.html.

### Clarity v2.2 — §2 weekly perceived-direction + life-event recalibration (final spec gaps)
- **Why:** Close the last two §2 items: the weekly validation signal (§13 Stage-1 needs it) and the
  life-event "meet you where you are" recalibration. Both tables existed; nothing wrote them.
- **What:** (1) **Weekly card** (dashboard, v2 members, Sun/Mon member-local, once/week until answered):
  "Compared to last week, this week felt lighter / about the same / heavier" + "one small win" →
  `clarity_weekly` (owner-RLS upsert); event clarity_weekly_answered. This is the perceived-direction
  correlate the drift cron already reads. (2) **Life-event recalibration**: a "Life changed recently?"
  affordance in the setup pane (Moved / A loss / Job change / Something else) writes `clarity_life_events`
  (recalibrate, window_days 14); `clarity-v2-write` reads active windows and passes `recalibrating` to the
  engine, which WIDENS the Practice bands (lo→0.5B, same one-directional care as a hard day - never lowers).
  Property test added (recal never scores lower). Stage-0 now 26/26. Files: dashboard.html,
  clarity-setup.html, clarity-engine.js, clarity-v2-write.js, tests/clarity/runner.js.
### Clarity v2.2 — full three-touch onboarding (§10) + grief lane UI
- **Why:** Complete the spec's onboarding flow correctly (the modal I'd built violated §10/§15.23
  "an in-screen card, not a modal that blocks the number") and expose the grief lane.
- **What:** Dashboard onboarding is now IN-SCREEN CARDS that never obscure the score. **Touch 1**
  (stage 0): card under the hero - "you can choose what it watches" [Customize now][Later];
  Later defers (event clarity_customize_deferred, stage 1). **Touch 2** (stage 1 + the day's
  check-in done): the pane opens automatically (once/session, never before the check-in, never
  blocks chat). **Touch 3** (day-14): tune-up suggesting ONLY dims the member logged >=4 days in
  the window (§15.26) - pre-named in the copy; accept adds them, adjust opens the pane, dismiss is
  silent; no suggestions = silently complete (no nag). clarity-setup.html: Focus lanes now show a
  **grief lane** (opt-in, presence-only) alongside the tracker-gated sobriety lane, plus a "Keep the
  standard setup" one-tap completion (§10 Touch-2). Events: clarity_customize_shown/deferred,
  clarity_tuneup_offered/accepted. Files: dashboard.html, clarity-setup.html.
### Clarity v2.2 — spec-alignment fix: sobriety is an opt-in Focus Lane, NOT the Foundation
- **Why:** Live review caught a real mismatch - the pane + methodology framed sobriety as "the
  Foundation, always on, can't toggle off." Per spec §1/§5 it's an OPT-IN Focus Lane INSIDE Practice
  (12 of P's 40), auto-offered to trackers but opt-out-able. Not everyone is in recovery; Clarity
  must never assume it. (The engine MATH was already correct - lane in Practice, 12/40, density^0.8.)
- **What:** (1) clarity-config-util validateConfig gains lanes:{sobriety:bool}; (2) clarity-v2-write
  lane gating is now hasTracker && config.lanes.sobriety!==false (auto-on for trackers, honors opt-out) -
  was force-on. (3) clarity-setup.html restructured into the spec's THREE sections (§10): Foundation
  (locked - steadiness/rest always on, only Fuel toggles), What you're working on (practices, pick 3-5 +
  live counter), Focus lanes (opt-in sobriety, shown only to trackers, toggleable). (4) clarity-method.html:
  Foundation named as steadiness/rest/fuel; sobriety reframed as an opt-in lane in Practice; Never List
  completed with canon items (never weight/calorie, never medication, never chat-sentiment). Engine
  unchanged - Stage-0 still 20/20. Files: clarity-config-util.js, clarity-v2-write.js, clarity-setup.html,
  clarity-method.html.
### Clarity v2.2 — customization UX pass (from Brenden's live test)
- **Why:** Live feedback on the Phase C pane + entry: sobriety note with no matching control, nourishment
  split into its own confusing section, the top-banner entry was easy to miss, and no permanent way back.
- **What:** `clarity-setup.html` = ONE unified "What counts toward your Clarity" list (nourishment folded in as a
  row; Movement/Reflection copy broadened to cover workouts/walks + journaling/meditation/breathwork; a **locked
  "Sobriety - Always on"** row now renders for members who track it, so the note has a matching control). Dashboard
  entry is now a **centered modal** (X / "Not now" / Personalize) instead of a banner - all three record the
  onboarding stage via a new `clarity-config` `seen` action, so it **never re-pops**; first-run = stage 0, day-14
  tune-up = stage<3. After dismiss/save it lives permanently in **Settings → Clarity** (new gated card:
  Customize + How Clarity works), shown only to v2-engine members. Note: new *measurable* dims (each needs a data
  signal) remain a future extension. Files: clarity-setup.html, dashboard.html, settings.html, clarity-config.js.
### H-3 + M-3 compliance fixes: anonymous crisis logging/alerts + operator gate hardening
- **H-3 (anonymous crises were invisible to the safety system).** The deterministic Level-3 988
  response already fired for anonymous visitors, but `logCrisis()` early-returned without a user_id
  and `sendOperatorAlert()` was gated on `user_id` - so a stranger's crisis produced NO crisis_log
  row and NO operator alert (the population most likely to be testing whether Riley is safe). Now
  anonymous crises are logged + alerted, keyed to the same `anon_id`/`ip_hash` already computed for
  the rate caps - NEVER to identity.
  - migration `090_crisis_log_anon.sql`: `crisis_log.user_id` now nullable + `anon_id`/`ip_hash`
    columns + a CHECK that every row is attributable to a member or an anon key (APPLIED to prod).
  - `riley-chat.js`: compute an `anonKey` before the crisis block; pass it to logCrisis + fire the
    operator alert for anon at Levels 2/3 (member-only `markLapseActive` left member-only).
  - `safety-alert.js`: new `sendAnonAlert()` - "Anonymous visitor" + anon key + excerpt, no profile
    lookup (anon chat is not persisted, so there is no stored conversation to attach).
  - `admin-safety.js`: the operator Safety queue now labels anon rows "Anonymous visitor" (was
    mislabeled "Member") and surfaces the anon key.
  - Post-hoc backstop scan for anon is DEFERRED - it would require storing anon excerpts, a retention
    decision for counsel (which the finding itself flags).
- **M-3 (operator gate hardening).** `requireOperator()` in `supabase-client.js`: the key compare is
  now constant-time (`crypto.timingSafeEqual` over SHA-256 of each side, was `!==`); CORS is no
  longer wildcard - the gate reflects an allow-list of meetriley origins only (success responses use
  each function's own headers, so this only touches rejection replies). Per-IP rate limiting on key
  guesses is scoped as a deliberate follow-up (needs an async refactor across ~25 call sites, or an
  edge-layer limit - not something to rush pre-launch).
- **Verified:** touched functions `node --check` clean; requireOperator unit-tested (correct key
  opens gate, wrong key 401, ACAO reflects meetriley + omitted for other origins, no wildcard);
  migration 090 confirmed live (user_id nullable, anon cols present, CHECK in place). Files:
  `riley-chat.js`, `safety-alert.js`, `admin-safety.js`, `supabase-client.js`,
  `supabase/migrations/090_crisis_log_anon.sql`.

### Clarity v2.2 — Phase D: monitoring cron + methodology page
- **Why:** Watch the v2 engine over time (catch drift before/after cutover) and give members a
  plain-language, trust-building explanation of what Clarity is and - crucially - what it never does.
- **What:** `clarity-drift-cron.js` (monthly, scheduled + operator-triggerable, gated + fail-open):
  records the v2 distribution (n, mean, p10/50/90, provisional/frozen rates, mean F/P/D), WHO-5
  convergent-validity Pearson r (same-day), perceived-direction agreement (weekly self-report vs
  Direction), and month-over-month drift flags to `clarity_monitoring` (migration 089). Correlations
  return null until ≥20 paired points (pre-launch = nulls, by design). `clarity-method.html` = member
  methodology page: the three layers in plain words, hard-day/first-days/sobriety handling, and the
  Never List (never a grade/diagnosis, never compares you to others, never punishes a hard day, never
  shows raw math, never judges). netlify.toml cron "0 13 1 * *". Stage-0 property tests already 20/20.
  Verified: cron syntax + pearson sanity + migration applied. Files: clarity-drift-cron.js,
  clarity-method.html, supabase/migrations/089_clarity_monitoring.sql, netlify.toml.

### Clarity v2.2 — Phase C: customization onboarding + config engine (DARK)
- **Why:** Members choose what "showing up" means for them - which Practice dims count + whether
  nourishment is tracked - so Clarity measures their own life, not a fixed template (§10).
- **What:** `clarity-config.js` (member endpoint, token-auth) with get/save; `clarity-config-util.js`
  (pure: validateConfig + effectiveConfig pending-promotion + nextAppDay). Guards: max 1 change/7d
  (onboarding-origin exempt), normal changes apply NEXT app-day (4am), onboarding applies now,
  config_version bumps on effect. `clarity-setup.html` = the customization pane (toggle Practice dims +
  fuel opt-out; sobriety always counts, never toggleable). Dashboard shows a gated entry card (touch 1:
  first setup · touch 3: day-14 tune-up) - only when the onboarding flag is on (dark by default).
  `clarity-v2-write.js` now reads the pending-aware effective config. Migration 088 already added the
  preview flag. Verified: config-util unit tests (validate/dedupe, promotion, next-app-day) + all inline
  scripts syntax-clean. Files: clarity-config.js, clarity-config-util.js, clarity-setup.html,
  clarity-v2-write.js, dashboard.html, netlify.toml.

### Age gate (18+) — H-2 compliance fix: enforce the 18+ representation, don't just claim it
- **Why:** ToS §2 / Privacy §10 represent the Service as 18+, but nothing enforced it - Google OAuth signup +
  the 10-screen onboarding collected no age. Minor-protection provisions carry the heaviest obligations in every
  state law reviewed (Oregon: private right of action at $1,000/violation). Compliance-review finding H-2.
- **What:** date-of-birth gate in `onboarding.html`, placed RIGHT AFTER the name screen - BEFORE Screen 3 ("what
  brings you here") collects any grief/sobriety answers - so a self-identified minor is denied before we store
  anything sensitive. Month/Day/Year selects -> `ageFrom()` -> `sUnder18()` deny-and-explain (kind copy + 988 /
  Crisis Text Line 741741 / 911 + a "go back" escape for a mistyped date). On pass: stamps `age_attested_at` +
  `age_18_plus:true` next to `consent_at`/`consent_version`. We do NOT store the birthdate - only the confirmation
  + timestamp (privacy-forward, Brenden's choice).
- **DB:** migration `088_age_attestation.sql` adds `age_attested_at timestamptz` + `age_18_plus boolean` to
  `user_profiles` (APPLIED to prod). Privacy §10 "Children" updated to describe the attestation.
- **Verified:** inline JS syntax clean; age screen + deny screen + 18+ pass + empty-guard rendered & driven in a
  throwaway browser harness (deleted, never committed); boundary correct (turns-18-today passes, exactly-17
  denies); SAVE payloads confirmed (false/true, no DOB). Files: `onboarding.html`, `privacy.html`,
  `supabase/migrations/088_age_attestation.sql`.

### Clarity v2.2 — Phase B (part 2): DARK shadow write wired into state-engine
- **Why:** Start computing v2 alongside v1 on every Tier-1 event, storing it in SEPARATE columns, so Phase A.5
  can shadow-verify v2-vs-v1 on real member rows. Still 100% invisible (cutover flag is 'v1').
- **What:** new `netlify/functions/clarity-v2-write.js` (`writeClarityV2Dark`) — gathers the richer 28-day
  signals (energy/sleep_quality/heaviness/outside/connection/craving series + hard_dates + config + membership
  day + core history + freeze state), calls the pure `clarity-engine`, ratchets each Practice dim's personal
  baseline (`user_dim_baselines`), and writes the v2 columns (`clarity_v2`/`provisional`/`clarity_core`/
  `f_score`/`p_score`/`d_score`/`v2_breakdown`/`config_version`/`frozen`) on today's `user_daily_state` row.
  `state-engine.js`: one `require` + one guarded call AFTER the v1 upsert (skipped on crisis cycles).
- **Safety:** fully dark + non-fatal — the call is wrapped in try/catch and runs only after the v1 upsert has
  already committed, so a v2 exception can NEVER corrupt v1. Scoring uses the pre-update baseline ("distance
  traveled"), then the baseline ratchets for next time. Verified with a mock-Supabase end-to-end smoke test
  (sane 0-100 scores, exact α_up ratchet, correct column payload) + engine tests still 20/20. Files:
  `netlify/functions/clarity-v2-write.js` (new), `netlify/functions/state-engine.js`.

### Clarity v2.2 — Phase B (part 1): the engine module + Stage-0 property tests (isolated, unwired)
- **Why:** Build the actual F/P/D scoring math for Clarity v2.2 — the delicate, member-facing part — as a pure,
  isolated, test-gated module BEFORE it touches anything live.
- **What:** `netlify/functions/clarity-engine.js` — dependency-free (no Supabase) so tests import it directly.
  Implements: Foundation (F1 steadiness / F2 rest / F3 fuel), Practice personal bands vs 28-day baseline + the
  asymmetric ratchet, Direction (EMA7 vs EMA28 of core), sobriety lane density^0.8, freshness decay + provisional
  state, First Light rise-only, hard-day band-widening, freeze snapshot, §7 input clamps. `tests/clarity/runner.js`
  — the Stage-0 property suite (§13): **20/20 pass** (bounds, determinism/individual-fairness, monotonicity, the
  documented non-monotonic rest plateau, band shape, direction sign, single-day outlier <12pt, ratchet asymmetry,
  provisional, First Light rise-only, freeze, hard-day-never-lowers). Added to `npm test`.
- **CTO decision:** the spec's `EMA7` for Foundation levels is realized as a 7-day MEAN — an EMA(α=0.25) let one
  bad night swing a layer ~17pt, violating the §7/§15 "<12pt per day" acceptance criterion; the member-trust
  robustness criterion wins. EMA is kept for Direction (trend). Calm/volatility stays intentionally reactive
  (documented exception, like non-monotonic rest).
- **Zero production impact:** nothing imports the engine yet. Next (Phase B pt 2): wire it into `state-engine.js`
  as a dark, try/caught second write to the v2 columns; then Phase A.5 shadow-verify. Clarity stays DARK on v1.

### Check-in v2 UX fixes: time-aware, one merged screen, dynamic note response
- **Why:** operator feedback on the new (Phase A) check-in — (1) at 8am it asked "Today was a hard day?"
  (nonsensical - morning reflects on yesterday); (2) the two grouped screens read as duplicates; (3) after the
  member shared "great weekend camping with friends", Riley gave a canned card + generic "no rush..." line
  instead of responding to what they said.
- **What (`chat.html`):**
  - **Time-aware:** morning check-in now frames the v2 fields around last night / yesterday (energy this morning,
    sleep last night, "how heavy yesterday felt", "Got outside yesterday", "Yesterday was a hard day"); midday/
    evening use today. Craving prompt time-framed too.
  - **One screen:** merged the two grouped screens into a single `rcQuickCheck` (scales + taps together), which now
    **echoes the member's answers** as a user bubble so an answered screen reads Q→A, not a stray prompt.
    Removed `rcMultiScale`/`rcMultiTap`.
  - **Dynamic note handoff:** when the member writes a check-in note (and it's not a concerning trend), Riley now
    responds to it for real via the LLM (`rcRespondToNote` streams a genuine, contextual reply from riley-chat and
    leaves the floor open) instead of the canned give-one-thing card + generic handoff. Escalation/crisis paths
    unchanged; no-note check-ins keep the give-one-thing card.
- Clarity v2 stays DARK; this is check-in UX only. Escalation updated to 1-5 heaviness (>=4).
### Promo-code capture - stamp coupon onto subscription + surface in admin (`059963e`)
- **Why:** The operator "coupon" filter in Client Overview was always returning null because
  coupon redemption was never stored in the DB - it lived only in Stripe.
- **What:** `stripe-webhook.js` now calls `captureCoupon()` after granting access on
  `checkout.session.completed`. Reads `session.discounts[]` first; falls back to one Stripe GET
  on the subscription object. Stamps `stripe_coupon_id` (internal) + `promo_code` (human code
  the customer typed) onto the subscription row. Non-blocking / fault-tolerant - grant never fails.
  `admin-home.js` + `admin-engagement.js` now read those columns from the DB instead of returning
  hardcoded null. `operator.html` Client Overview filter bar has a new "Promo/coupon" dropdown
  (has / none). Migration `087_subscription_coupon_capture.sql` = repo record (columns already applied).
- **Files:** `stripe-webhook.js`, `admin-home.js`, `admin-engagement.js`, `operator.html`,
  `supabase/migrations/087_subscription_coupon_capture.sql`

### Clarity Score v2.2 — Phase A: schema + expanded check-in (DARK, additive)
- **Why:** Rebuilding the member Clarity score from v1.0 (flat weighted avg) to the v2.2 three-layer
  Foundation/Practice/Direction engine ("distance traveled, not distance from perfect"). Multi-session epic;
  everything additive + DARK — v1 stays authoritative and untouched until an explicit cutover flag flip.
  Full spec in `docs/CLARITY_SCORE_v2.2.md`; plan of record in `.claude/plans/typed-foraging-seahorse.md`.
- **What (this phase):** migration `086_clarity_v2_schema.sql` (APPLIED) — additive, idempotent: `daily_checkins`
  += energy/sleep_quality/heaviness/outside/connection/hard_day/craving; `user_daily_state` += v2 columns
  (clarity_v2, provisional, f/p/d_score, frozen*, v2_breakdown, config_version) alongside untouched v1 columns;
  new tables `user_clarity_config`, `user_dim_baselines`, `clarity_dims` (public-read 9-dim registry), `hard_dates`,
  `clarity_life_events` (distinct from the existing emotional-calendar `life_events`), `clarity_weekly`; RLS owner-only;
  seeded the cutover flag `site_content('clarity','engine')={engine:'v1'}` (DARK).
- **Check-in expansion (`chat.html`) — the ONLY member-visible change this phase:** the Riley-led check-in now
  captures the v2 fields via grouped screens (a `rcMultiScale` "quick reads" screen: energy + sleep hours + sleep
  quality + heaviness; a `rcMultiTap` screen: got-outside / talked-to-a-human / hard-day) + a lane-gated craving
  screen (sobriety only; craving>=4 surfaces the Emergency Craving Protocol). Kept ~20s via grouping; `postLock`
  mandatory-lock, fail-open handlers, single `daily_checkins` upsert, and the `/checkin-scan` crisis pass all intact.
  Escalation updated to the new 1-5 heaviness; hard-day tap also writes `hard_dates`.
- **Unchanged for members:** dashboard/brief still show the v1 score (flag on `v1`); no engine wired yet (Phase B).

### Operator: Home member table + Client Overview search/filter bar
- **Why:** operator Home showed rich-card rows (hard to scan 15 members quickly); Client Overview lacked name/email filters and no way to slice by paid vs free or by programs.
- **Backend (`admin-home.js`, `admin-engagement.js`):** both functions now return per member: `first_name`/`last_name` (split from `full_name`, first token = first, rest = last; falls back to `preferred_name`), `paid` (boolean - true if tier is companion/coach/mentor, derived from the already-loaded `user_active_products`), `has_purchases` (boolean - one-time program purchases from `purchases` table; `admin-engagement` adds it as a single bulk scan to the existing `Promise.all`), `welcome_email_sent` (boolean|null - `email_log` kind=welcome status=sent), `coupon` (null - coupon/promo redemption is NOT stored in our DB; requires live per-member Stripe call which is too slow for a list - logged in function comments as a flag; add a webhook that mirrors `discount.coupon.id` onto `subscriptions.stripe_coupon_id` to enable). No N+1 queries added; no existing behavior changed.
- **Home tab - Clients widget:** replaced the engRow card list with a proper scannable table: columns exactly First | Last | Email | Paid (Yes/No) | Sign-up date | Programs (Yes/No) | Welcome email (Yes/No). Sortable by First/Last/Sign-up date (click column header). Client-side text search across name+email. Each row opens the member panel on click (same as before).
- **Client Overview tab:** full names now shown in engRow (first_name + last_name when available, falls back to `name`). Replaced the old single search box with a full search+filter bar: text search (name+email), Paid filter (All/Paid only/Free only), Programs filter (All/Has programs/No programs), Sign-up sort (Newest/Oldest/Default). "Clear filters" button resets all. Filter state resets on each tab load. Existing features (member drill/detail, safety merge, billing panel, Add User, tier/state segment dropdown) all intact.
- **Files:** `netlify/functions/admin-home.js`, `netlify/functions/admin-engagement.js`, `operator.html`.
- **Verified:** both backend files pass `node --check`; operator.html JS passes syntax check; auth gates (401/503 on no/wrong key) unchanged; no other tabs touched.

---

## 2026-07-10

### Brand ethos band added to member app dashboard (`aed2ca1`)
- **What:** mirrored the three-line unattributed ethos ("Do hard things. / Do uncomfortable things. / Don't let small voices shake big dreams.") from home.html into dashboard.html as a quiet closing moment at the bottom of main content.
- **Design:** app-dark treatment - muted `var(--smoke)` text (not full parchment), faint gold hairline top only, no bottom border. Understated - this is a functional home, not a marketing page.
- **CSS:** app-scoped class names (app-ethos-band/eyebrow/lines) to avoid collision with home.html. Responsive with 700px breakpoint (matches dashboard sidebar breakpoint). clamp() font sizing.
- **home.html mobile verified:** no changes needed - clamp() + .wrap padding already handles narrow viewports cleanly.
- **Files:** `dashboard.html`.

### Social publishing HELD by default - nothing reaches FeedHive until the operator says go
- **Why:** Operator directive: do not publish anything to FeedHive until explicit go-ahead. Approvals defaulted
  to live, so an approve click would have scheduled real posts.
- **What:** New **`SOCIAL_PUBLISH_MODE`** with default **`hold`**, enforced at the single choke point
  `feedhive-publish.js` (every publisher path - content-queue + legacy pipelines - goes through it). In `hold`,
  the endpoint sends NOTHING to FeedHive (no posts, drafts, or media uploads) and returns `{held:true}`.
  `content-queue.js` treats a held response as **approved + queued** (job `state='queued'`, not failed), so you
  can still curate the launch set now. Go-ahead = set `SOCIAL_PUBLISH_MODE=draft` (FeedHive drafts) or `=live`
  (scheduled/live) in Netlify. Files: `feedhive-publish.js`, `content-queue.js`.

### Comms #3: proactive nudge respects quiet hours (per-member) + US-wide daytime run
- **Why:** the once-daily interactive-program nudge fired at a fixed 15:00 UTC = 8am PT / 11am ET (fine for
  current US members, but 15:00 UTC is 5am in Hawaii). Closes the last item from the quiet-hours audit.
- **`netlify.toml`:** `int-proactive-cron` moved 15:00 -> **18:00 UTC** = daytime in EVERY US zone incl Hawaii
  (8am HST) + Alaska (9-10am AKT) through Eastern (2pm ET).
- **`supabase-client.js`:** new shared `inQuietHours(tz)` (10pm-7am member-local, Denver fallback,
  `COMMS_DEFAULT_TZ` override) - **single source of truth** for the quiet-hours window.
- **`evaluate-comms.js`:** now imports the shared `inQuietHours` (removed its private copy) so the window
  can't drift between the two senders. Behavior identical.
- **`int-proactive-cron.js`:** the EMAIL channel is gated by the member's local quiet hours (fetch `timezone`;
  skip + count `email_quiet_skipped`). In-app `client_alerts` still fire for everyone (time-agnostic).
- **⚠️ PARALLEL SESSION:** `int-proactive-cron.js` was edited here. My change is only in the email-send region
  (profile select + send loop + response counter), NOT the `planForEnrollment`/batch-reads region. If you have
  local int-proactive changes, rebase onto this and they should merge cleanly. Commit `46e7b3a`.
- **Files:** `netlify.toml`, `supabase-client.js`, `evaluate-comms.js`, `int-proactive-cron.js`.

### Comms: audit follow-ups - member-local daily cap + unsubscribe = email-only
- **Why:** three gaps found while auditing the quiet-hours fix.
- **#1 member-local daily cap (`evaluate-comms.js`):** the "one lifecycle email per day" cap was measured
  in UTC - the same UTC-vs-local class as the timezone bug (this file was missed by the app-wide member-day
  sweep). Now evaluated in each member's local day via the shared `memberDay()` helper (4am rollover). We
  collect per-user non-transactional send times and compare against their own local "today."
- **#2 unsubscribe is email-only (`comms-unsubscribe.js`, `preferences.html`):** email unsubscribe stops
  EMAIL only; push is a separate channel by design. The one-click unsubscribe confirmation and the
  `/preferences` page now say so and point members to app Settings (verified `/settings` 200) to change push.
- **#4 truthful comment (`evaluate-comms.js`):** guide_1 (welcome) is sent by the CRON, not a signup hook.
  Behavior unchanged - routing the welcome through the cron is what makes it honor quiet hours + timezone.
- **Deferred #3:** make the once-daily proactive nudge (`int-proactive-cron.js`, fixed 15:00 UTC) per-member-tz
  for future HI/AK/international members. Held because a parallel session is mid-refactor on that file (N+1 ->
  batched reads); will land on top of their change to avoid a broken merge.
- **Files:** `evaluate-comms.js`, `comms-unsubscribe.js`, `preferences.html`. Commit `b4deb1d`.

### Comms: quiet hours now honor each member's real timezone (10pm-7am)
- **Why:** Company policy - members never hear from us between 10pm and 7am THEIR local time. Two people
  signed up one morning and got nothing; root cause (confirmed against the live DB): the hourly evaluator
  computed quiet hours in Mountain for EVERYONE - it never loaded the member's captured timezone, so a
  New York signup at ~10am ET still fell inside the Mountain "quiet" window and was held.
- **Fix (`evaluate-comms.js`):** profile select now pulls `timezone`; the snapshot carries
  `memberTz = prof.timezone || st.timezone`; the gate evaluates `inQuietHours(memberTz)`. Window moved
  9pm-8am -> 10pm-7am. Unknown tz falls back to America/Denver, never UTC (UTC would email a US member at
  ~2am). Timezone is auto-captured at onboarding (browser `Intl` -> `user_profiles.timezone`).
- **Onboarding (`onboarding.html`):** trust note on the notifications screen - "quiet hours ... never
  between 10pm and 7am your time." No new question, since the timezone is auto-detected.
- **Notifications already compliant:** reset-nudge + brief-delivery crons fire at the member's LOCAL
  chosen hour (daytime by design); only the email evaluator needed the tz fix.
- **Files:** `evaluate-comms.js`, `onboarding.html`. Commit `1c6c1b0`. COMMS_ENABLED is on; sends resume
  on the next hourly run for members currently in their daytime.

### Home: brand-ethos band added to marketing home page
- **What:** new `<!-- BRAND ETHOS -->` section placed between Cardinal and footer on `home.html`.
  Three-line brand mantra (unattributed, brand value standing on its own - not a testimonial):
  "Do hard things. / Do uncomfortable things. / Don't let small voices shake big dreams."
- **Design:** DM Serif Display, parchment text on ink background, faint gold hairline borders top+bottom
  (`rgba(201,168,76,0.15)`), "WHAT WE BELIEVE" eyebrow label. `clamp(22px,3.8vw,40px)` responsive type.
  Fully responsive, scroll-reveal animation, no em-dashes.
- **Files:** `home.html` only. Commit `213a280`. Verified live on meetriley.us.

### Mobile: fix the topbar greeting crowding the hamburger + mobile polish
- **Why:** Brenden reported the hamburger "overlapping Welcome, Brenden." Rendered the real dashboard topbar
  at 375px (harness + screenshot): the hamburger itself doesn't overlap (10px gap), but the greeting
  (19-22px serif) WRAPPED to multiple lines and collided with the right-side actions - that's the crowding.
- **Fix (global, `pwa.js`):** at <=700px the topbar heading (`.greeting`/`.tb-title`/`.topbar-greeting`) is now
  16px, one line, `white-space:nowrap` + ellipsis with `min-width:0` on its group so it shrinks/truncates
  instead of wrapping; `.tb-actions` pinned `flex-shrink:0`; topbar padding tightened (64px left to clear the
  hamburger, 14px right). Verified in an accurate harness: "Good afternoon, Brenden." now sits on one clean
  line with the bell + avatar to the right, no overlap. One change fixes every member page's topbar.
- **Polish (approved):** onboarding 0-10 ruler tightened at <=560px (gap 4px, `.rnum` min-width 22px);
  `chat-anon` send button + textarea 38px -> 40px (fuller tap target); `brief.html` focus/challenge/extra
  card rows now `flex-wrap:wrap` + `flex:1 1 140px` so they stack on very narrow phones.
- **Files:** `pwa.js`, `onboarding.html`, `chat-anon.html`, `brief.html`.

### Founder letter (guide_5): personalize the greeting with the member's name
- **Why:** Brenden's final letter opened "Hi," (built verbatim); he wants it personalized. The comms system
  is built for this - `admin-comms.js` renders the operator preview with `first_name:"{first_name}"`, so a
  template using `v.first_name` shows "Hi {first_name}," in the preview and "Hi Casey," at send.
- **What:** `guide_5` greeting → `"Hi " + esc(v.first_name || "there") + ","` (html) and the text twin.
  Verified: real send → "Hi Casey,"; operator preview → "Hi {first_name},"; missing name → "Hi there,".
- **Files:** `comms-templates.js`.

### `01c6258` - Privacy/trust: confidentiality bullet, 2nd-session reminder, Settings data card
- **Why:** three trust-building updates for a grief/recovery/addiction audience - honesty and control matter here.
- **Task 1 (onboarding.html):** added "Yours, and private" as the FIRST bullet on the Screen 9 consent screen. Honest about the safety exception ("The one exception: a real safety moment, used only to help you, nothing else."). Consistent with the footer that was already there - no contradictions.
- **Task 2 (pwa.js):** one-time, non-blocking soft toast on the member's 2nd session. Tracks via `riley_session_count` (localStorage, incremented once per browser session via `riley_session_counted` in sessionStorage) + `riley_privacy_reminder_shown` flag. Shows only after onboarding, skips if check-in is locked, auto-dismisses after 12s, links to /settings.
- **Task 3 (settings.html):** replaced the "Your data -> /dashboard#data" redirect row with a dedicated "Your data" card - Export, Delete data, and Delete account all one tap away. Export wires to the existing `auth-handler.js export_data` action (already existed; downloads `my-riley-data.json`). Delete data wires to `delete_data` action (clears data, keeps sign-in). Delete account unchanged (RileyDeleteAccount modal).
- **Files:** `onboarding.html`, `pwa.js`, `settings.html`.

### Mobile-readiness audit (all 38 pages) + fix the 2 real defects found
- **Why:** Confirm the PWA/website works the SAME on mobile (375px) as desktop, no rendering/UX breakers.
  Audited every client page 3 ways: baseline grep (viewport meta present on ALL 38), 3 parallel deep code
  audits (marketing / core app / feature pages), and live mobile renders of home + login (screenshot-verified,
  0 horizontal overflow). VERDICT: genuinely mobile-ready - fluid layouts, `overflow-x:hidden`, responsive
  grids with mobile breakpoints, and the member sidebar becomes a `pwa.js` hamburger drawer at <=700px.
- **Fixed (real breaker):** `conversations.html` had a hardcoded `grid-template-columns:280px 1fr` with no
  mobile override → the message thread was crushed to a sliver on a phone. Added a `.cv-split` class that
  stacks to 1 column (list capped 44vh) at <=700px. Now usable on mobile.
- **Fixed (conditional defect, 16 pages):** the locked-feature `wall()` overlay used `left:220px` (the desktop
  sidebar width), so on mobile (sidebar hidden) it started 220px in and squeezed the unlock card. Changed to
  `left:0` (full-screen lock; the card already has a "Back to Home" escape, so desktop is fine + now identical).
- **Reported, not fixed (owner's call):** marketing pages have no hamburger nav below 720px (section links only
  in the footer) - UX gap, not a breaker. Optional polish: onboarding 0-10 ruler is tight (fits), chat-anon send
  button 38px, brief.html two flex rows could add wrap. None block launch.
- **Files:** `conversations.html` + 15 pages (wall() one-liner). No JS logic changed; all pass `node --check`.

### 2-week all-Riley launch campaign (28 curated posts) + pause the auto web-engine
- **Why:** The launch should be a controlled, intentional Riley-promotion sequence, not the randomized
  web-topic pipeline. Operator wants 2 weeks of all-Riley posts (2/day) built + scheduled up front, reviewed
  daily; the autonomous engine switches on after launch.
- **What:** `content-run-background.js` gains a curated **`LAUNCH`** array (28 posts: intro → 8:14 story → who
  it's for → what Riley does → the Reset → pillars grief/burnout/body → slip → rebuild → 3am → Casey K. social
  proof → the offer) and **`seedLaunch()`** — inserts candidate+brief, renders each design (grounds engine),
  schedules **2/day (8:14am + 6:14pm MT)** starting tomorrow across 14 days, and drops them into Review
  (status 'designed' + scheduled_for). Idempotent (skip if already seeded; force:true to re-seed). Triggered via
  the handler `{mode:'launch'}` branch. Copy is hyphens-only, uses canonical lines verbatim, Casey's real quote.
- **Operator:** new **🚀 Seed launch** button in the Social Media tab (fires the background seed, then opens Review).
- **Pause:** `netlify.toml` comments the `content-daily-cron` schedule (the randomized daily run is off during
  launch). Re-enable after 2 weeks by uncommenting.
- **Files:** `content-run-background.js`, `operator.html`, `netlify.toml`.

### Streamlined social pipeline: agents build+schedule the whole post; one daily Review; Approve = live
- **Why:** Too many operator steps (approve copy → design → review → final approve → then log into FeedHive to
  schedule). The operator wants the agents to build each post COMPLETELY up front (design + caption + a scheduled
  time) and a once-a-day Review where Approve schedules straight to FeedHive (no second step), plus Send-back and Reject.
- **Pipeline (`content-run-background.js`):** design hook now points at the working grounds engine
  (`require("./content-design")`, was gated Canva `content-atlas`), so every post is rendered in the daily run.
  Extracted `buildPostFromCandidate()` (Sage → design → Sentinel → queue) + `assignSchedules()` — a scheduler agent
  recommends optimal Mountain-Time posting windows and a deterministic allocator places each into the next open,
  non-colliding future slot (DST-correct). Items now land as **`status='designed'` (Review) with a `scheduled_for`**
  (Sentinel-blocked → stays out of Review). New `regenerateItem()` for Send-back.
- **Lifecycle (`content-queue.js`):** **Approve** now = schedule LIVE to FeedHive at the post's `scheduled_for`
  (folds in the old `publish`; `publish`/`final_approve` are aliases). New **`regenerate`** action (agents rebuild
  the post). `feedhive-publish.js` honors an authorized `schedule:true` from the operator-gated caller →
  FeedHive `status='scheduled'`. Failsafe: **`SOCIAL_PUBLISH_MODE`** env (default `live`; set `draft` to revert).
- **Operator UI (`operator.html`):** **Review is the default tab** and each card shows the design + caption +
  **scheduled time** with Approve &amp; schedule / Send back to editing / Reject (+ swap-ground). Pending → **Needs attention** (blocked only).
- **DB:** migration `084` adds `content_approval_queue.scheduled_for` (applied). `netlify.toml`: `content-run-background`
  now bundles the grounds/fonts (it renders in-process).
- **Scope:** formats = post/story (carousel/reel follow-on); only IG+FB connected (per-platform routing follow-on).
- **Files:** `content-run-background.js`, `content-queue.js`, `feedhive-publish.js`, `operator.html`, `netlify.toml`,
  `supabase/migrations/084_queue_scheduled_for.sql`.

### Social publish actually reaches FeedHive: media upload + one-post-per-approval
- **Why:** After the design step worked, "Final approve" created jobs but FeedHive rejected every one
  ("FeedHive API error") so nothing hit Scheduled. Cause: FeedHive `POST /posts` attaches media by
  **uploaded media ID**, not URL - the code sent `[{type:'image',url}]`. Also Echo emits a package per
  platform (instagram/tiktok/linkedin) while `feedhive-publish` targets ALL connected accounts every call,
  so publishing each package would create duplicate drafts.
- **What:** `feedhive-publish.js` now implements the 3-step media upload (create session → PUT to S3 →
  complete → `med_` id) via `resolveMediaIds()`, accepts pre-uploaded `media_ids` OR `media` URLs, and a new
  `action:'upload_media'` (upload once, reuse IDs). `content-queue.js` publish uploads the design ONCE before
  the loop, passes `media_ids`, collapses to **one post per approval** (targets all connected accounts;
  per-platform account routing is a follow-up), and now records the real FeedHive error `detail` on failed jobs.
- **Files:** `feedhive-publish.js`, `content-queue.js`. FEEDHIVE_MODE=draft unchanged (nothing auto-posts).

### Comms restructure: founder Month-One letter (guide_5 @ day 29) + no upsell to paid + tier on send log
- **Why:** Brenden finalized the founder letter and restructured the Guide flow around it. Still DARK; current
  members remain walled off (`unsubscribed_lifecycle=true`).
- **The founder letter (`guide_5`):** replaced the interim copy with Brenden's FINAL, founder-authored "Month
  One" letter, verbatim, exact cadence (tight tercets via `<br>`, paragraph breaks via separate `p()`). The two
  em-dashes converted to hyphens per the standing brand rule. `from: brenden`, `replyTo: support@`,
  `author: founder`, subject "A note from the person who built Riley", NO CTA (sells nothing). Rendered
  standalone + screenshot-verified for spacing/cadence before shipping.
- **Timing:** `guide_5` moved from day 7 → **day 29** (active users only; Gone-Quiet owns the absent). It now
  owns the one-month moment. **`guide_7` RETIRED** (Riley's old day-30 "One month" note removed from templates,
  TRIGGERS, and the flow). The Guide flow now ends at guide_5. No day-7 email (Reset arc covers it, per spec).
- **No upsell to paid (Option A):** `guide_6` (the Companion pitch, day 12) now sends **only to Guide tier** -
  a Companion or Coach member never gets pitched a tier they already have. `guide_5` has NO tier gate, so every
  client, regardless of tier, gets the founder letter.
- **Tier on the send log:** new `email_sends.plan` column (migration 085); `evaluate-comms decide()` records
  each recipient's tier so the operator can see which tier every send went to. `node --check` passes, 0 em-dashes.
- **Files:** `comms-templates.js`, `evaluate-comms.js`, `supabase/migrations/085_email_sends_plan_column.sql`.

## 2026-07-09

### Riley Relationship Engine (slice 3-6): tenure-calibrated trust · pattern-noticing · milestones · deepening
- **Why:** Brenden gave auto-authority to build the rest of the structure that grows Riley's knowledge of each
  member over time. All four are additive prompt/data layers in `riley-chat.js` (`buildUserContext` +
  `getClientData`); crisis path untouched, no gender assumptions, hyphens only, model unchanged.
- **#3 Trust calibrated to tenure:** from `user_profiles.created_at`, a RELATIONSHIP STAGE directive - week 1
  "still earning trust, lead with listening"; <=30d "building a rhythm"; <=120d "established, be familiar";
  beyond "deep, direct like a long friend."
- **#4 Pattern-noticing:** a new recent-check-ins read (last 14) computes a check-in streak + recent-mood
  tone; surfaced as "PATTERNS YOU HAVE NOTICED" (reflect gently/rarely). Explicitly framed as warm colour,
  NOT a safety mechanism - crisis + check-in escalation still own risk. Only positive/steadying framings.
- **#5 Milestones + anniversaries:** computes whether today is a sobriety milestone (1/7/30/60/90/180/270/
  365/547/730d + yearly after) or a signup anniversary, and tells Riley to open with genuine warmth.
- **#6 Progressive deepening:** a KEEP LEARNING directive - when things are calm, Riley may occasionally ask
  ONE light new getting-to-know-you question (never in distress, never an interview).
- **Verified:** `node --check` passes, no em-dashes, riley-chat prod-healthy. Files: `riley-chat.js`.

### Riley Relationship Engine (slice 1+2): actively use memory + date-triggered open-loop follow-ups
- **Why:** Brenden - take the onboarding personalization into Riley's ongoing behavior so it "continually
  builds trust." Two highest-leverage pieces first: (1) Riley proactively USES what it knows (now that
  onboarding feeds real life-context into `riley_memory`), and (2) Riley follows up on time-bound things
  after they happen ("how did Thursday go?") - the single most "it actually cares" behavior.
- **What (#1 - active use):** `riley-chat.js` system prompt gains a "BUILD THE RELATIONSHIP" directive inside
  the memory block - Riley gently checks in on ONE specific thing it knows (their people, work, program, what's
  weighing on them) when the moment fits, never interrogating or reciting. Fires only when there are specifics.
- **What (#2 - open-loop follow-ups):** new **`member_followups`** table (migration 084) - date-triggered,
  kept SEPARATE from `riley_memory` so reconcile/decay/embeddings never touch these resolvable items.
  Capture: the existing (fire-and-forget, Haiku) `extractMemories` gains a `followup` facet with a resolved
  `due` date (today injected so "Thursday" resolves) → inserts `{content, due_at}` (deduped). Surface: the
  context loader pulls open follow-ups due within a 4-day catch window into an "OPEN THREADS TO FOLLOW UP ON"
  prompt section, then marks them `surfaced` (fire-and-forget) so Riley asks ONCE and never nags. Fail-open
  throughout. Added to `ACCOUNT_DELETE_TABLES`. Surface logic validated against the live table.
- **Guardrails preserved:** crisis path untouched, no gender assumptions, hyphens only, model unchanged.
  `node --check` passes. Next slices (Brenden's list): tenure-calibrated trust, pattern-noticing, milestones.
- **Files:** `riley-chat.js`, `auth-handler.js`, `supabase/migrations/084_member_followups.sql`.

### Onboarding deepening: contextual lean-in + "about your world" - all wired into Riley's memory
- **Why:** Brenden loved the onboarding and wanted it to get to know people more personally, so Riley can
  build trust over time. Principle: add DEPTH, not length - Riley leaning in with one optional tap, never a
  longer form. Everything feeds `riley_memory` (verified: the exact table riley-chat.js loads into Riley's
  context every message + the pgvector recall indexes), so Riley can reference it in future conversations.
- **What (Screen 3b - contextual lean-in):** after "What brings you here", a reason that warrants a gentle
  follow-up triggers ONE single-tap question with a dignified opt-out: grieving → "what kind of loss?"
  (loved one / relationship / job or identity / pet / rather not say); struggling emotionally → "what's
  weighing on you most?" (work / family / relationship / health / money / everything); sobriety → "what are
  you working to stay free from?". Skippable. Non-answers ("rather not say" / "not sure") save nothing.
- **What (Screen 7b - a little about your world):** an optional, skippable screen after Confidence - chips
  (married/partnered · kids · working · in school · in a recovery program · support nearby · live alone) +
  one free-text line (crisis-scanned like the rest). Captures the life context that makes Riley feel like it
  knows them (family, work, support network).
- **Memory:** `saveMemory` now also writes `status:'active'` + `last_confirmed_at` so onboarding facts are
  first-class in memory-v2 (reconcile + recall rank them). Reuses the existing crisis scan + 988 interrupt.
- **Verified:** both new screens rendered in an isolated harness (screenshot) - visually identical to the
  loved flow. `node --check` passes. Files: `onboarding.html`.

### Social design engine follow-ups: fix schedule crash + add cancel-scheduled-post
- **Why:** With designs rendering, "Final approve → schedule" threw `Cannot read properties of null
  (reading 'id')`. Cause: `content_publishing_jobs` has `CHECK (publisher IN ('buffer','native'))` but the
  code inserted `publisher:'feedhive'` → the job insert failed → `job.id` on null. (Same class as the
  render_engine CHECK.) The operator also had no way to cancel a scheduled post.
- **What:** `content-queue.js` - `publisher:'native'` (+ a null-guard so a failed job insert skips instead
  of crashing the whole publish). New **`cancel_job`** action: best-effort FeedHive delete (`DELETE /posts/:id`)
  + set the job `state='cancelled'` (removes it from Scheduled) + return the post to Review. `operator.html` -
  a **Cancel** button on each Scheduled job. Confirmed: FeedHive receives BOTH the caption (text + hashtags)
  AND the rendered design (media) - the `feedhive-publish` call sends `{text, media, scheduled_at}` (draft mode).
- **Files:** `content-queue.js`, `operator.html`.

### Comms go-live hardening (still DARK): signed unsubscribe links + timezone-aware quiet hours
- **Why:** pre-go-live audit flagged two dev items on the lifecycle-comms system before `COMMS_ENABLED` is
  ever flipped: (1) unsubscribe/preference links were raw `?u=<uid>` (someone could forge a link for another
  member), (2) quiet-hours fell back to UTC when a member's timezone was unknown (would email a US member at
  ~2am). System stays DARK - nothing sends until Brenden sets `RESEND_API_KEY` + `COMMS_ENABLED=true`.
- **What (signed links):** new `netlify/functions/comms-sign.js` - HMAC-SHA256 (128-bit hex) over the member
  id. Secret = `COMMS_UNSUB_SECRET` with fallback to `SUPABASE_SERVICE_KEY` (always set) so it works with NO
  new required env var. `evaluate-comms.js` now appends `&s=<sig>` to every emailed unsubscribe + preference
  URL (footer links AND the RFC 8058 `List-Unsubscribe` header). `comms-unsubscribe.js` requires a valid sig
  for opt-IN actions (resubscribe / letter-on) and shows a "link expired" page otherwise; opt-OUT (the default
  unsubscribe + letter-off) is ALWAYS honored regardless of signature (never trap a subscriber, per RFC 8058 /
  CAN-SPAM). Fails open if no secret is configured. Roundtrip unit-tested (correct→ok, forged/empty/other-id→
  reject, no-secret→fail-open).
- **What (quiet hours):** `inQuietHours` no longer falls back to UTC - unknown timezone now evaluates in
  `COMMS_DEFAULT_TZ` (default `America/Denver`, the company's home zone), so the 9pm-8am quiet window is roughly
  right for a US userbase even before per-member timezones are populated. Override via env, no redeploy.
- **Files:** `comms-sign.js` (new), `evaluate-comms.js`, `comms-unsubscribe.js`. Still-open go-live blockers
  (Brenden): set `RESEND_API_KEY` + verify domain/mailboxes, replace interim `guide_5` copy, then flip
  `COMMS_ENABLED=true` (see the go-live runbook).

### Operator delete-account: legible errors + erase-completeness fix (privacy)
- **Why:** Brenden hit a "failed out" when deleting a member from the operator portal. The UI only showed a
  generic "Delete failed" so the real cause was invisible. Investigation: the function loads fine (401
  without a key), auth works, client is service-role, `eraseMemberById` is internally fault-tolerant (can't
  throw), and NO foreign keys reference `auth.users` (so auth deletion isn't FK-blocked) - the code path is
  sound, so the failure needs to be SEEN. Also found a real privacy gap while in the live DB.
- **What (legibility):** `admin-account.js` now wraps the deactivate/delete logic in try/catch → returns
  `{error:"server_error", detail}` instead of an opaque 500. `operator.html` deactivate + delete now read the
  response as text (parse-safe), and surface `Delete failed (HTTP <status>): <detail>` incl. non-JSON bodies -
  so the next attempt tells us exactly what happened (400 vs 500 vs 502 timeout vs network).
- **What (privacy/completeness):** verified `ACCOUNT_DELETE_TABLES` against the live schema - 13 tables had a
  `user_id` column but weren't erased. Added the member-owned ones so delete truly erases everything:
  `int_enrollments, phq_gad_scores, who5_scores, program_module_progress, user_active_products,
  user_comms_state, email_log, email_sends, feature_interest`. Deliberately NOT added: `crisis_log` (retained
  de-identified), `payments` (financial record; Stripe authoritative), `admins` (operator), the
  `data_integrity_report` view. Shared list, so self-serve + operator delete both benefit.
- **Open:** root cause of the original hard-fail still to be confirmed from the now-legible error on retry
  (most likely a transient/timeout or the "auth login not removed" success-caveat). Files: `admin-account.js`,
  `auth-handler.js`, `operator.html`.

### Banger onboarding + check-in - breathing sun mark, Riley writes the plan live, gift cards
- **Why:** Brenden, post-launch: "an absolutely BANGER onboarding flow and checkin." Both flows were already
  solid; this elevates the two most emotional surfaces. Vibe he chose: cinematic & alive + warm & minimal;
  the plan reveal = Riley writes it live from the member's answers.
- **What (`onboarding.html`):** Replaced the 🐦 emoji with Riley's breathing "sun" mark (the SAME brand
  asset the chat + marketing popup already use - `radial-gradient` gold orb, 5s breathe) on the welcome,
  crisis-support, and finish screens. The aha moment (`sPreview`) now has Riley WRITE the plan
  char-by-char, weaving the member's name + their own words back with key phrases in gold; tap-to-skip and
  `prefers-reduced-motion` both fast-forward to the full text; CTAs reveal only after the plan finishes.
- **What (`chat.html` daily check-in - ADDITIVE, crisis path untouched):** The "give one thing back" is now
  a distinct gift card (breathing sun + serif title; celebratory variant glows warmer; any CTA folds
  inside) instead of a plain bubble, preceded by a short considering-beat (animated dots) so the reward
  reads as chosen. The beat/card are NEVER used on the crisis path (levels >=2 still return early with an
  immediate plain-text safety message + unlock).
- **Verified:** rendered the sun mark, the live-typed plan, and both card variants in an isolated harness
  (screenshotted) before shipping; both files pass `node --check`.
- **Files:** `onboarding.html`, `chat.html`.

### Grounds design engine wired into the live Content Engine - approve → design → review → publish
- **Why:** CONTENT_ENGINE_v3 was live (briefs → approval_queue → publishing) but the design step was empty
  (`content_creative_assets` = 0 rows): the only engine was Canva (`content-atlas.js`), gated off, so approving a
  post scheduled it to FeedHive as TEXT-ONLY with no image and no review gate. The operator wanted designs in the
  Social Media tab and a two-step: approve copy → system assigns a design → review → final approval.
- **What:** New `netlify/functions/content-design.js` - a SERVER-SIDE render engine (`render_engine='riley-grounds'`)
  using `@napi-rs/canvas` (a Node port of the kit's Pillow layouts). Reads grounds+fonts off disk, assigns a ground
  via `template-rotation.js` (Veil for heavy content), renders the PNG, uploads to the public `content-assets`
  Supabase bucket, inserts a `content_creative_assets` row. Pluggable alongside Canva; runs in the pipeline too.
- **Lifecycle (`content-queue.js`):** split approve into two steps. `approve` (from `pending`) now auto-assigns +
  renders a design and moves the item to **`designed`** (Review) - it no longer schedules. New `swap_design` action
  re-renders on a chosen ground. New `publish` action (from Review) runs the Echo→publishing_jobs→FeedHive path and
  **attaches the rendered image as media** (the previously-missing piece). Added `view=review` + a review count.
- **Operator UI (`operator.html` Social Media tab):** new **Review** sub-tab (rendered post + swap-ground buttons +
  Final approve / Reject) and **Designs** sub-tab (the six grounds gallery with mode + use-for + layouts).
- **DB:** migration `083` adds the `designed` value to the `review_status` enum (additive). The `content-assets`
  bucket already existed (public). Packaging: `@napi-rs/canvas` added to package.json; `netlify.toml` bundles the
  grounds/fonts via `included_files` + keeps the native binary in `external_node_modules`; content-design +
  content-queue get 26s timeouts. `/brand/*` stays force-404'd.
- **Scope:** v1 renders one static image per brief (hook/body/story). Carousels (multi-slide) + reels (motion) are a
  follow-on. Files: `content-design.js`, `content-queue.js`, `operator.html`, `netlify.toml`, `package.json`,
  `supabase/migrations/083_social_design_review.sql`, `CLAUDE.md`.

### Retire the old full-page chat (/talk = riley-auth.html) - it is now a pure OAuth router
- **Why:** After a live checkout, a paying member landed on the OLD in-page chat onboarding on
  `riley-auth.html` instead of the app. Brenden: "i do not want anyone to ever land on this page...
  it needs to take the client to the dashboard where Riley pops up." Standing rule: every client
  chats with Riley ONLY via the popup (marketing `chat-anon.html` popup + app `/chat?embed=1` pill).
- **What (`riley-auth.html`):** boot() now covers the page immediately (full-screen spinner) for ALL
  routing so the retired chat never flashes. `handlePostAuth` routes: buyer -> Stripe checkout; else
  onboarded -> `/dashboard`; not-onboarded -> `onboarding.html` (the v2 screen-based onboarding, which
  finishes on `/dashboard` where the pill auto-opens). Removed the old `runOnboarding()` call (function
  now dead/unreferenced - left in place for a later cleanup, not deleted to avoid pre-launch risk).
  Genuinely anonymous visitors (no OAuth callback, no `?signin=1` handoff) are bounced to `meetriley.us`
  where the popup is the chat channel. OAuth callbacks (`?code=`/`#access_token=`) keep the cover and are
  routed by `onAuthStateChange`; a 12s safety net sends a hung/failed callback to `/login`. site-config
  failure now redirects to the marketing site instead of stranding on a blank covered page.
- **What (`dashboard.html`):** the un-onboarded guard now redirects to `onboarding.html` (was
  `riley-auth.html`) - one less hop, straight to the real onboarding.
- **Unchanged:** marketing "Talk to Riley"/`/talk` links are still intercepted by `marketing-pill.js`
  into the anonymous popup; the popup sign-in handoff still goes to `/login`. Both inline JS blocks
  syntax-checked with `node --check`.
- **Files:** `riley-auth.html`, `dashboard.html`.

### Lock the social template system v1.0 - kit, engines, nav-ink asset, rotation rules
- **Why:** The locked social design system (six grounds, spec, render engines, examples, nav
  logos, PDFs) needed to live in the repo as the canonical brand toolkit, AND the "use templates
  randomly, within rules" cadence had to become enforceable so the Operator's social funnel follows it.
- **What (brand kit):** New `brand/template-kit/` - `grounds/` (the six locked grounds x 3 canvases),
  `examples/`, `carousel_engine.py` + `multiformat_engine.py`, `make_carousels.py` + `make_multiformat.py`,
  `TEMPLATE_SPEC.md`, bundled `fonts/` (DM Serif Display / DM Sans / DM Mono), nav logos + the new
  `riley-nav-ink.svg` (outlined-glyph vector source) and `riley-nav-ink@2x.png`. PDFs in `brand/docs/`.
- **Engines fixed:** now LOAD the pre-baked ground PNGs (dropped numpy/procedural grounds), restrict to
  the six locked names (Beam/Ember raise), and use the bundled DM fonts. Retired grounds remapped in the
  content defs: **ember->veil** (grief/slip - heavy), **beam->first-light**; `firstlight`->`first-light`.
- **Rendered library:** `make_*.py` produce `brand/template-kit/library/` (59 carousel slides, 20 singles,
  20 stories, 6 H.264 reels). That output is **git-ignored** (~120MB, fully regenerable) - only the kit
  SOURCE is committed. `/brand/*` is force-404'd in `netlify.toml` (internal, never served).
- **Rotation rules (`netlify/functions/template-rotation.js`, Spec section 11):** never the same template
  >2x in a row; never >3 dark or >3 light in a row; weekly mix of post/story/reel/carousel; Week 1 all
  Riley/launch; Weeks 2-4 >=4 Riley/program posts (rest web-sourced). `planCampaign`/`nextPick`/
  `validateSequence` + `--selftest` (5 seeds pass). Live pipeline wiring (auto-compose + FeedHive) is a follow-on.
- **Files:** `brand/**`, `netlify/functions/template-rotation.js`, `netlify.toml` (brand 404),
  `.gitignore` (library), `CLAUDE.md` (Social template system section). Punctuation: hyphens only (no em-dashes).

### Check-in counts toward Guide daily chat cap - unified relationship framing (`42d0355`)
- **Why:** The daily check-in is a Riley-led client-side flow (chips, not LLM calls), so it
  never incremented the 20/day Guide cap. The cap was effectively 20 free-form + free check-ins
  - not the product intent (check-in = part of the Riley relationship, not a separate meter).
- **What:** Completing a check-in now charges a fixed 5 from the same `usage_counters` row that
  `riley-chat.js` reads. Net: ~15 free-form messages left after a check-in. Paid tiers (Companion/
  Coach/Mentor) are unchanged - charged:0 immediately. `free_access_mode` also no-ops the charge.
- **How:** New `checkin_charge` action in `auth-handler.js` - verifies token, resolves tier
  (same subscription bridge as riley-chat), checks free_access_mode, calls `incrementUsage` x5,
  returns remaining. `rcFinish()` in `chat.html` fires it after the `daily_checkins` upsert
  (fire-and-forget; never blocks the check-in or handoff). Updates cap display immediately.
- **UX framing:** cap-caption, `applyChatCap()` placeholder, and riley-chat's at-limit reply
  updated to name the check-in positively ("your check-in and our conversations are all part
  of the same relationship") - never framed as a penalty.
- **Crisis/safety unchanged:** check-in always completes regardless of cap state; crisis
  overrides at every layer in riley-chat.js.
- **Files:** `netlify/functions/auth-handler.js`, `netlify/functions/riley-chat.js`, `chat.html`

### Server-side daily cap for anonymous chat - upgrade conversion lever (`b393cd6`, `bfd8ddb`)
- **Why:** chat-anon.html had only a client-side session cap (was 10, easily bypassed by
  scripted callers and page refreshes). Anonymous visitors with no real cap = cost exposure
  and no conversion pressure to sign up.
- **What:** Server-side cap in `riley-chat.js` for requests with no user_id (anonymous):
  - Per-anon_id product cap = 20/day (matches Guide tier `reset_free` in `usage_limits` - confirmed from DB)
  - Per-IP abuse ceiling = 100/day (5x product cap; hashed FNV-32a, no raw IP stored). Scripts rotating
    anon_id still hit the IP ceiling. Shared-IP honest users (cafes, offices) are never blocked at the low cap.
  - Crisis ALWAYS overrides: Level 3 (988 response) fires before any cap check. Levels 1-2 also bypass.
    Live-verified: "I want to end my life" at 20/20 cap returns 988 response, no nudge.
  - Fail-open: if DB is unavailable, the message is allowed through (same policy as logged-in cap).
  - Warm upgrade nudge on cap: "That's your free chat with me for today - and I'm glad we got to talk.
    Riley Companion gives you unlimited conversations, any time..." (Riley voice, no em-dashes)
  - X-Chat-Atlimit + X-Chat-Remaining headers set on all anon replies (same as logged-in path).
- **chat-anon.html:** generates stable anon_id UUID in localStorage (survives page loads within a day),
  sends it on every request. Reads cap headers, shows upgrade nudge and locks input at cap. CLIENT_CAP
  raised to 20 to match server. Gentle "N messages left" notice at 3 remaining.
- **Migration 082:** `anon_chat_counters` table + `increment_anon_counter` / `get_anon_counter` RPCs.
  RLS enabled, no client access. Applied to prod.
- **Files:** `netlify/functions/riley-chat.js`, `chat-anon.html`, `supabase/migrations/082_anon_chat_counters.sql`

### Marketing pill: floating anonymous Chat with Riley on all 8 marketing pages
- **Why:** marketing pages (meetriley.us) had "Talk to Riley" buttons pointing to `/talk` (a route that
  never existed as a file), so they either broke or silently opened a popup with a blank iframe. Logged-
  out visitors had no working way to try Riley before signing up.
- **What:** New `chat-anon.html` (on-brand ink/gold/parchment, DM Serif/Sans) calls `riley-chat.js` as
  an anonymous visitor (no user_id/token). All server-side crisis detection is fully active - the L3
  988 response fires for crisis phrases on anonymous sessions. New `marketing-pill.js` renders the docked
  non-blocking bottom-right pill and popup (mirrors app pwa.js UX) on all 8 marketing pages.
  Intercepts existing /talk links so they open the popup. Added `/chat-anon` clean URL route.
- **Crisis verified live:** both "I want to end my life" and "I have been thinking about suicide" returned
  the full 988 + 911 safety response from the anonymous chat path. No bypass possible - crisis is
  server-side in `riley-chat.js`.
- **Rate-limit:** anonymous sessions capped at 10 messages/session (client-side) + 1s debounce. Sign-in
  CTA nudge appears at message 3 and cap warning at message 8. Server enforces Guide cap for null user_id.
- **Retired buttons:** removed standalone "Talk to Riley" CTA buttons from home hero, home "Meet Riley"
  section, and resources section CTA. Footer "Talk to Riley" nav links kept - they work via pill intercept.
- **Files:** `chat-anon.html` (new), `marketing-pill.js` (new), `netlify.toml` (+/chat-anon redirect),
  `home.html`, `about.html`, `pillars.html`, `resources.html`, `blog.html`, `safety.html`, `help.html`,
  `data.html` (remove old inline popup, add marketing-pill.js script tag, retire body CTA buttons).



### Operator customer lifecycle: Deactivate + Delete account (new `admin-account.js`)
- **Why:** the operator could cancel/refund a member's Stripe subscription (admin-billing) but could NOT
  deactivate or delete a customer from the dashboard - full erasure was member-self-serve only.
- **New `admin-account.js`** (OPERATOR_KEY-gated, writes `admin_audit`): `deactivate` = cancel Stripe sub +
  set `subscriptions` canceled/expired (revoke access) but KEEP data (reversible); `delete` = cancel Stripe
  FIRST, then hard-erase via the shared `eraseMemberById()` (requires `confirm:true`). crisis_log retained
  de-identified per policy.
- **auth-handler.js:** extracted the erasure into a shared `eraseMemberById(supabase, userId)` (exported) that
  BOTH self-serve `delete_account` and the operator `delete` now call - one table list, can't drift. **Added the
  Memory v2 tables** `session_summaries` + `chat_turn_signals` to `ACCOUNT_DELETE_TABLES` (self-serve deletion
  was leaving them behind - closes an audit gap).
- **operator.html:** member-detail "Danger zone" with Deactivate + Delete account (type-DELETE-to-confirm);
  auto-authed via the x-operator-key injector. Inline JS re-verified (`node -c`).
- Stripe billing tracking + cancel/refund already existed in the member detail (`admin-billing` + the Billing
  panel); it shows "No billing account yet" until `STRIPE_SECRET_KEY` is set + real purchases exist.

### Typography: NO EM-DASHES anywhere - plain hyphen only (`f092040`, `126140f`, `8cd8d98` + DB)
- **Why:** Brenden - the em-dash "-" reads too large. Standing rule now: plain hyphen `-` everywhere, never
  em/en-dashes. (Logged in Claude memory MEMORY.md standing directives + working-preferences.)
- **What:** replaced `—`/`&mdash;` with `-` across ALL 37 HTML pages (`f092040`), ALL 110 netlify functions +
  root JS incl. email templates & UI copy (`126140f`), and the LLM prompts of the social/program generators
  (sage, scout, atlas, plan-generate, daily-brief, journey-step, member-doc, week-one-letter - int-session uses
  riley-chat) (`8cd8d98`). Riley's chat prompt (riley-chat.js VOICE) now instructs "use a plain hyphen, never
  em/en-dashes." Updated the DB `content_prompt_versions` (all 7 active agents: sage/scout/sage_morning/atlas/
  sentinel/echo/library_scout) - em-dashes stripped + rule appended.
- **🔴 CODE PRESERVED:** the regex char classes `[—-]` in weekly-pipeline / manual-pipeline / week-one-letter
  (match either dash) were restored after the sweep; crisis-detection patterns have no em-dashes; no em-dash
  string delimiters/comparisons exist; all modified .js pass `node --check`. Any NEW copy/prompt must use hyphens.

### Homepage first testimonial + About copy edits (`44d419b`, `f0fa6f5`, `126140f`, `8cd8d98`)
- **Home:** first customer testimonial (Casey K.) added to the Stories section as a gold-accented card,
  instrumented for Customize Website. 🔴 Brenden wants 2 more before launch (1/3 - see pre-launch-checklist).
- **About:** revised "Built the hard way" opener; revised "Meet Riley" (+ "not here to replace professional
  care..."); full "Why 8:14" story rewrite with gold colon/period in the title + an italic DM-Serif dedication.
  All new copy instrumented for Customize Website.

### Operator "Customize Website" - live marketing-site editor (`c7c2d9e` → `c23008f`)
- **Why:** the marketing pages were hardcoded HTML; Brenden wanted to edit copy + layout himself, no redeploy.
- **What:** new operator tab with a live click-to-edit preview of home/about/pillars/resources. Edit text;
  show/hide/reorder/recolor sections; swap/remove logos (brand-image picker from cardinal assets + upload/URL);
  **per-element layout** (drag the ⛶ handle to move, width/height/spacing/align, text colour + bold/italic);
  **responsive** (separate Desktop/Mobile - desktop edits never touch mobile, via a media-queried stylesheet;
  a Desktop/Mobile toggle drives the edit bucket). Save publishes instantly. Runtime-override model: pages carry
  `data-cms-*` slots; `site-cms.js` applies overrides + is the in-iframe editor (posts changes to the parent
  operator, which holds the OPERATOR_KEY and saves via `admin-site-content.js`). `site_content` table + public
  `site-media` bucket (**migration 072**, RUN). RLS blocks anon writes so edit mode can never persist without
  the key; resources' 988 crisis section is deliberately not instrumented. Full record: `customize-website-2026-07.md`.

### Memory v2 completeness pass (punch-list 8–14) + launch-audit fixes — SHIPPED
- **Audit fixes (P0/P1):** subscriptions bridge in riley-chat + riley-brain (paying members were
  metered as Guide once free_access_mode off); onboarding Day-1 free-text now runs the crisis check
  (`reset-day.js`); `content-atlas.js` operator-gated (was ungated model-cost endpoint).
- **#8 Coach adaptive plans:** `plan-adapt-cron.js` (weekly Mon 13:00 UTC) — regenerates plans from
  completion % with a visible "what changed" line. Closes the confirmed no-schedule gap.
- **#9 Member-visible memory:** `member-memory.js` + `/memory` page + settings link — see/fix/remove
  what Riley remembers (IDOR-guarded; crisis_log never shown; corrections logged for the ops metric).
- **#10 Session summaries (Phase 2):** cross-session episodic memory injected as "RECENT CONVERSATIONS."
- **#11 P2 hardening:** atomic webhook idempotency (stripe + payment webhooks, claim-before-grant);
  waitlist-join flood cap + send-once (email-bomb fix); story-submit global cap; CLAUDE.md Haiku-routing
  note; tagged 18 approved library items `guide_starter=true` (Guide now sees curated content).
- **#14 Observability:** `health-chat.js` + `/api/health-chat` (uptime monitor target); k6 load script
  `tests/load/chat-load.js` (run vs staging).
- 🔴 Needs Brenden's hands (can't automate): #12 set `EMBEDDINGS_API_KEY` in Netlify (+ provider pick);
  #13 activate CI (move `docs/ci-workflow.reference.yml` into `.github/workflows/` via GitHub UI); #14
  provision staging + uptime/status/Sentry. comms-unsubscribe HMAC deferred (reversible).

### Memory v2 + cost/reliability foundation — SHIPPED DARK (fail-open; byte-identical until an embedding key is set)
- **Migrations 079–081** (applied): pgvector; `embedding vector(1024)` + reconcile cols (`confidence`,
  `last_reinforced_at`, `superseded_by`, `status`, `source`) on `riley_memory`+`life_map`; HNSW cosine indexes;
  RPCs `match_member_memory` (hybrid recall), `nearest_memory` (dedup), `decay_memories`, `merge_duplicate_memories`;
  new RLS tables `session_summaries`, `chat_turn_signals`, `api_cost_log`, `system_incidents`.
- **riley-chat.js**: hybrid semantic recall keyed on the current message (fail-open to recency); reconcile-not-insert
  extractor (NEW/REINFORCE/SUPERSEDE + embed-on-write, Haiku); model call routed through new **anthropic-client**
  (prompt caching on unmodified turns · retry→Haiku fallback→graceful line · cost logging). Crisis L3 untouched.
- New modules: `anthropic-client.js`, `model-router.js` (Sonnet chat / Haiku utility), `embeddings.js`
  (provider-swappable, 2s timeout, null-on-fail), `memory-maintenance-cron.js` (weekly Mon 09:00 UTC),
  `post-hoc-crisis-scan.js` (nightly safety backstop; never touches the live deterministic path).
- **Safety net**: `tests/crisis` (human-authored corpus; BLOCKS build until populated; caught a real L2
  false-positive on "drink some water") + `tests/golden` (voice/rules); `.github/workflows/ci.yml`; `npm test`.
- **Docs**: `docs/architecture-memory-v2.md`, `docs/data-map.md`, `docs/data-retention.md`, `docs/runbooks/`.
- 🔴 Activate semantic layer: set `EMBEDDINGS_API_KEY` (+ `EMBEDDINGS_PROVIDER`) in Netlify → run
  `memory-maintenance-cron` once to backfill. Until then fully dark.
- 🔴 CLAUDE.md "all functions sonnet" is now superseded for UTILITY calls only (Haiku 4.5) per spec §8.2 —
  conversation stays claude-sonnet-4-6.

### Marketing → checkout funnel (buy → sign in → auto-checkout) — DORMANT until payments_live
- **home.html** (emitter): when `payments_live` is true, a paid CTA carries its plan to `/login?buy=<lookup_key>`
  (subs default to monthly via LKMAP; programs pass through; free/no-plan CTAs still just hit `/login`).
- **login.html** (capture): stashes `?buy` into sessionStorage (survives the Google OAuth same-origin round-trip).
- **dashboard.html** (receiver): after the onboarding check, reads the intent, and — only if `payments_live` —
  opens `stripe-checkout` and redirects to Stripe. Every onboarded user lands on `/dashboard` (riley-auth:520),
  so returning buyers checkout immediately and new users after onboarding. **Each piece is a no-op until
  `payments_live=true`**, so current behavior (waitlist) is untouched. All 6 CTA plan-ids verified → valid keys.

### Operator per-member Billing panel + admin-billing engine + live cancel verified
- **`admin-billing.js`** (OPERATOR-gated, `36e21d0`): `get` (subs + charges + card brand/last4 + Stripe hosted
  `receipt_url`; NO raw banking), `cancel` (immediate/at_period_end), `refund` (operator-initiated).
- **`operator.html`**: new **Billing** section in the member-detail view (`renderUserDetail`) — mirrors the
  Correspondence panel. Shows subscription (plan/amount/status) + payments (amount, card, hosted receipt link)
  with **Cancel** and **Refund** buttons wired to `admin-billing` (patched `fetch` injects the operator key).
- ✅ **Live cancel verified**: canceled a real Companion sub → Stripe `canceled` + `customer.subscription.deleted`
  webhook → Supabase revoked. grant/renew/cancel→revoke all proven on live keys.
- ⚠️ **COMMS still DARK** — Brenden asked to enable; NOT flipped (standing rule: `COMMS_ENABLED` is a Netlify env
  var he sets; sensitive auto-outreach). Prereqs before flip: mailboxes live, reconcile `reengagement-cron` ↔
  Gone-Quiet double-send, DRY-run preview. 🔴 Stripe LIVE branding still unset (Public details name + Branding icon).

## 2026-07-08

### Stripe LIVE verified end-to-end + post-checkout redirect hardening + operator test-checkout
- ✅ **Live money loop PROVEN** with a real $19 Companion purchase: checkout → `checkout.session.completed`
  granted the sub + stored the live `stripe_customer_id` → `invoice.paid` renewed. All on live keys.
- **`stripe-test-checkout.js`** (`100de4d`, OPERATOR-gated): mints a real live Checkout Session for a given
  member so we can smoke-test without opening the public buy buttons (`payments_live` stays false).
- **Post-checkout redirect hardening** (`dashboard.html`, `login.html`): if someone returns from Stripe
  with NO session (e.g. paid in a window not signed into Riley — which is how a test bounced to the marketing
  home), `/dashboard` now routes to `/login?paid=1` with a "Payment complete — sign in to unlock" banner
  instead of the bare marketing page. Real buyers are unaffected (marketing buy CTAs route through `/login`
  first, so they always return signed in). 🔴 Reminder: dashboard branding (logo/icon + colors) is still
  EMPTY in Stripe **Live** mode — set Icon+Logo+colors at dashboard.stripe.com/settings/branding (Live toggle).

### Stripe LIVE — +2 webhook events, Customer Portal config, product descriptions (`8f33dc0`)
- Live Stripe is wired: live secret + webhook secret set by Brenden; 10 products / 12 prices live w/ descriptions;
  live endpoint armed. In-app buy buttons gated on `app_settings.payments_live` (still **false** → nothing charges).
- **+2 webhook events** (`stripe-webhook.js`, now 7): `invoice.payment_failed` → KEEP access during Stripe's
  auto-retry/dunning window, just log (if retries ultimately fail, `subscription.deleted` revokes); `charge.dispute.created`
  → chargeback → revoke + flag in `payments` for review. `stripe-setup.js` now **updates** the existing endpoint's
  events (not create-only).
- **Customer Portal config** (`stripe-setup.js`): creates a `billing_portal/configurations` (idempotent) so
  `stripe-portal` opens in live — update card / cancel / view+download invoices / update email+address. (Plan-switch
  left to dashboard — needs per-product config.)
- **Portal self-heal** (`stripe-portal.js`): if Stripe says the stored customer doesn't exist in this mode
  (stale TEST-mode `cus_` lingering after go-live, or a deleted customer), clear the id + return the friendly
  `no_billing_account` instead of "Could not open billing". Live repro fixed: a sandbox `cus_` (livemode:false)
  on a profile made the live portal 500 → cleared the stale id in DB + shipped the guard. **Go-live reminder:
  purge all `livemode:false` rows from `payments`/`purchases` + null test `stripe_customer_id`s before launch.**
- **Product descriptions** (`stripe-catalog.js`): custom buyer-facing copy on both subs + all 8 programs; `stripe-setup`
  now refreshes name+description on existing products on re-run.
- 🔴 **Re-run stripe-setup (live, operator) to APPLY** the 7-event update + portal config on the live account.
  Still NOT go-live (`payments_live=false`). Dashboard-only follow-ups (Brenden): invoice branding logo+colors
  (#0a0908 ink / #c9a84c gold), refund-policy footer, create actual promo Coupons (checkout already allows codes).
  Files: stripe-webhook.js, stripe-setup.js, stripe-catalog.js.

## 2026-07-07

### Stripe payments — direct integration BUILT (sandbox; not live)
- Replaced RockPaperCoin/Zapier with **direct Stripe** (Billing + Checkout + Portal + Webhooks).
  "Stripe for money, Supabase for access." Everything is in **test/sandbox** — no real money, NOT live.
- **Functions:** `stripe-catalog.js` (source of truth: 2 subs + 8 one-time programs, price maps),
  `stripe-setup.js` (operator-gated; pushed 10 products/12 prices to sandbox; fixed product ids `riley_<key>`),
  `stripe-webhook.js` (signature-verified, idempotent, fail-closed; grant/renew/tier-swap/revoke; LIVE — secret
  set), `stripe-checkout.js` (member Checkout Session; resolves price by PRODUCT id not lookup_key; promo codes
  + receipts + Tax opt-in), `stripe-portal.js` (Customer Portal). Migrations **077** `payments`, **078**
  `user_profiles.stripe_customer_id`.
- **Buttons:** programs.html `buyProgram` + Companion/Coach modal → real checkout (was waitlist). settings.html
  gets a "Manage billing" card → portal. Marketing home.html stays waitlist-gated by `app_settings.payments_live`
  (flip that ONE flag at go-live → marketing routes to checkout).
- 🔴 **NOT LIVE.** Go-live = Stripe business verification → live keys → re-run stripe-setup (live) → live webhook
  endpoint + STRIPE_WEBHOOK_SECRET → flip payments_live=true. Open: harden webhook lookup_key at renewal; test the
  6 checks in sandbox; remove obsolete temp fns rpc-introspect + old payment-webhook. Full record:
  memory/stripe-payments-2026-07.md. Files: stripe-*.js, programs.html, settings.html, migrations 077/078, netlify.toml.


### Check-in polish — celebratory reflect card no longer reads as "auto-answered"
- **Report:** after skipping the note question, the good-day "give one thing back" card
  ("Name what worked… what helped today?") was immediately followed by the handoff
  ("Love that, {name}. Let's put it to work…") — two Riley messages back-to-back, so the
  reflection prompt felt auto-skipped/auto-answered. (The step machinery is correct — `rcAsk(i)`
  advances exactly one step; this was pacing + copy, not a double-advance.)
- **Fix (chat.html `rcAfter`):** a ~1.4s beat before the handoff so the reflection card lands
  first; and the mood≥4 handoff no longer presumes an answer — now invites one:
  "No rush, {name} — tell me what worked today, or just start wherever feels right." File: chat.html.

### Check-in fix — Phase-2 "note from Riley" no longer collides with the daily check-in
- **Bug:** on the app home, the chat auto-opens the daily check-in (pwa.js) AND `loadPhase2Discovery()`
  immediately popped the Phase-2 "A note from Riley" modal — two Riley prompts on screen at once.
- **Fix:** dashboard.html now delays the Phase-2 trigger to **~5 min into the session**
  (`setTimeout(loadPhase2Discovery, 5*60*1000)`) so it surfaces only after someone's settled in, well
  clear of the check-in. Still once/day gated (set only when it fires); the timer clears if they leave
  the page first. Only initial-trigger delayed; nothing else changed. File: dashboard.html.

### Quality sweep — 4-agent audit → fixed P0 security + P1 + design/UX defects
- **P0 (security):** `evaluate-comms.js` and `int-proactive-cron.js` were scheduled crons with **NO
  auth gate** (every other cron gates) — publicly triggerable, which would let anyone drive lifecycle/
  program email sends once COMMS/RESEND go live. Added `requireScheduledOrOperator` to both.
- **P1:** operator crisis "Mark handled" / safety-popup **"View"** dumped the operator on an orphaned
  `#ss` screen (Safety was merged into Client Overview) — repointed both to `loadEngagement()` /
  `[data-s=e]`. • Force-404'd publicly-servable **`/004_dashboard.sql` + `/migration.sql`** (schema
  leak, repo root = publish dir). • `week-one-letter` (700-tok member gen) had no timeout block →
  added `timeout=26`. • `login.html` loaded **zero brand fonts** (system stack) → added DM Serif/Sans.
  • Deleted dead `dashboard-auth.js` (unreferenced, stale facts).
- **P2 (design/UX):** operator `--green2` (undefined → wrong Net/mo color) → `var(--green)`;
  chat.html undefined `--smoke2` → defined; off-brand "Your AI Chief of Staff" → "Your companion";
  chat embed selector didn't hide the New-Conversation button (collided w/ popup controls) → fixed;
  operator Home Key-Metrics grid → responsive `auto-fit`; `weekly-pipeline-cron` max_tokens 2000→**4000**
  (CLAUDE.md rule); added analytics (track/posthog) to program.html + int-program.html; aria-labels on
  delete buttons (finance/tracker/nutrition) + lifemap avatar alt; profile MB copy (6→5 to match hint);
  journey "See Your Timeline" → `/progress` (was `/roadmap`→Reflection).
- **Verified GOOD (no false fixes):** all model strings `claude-sonnet-4-6`; L3 crisis short-circuits
  first; crisis/safety excluded from email_log; no IDOR; finance/tracker DO define `--green2` (left alone).
- 🔵 **Deferred (hygiene, low-risk-if-left):** operator dead-code (~350 lines legacy pipeline/review/
  users fns) + `syncSocialTrigger`/dead `gs()` sections; ~49 duplicate `[[redirects]]` in netlify.toml;
  `waitlist-join` rate-limit; move root `004_dashboard.sql`/`migration.sql` into supabase/migrations;
  CLAUDE.md "8 functions" (now 92); `/assets/*/README.md` 404; orphaned `admin-metrics.js`;
  payment-webhook idempotency race; operator FeedHive Settings stale block; home.html monthly-toggle
  fallback. Files: evaluate-comms.js, int-proactive-cron.js, weekly-pipeline-cron.js, operator.html,
  login.html, chat.html, program.html, int-program.html, profile.html, journey.html, finance.html,
  nutrition.html, lifemap.html, tracker.html, netlify.toml, (deleted) dashboard-auth.js.

### Member UX fixes — chat pill on the chat page + hamburger/topbar overlap
- **Chat pill:** the floating "Chat with Riley" pill no longer shows on the full **chat page**
  (`/chat`) — you're already chatting there. `pwa.js` now computes `onChatPage` and skips both
  `chatPill()` and the `/chat` link-intercept there (the embedded popup iframe already returned
  early via `?embed=1`; opening the popup already hid the pill). So the pill only appears where it's
  actually useful, and disappears the moment a conversation is the page.
- **Hamburger overlap:** the fixed mobile hamburger sat on top of the greeting on pages whose
  top-bar isn't `.topbar` (e.g. chat.html uses `.dash-topbar`). Extended the pwa mobile clearance to
  `.topbar,.dash-topbar{padding-left:66px}`. Verified EVERY sidebar/hamburger page uses one of those
  two top-bar classes, so the greeting now clears the hamburger on all member pages. (All pages
  already carry a proper viewport meta.) File: pwa.js.

### Payment grant webhook (RockPaperCoin/Stripe → Zapier → Riley) — DORMANT
- New `payment-webhook.js` + migration **077** `payments`. On a paid invoice, a Zap POSTs here and Riley
  grants the tier/program by inserting the same `subscriptions`/`purchases` row a comp uses (picked up by
  `user_active_products`). Contract: email, external_id, amount_cents|amount, optional plan/term/program/product.
- **Safe by design:** DORMANT until `PAYMENTS_WEBHOOK_SECRET` is set (no secret → 503, grants nothing);
  idempotent (unique `external_id` → replays log `duplicate`); fail-closed (unmatched email or unresolvable
  amount/product → logged `unmatched`/`needs_review`, grants NOTHING — never guesses a tier). Every event
  logged to `payments` for audit. Amounts map tiers uniquely ($19/$175 companion, $34/$350 coach); $8.14
  programs need an explicit `program` field (mapped in the Zap).
- 🔴 Before go-live: RockPaperCoin has NO public API (its Zapier app is a private beta) → checkout uses RPC
  hosted payment links (one per product). Set PAYMENTS_WEBHOOK_SECRET, build the Zap (RPC "Invoice Paid" →
  Webhooks POST), wire the app's buy buttons to the RPC links, and verify user_active_products honors expires_at
  for monthly renewals. Files: payment-webhook.js, migration 077, netlify.toml.


### Signup flow fixes — no sign-in loop, no rebuild-date prompt, app-install after onboarding
- **1) Fixed the "loops back to sign-in" bug.** After Google authorize, the OAuth callback landed on
  `/dashboard`, which bounces to the marketing/sign-in page the instant `getSession()` is momentarily null
  (post-OAuth hydration race). Now `login.html` lands the callback on **`/riley-auth.html`** (the onboarding
  chat) — it tolerates the race (waits for the SIGNED_IN event) and routes: new members straight into the
  onboarding chat, already-onboarded members onward to `/dashboard`. Single sign-up now goes straight to chat.
- **2) Removed the "When did you start your rebuild?" prompt.** `renderSobrietyInfo()` no longer auto-shows
  the sobriety-set-bar for members without a date — sobriety stays optional (settable from the tracker),
  never pushed during onboarding. (Element already `display:none` by default; the banner + Edit path for
  members who DO track a date are unchanged.)
- **3) "Download the Riley app" now appears only AFTER onboarding.** `pwa.js` gates both install affordances
  (login popup + install pill) on a new `riley_onboarded` localStorage flag, set at onboarding completion
  (riley-auth) and whenever `onboarding_completed` is confirmed (riley-auth handlePostAuth + dashboard guard).
- Files: login.html, riley-auth.html, dashboard.html, pwa.js.

### Gone-Quiet reworked to "14 days since the last touch" (fixes onboarding overlap)
- **Why:** the old rule (win-back after 2 idle days) could cut a new member's onboarding short — a signup
  who didn't return for 2 days flipped straight into win-back. Operator's call: start win-back only after
  **14 days of NO touch — from us OR them**.
- **How (`evaluate-comms.js`):** `lastTouch = max(member activity, last email WE actually sent)`;
  Gone-Quiet only fires when `daysSinceTouch >= QUIET_GAP` (default 14, editable via `quiet_1.trigger_days`).
  Because every onboarding email is itself a touch, the Guide series **self-protects its window** — win-back
  can't begin until 14 days after the LAST onboarding email. The quiet_1→2→3 ladder is now ladder-position
  stepped and **auto-spaces** at 14-day intervals (each quiet email refreshes the touch). Guide flow now
  gates on `daysSinceTouch < QUIET_GAP` instead of `daysAbsent < 2`. Still DARK.
- Onboarding/Gone-Quiet remain mutually exclusive + 1-email/day cap (unchanged). Timing map (`TRIGGERS`)
  relabeled: quiet_1 = "after N days no contact" (days 14, editable); quiet_2/3 = "auto-spaced" (no day field).
- Note: "our touch" currently counts comms sends (email_sends); folding in email_log (brief/welcome) is a
  possible enhancement. Files: evaluate-comms.js, comms-templates.js.

### TEMPORARY 24h promo — auto-comp every new signup to Coach tier (+ iPhone push message)
- **Operator-requested:** for 24h, every NEW signup is auto-enrolled to **Coach** tier.
  Implemented as a scheduled **sweep** (`auto-comp-cron.js`, every 10 min) — NOT a signup-path
  trigger, so it can't break/slow account creation. Comps by inserting a comped `coach`
  `subscriptions` row (same mechanism as Add-User); idempotent; writes an `admin_audit` row per
  comp (`source:'auto_promo_24h'` — traceable + revocable).
- **Window** stored in `app_settings` (`auto_comp_coach_start`/`_until`, 2026-07-08 00:37Z →
  2026-07-09 00:37Z). The cron no-ops after `_until`. 🔴 REMOVE the netlify.toml schedule after the
  promo (inert regardless). To stop early: delete the app_settings rows.
- **iPhone push fix:** operator "Enable notifications" now detects iOS-not-installed and tells the
  user to open in **Safari → Add to Home Screen → open from the icon** (iOS only allows web push
  from an installed PWA, Safari only — Chrome/iOS can't). File: operator.html.
- Files: auto-comp-cron.js (new), netlify.toml, operator.html.

### Unified email shell (hybrid) — rolling every sender onto ONE house style
- Operator chose the house shell: **Shell A's Ink header + Riley. wordmark + footer**, with **Shell B's
  serif font/voice**, always signed **"— Riley"**. Implemented in the shared `shell()` (comms-templates.js):
  body font is now Georgia serif; `shell(body,{footerHtml})` accepts a custom footer (so sensitive/crisis
  mail can carry a reply-to-opt-out + 988 footer instead of the marketing unsubscribe). Exported
  `shell/p/btn/em/esc` for reuse.
- ✅ **ALL client senders now render through the shared shell** (same copy, unified frame):
  crisis-followup-cron (custom reply-to-opt-out + 988 footer), reengagement-cron (dropped its leftover
  "Meet Riley" double-signoff), brief-delivery-cron (keeps the "Today's focus" callout), int-proactive-cron
  (custom program opt-out footer), email-welcome (was a dark card → now the light house shell). The old
  bare-serif "MEET RILEY" eyebrow shell + the dark welcome card are fully retired.
- Files: comms-templates.js, crisis-followup-cron.js, reengagement-cron.js, brief-delivery-cron.js,
  int-proactive-cron.js, email-welcome.js.

### Operator "Client Onboarding Communication" tab — view/edit the whole lifecycle email sequence
- New operator tab (sidebar **Onboarding Comms**) surfaces all 17 lifecycle emails grouped into the
  4 flows (Guide · Gone Quiet · Paid Member · Add-on), in send order, each with a **live rendered
  preview** in the real brand shell. Per email the operator can edit **subject, preview text, sender
  (Riley/Brenden), timing (day threshold + note), body copy, button, and on/off** — Save, Update
  preview (non-persisting), or **Reset to original**.
- **Model:** `comms-templates.js` stays the verbatim fallback; edits are stored as *overrides* in new
  **migration 076** `comms_templates` (a row only overrides the fields changed). `render()` now takes
  an optional override (subject/preview/from/body/button); the brand shell is always applied so the
  DESIGN stays consistent no matter what's edited. Body edits use plain paragraphs + `[text](url)` links.
- **Real, not cosmetic:** `evaluate-comms.js` reads the overrides — edited copy/sender is what sends,
  disabled emails are skipped, and the Guide/Gone-Quiet/paid **day thresholds are now operator-editable**
  (`trigger_days`, falling back to code defaults). Still **DARK** (COMMS_ENABLED unset → nothing sends);
  the tab banner shows the live on/off state.
- **Backend:** `admin-comms.js` (OPERATOR_KEY-gated GET/PUT + `action:reset`/`action:preview`).
- Files: migration 076, comms-templates.js, evaluate-comms.js, admin-comms.js, operator.html, netlify.toml.

### Email copy consistency — "It's Riley" opener + single "— Riley" signoff
- Per operator standard: the crisis-followup emails now open **"It's Riley."** (was lowercase) across
  all 4 stages, and sign off with just **"— Riley"** (removed the duplicate "Meet Riley" line; the top
  "MEET RILEY" brand eyebrow stays). File: crisis-followup-cron.js.
- 🔎 **Consistency note for a follow-up:** email designs are NOT yet unified — the lifecycle/comms emails
  use the Ink-header brand shell (with unsubscribe footer), while crisis-followup/brief/proactive crons
  use a lighter inline "MEET RILEY" serif shell. Standardizing all senders on ONE shared shell is a
  worthwhile next pass (recommend the comms shell — it has the required List-Unsubscribe + preview text).

### Client Tracker v2 — "Filter by" dropdown + per-segment email-sent status + on Home
- **Dropdown replaces chips:** the tracker header now has a grouped **"Filter by"** `<select>`
  (All · Needs check-in · Tier: Guide/Companion/Coach · Status: New/Cooling/Dormant/Active) +
  search. Shared `trackerHtml`/`trackerFilter`/`trackerSeg` (namespaced by prefix) so ONE tracker
  component drives both surfaces. `engSegMatch` now handles tier filters too.
- **On Home:** the "Clients" widget gets the same header, over the **15 newest** members
  (`_trackers['home']`, rendered after home-body via `trackerFilter('home')`).
- **Per-segment email status:** picking a segment shows, per member, whether THAT stage's email
  was sent — green ✓ / red ✗ — plus a summary count ("5 New · 3 welcome sent · 2 missing").
  Mapping (`SEG_MAIL`): New & tiers→welcome, Cooling & Active→brief, Dormant→reengagement.
  `engRow(u, mailKind)` renders the ✓/✗ pill (falls back to the ✉ last-email chip when no segment).
- **Data:** admin-engagement + admin-home now return `email_kinds` per member (latest status per
  kind) from the existing `email_log` scan — no extra queries. Files: admin-engagement.js,
  admin-home.js, operator.html. Operator-only.

### Unified Client Tracker — one row + one source across Home and Client Overview
- **Why:** four overlapping client views (Home "Latest sign-ups" + "Recent correspondence";
  Client Overview "Needs a Check-In" + "All Clients") were confusing. Collapsed into ONE rich
  client-row (`engRow`) + ONE data shape, with email status folded into every row.
- **Client Overview:** the two tables become ONE tracker — needs-attention members float to the
  top (gold left-border + "needs check-in" tag), with segment chips (All · Needs check-in · New ·
  Cooling · Dormant · Active) + the search box (`filterEngSeg`/`applyEngFilter`). Hero stats kept.
- **Home:** "Latest sign-ups" + "Recent correspondence" widgets replaced by ONE **"Clients"** widget
  — the 10 newest members rendered with the SAME `engRow` (state, tier, mood, last-active + ✉ last-email
  chip). "Mark N new seen" kept. `HOME_WIDGETS` migrates old keys (`lastactive`→`clients`, drop
  `correspondence`) so saved layouts move over cleanly.
- **Data:** `email_log` now joins into the client rows. `admin-engagement.js` adds one batch
  `email_log` scan (recent 10k, grouped in JS — no N+1, no 5k-id URL) → `users[].last_email`.
  `admin-home.js` enriches `recent_signups` to the engRow shape (state/tier/mood/last_email via small
  `.in(~25 ids)` lookups). Shared `stateFromLastActive` extracted to `tier-utils.js` (with `currentTier`)
  so both endpoints stay in lockstep. `admin-correspondence.js` unchanged (still powers the member panel).
- Files: tier-utils.js, admin-engagement.js, admin-home.js, operator.html. Operator-only; no member/crisis impact.

### "Resend welcome" button on the member panel
- New `admin-resend-welcome.js` (OPERATOR_KEY-gated POST `{user_id}`) — re-sends the welcome email
  to an EXISTING member (admin-create-user 409s on existing). Routes through `sendWelcomeEmail()` →
  `sendClientEmail()`, so the resend is LOGGED to email_log and appears in both correspondence views.
- operator.html: a **"Resend welcome"** button in the member's Correspondence panel (confirm-guarded;
  shows the real result inline — sent ✓ / failed + reason — then refreshes the list). Serves the
  "did their welcome actually land?" case + is a live end-to-end proof of the logging. Files:
  admin-resend-welcome.js, operator.html, netlify.toml.

### Lifecycle communications system — BUILT DARK (Tasks 3, 4, 6, 7 of the comms handoff)
- **State:** 🔴 **DARK.** `COMMS_ENABLED` is unset → the hourly evaluator suppresses 100% of
  sends (it logs every decision to `email_sends` and makes zero Resend calls). **Brenden flips
  `COMMS_ENABLED=true` to go live** — do NOT set it. Copy is verbatim from the deck (placeholders only).
- **DB:** migration **073** — `user_comms_state` (per-user lifecycle snapshot: door/plan/ladder/
  reset/prefs/timezone) + `email_sends` (decision ledger: template_key, flow, suppressed, reason,
  resend_id). RLS on, zero policies (service-role only). APPLIED.
- **Templates:** `comms-templates.js` — 17 verbatim keys (guide_1-7, reset_daily, quiet_1-3,
  quiet_reset, paid_1-3, addon_1-2), on-brand Ink/parchment shell, `render()`. Senders
  riley@ (lifecycle) / brenden@ (founder), Reply-To always support@. guide_5 = interim (founder copy pending).
- **Evaluator:** `evaluate-comms.js` — **hourly cron** (`0 * * * *`). Derives each member's state
  SERVER-SIDE from user_profiles/subscriptions/riley_conversations/daily_checkins (no client wiring
  needed). Global gates: unsubscribed · quiet-hours (9pm-8am local) · one-non-tx-per-day · lapse-repair.
  Then Gone-Quiet ladder → Guide flow → Paid/Add-on. Each key sends **at most once/user ever** (except
  reset_daily), enforced in code. `DRY_RUN=true` supported for a live dress-rehearsal that still sends nothing.
- **Unsubscribe/prefs:** `comms-unsubscribe.js` (RFC 8058 one-click List-Unsubscribe + email-tappable
  letter opt-in/out + resubscribe, uid-based no-login) + authed `/preferences` page (`preferences.html`).
- **Single-choke-point alignment:** extended `email-send.js` additively (optional `replyTo` + `headers`
  — existing 3 callers unaffected) so lifecycle email routes through `sendClientEmail()` and lands in
  `email_log` / the operator correspondence view too, while carrying Reply-To + one-click unsubscribe.
- 🔴 **RECONCILE BEFORE FLIPPING `COMMS_ENABLED=true`:**
  1. ✅ **RESOLVED — `reengagement-cron` vs Gone-Quiet win-back overlap.** `reengagement-cron` now
     stands down automatically when `COMMS_ENABLED=true` (early-return guard), so it keeps running
     win-back while comms is dark (no coverage gap) and the Gone-Quiet ladder takes sole ownership the
     instant you flip the switch (no double-email). Reversible; keyed to the same flag.
  2. **Guide-flow exact timing** (guide_1-7 day thresholds) is a faithful reading of the handoff; the
     authoritative day table lives in `riley-lifecycle-comms-spec-FINAL.md` (not in repo) — reconcile.
- Files: migration 073, comms-templates.js, evaluate-comms.js, comms-unsubscribe.js, preferences.html,
  email-send.js (additive), netlify.toml (hourly schedule + unsubscribe fn).

### Correspondence log — glanceable "Recent correspondence" widget on operator Home
- Follow-on to the correspondence log: a new **"Recent correspondence"** widget on the operator
  Home tab shows the latest 25 emails across ALL members at a glance (recipient · subject · time ·
  kind, green/red status dot) — no need to click into a person. Lazy-loads from admin-correspondence
  (cached across re-renders), rows with a linked member open that member's panel. Reorderable/hideable
  like the other Home widgets; appended to existing saved layouts. operator.html only.

### Correspondence log — every client email is now recorded + visible in the operator
- **Why:** ~8 functions POSTed to Resend and discarded the result, so "did we email this
  client / did it land?" was unanswerable (this came up when Elizabeth was added). Fixed at the
  root: a single choke point.
- **DB:** migration **075** `email_log` (metadata only — recipient, subject, kind, status,
  Resend id / error; NEVER the body). RLS on, zero policies (service-role writes, operator reads).
- **Helper:** new `email-send.js` `sendClientEmail()` — sends via Resend AND logs one row by
  construction (best-effort, never blocks a send). Returns `{sent,id,status,reason,detail}`.
- **Wired (6 client senders):** welcome, program nudges (int-proactive), re-engagement, daily
  brief, waitlist, story — all now route through the helper. **Excluded by design:**
  crisis-followup + safety-alert (crisis stays out of any operator-visible stream, §1.4).
- **Operator:** new `admin-correspondence.js` (OPERATOR_KEY-gated GET by user_id/email/recent);
  client detail panel now shows a "Correspondence" list per member; the Add-User confirmation now
  shows the REAL send result (sent ✓ / failed + reason) instead of the stale "will send once
  Resend is connected." Files: migration 075, email-send.js, admin-correspondence.js, + 6 senders,
  admin-create-user.js, operator.html, netlify.toml.

### Web push — client re-subscribe is now self-healing after a key change
- **Bug:** the enable flows did `getSubscription(); if(!sub) subscribe(newKey)` — so a device
  holding a subscription bound to an OLD VAPID key kept reusing it and never re-subscribed. The
  server then signed with the new key → push service 403 → nothing arrived (silent). This bit
  every device that had ever subscribed under a prior key, independent of the env-var bug.
- **Fix:** compare the existing subscription's `applicationServerKey` to the current one; on
  mismatch (or if the browser won't expose it), `unsubscribe()` and re-subscribe with the current
  key. Applied to `operator.html` (`opSameKey` helper) + inline in `reset.html` + `settings.html`.
  Enable is now self-healing — no manual "turn off first" needed after a key rotation.

### Web push — VAPID keypair moved into the database (no more Netlify env-var pairing)
- **Why:** the VAPID keypair was two Netlify env vars entered as a matched pair by hand; a
  blank/mismatched `VAPID_PRIVATE_KEY` silently disabled all web push (the "no-vapid" bug).
- **What:** migration **074** — new singleton `push_config` table (id=1, public/private/subject),
  **RLS on with ZERO policies** (service-role only; private key never leaves the server) +
  `revoke all from anon, authenticated`. Keypair seeded out-of-band (NOT in the repo). One shared
  `getVapidConfig()` in `supabase-client.js` reads it (cached per container, env-var fallback).
- **Wired:** `push-subscribe.js`, `operator-push.js`, `operator-notify.js`, `reset-nudge-cron.js`,
  `admin-integrations.js` now call `getVapidConfig()` instead of `process.env.VAPID_*`. The two
  "key" endpoints still return ONLY the public key. Env vars remain a safe fallback.
- **Keypair is now STABLE** — set once, so browser subscriptions stay valid. Existing operator/
  member subscriptions were bound to old keys (push never actually worked) → devices re-subscribe
  once (toggle off/on) after this deploy. Files: migration 074 + the 6 functions above.

### Build fix — secret-scan false-positive on two non-secret @meetriley.us addresses
- **Symptom:** deploy FAILED at secret-scan — "found 2 instance(s)": `SAFETY_ALERT_EMAIL`'s value in
  CHANGELOG.md + `comms-templates.js` (×3), and `VAPID_SUBJECT`'s value in email-welcome/operator-notify/
  push-subscribe/reset-nudge-cron/story-submit/waitlist-join.
- **Cause:** the scanner only hunts for values of env vars that are *defined in Netlify*. Adding
  `VAPID_SUBJECT` (for web push) + the new Lifecycle-comms commit hardcoding `brenden@meetriley.us` made
  each var's literal value appear in committed files for the first time. Both values are non-secret
  contact/routing addresses (`brenden@meetriley.us`, `mailto:hello@meetriley.us`) that BELONG in code as
  From/Reply-To headers + the web-push contact fallback — same class as the already-omitted SUPABASE_URL.
- **Fix:** added `SAFETY_ALERT_EMAIL,VAPID_SUBJECT` to `SECRETS_SCAN_OMIT_KEYS` in `netlify.toml` (+ comment).
  No code/behavior change. Unblocks the VAPID web-push deploy.

### Lifecycle Comms — Task 1 (DNS) verified done + Task 3 (templates) built
- **Task 1 (Resend DNS):** verified via live DNS query — SPF (`send.meetriley.us` Resend subdomain),
  DKIM (`resend._domainkey`), **DMARC** (`p=quarantine`), MX (Google Workspace) ALL present. Domain
  fully authenticated; `riley@`/`brenden@` will send clean. No GoDaddy changes needed. (Optional: point
  DMARC `rua` to support@meetriley.us to read reports.)
- **Task 3 (templates):** `netlify/functions/comms-templates.js` — all **17 template keys** VERBATIM
  (guide_1–7, reset_daily, quiet_1–3, quiet_reset, paid_1–3, addon_1–2) + brand shell (Ink header/
  parchment/white card/gold button, 560px) + both footer variants (`FOOTER_VARIANT` env, default B) +
  `{placeholder}` substitution. `render(key,vars,urls)` → {from,replyTo,subject,preview,html,text}.
  guide_5 = `author:'interim'` (founder-copy-pending). Chose one module over 36 loose files (Lambda-friendly).
- 🔴 REMAINING: Task 4 evaluate-comms cron, Task 5 state wiring, Task 6 unsubscribe/prefs, Task 7 harness.
  Everything stays DARK — `COMMS_ENABLED=false`, nothing sends.
- **Files:** `netlify/functions/comms-templates.js` (new).

### Activation funnel events + Lifecycle Comms foundation (DB)
- **Activation events wired** (closes the acquire→activate funnel gap): `signup_started` (login: google +
  magic-link), `signup_completed` (new-account heuristic on SIGNED_IN), `first_riley_message` (both chats,
  once/session), `account_saved` (anon /talk chatter saving). Guarded `window.RileyPH.track` calls.
- **Lifecycle Comms build STARTED** (separate handoff — builds fully **dark**, `COMMS_ENABLED=false`, never
  flipped by Claude; copy verbatim; senders riley@/brenden@meetriley.us, reply-to support@, never noreply@).
  **Task 2 DONE:** migration **073** — `user_comms_state` + `email_sends` (backend-only, RLS deny-all,
  indexes, grants). Once-per-template uniqueness enforced in function code, not DB.
  🔴 REMAINING: Task 1 Resend DNS (founder — SPF/DKIM/DMARC at GoDaddy), Task 3 templates (18 verbatim),
  Task 4 evaluate-comms cron, Task 5 state wiring, Task 6 unsubscribe/prefs, Task 7 test harness.
- **Files:** `login/riley-auth/chat.html`, `supabase/migrations/073_comms.sql`.

### Launch fixes Tasks 9-11 — a11y + perf + instrumentation (targeted)
- **Task 9 (a11y):** pillars emoji icons → `aria-hidden` (decorative; text titles carry meaning).
  Contrast audited: `--smoke #8A8578` passes AA on the dark theme (~5.3:1); only a concern on light
  backgrounds (rare here). Cardinal img already had alt. (Remaining: full emoji sweep on other pages,
  modal focus-trap, touch-target audit — flagged.)
- **Task 10 (perf):** added font **preconnect** on home (LCP page); **lazy-load** the cardinal image
  (`loading=lazy decoding=async`). Fonts already `display=swap` on 35/36 pages (login = system fonts).
  (Remaining: hero-image compression needs asset; Netlify asset-opt + UptimeRobot = founder.)
- **Task 11 (instrumentation):** added PostHog **`story_submitted`** event; **`FUNNEL.md`** = the launch
  funnel taxonomy for Echo (wired: page_view/waitlist_joined/story_submitted/reset*/checkin; TO-WIRE:
  signup_started/completed, first_riley_message, account_saved; BLOCKED on payments: program_purchased,
  subscription_started). FUNNEL.md 404'd publicly (internal doc).
- **Files:** `home.html`, `pillars.html`, `netlify.toml`, `FUNNEL.md` (new).

### Customize Website — operator live editor for the marketing site
- **Why:** the public marketing pages (home/about/pillars/resources) were hardcoded HTML —
  Brenden couldn't change copy or layout without a code edit + redeploy. He wanted to edit
  the site himself from the operator dashboard.
- **What:** new **Customize Website** operator tab — a live click-to-edit preview of the real
  page. Click text to edit it; hover a section for its toolbar (👁 show/hide · ↑↓ reorder ·
  🎨 bg/text colors); click a logo/image to swap/upload/remove. Save → live instantly, **no
  redeploy**. Runtime-override model: pages are instrumented with `data-cms-*` slots; a shared
  `site-cms.js` applies overrides on load, and in `?cms=edit` mode (only inside the operator
  iframe) turns the page into the editor, posting each change to the parent operator which holds
  the key and saves. **Security:** writes go ONLY through `admin-site-content.js` (OPERATOR_KEY,
  service key) — RLS blocks anon writes, so loading a page in edit mode directly can never persist.
  Table `site_content` + public `site-media` bucket (**migration 072**). `resources.html`'s 988
  crisis section is deliberately NOT instrumented (can't be hidden).
- **Files:** `operator.html` (tab), `site-cms.js` (new), `netlify/functions/admin-site-content.js`
  + `site-content.js` (new), `supabase/migrations/072_site_content.sql` (RUN), and `data-cms-*`
  instrumentation on `home/about/pillars/resources.html`. Extend coverage by adding more
  `data-cms-*` attributes — no code change needed.
- **🔴 Migration 072 is RUN.** (Also pending from other sessions: 070_user_stories, 071_waitlist.)

### Launch fixes Task 7 — durable waitlist + confirmation email + PostHog event
- `waitlist-join.js` now upserts a **durable, deduped `waitlist` row** (email, plan_intent) IN ADDITION
  to the existing `events(name='waitlist_joined')` row that Echo's Phase-2 counter reads. Sends a warm
  **Resend confirmation** to the joiner (no-op if RESEND_API_KEY unset). Plan intent already flows from
  the CTA (`data-plan-id` → modal). home.html emits **PostHog `waitlist_joined`** (`window.RileyPH.track`)
  with the plan property on success.
- **`waitlist`** table = migration **071** (APPLIED live): RLS deny-all (service-role only), unique index
  on email for idempotent upsert, grants.
- **Files:** `waitlist-join.js`, `home.html`, `supabase/migrations/071_waitlist.sql`.

### Launch fixes Task 6 — public "Share your story" form (Decision #14)
- Replaced the "Share your story" → /login link with a **public no-auth modal** (name optional, email,
  story, consent checkbox) on home.html. Submits to **`story-submit.js`** (service role): validates,
  **rate-limits** (max 3/email/15min), inserts to **`user_stories`**, then Resend-emails Brenden the full
  submission + a warm confirmation to the submitter (no-op if RESEND_API_KEY unset). Nothing publishes
  without review — status workflow submitted → reviewed → consented → published.
- **`user_stories`** table = migration **070** (APPLIED live via MCP): RLS **deny-all** (no policies →
  anon/authenticated blocked; service role only), status CHECK, index, service_role/postgres grants.
- **Files:** `story-submit.js` (new), `home.html` (modal + JS), `netlify.toml`, `supabase/migrations/070_user_stories.sql`.

### Launch fixes — Task 5 (safety/help/data pages, FAQ) + revised AI disclosure (Task 2.2)
- **AI disclosure moved out of Riley's spoken opening** (founder call): reverted `riley-chat.js` to the warm
  "Hi, I'm Riley" opening; the SB 243 disclosure is now a **persistent UI line at the chat** in `chat.html`
  + `riley-auth.html` ("Riley is an AI companion… How she works & keeps you safe →" → `/safety`). she/her +
  AI-honesty principle stay in the prompt.
- **New pages (v1 — founder should review copy):** `/safety` (SB 243 protocol; crisis behavior cross-checked
  vs the real `riley-chat.js` CRISIS SUPPORT — 988/911/SAMHSA, free at all tiers, no risk-assessment Qs,
  de-identified `crisis_log` ~12mo, lapse-repair), `/data` (plain-English privacy), `/help` (billing, cancel,
  **refund policy** — 30-day on Companion/Coach; $8.14 programs + bundle non-refundable, memory-per-tier).
- **Pricing FAQ** accordion (7 items) added to home.html; trust row "Private by design" → `/data`; "30-day
  guarantee" → "on subscriptions". **Footer links** (Safety/Help/Your Data) added to all 7 marketing pages.
- **Files:** `safety/data/help.html` (new), `home/chat/riley-auth/about/pillars/resources/blog/terms/privacy.html`,
  `riley-chat.js`. No migration. Task 5.5 (Terms update list) = handed to founder, not published.

### Launch fixes — safety/trust copy (Task 2) + pricing page (Task 3) [marketing site]
- Part of the meetriley.us Launch Fixes handoff (11-task build order). Task 1 code was already done
  (0 `eight14.us` refs); Netlify 301 + Google OAuth origins for riley.meetriley.us are founder-owned.
- **Task 2 (safety & trust):** crisis CTA → "Get immediate support" → `/resources`; meta/og reworked
  (removed "supportive community" on all 5 marketing pages); **four pillars reordered** (Rebuild →
  Movement → Food That Heals → Sobriety) in pillars.html; Riley system prompt now states **she/her +
  AI-honesty**; **SB 243 new-conversation AI disclosure** added to `riley-chat.js`. HELD for founder
  approval: the About-page disclosure (draft only). DEFERRED: "How Riley works & keeps you safe" →
  `/safety` link near chat input (waits on /safety being published).
- **Task 3 (pricing — it lives in `home.html`):** program row split into **self-guided (à la carte
  $8.14)** vs **Riley-led interactive ("coming soon")**; removed "Monthly workshops" (card + table);
  Companion → "all self-guided programs", Coach → "all interactive programs included"; bundle → **"The
  Self-Guided Bundle"**; Guide card gains the 8:14 Reset + **"No credit card required. Ever."** (hero +
  card); "Riley, any time" → "Riley conversations"; annual/monthly toggle gains **savings text
  ($53/$58 from `plans`) + aria-pressed**. Prices unchanged ($19/$34/$175/$350 verified in `plans`).
- **Files:** `home.html`, `about/blog/pillars/resources.html` (og), `netlify/functions/riley-chat.js`. No migration.

### Interactive-program nudges — email channel via Resend + cron scheduled
- **Why:** the proactive nudges (session reminders, grief/staying-free date touches, next-day lapse
  check-in) only wrote in-app alerts; Resend is now confirmed live (`email_configured:true`).
- **What:** `int-proactive-cron` also sends email via Resend, consent-gated (enrollment `nudge_channels`
  includes 'email' AND `user_profiles.email_notifications` ≠ false), generic copy only (subject = alert
  title, never names sensitive content), tracked in `engagement_events`. **Scheduled** daily 15:00 UTC
  (~9am MT, quiet-hours-safe). Dormant until members enroll; `dry_run` still HTTP-works post-schedule.
- **Files:** `int-proactive-cron.js`, `netlify.toml` (schedule). No migration.

### Operator Settings — real Integrations status (replaced the fake "Connected")
- **Why:** Settings hardcoded "Anthropic: Connected / Supabase: Connected" regardless of reality;
  no way to see which env keys are actually wired. (Also confirmed: **Metricool is NOT integrated** —
  social publishing is FeedHive; RESEND_API_KEY *is* set per Brenden.)
- **What:** `admin-integrations.js` (GET, operator-gated) returns a boolean per integration — presence
  of the Netlify env key, NEVER the value. Settings panel renders it on open: Anthropic/Supabase/
  Operator (core) · Resend/Web-push (delivery) · FeedHive/PostHog/Canva/Stripe (growth), green
  Connected / red Not set / grey optional.
- **Files:** `admin-integrations.js` (new), `operator.html` (loadIntegrations + tgs), `netlify.toml`.

### Client home reorganized — dynamic tappable stat tiles + de-duplicated
- **Why:** the home felt cluttered — mood + sobriety each appeared TWICE (a stat tile up top AND a
  full panel lower down: "How are you feeling?" + "Sobriety Streak"); the 4 stat tiles looked
  tappable but weren't; and the tiles were a FIXED set (not everyone tracks sobriety — some track
  meals/workouts instead).
- **What (`dashboard.html` only):**
  - **Dynamic stat tiles** — the row now shows only the trackers THIS member uses, driven by
    entitlements + data: Sobriety (if active date), Mood (always), Sleep / Movement / Nutrition (if
    `tracker_sleep`/`tracker_fitness`/`tracker_nutrition` entitled OR has data). A body-focused member
    sees Movement + Nutrition instead of Sobriety.
  - **Tiles are now tappable `<a>`s** → history: Sleep→/sleep, Movement→/workouts, Nutrition→/nutrition,
    Mood & Sobriety→/progress. Hover "›" affordance; grid is `auto-fit` so 1–5 tiles all look right.
  - **Sobriety redesigned** — the always-full ring (meaningless) is gone; the tile shows days + a
    progress bar toward the NEXT milestone ("118 to 1 year"). Real, incomplete momentum.
  - **Removed the duplicate panels** — "How are you feeling?" (mood now lives in the chat check-in;
    `saveMood` null-guarded) and "Sobriety Streak". Right column is now Habits · Goals · Programs only.
  - Added a `nutrition_logs` load for the Nutrition tile. Milestone "✨ N days" slot untouched.
- **Files:** `dashboard.html`.

### Scale audit → indexes, cron/metrics batching, app-wide RLS initplan fix
- **Why:** review for scale to 5k customers. Supabase perf advisor flagged unindexed hot FKs + the
  `auth_rls_initplan` pattern (auth.uid() per-row) across 76 policies. Verdict: stack scales to 5k
  comfortably (serverless + PostgREST pooling + parallel indexed hot path); these are the fixes.
- **What:** migration **067** (hot-path indexes: `int_commitments`/`int_triggers`/`int_trusted_people`.
  enrollment_id + `user_program_progress`.user_id). **068** (`int_program_metrics()` fn — GROUP BY in
  Postgres; admin-int-metrics no longer pulls all rows). **069** (guarded, atomic, idempotent DO-block
  sweep wrapping auth.uid()/role()/jwt() in `(select …)` across all 76 policies — run once, re-run the
  advisor after). int-proactive-cron: removed the per-enrollment N+1 (batched reads + sync plan).
- **🔴 Migrations 067→069 need running** (Brenden). Files: `supabase/migrations/067–069`.

### Interactive Riley-led programs — full system SHIPPED (migrations 060–065)
- 4 coached $18.14 programs (Move Nourish · Living Forward · Building Happiness · Staying Free), draft.
  Data + engine (`int-session.js`) + 60 sessions + `int-program.html` + in-session Riley chat & Guide
  cap-exemption + lapse-repair (`lapse-detection.js`, founder canon, crisis path intact) + four-lane
  routing + in-app proactive cron + operator editor/metrics. `riley-chat.js` gained session-context,
  slip detection, routing (all additive/gated — default chat unchanged, verified). Migrations 060–065 RUN.
- **Operator UX:** Programs tab is now ONE catalog (session/module editors expand in each row); Home
  merged "New members" + "Last Active Clients" → one "Latest sign-ups" widget. See `interactive-programs-2026-07.md`.

### Daily check-in merged INTO Riley chat — dark, mandatory, time-aware
- **Why:** the dashboard auto-fired its **own** rich modal check-in AND the chat popup ran a
  **separate** lighter check-in — members saw two at once. The chat was also light/cream (off-brand)
  and the morning goal question asked about "today" at 6am (nonsensical). Also fixed a pre-existing
  bug: `chat.html` bootstrap threw on missing `#user-avatar`/`#user-name`, so the chat's own
  check-in + resume never actually ran.
- **What:** `chat.html` is now the **single** owner of the daily check-in — Riley-led chips, the full
  rich flow (mood → sleep/heaviness → lane-keyed goal → what shaped it → optional note), crisis scan +
  Watch/Concern escalation + "give one thing back" card, saving the same `daily_checkins` row. In the
  **morning** the reflective questions look back at **yesterday**. Chat restyled **dark** (ink/gold/
  parchment). After the check-in, a warm mood-aware line + resume-or-new. Check-in is **mandatory**:
  while it's in progress the popup can't be minimized/closed — `chat.html` posts `pending/done/exempt`
  to `pwa.js` which locks the −/×/ESC/overlay. **Crisis + any error always unlock** (fail-open, never
  trap). Retired the dashboard modal (`loadDailyCheckin` trigger + the whole engine removed) and
  neutralized the `saveMood` quick-tap so it logs mood only (no `checkin_completed` bypass).
- **Files:** `chat.html` (check-in flow, dark theme, contextual greeting, lock signals, bootstrap fix,
  `newConversation` fix), `pwa.js` (mandatory lock: postMessage listener + guarded close/ESC/overlay),
  `dashboard.html` (retired modal trigger + dead engine, `saveMood` logs mood only). No migration.

### Security — internal `*.md` docs no longer publicly served + operator-key note
- **Why:** `meetriley.us/CLAUDE.md` (and other root docs) returned HTTP 200 — internal dev notes
  were publicly readable, including the documented `Riley814` operator password.
- **What:** `netlify.toml` now force-404s the internal docs on every host (`/CLAUDE.md`,
  `/CHANGELOG.md`, `/DATA_CONTRACT.md`, `/ENTITLEMENTS_ADMIN.md`, `/INTERACTIVE_PROGRAMS_QA.md`,
  `/README.md`) via a new `/404.html`. Scrubbed the literal `Riley814` from `CLAUDE.md` — the operator
  key is validated SERVER-SIDE by `requireOperator()` (supabase-client.js); value lives only in the
  Netlify `OPERATOR_KEY` env var + a password manager. Verified NO secret values (service key, etc.)
  are committed; the Supabase anon key is public-by-design (RLS-protected) — no action there.
- ✅ **DONE (2026-07-07) — `OPERATOR_KEY` rotated** by Brenden + redeployed. Verified: the old `Riley814`
  key now returns **401** at `admin.meetriley.us/.netlify/functions/admin-home` (rotation took, gate intact).
  New value lives only in the Netlify env var + a password manager. Exposure fully closed.
- **Files:** `netlify.toml`, `404.html` (new), `CLAUDE.md`.

### `7e132fa` — Programs page: split add-ons into Self-Guided vs Riley-Led
- **Why:** the client `/programs` "Program Add-ons" grid mixed self-guided content programs
  ($8.14, no Riley) with Riley-led coaching programs ($18.14, Session Zero + 14 sessions) in one
  undifferentiated list — members found it confusing.
- **What:** `programs.html` now renders two labeled sections, each with a serif header, a one-line
  descriptor, and a price pill: **Self-Guided Programs** (from $8.14) and **Riley-Led Programs**
  ($18.14). Split is driven by program `kind`: `self_guided`+`bundle` → self-guided; `interactive`+
  `guided` → Riley-led (`pgFamily()`/`pgSection()`). New programs slot in automatically.
- **Files:** `programs.html` only (CSS `.pg-fam*`, `#pg-avail`→`#pg-addons`, `loadPrograms()`).

### `7b6348c` — Client portal: remove redundant topbar ← Home / Ask Riley buttons
- **Why:** every client page has the left sidebar (Today = home) + the global floating Riley pill,
  so the top-right `← Home`/`← Tracker` + `Ask Riley` button pair was pure duplication.
- **What:** removed that button pair from **12 pages** (brief, calendar, conversations, finance,
  library, nutrition, programs, progress, sleep, tracker, workouts, chat).
- **Kept (do NOT remove):** the `+ New Chat` / `New Conversation` buttons (functional), the
  dashboard notification bell, the `← Back to dashboard` link on the **sidebar-less** pages
  (`program.html`/`profile.html`/`settings.html` — their only nav), and the `← Back to Home` links
  that live **inside the full-screen `🔒 feature-locked` overlays** (they're the escape hatch, not
  footer clutter — removing them traps users).

---

## 2026-07-06

### `f6dbc6a` — Operator dashboard rework + Finance system
- Operator `operator.html`: top nav → **left sidebar** + Riley logo; tabs reorganized (PostHog
  Analytics nested under Social; Engagement→**Client Overview** w/ Safety merged; Metrics→**Riley
  Overview**; Add User → modal). New finance: **Revenue** (MRR from `subscriptions`) + editable
  **`operating_expenses`** table + Net, via `admin-finance.js` + migration `066`. Home shows an
  MRR·Expenses·Net snapshot. (Full detail in Claude memory: `operator-finance-rework-2026-07`.)
