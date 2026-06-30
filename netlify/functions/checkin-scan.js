/**
 * checkin-scan.js — Standard Netlify Serverless Function
 *
 * Closes the gap where the Daily Check-In's free-text fields (what's on your
 * mind, dinner) save straight to Supabase and never pass through Riley's crisis
 * detection. The dashboard POSTs the free-text here after a check-in; this runs
 * the SAME deterministic detector (crisis-detection.js) and, on a Level 2/3
 * signal, logs to the restricted crisis_log + flags the profile — so the
 * follow-up cron and operator safety queue catch it just like a chat message.
 *
 * Request (POST JSON): { user_id, token?, text }
 * Response (JSON): { level: 0|1|2|3, response: string|null }
 *   response is the deterministic Level-3 message when level === 3, else null.
 *
 * No LLM call. Detection is rules-based and fast.
 */

const { getSupabaseClient } = require("./supabase-client");
const { detectCrisis, LEVEL3_RESPONSE } = require("./crisis-detection");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (statusCode, data) => ({
  statusCode, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }, body: JSON.stringify(data),
});

// Mirror of riley-chat's logCrisis — restricted safety write, non-fatal.
async function logCrisis(supabase, userId, level, matches, snippet) {
  if (!supabase || !userId) return;
  try {
    await supabase.from("crisis_log").insert({
      user_id: userId, session_id: "daily-checkin", level,
      matched_rules: Array.isArray(matches) ? matches.slice(0, 8) : [],
      message_excerpt: typeof snippet === "string" ? snippet.slice(0, 500) : null,
      followup_stage: 0, resolved: false,
    });
    supabase.from("user_profiles")
      .update({ last_crisis_at: new Date().toISOString(), last_crisis_level: level })
      .eq("id", userId).then(() => {}, () => {});
  } catch (e) { console.warn("checkin-scan logCrisis failed (non-fatal):", e.message); }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  const text = (body.text || "").toString();
  let userId = body.user_id || null;
  if (!text.trim()) return json(200, { level: 0, response: null });

  let supabase = null;
  try { supabase = getSupabaseClient(); } catch (e) { console.warn("supabase init failed:", e.message); }

  // If a token is supplied, verify it and trust its user id over the body's.
  if (supabase && body.token) {
    try {
      const { data } = await supabase.auth.getUser(body.token);
      if (data?.user?.id) userId = data.user.id;
    } catch (_) { /* fall back to body.user_id */ }
  }

  let crisis = { level: 0, matches: [] };
  try { crisis = detectCrisis(text); } catch (e) { console.warn("detectCrisis threw:", e.message); }

  if (crisis.level >= 2 && supabase && userId) {
    await logCrisis(supabase, userId, crisis.level, crisis.matches, text);
  }

  return json(200, { level: crisis.level, response: crisis.level === 3 ? LEVEL3_RESPONSE : null });
};
