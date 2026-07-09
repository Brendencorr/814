/**
 * health-chat.js — synthetic health endpoint for uptime monitoring (Master Build Spec §10).
 *
 * Checks the chat path's DEPENDENCIES are reachable WITHOUT a model call (so a monitor can ping
 * it every minute at zero cost) and WITHOUT touching any real member data. `?deep=1` adds a tiny
 * Haiku ping for a true end-to-end check (use sparingly). Public — returns only booleans.
 *
 * Point BetterStack/UptimeRobot at: /api/health-chat  (200 = healthy, 503 = degraded).
 */
const { getSupabaseClient } = require("./supabase-client");

exports.handler = async function (event) {
  const started = Date.now();
  const checks = { supabase: false, anthropic_key: false, embeddings: false };

  try { const sb = getSupabaseClient(); const { error } = await sb.from("app_settings").select("key").limit(1); checks.supabase = !error; } catch (_) {}
  checks.anthropic_key = !!process.env.ANTHROPIC_API_KEY;
  checks.embeddings = !!(process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || process.env.VOYAGE_API_KEY);

  const deep = event.queryStringParameters && event.queryStringParameters.deep === "1";
  let model = null;
  if (deep && checks.anthropic_key) {
    try {
      const { callClaude } = require("./anthropic-client");
      const { MODELS } = require("./model-router");
      const r = await callClaude({ system: "Reply with the single word: ok", messages: [{ role: "user", content: "ping" }], max_tokens: 5, model: MODELS.utility, functionName: "health-chat" });
      model = /ok/i.test(r.text || "") ? "ok" : "unexpected";
    } catch (_) { model = "error"; }
  }

  const ok = checks.supabase && checks.anthropic_key && (!deep || model === "ok");
  return {
    statusCode: ok ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ ok, checks, model, latency_ms: Date.now() - started }),
  };
};
