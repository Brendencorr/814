# Riley — Deploy & Change Log

**Shared coordination log for parallel Claude Code sessions.** Multiple sessions deploy to
`main` at any given time. Before you start: `git fetch && git log --oneline -5` + read the top of
this file. After you ship to production: **append an entry here (newest first) in the same commit
or the next one, then push.** This is how each session knows what the others already changed.

Format per entry: `date` · `commit` — one-line summary · then bullets of what/why + files touched.
Keep it benign — this file is committed to a public-served repo, so **never put secrets here**.

---

## 2026-07-07

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
