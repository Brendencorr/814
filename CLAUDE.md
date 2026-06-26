# 8:14 Project — Claude Code Instructions

## CRITICAL: Model Name
The correct Anthropic model string for ALL functions in this repo is:
claude-sonnet-4-6

Never use claude-sonnet-4-20250514 — it is deprecated and will cause 502 errors.
Never use claude-opus-4-5 — use claude-sonnet-4-6 instead.

When editing any file in netlify/functions/, always verify the model string is claude-sonnet-4-6 before committing.

## Repo Structure
- netlify/functions/ — 5 Netlify serverless functions
- dashboard.html — private agent dashboard
- All functions use the same handler pattern — only system prompts differ

## Environment Variables
ANTHROPIC_API_KEY — set in Netlify, never hardcode
