# Riley — Deploy & Change Log

**Shared coordination log for parallel Claude Code sessions.** Multiple sessions deploy to
`main` at any given time. Before you start: `git fetch && git log --oneline -5` + read the top of
this file. After you ship to production: **append an entry here (newest first) in the same commit
or the next one, then push.** This is how each session knows what the others already changed.

Format per entry: `date` · `commit` — one-line summary · then bullets of what/why + files touched.
Keep it benign — this file is committed to a public-served repo, so **never put secrets here**.

---

## 2026-07-09

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
