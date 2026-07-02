/**
 * content-lib.js — shared helpers for the 8:14 automated content engine.
 * All content-engine tables live in public with a content_ prefix
 * (PostgREST only serves the public schema). Prompts load at runtime from content_prompt_versions
 * (never hardcoded) so prompts can be versioned without a redeploy.
 */

const { getSupabaseClient } = require("./supabase-client");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6"; // repo standard — do not change

// Service-role Supabase client (public schema; bypasses RLS). content_* tables.
function contentDb() {
  return getSupabaseClient();
}

// Load the active prompt body for an agent
async function loadPrompt(agent) {
  const { data, error } = await contentDb()
    .from("content_prompt_versions")
    .select("prompt_body")
    .eq("agent", agent)
    .eq("active", true)
    .single();
  if (error || !data) throw new Error(`No active prompt for agent '${agent}': ${error?.message || "not found"}`);
  return data.prompt_body;
}

/**
 * Call Claude. Optionally enable the Anthropic server-side web_search tool
 * so Scout reads the live web with no external scraper keys required.
 * Returns the concatenated text of all text blocks in the final message.
 */
async function callClaude({ system, user, maxTokens = 4000, webSearch = false }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  // With web search the message has multiple content blocks; keep only text.
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text;
}

// Robustly extract the first JSON object/array from a model reply.
function extractJson(text) {
  if (!text) return null;
  // Strip markdown fences if the model added them despite instructions.
  let t = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Find the outermost { } or [ ]
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  let start = -1;
  if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start < 0) return null;
  const openCh = t[start];
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
  }
  return null;
}

// Non-fatal operator notification: Slack webhook if configured, else console.
async function notify(message) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  console.log("[content-engine]", message);
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (e) {
    console.warn("Slack notify failed (non-fatal):", e.message);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

module.exports = { contentDb, loadPrompt, callClaude, extractJson, notify, CORS, MODEL };
