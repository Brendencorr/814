# Riley — Deploy & Change Log

**Shared coordination log for parallel Claude Code sessions.** Multiple sessions deploy to
`main` at any given time. Before you start: `git fetch && git log --oneline -5` + read the top of
this file. After you ship to production: **append an entry here (newest first) in the same commit
or the next one, then push.** This is how each session knows what the others already changed.

Format per entry: `date` · `commit` — one-line summary · then bullets of what/why + files touched.
Keep it benign — this file is committed to a public-served repo, so **never put secrets here**.

---

## 2026-07-07

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
