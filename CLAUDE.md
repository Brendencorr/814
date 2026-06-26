# 8:14 Project — Claude Code Instructions

## CRITICAL: Model Name
The correct Anthropic model string for ALL functions in this repo is:
claude-sonnet-4-6

Never use claude-sonnet-4-20250514 — it is deprecated and will cause 502 errors.
Never use claude-opus-4-5 — use claude-sonnet-4-6 instead.

When editing any file in netlify/functions/, always verify the model string is claude-sonnet-4-6 before committing.

## CRITICAL: max_tokens
max_tokens must be 1500 for ALL functions on Netlify free tier.

Netlify free tier has a 10-second function timeout. 4000 tokens causes timeouts and 502 errors.
Never set max_tokens above 1500 in any netlify/functions/ file.

## Repo Structure
- netlify/functions/ — 5 Netlify serverless functions
- dashboard.html — private agent dashboard
- All functions use the same handler pattern — only system prompts differ

## Required Environment Variables
- ANTHROPIC_API_KEY — Anthropic Claude API key (set in Netlify, never hardcode)
- SUPABASE_URL — Supabase project URL
- SUPABASE_ANON_KEY — Supabase publishable key
- SUPABASE_SERVICE_KEY — Supabase secret key for server-side operations

## Supabase
The shared client is at netlify/functions/supabase-client.js.
Always use SUPABASE_SERVICE_KEY (not SUPABASE_ANON_KEY) in functions — server-side only.
All Supabase writes are non-blocking and non-fatal: if Supabase is unavailable, functions still return Claude's reply.

Tables:
- scout_history — topics/pillars covered each week (prevents repetition)
- echo_scores — weekly performance metrics
- published_posts — record of every post sent through the pipeline

Migration file: supabase/migrations/001_initial.sql — run this in the Supabase SQL editor to create tables.
