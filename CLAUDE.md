# 8:14 Project — Claude Code Instructions

## CRITICAL: Model Name
The **member conversation** model is:
claude-sonnet-4-6

Never use claude-sonnet-4-20250514 — it is deprecated and will cause 502 errors.
Never use claude-opus-4-5 — use claude-sonnet-4-6 instead.

**Model routing (Master Build Spec v2 §8.2 — supersedes the old "all functions sonnet" rule):**
- **Conversation** (riley-chat member replies) → `claude-sonnet-4-6`. Non-negotiable; quality is felt here.
- **Utility / background** (memory extraction, session summaries, classification, synthesis, plan
  adaptation, post-hoc crisis scan) → **Haiku 4.5** `claude-haiku-4-5-20251001` for cost.
- All models are routed through **`model-router.js`** (`MODELS.chat` / `MODELS.memory` / etc.) — change a
  model in ONE place, not a grep. Every Haiku call site is non-blocking / fail-open, so a bad utility model
  can never break a member's reply. **Do NOT "fix" Haiku back to Sonnet** in the utility functions.
- New AI calls should go through **`anthropic-client.js` `callClaude()`** (prompt caching + cost logging +
  retry/Haiku failover), not a raw fetch.

## CRITICAL: max_tokens
- riley-chat.js (streaming): max_tokens = 1000 — short conversational replies, streams in real time
- Agent functions (scout, sage, atlas, echo): max_tokens = 4000 — Netlify Pro removes CDN inactivity timeout
- Pipeline background functions (weekly-pipeline-cron, manual-pipeline-background): max_tokens = 4000
- Riley streaming bypasses the synchronous timeout — max_tokens 1000 comfortably finishes within 30s
- On Netlify Pro, synchronous agent functions can handle 4000 tokens within the 26-second function limit
- Dashboard pipeline uses manual-pipeline-background.js (-background suffix = no timeout)

## riley-chat.js response format
riley-chat.js is a STANDARD Netlify serverless function (no streaming wrapper).
It returns Content-Type: text/plain with the reply text directly (no JSON wrapper).

Riley widgets use response.body.getReader() to read the plain text:

  const res     = await fetch('/.netlify/functions/riley-chat', { method: 'POST', ... });
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
    bubble.textContent = fullText;
  }

This works because getReader() works fine with regular (non-streaming) responses too —
the full body arrives in one or a few chunks. The blinking cursor shows while the
request is in flight.

DO NOT use response.json() for riley-chat — it returns text/plain not JSON.
DO NOT add @netlify/functions or stream() wrapper — Netlify's standard Lambda format is correct.

## CRITICAL: Scheduled pipeline is weekly-pipeline-cron.js
The cron schedule is on weekly-pipeline-CRON (not weekly-pipeline, not weekly-pipeline-background).
weekly-pipeline.js is the manual HTTP trigger endpoint (callable from dashboard).
weekly-pipeline-cron.js runs every Sunday 12:00 UTC (6am MT) as a scheduled background function.
Netlify scheduled functions do NOT need a -background suffix — the schedule makes them background automatically.

## Clarity & Cadence — spec pointers (source of truth in docs/)
- Clarity engine: `docs/07_CLARITY_SCORE_V2_SPEC.md` (v2.3) + `docs/07A_CLARITY_V2_4_AMENDMENT.md`
  (v2.4 - Presence lane for grief + insight nudges; founder-approved 2026-07-23, closes the grief
  open question. We still never grade grief itself - Presence scores the showing up.).
- Cadence & check-ins: `docs/08_RHYTHM_AND_RETURN_SPEC.md` (v1.1 - return tiers, Never-Say list, continuity loop).
- The scored check-in spine is invariant; personalization is additive only.
- Rhythm & Return is ON BY DEFAULT (founder call 2026-07-22) - set `RHYTHM_ENABLED=false` in Netlify env
  to turn the layer off. Gate every call site through `rhythmEnabled()` (rhythm.js), never a raw env read.
  The shared tier/backoff/Never-Say logic lives in `netlify/functions/rhythm.js` (pure, unit-tested in
  tests/rhythm/). The check-in's framing + follow-up questions are LIVE-GENERATED per member (Haiku via
  checkin-prompts.js personalizeLayer) with the Never-Say gate + static-bank fallback - the SCORED spine
  is never generated and never reworded in substance.

