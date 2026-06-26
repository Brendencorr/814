# The 8:14 Project — Netlify Serverless Backend

AI-powered backend for [eight14.us](https://eight14.us) — a mental health and wellness platform built on the Claude AI API (Anthropic).

## Functions

| Function | Path | Visibility | Description |
|---|---|---|---|
| `riley-chat` | `/.netlify/functions/riley-chat` | Public | Public-facing wellness chatbot on eight14.us/riley |
| `scout` | `/.netlify/functions/scout` | Private dashboard | Content research and trending topics agent |
| `sage` | `/.netlify/functions/sage` | Private dashboard | Scriptwriter for YouTube, captions, and emails |
| `atlas` | `/.netlify/functions/atlas` | Private dashboard | Content organizer and weekly publishing scheduler |
| `echo` | `/.netlify/functions/echo` | Private dashboard | Analytics and content optimization agent |

### riley-chat

Public chatbot available at `eight14.us/riley`. Riley is a warm, direct wellness guide who helps people rebuild through sobriety, fitness, food, and mental health tools. Responses are capped at 2–3 short paragraphs and always include a next step or question. In a crisis, Riley points to the **988 Suicide and Crisis Lifeline** (call or text 988) or **SAMHSA** at 1-800-662-4357.

### scout

Content research agent for the private dashboard. Returns trending topics in sobriety/recovery/wellness, high-value search terms, content gaps, repost opportunities, and two recommended video concepts with hooks.

### sage

Scriptwriter agent. Produces complete, publish-ready copy in Riley's voice — YouTube scripts (8–12 min), Instagram/social captions, and emails. Never outlines; always finished copy.

### atlas

Content organizer. Accepts a piece of content and returns a full 7-day publishing calendar (day, platform, content type, caption preview) plus a Buffer-ready queue. One YouTube video becomes a Short, two IG Reels, three captions, one Facebook post, and one email.

### echo

Analytics agent. Takes content performance data and returns structured recommendations: what's working and why, what's underperforming, the single biggest lever, an A/B test to run, and next week's content priority.

## API

Every function accepts `POST` requests with a JSON body:

```json
{ "message": "your prompt here" }
```

And returns:

```json
{ "reply": "AI response text" }
```

All functions include CORS headers (`Access-Control-Allow-Origin: *`) and handle `OPTIONS` preflight requests.

## Environment Variables

Set the following environment variable in your Netlify site settings (**Site configuration → Environment variables**):

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key from [console.anthropic.com](https://console.anthropic.com) |

## Deployment

### Drag and Drop

1. Build or zip the project folder (including `netlify/functions/` and `netlify.toml`).
2. Go to [app.netlify.com](https://app.netlify.com) and drag the folder onto the **Sites** page.
3. After deploy, go to **Site configuration → Environment variables** and add `ANTHROPIC_API_KEY`.
4. Trigger a redeploy so the variable takes effect.

### Netlify CLI

```bash
npm install
npx netlify deploy --prod
```

## Function URLs

After deployment your functions are available at:

```
https://<your-site>.netlify.app/.netlify/functions/riley-chat
https://<your-site>.netlify.app/.netlify/functions/scout
https://<your-site>.netlify.app/.netlify/functions/sage
https://<your-site>.netlify.app/.netlify/functions/atlas
https://<your-site>.netlify.app/.netlify/functions/echo
```

## Example Request

```bash
curl -X POST https://<your-site>.netlify.app/.netlify/functions/riley-chat \
  -H "Content-Type: application/json" \
  -d '{"message": "I just hit 30 days sober. What should I do next?"}'
```
