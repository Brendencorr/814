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
- Fonts: Playfair Display (headings), DM Sans (body), Bebas Neue (labels/nav)
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
