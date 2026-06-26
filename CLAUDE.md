# 8:14 Project — Claude Code Instructions

## CRITICAL: Model Name
The correct Anthropic model string for ALL functions in this repo is:
claude-sonnet-4-6

Never use claude-sonnet-4-20250514 — it is deprecated and will cause 502 errors.
Never use claude-opus-4-5 — use claude-sonnet-4-6 instead.

When editing any file in netlify/functions/, always verify the model string is claude-sonnet-4-6 before committing.

## CRITICAL: max_tokens
max_tokens is currently set to 2000 for all functions.
Netlify free tier synchronous functions have a 10-second timeout.
Scheduled functions (weekly-pipeline) run as background functions with up to 10 min timeout on free tier.
Never set max_tokens above 2000 without testing for timeout first.

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

### Migrations
Run in order in Supabase SQL editor:
1. supabase/migrations/001_initial.sql — creates scout_history, echo_scores, published_posts
2. supabase/migrations/002_pipeline.sql — adds pipeline_runs table + format_winner/worst_pillar columns

## Functions

### Agent functions (manual, called from dashboard)
- scout.js — research agent, injects echo performance data + history before calling Claude
- sage.js — writer agent, injects format_winner + pillar performance before calling Claude
- atlas.js — scheduler, calls buffer-publish for each post after Claude responds
- echo.js — analytics agent, saves metrics to echo_scores after each run
- riley-chat.js — public chatbot, reads scout/echo/posts context on every call

### Infrastructure functions
- buffer-publish.js — POST endpoint to schedule one post to Buffer API
- pipeline-status.js — GET endpoint, returns pipeline_runs + echo_scores + published_posts for dashboard
- weekly-pipeline.js — scheduled function, runs full pipeline autonomously every Sunday

## Scheduled Pipeline
- weekly-pipeline runs every Sunday at 6am Mountain Time (12:00 UTC)
- Configured in netlify.toml: schedule = "0 12 * * 0"
- Scheduled functions run as background functions — longer timeout than synchronous functions
- Sequence: Echo data read → Scout → Sage → Atlas → Buffer publish → log to pipeline_runs
- Each step is fault-tolerant; pipeline continues even if one step fails
- Status logged to pipeline_runs table (success / partial / failed)

## Self-Improvement Logic
- Scout reads echo_scores.best_pillar and format_winner before every run
- Scout reads last 4 weeks of scout_history to avoid repeating topics
- Sage reads echo_scores format performance and injects it before writing
- Riley reads latest scout_history + echo_scores + published_posts on every conversation
- Echo saves format_winner and worst_pillar — fill these in manually after reviewing each week's data
