# 8:14 Project — Claude Code Instructions

## CRITICAL: Model Name
The correct Anthropic model string for ALL functions in this repo is:
claude-sonnet-4-6

Never use claude-sonnet-4-20250514 — it is deprecated and will cause 502 errors.
Never use claude-opus-4-5 — use claude-sonnet-4-6 instead.

When editing any file in netlify/functions/, always verify the model string is claude-sonnet-4-6 before committing.

## CRITICAL: max_tokens
- riley-chat.js (streaming): max_tokens = 1000 — short conversational replies, streams in real time
- Agent functions (scout, sage, atlas, echo, pipeline): max_tokens = 2000
- Never raise agent max_tokens above 2000 without testing for timeout first
- Riley streaming bypasses the synchronous timeout — max_tokens 1000 comfortably finishes within 30s

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
- dashboard.html — private agent dashboard (password: Riley814)
- supabase/migrations/ — SQL migrations to run in Supabase SQL editor
- All agent functions use the same handler pattern — only system prompts and Supabase logic differ

## Required Environment Variables
Set all of these in Netlify → Site configuration → Environment variables:

- ANTHROPIC_API_KEY — Anthropic Claude API key (never hardcode)
- SUPABASE_URL — Supabase project URL
- SUPABASE_ANON_KEY — Supabase publishable key
- SUPABASE_SERVICE_KEY — Supabase secret key for server-side operations
- BUFFER_API_TOKEN — Buffer API token for auto-publishing to social platforms
- BUFFER_PROFILE_IDS — Comma-separated Buffer profile IDs (one per platform)
- URL — Netlify site URL (set automatically by Netlify, e.g. https://admin.eight14.us)

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
- atlas.js — scheduler, calls buffer-publish for each post after Claude responds
- echo.js — analytics agent, saves metrics to echo_scores after each run
- riley-chat.js — chatbot; accepts user_id + session_id for persistent memory; reads user profile for personalization

### Infrastructure functions
- auth-handler.js — POST endpoint; actions: get_session, save_message, update_profile; uses SERVICE_KEY
- buffer-publish.js — POST endpoint to schedule one post to Buffer API
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
- Sequence: Echo data read → Scout → Sage → Atlas → Buffer publish → log to pipeline_runs
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

## Operator Dashboard (admin.eight14.us)
admin.eight14.us serves dashboard.html — private operator tool for Brenden only.
Password gate: Riley814 (stored in sessionStorage).

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