## Repo Structure
- netlify/functions/ — 8 Netlify serverless functions
- dashboard.html — private agent dashboard (gated by the OPERATOR_KEY env var; value is NOT stored in this repo)
- supabase/migrations/ — SQL migrations to run in Supabase SQL editor
- brand/ — internal brand toolkit (NOT publicly served; force-404 via netlify.toml). See Social template system below.
- All agent functions use the same handler pattern — only system prompts and Supabase logic differ

## Social template system (LOCKED v1.0)
brand/template-kit/TEMPLATE_SPEC.md is the locked contract - six grounds only (dawn, first-light, veil,
parchment, framed, first-blush), launch-phase signatures (nav on dark, riley-nav-ink on light, no maker's mark).
Rotation rules enforced in netlify/functions/template-rotation.js.
- Grounds are pre-baked PNGs in brand/template-kit/grounds/; the Python engines LOAD them (never regenerate) and
  restrict to the six locked names (Beam/Ember/etc. are retired and raise). Production fonts (DM Serif Display /
  DM Sans / DM Mono) are bundled in brand/template-kit/fonts/ - never publish stand-in-font renders.
- Rebuild the render library: `python3 brand/template-kit/make_carousels.py && python3 .../make_multiformat.py`
  → brand/template-kit/library/ (GITIGNORED, ~120MB, regenerable - not committed).
- Rotation rules (template-rotation.js, also Spec §11): never the same template >2x in a row · never >3 dark or
  >3 light in a row · weekly mix of post/story/reel/carousel · Week 1 = all Riley/launch · Weeks 2-4 = ≥4
  Riley/program posts per week (rest may be web-sourced). Self-test: `node netlify/functions/template-rotation.js --selftest`.

### Grounds render engine (content-design.js) - the LIVE design step for CONTENT_ENGINE_v3
- `netlify/functions/content-design.js` renders a brief onto a ground SERVER-SIDE with **@napi-rs/canvas**
  (render_engine='riley-grounds'), a Node port of the Pillow layouts. It reads grounds+fonts off disk (bundled via
  netlify.toml `included_files`), assigns a ground via template-rotation.js (Veil for heavy), uploads the PNG to the
  public **content-assets** Supabase bucket, and inserts a **content_creative_assets** row. This is a new pluggable
  engine alongside content-atlas.js (Canva) - Canva stays available but is no longer required.
- @napi-rs/canvas is **lazy-required** so a bundling problem degrades the design step only (renderBrief returns
  {designed:false}) instead of breaking content-queue. Keep it in netlify.toml `external_node_modules`.
- **Two-step lifecycle** (content-queue.js): `pending` → **approve** (auto-assigns + renders a design → status
  `designed`) → **Review** (operator swaps ground / final-approves) → **publish** (Echo per-platform →
  content_publishing_jobs → feedhive-publish WITH the rendered image as media) → `scheduled`. The `designed`
  review_status enum value is added in migration 083. Operator UI: Social Media tab → Review + Designs sub-tabs.
- v1 renders ONE static image per brief (hook/body/story). Carousels (multi-slide) + reels (motion) are a follow-on.

## Required Environment Variables
Set all of these in Netlify → Site configuration → Environment variables:

- ANTHROPIC_API_KEY — Anthropic Claude API key (never hardcode)
- SUPABASE_URL — Supabase project URL
- SUPABASE_ANON_KEY — Supabase publishable key
- SUPABASE_SERVICE_KEY — Supabase secret key for server-side operations
- FEEDHIVE_API_KEY — FeedHive API key for scheduling/publishing to social platforms (REPLACED Buffer)
- FEEDHIVE_ACCOUNT_IDS — (optional) comma-separated FeedHive account IDs to target; if unset, feedhive-publish targets ALL active connected accounts
- FEEDHIVE_MODE — "draft" (default) or "live". draft = nothing auto-publishes (a human approves/schedules in FeedHive); live = pipeline schedules already-approved items. Per CONTENT_ENGINE_v3 §A7; Phase A moves this to a DB-stored admin toggle.
- FEEDHIVE_TRIGGER_URL — (Phase A, optional) FeedHive Trigger-URL endpoint for the create-and-schedule hot path (REST POST /posts is the current path)
- URL — Netlify site URL (set automatically by Netlify, e.g. https://admin.meetriley.us)

## Supabase
The shared client is at netlify/functions/supabase-client.js.
Always use SUPABASE_SERVICE_KEY (not SUPABASE_ANON_KEY) in functions — server-side only.
All Supabase writes are non-blocking and non-fatal: if Supabase is unavailable, functions still return Claude's reply.

### Tables
- scout_history — topics/pillars covered each week (prevents repetition)
- echo_scores — weekly performance metrics (format_winner, best_pillar, worst_pillar)
- published_posts — record of every post sent through the pipeline (includes buffer_update_id)
- pipeline_runs — log of every Sunday autonomous pipeline run
- user_profiles — authenticated user data: name, email, sobriety_date, programs_purchased
- riley_conversations — persistent Riley chat history per user and session
- user_program_progress — program day tracking per user

### Migrations
Run in order in Supabase SQL editor:
1. supabase/migrations/001_initial.sql — creates scout_history, echo_scores, published_posts
2. supabase/migrations/002_pipeline.sql — adds pipeline_runs table + format_winner/worst_pillar columns
3. supabase/migrations/003_auth.sql — user_profiles, riley_conversations, user_program_progress with RLS

### Database security — RUN AFTER EVERY MIGRATION (prevents the auth_users_exposed class of bug)
In Supabase, ANYTHING in the `public` schema is exposed through the API and, by default, granted to the
`anon` + `authenticated` roles. So a new view/function/table is publicly reachable with the anon key UNLESS
you revoke it. That is how member emails leaked through `data_integrity_report` and how operator RPCs
(`admin_home_analytics`) became anon-callable — fixed in migrations 096/097.

Every migration that creates a view / function / trigger fn MUST, in the SAME migration:
- If it is SERVER-ONLY (monitoring views, operator RPCs, trigger fns, cron helpers — anything read only
  via the SERVICE key): explicitly `revoke all on <view> from anon, authenticated;` /
  `revoke execute on function <name>(<argtypes>) from anon, authenticated;`.
- NEVER let a `public` object that reads `auth.users` be reachable by anon/authenticated. Prefer
  `alter view <v> set (security_invoker = true);` and keep operator/monitoring objects out of client reach.

Then ALWAYS run the Supabase Security Advisor and fix any NEW lint before the work is "done":
- via the MCP: `get_advisors` with type=`security`; or the dashboard → Advisors → Security.
- Treat `*_exposed`, `anon_*_executable`, and any ERROR-level lint as BLOCKING.
Keep Supabase's advisory EMAILS enabled — that automated scan is the backstop that caught the last one.

## Functions

### Agent functions (manual, called from dashboard)
- scout.js — research agent, injects echo performance data + history before calling Claude
- sage.js — writer agent, injects format_winner + pillar performance before calling Claude
- atlas.js — scheduler, calls feedhive-publish for each post after Claude responds
- echo.js — analytics agent, saves metrics to echo_scores after each run
- riley-chat.js — chatbot; accepts user_id + session_id for persistent memory; reads user profile for personalization

### Infrastructure functions
- auth-handler.js — POST endpoint; actions: get_session, save_message, update_profile; uses SERVICE_KEY
- feedhive-publish.js — POST endpoint to create/schedule one post via the FeedHive API (drafts by default; auto-schedules only when FEEDHIVE_AUTOSCHEDULE=true). Resolves target accounts from FEEDHIVE_ACCOUNT_IDS or all active connected accounts.
- pipeline-status.js — GET endpoint, returns pipeline_runs + echo_scores + published_posts for dashboard
- weekly-pipeline.js — HTTP POST manual trigger; returns JSON status; callable from dashboard
- weekly-pipeline-cron.js — cron-scheduled function (Sunday 6am MT); runs as background; full pipeline

### Auth pages
- login.html — Google OAuth sign-in page → redirects to /dashboard.html on success
- riley-auth.html — Full Riley chat experience with Google auth, sobriety date, conversation history

## Scheduled Pipeline
- weekly-pipeline-cron.js runs every Sunday at 6am Mountain Time (12:00 UTC)
- Configured in netlify.toml: schedule = "0 12 * * 0"
- Do NOT add -background suffix to scheduled functions — it conflicts with Netlify's cron handling
- Background functions have no HTTP timeout — run until complete (10 min free / 15 min Pro)
- Sequence: Echo data read → Scout → Sage → Atlas → FeedHive publish → log to pipeline_runs
- Each step is individually fault-tolerant; pipeline logs partial status and continues
- Status logged to pipeline_runs table (success / partial / failed)
- weekly-pipeline.js remains as manual HTTP trigger from dashboard (returns JSON status)

## Google OAuth
Google Client ID: 206086364002-clh43vor3dvrk0bv54e5pp5nfd79jvto.apps.googleusercontent.com
Configure in: Supabase Dashboard → Authentication → Providers → Google
Add authorized redirect URI: https://tglljvjixlolaguycvbb.supabase.co/auth/v1/callback

## Supabase Frontend Config
URL: https://tglljvjixlolaguycvbb.supabase.co
ANON KEY: get from Supabase Dashboard → Settings → API → anon (public)
Replace SUPABASE_ANON_KEY_PLACEHOLDER in login.html and riley-auth.html with the actual anon key.
The anon key is safe to expose in browser — RLS policies protect all user data.

## Riley Chat API — embed usage

riley-chat.js accepts POST with JSON body. Two calling conventions:

**Legacy (single message):**
```json
{ "message": "user text here" }
```

**Preferred (full conversation history):**
```json
{
  "message": "latest user text",
  "messages": [
    { "role": "user",      "content": "first message" },
    { "role": "assistant", "content": "riley reply" },
    { "role": "user",      "content": "latest user text" }
  ]
}
```

Always send the full `messages` array so Riley remembers the conversation.
The server caps history to the last 20 messages automatically.
If both `message` and `messages` are sent, `messages` takes precedence and `message` is appended if not already the last entry.
Response: `{ "reply": "Riley's response text" }`

**With persistent memory (logged-in users):**
```json
{
  "message": "latest user text",
  "messages": [...history],
  "user_id": "uuid-from-supabase-auth",
  "session_id": "uuid-generated-per-browser-session"
}
```
When user_id and session_id are provided:
- Riley's system prompt is personalized with the user's profile (name, sobriety date, programs)
- Both the user message and Riley's reply are saved to riley_conversations automatically

## Operator Dashboard (admin.meetriley.us)
admin.meetriley.us serves operator.html — private operator tool for Brenden only.
Password gate: the operator types the OPERATOR_KEY, which is validated SERVER-SIDE by
requireOperator() (no client-side password, no key value stored in this repo). Set/rotate
OPERATOR_KEY in Netlify → Environment variables; keep the value only in a password manager.

Design system:
- Background: #06090e | Cards: #0a1018 | Borders: #1a2530
- Gold: #c9a84c | Sage: #4a7c59 | Text: #e8e4de
- Fonts: DM Serif Display (headings), DM Sans (body), DM Mono (labels/nav) — same DM system as the member site
- Messaging canon: `RILEY_MESSAGING_HOUSE.md` v2.1 — now committed at the repo root (force-404'd publicly, like POSITIONING.md). Homepage v2 + sitewide copy follow it verbatim; canonical lines are never paraphrased; plain hyphens only in member-facing copy, never em-dashes. Check every copy change against it.
- Email signing canon (Brenden, 2026-07-22): exactly ONE email is ever from/signed Brenden — `guide_5`, the day-29 month-one founder note in comms-templates.js. EVERY other communication (emails, in-app, letters) is signed Riley. Never add a new Brenden-signed comm.
- Mentor tier: dashboard-only, NEVER on marketing surfaces — no teaser, no quiet card (re-confirmed 2026-07-22).

## Founder decisions, 2026-07-23 (hold as truth)
- **Riley is NOT a recovery tool - never describe it as one, anywhere** (founder correction after an
  internal brief opened with "a recovery and sobriety support product"). The category is REBUILDING -
  not wellness, not recovery. Recovery is one chapter, never the whole story. The canonical one-liner
  (verbatim): "Riley is a companion for life's hard chapters - grief, burnout, habits, sobriety,
  starting over - built by someone who's been through them." This binds INTERNAL docs and briefs too,
  not just member-facing copy - source: RILEY_MESSAGING_HOUSE.md §The Category and the Mission.
- **Life Balance wheel is BACK, and at the TOP of /lifemap** — reverses punch-list P1.4 (July 14).
  Order: wheel → My User Manual → Your Story → insights → facets → timeline. Do not re-delete it.
- **Life Map spotlight on the member homepage** (dashboard.html `loadLifemapSpotlight`): condensed
  What Riley's Noticing + filled facet chips + still-learning line, under the composer, for every
  entitled member until they hit DISMISS (localStorage `lm_spot_off_<uid>`, per device). Never
  auto-hide it — "at least the first week" is guaranteed by only the member dismissing it.
- **The spotlight is an OPEN feature** (founder, same day): members add, update, and REMOVE entries
  directly on the homepage card (every chip has an ×, every facet a "+ add", still-learning facets
  are tappable to start). Habits/fears/people change — there must always be space to update the
  member's identity. It does not need to preserve past answers; removal is the member's call
  (soft-delete via life_map.is_active, same as the Life Map page).
- **The daily brief is ONE card** — title row + body in a single padded container, no separate
  gradient header band, no duplicated copy (bc-sub is hidden but stays in the DOM for the JS).
- **Onboarding→Clarity handoff (founder-approved 2026-07-23, four fixes):**
  1. **Sobriety date is asked ONCE, in chat, only when sobriety is already the topic** — never an
     onboarding screen. Directive in riley-chat buildUserContext; capture via
     `sobriety-date-capture.js` (Haiku, regex-gated, fail-open; guarded update fills only a null
     column, also seeds sobriety_tracker). A decline is stored as riley_memory and is permanent
     (NEVER RE-ASK). 2. **Presence lane offer extends to focus_lane='grief'** (not just grief-program
     owners) — onboarding grief pick seeds config.lanes.presence=true via clarity-config
     origin:'onboarding'; clarity-v2-write auto-offers for existing grief-lane members. Opt-out
     unchanged. 3. **Important Dates**: member surface on /lifemap (date + optional "why is this
     important" + heavy toggle) writing important_dates, heavy ones mirrored to hard_dates
     (source 'member', recurrence annual); grief lean-in gets an optional heavy-date screen;
     clarity-v2-write now PROJECTS annual labeled hard_dates into its window (taps never recur —
     chat.html writes recurrence:'none'). 4. **Focus picks seed enabled_practice** at onboarding
     finish (default trio base + connection/outside/program from their picks, cap 5).
- **Memory/recall upgrades (founder-approved 2026-07-23, #2-#6 of the memory roadmap):**
  All Haiku-powered utilities - non-blocking, fail-open, regex-gated where possible.
  #2 `style-learn.js`: auto-learns communication_style (14-day self-rate-limit; NEVER clobbers a
  member-set style - events name 'style_learned' is the provenance marker); injected in riley-chat.
  #3 `people-graph.js` + `member_people` (migration 104, owner RLS): structured people
  (name/role/sentiment/mention recency) fed by the extraction pass; THEIR PEOPLE prompt block has
  Riley ask about people BY NAME. life_map relationship chips unchanged.
  #4 `progress-mirror-cron.js` (Mon 15:00 UTC) + `progress_mirrors` (105, SERVER-ONLY): one
  "distance traveled" note per member per ~28d; DIGIT-BAN + violatesNeverSay gate every note;
  surfaced ONCE in chat, calm days only (no heavy dates, recentMood > 2.2), shown_at marks it.
  #5 `memory-intent.js`: "forget that"/"remember this" honored in-data (soft-delete / priority
  insert, source 'member_request'); MEMBER MEMORY CONTROL directive in buildUserContext.
  #6 memory-maintenance-cron gained theme PROMOTION (recurring riley_memory themes → life_map,
  source 'consolidation', max 2/member/run) - merge/decay/backfill already existed.
  #1 (semantic recall) is BUILT but DARK: set EMBEDDINGS_API_KEY (+EMBEDDINGS_PROVIDER) or
  OPENAI_API_KEY/VOYAGE_API_KEY in Netlify and retrieval + weekly backfill go live on their own.
  SECURITY LESSON (advisor re-flag, fixed in 106): re-creating a SECURITY DEFINER function
  restores PUBLIC execute - every migration that (re)creates one must re-revoke in the same file.
- Product source of truth for collaborators/other AI chats: `docs/PRODUCT_BRIEF_2026-07-23.md` —
  regenerate/update it when tiers, member experience, or comms change materially.
- `/docs/*` is force-404'd publicly (netlify.toml) — internal specs live there; keep it that way.

## Founder decisions, 2026-07-22 (hold as truth)
- **No crossover message.** The Clarity v2 upgrade announcement (Doc 07 §12.4 "Clarity got smarter"
  placeholder) is DEAD - never build or send it. Members just experience the new score.
- **Payments are LIVE** (`app_settings.payments_live = true`). The marketing waitlist path is
  RETIRED and removed from home.html - paid CTAs route straight through sign-in to Stripe Checkout.
  Do not resurrect the waitlist modal.
- **Grief scoring is an OPEN QUESTION.** Doc 07 §5 ships "never score grief" (presence-credit only);
  the founder disagrees and wants it fleshed out - grief is real and should count some way. Do NOT
  change the lane until a founder-approved spec exists. Current truth: grief-lane members DO earn
  presence credit (showing up counts toward Practice); what is never graded is grief itself.
- Supabase leaked-password protection: deferred until the plan upgrade (founder aware).
- **Birthdate is KEPT from the 18+ gate** (founder, 2026-07-23 - supersedes 088's discard design):
  saved to `user_profiles.date_of_birth`, injected into Riley's chat context as Age, disclosed in
  privacy.html. Ask ONCE, ever. HARD LINES: never an input to Clarity scoring or audits (the
  methodology page's fair-by-design wording was narrowed to match); a denied minor's birthdate is
  never stored; accounts predating 2026-07-23 have no DOB on file - Riley never asks their age cold
  (NEVER RE-ASK LAW in riley-chat buildUserContext).

## Clarity + cadence canon (2026-07-22)
- Clarity engine: docs/07_CLARITY_SCORE_V2_SPEC.md (v2.3 — bands, lanes, First Light, provisional,
  return cadence/Re-Light, spine/skin dynamic check-ins). Cadence & check-ins:
  docs/08_RHYTHM_AND_RETURN_SPEC.md (v1.1 — return tiers, Never-Say list, continuity loop).
  The scored check-in spine is invariant; personalization is additive only.
- Clarity/Rhythm work lives on branch `clarity-v2` — it merges AFTER launch blockers (payments,
  campaign, site) unless the founder says otherwise. Do not touch the launch-critical path from it.

## Messaging cohesion gate (founder rule, 2026-07-22) — BEFORE EVERY PRODUCTION PUSH
Any push to main must keep the website, app pages, AND internal dashboards saying the same thing.
- Run `node scripts/check-messaging.js` before pushing (enable the pre-push hook once per clone:
  `git config core.hooksPath .githooks`). Netlify runs the SAME script as its build command, so a
  deploy with drift FAILS — this gate is enforced, not advisory.
- It checks: retired strings (incl. "Riley Guide" as display name and Riley claiming "she's been
  through it"), em-dashes in member-facing files, canonical v2.1 lines verbatim on home/about, tier
  taglines pinned to the right cards, no Mentor on marketing, AND (when Supabase env is present, as
  in Netlify builds) the DB-stored client-visible naming: `products.display_name` + `plans.name/tagline`.
- Tier naming, single source of truth (internal keys NEVER change): key `guide`/`reset_free` displays
  "Riley Companion" (free) · key `companion` displays "Riley Coach" ($19/$175) · key `coach` (retired
  $34 tier) displays "Riley Mentor", hidden from menus, grandfathered members only · `mentor` row is
  draft/hidden. Synced 2026-07-22 across: DB products + plans, dashboard.html TL map, tier-labels,
  riley-chat.js prompt, stripe-catalog, marketing pages. If you change a display name, change it in
  ALL of those places + the check script's expectations, in the same commit.

## Homepage + About final layout (founder decisions, 2026-07-22 — supersede the v2 handoff §-order)
- home.html order: hero (two-line H1, no orb above eyebrow) → Porch Lights → Meet Riley (memory
  doctrine folded in — NO standalone Memory section) → tiers/compare/à-la-carte → Problem ("hardest
  hours") → hard moments → whispered story → testimonial → ethos → FAQ → close. The 8:14 Reset band
  was removed as repetitive. Porch doors: light on the left, two text lines beside it.
- about.html: founder-final copy (2026-07-22 amendment): Why 8:14. → Built the hard way. →
  Wherever you are. → Meet Riley ("A steady presence. Any hour.", absorbs the Why Riley copy and
  carries the "Riley is an AI." disclosure) → Begin. Replaced paragraphs are locked verbatim and
  deliberately NOT CMS-editable.
- All from Google Fonts CDN

Dashboard reads live data via:
- GET /.netlify/functions/pipeline-status → pipeline_runs, echo_scores, published_posts, scout_history

Dashboard writes/triggers via:
- POST /.netlify/functions/echo → Echo analysis from weekly numbers
- POST /.netlify/functions/scout → Scout research
- POST /.netlify/functions/sage → Sage content writing
- POST /.netlify/functions/atlas → Atlas scheduling
- POST /.netlify/functions/weekly-pipeline → Manual pipeline trigger

Supabase tables used by dashboard (no RLS — anon key reads work):
- echo_scores, pipeline_runs, published_posts, scout_history

## Tier Positioning (CANONICAL - see POSITIONING.md)
The tiers answer "how close do you want Riley?", not "how much do you get?" Money is secondary.
Locked v2.3.1 truth - display rename ONLY (internal keys, entitlements, Stripe lookups, DB values
unchanged). All display names render through tierLabel() (tier-labels.js) / RILEY_TIER_LABELS in
client HTML - NEVER hardcode a tier display name. One paid tier. Verbatim taglines (must match everywhere):
- Companion (free; internal key "guide"): **Riley shows you where you stand.**
- Coach ($19/mo · $175/yr; internal key "companion"): **Riley walks with you.** (memory turns on -> "never explain yourself twice"; Coach is the whole of Riley)
- Mentor (teased, not purchasable; internal keys "coach"/"mentor"/"concierge"): **Riley moves you forward.**
The one member-facing name for the Coach memory pillar is **Life Map** (never "Knowledge Graph"). In-app
upsell cards lead with value and carry NO inline price. Full copy deck + surface checklist: `POSITIONING.md`
(force-404'd publicly). Tier blurbs also live in DB `products.blurb` + Riley's prompt (riley-chat.js) +
Stripe (`stripe-catalog.js`, pushed live by re-running stripe-setup).

## Self-Improvement Logic
- Scout reads echo_scores.best_pillar and format_winner before every run
- Scout reads last 4 weeks of scout_history to avoid repeating topics
- Sage reads echo_scores format performance and injects it before writing
- Riley reads latest scout_history + echo_scores + published_posts on every conversation
- Echo saves format_winner and worst_pillar — fill these in manually after reviewing each week's data

## DEFERRED WORK — come back to this
### Canva auto-design in Atlas (PAUSED 2026-06-29)
Goal: after Sage writes copy, Atlas auto-designs ALL social posts in Canva, fully automated.
Decision made: "Fully automated in Atlas" (server-side Canva Connect API, not the chat plugin).
Blockers to resolve before building:
1. Canva Connect API OAuth token (from Canva Developer portal integration)
2. Brand Templates with named autofill fields — one per post type (carousel, quote, caption)
3. Plan tier — Autofill + Brand Template APIs are likely Canva Enterprise only. MUST confirm
   the account exposes the Autofill API before building, or pivot to me-in-the-loop flow.
Planned build (once unblocked):
- New canva-publish.js: template ID + copy -> create autofill job -> poll -> return design + export URL
- Wire into the BACKGROUND pipeline (manual-pipeline-background.js / weekly-pipeline-cron.js),
  NOT synchronous atlas.js (autofill is async, would exceed timeout)
- Store canva_url in published_posts; surface designs in operator Review screen
