/**
 * chat-feedback.js - member thumbs up/down on a Riley reply (v2.3 Batch 0.4).
 *
 * Writes a response-effectiveness signal to chat_turn_signals. A thumbs-DOWN shortly after a
 * crisis-path reply is flagged on the most recent crisis_log row for operator REVIEW (per spec:
 * "not just log"). Identity comes from the verified token only. Fully non-fatal.
 *
 * POST { token, session_id?, reaction: "up" | "down" }
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const reaction = body.reaction === "up" ? "up" : body.reaction === "down" ? "down" : null;
  if (!reaction) return json(400, { error: "reaction must be 'up' or 'down'" });

  const sb = getSupabaseClient();
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = body.token || (auth.startsWith("Bearer ") ? auth.slice(7) : null);
  let userId = null;
  if (token) { try { const { data } = await sb.auth.getUser(token); userId = data && data.user && data.user.id; } catch (_) {} }
  if (!userId) return json(401, { error: "unauthorized" });
  const sessionId = (body.session_id || "").toString().slice(0, 120) || null;

  // 1. the effectiveness signal
  try {
    await sb.from("chat_turn_signals").insert({
      user_id: userId, conversation_id: sessionId, riley_move: "feedback",
      member_reaction: reaction === "up" ? "👍" : "👎",
    });
  } catch (_) { /* analytics is non-fatal */ }

  // 2. a downvote right after a crisis-path reply -> flag the recent crisis_log row for operator review.
  let flaggedCrisis = false;
  if (reaction === "down") {
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: cl } = await sb.from("crisis_log").select("id,operator_note")
        .eq("user_id", userId).eq("is_test", false).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(1);
      const row = cl && cl[0];
      if (row) {
        const note = ((row.operator_note || "") + " [member marked this crisis-path reply unhelpful - review]").trim().slice(0, 1000);
        await sb.from("crisis_log").update({ operator_note: note }).eq("id", row.id);
        flaggedCrisis = true;
      }
    } catch (_) {}
  }

  return json(200, { ok: true, flagged_for_review: flaggedCrisis });
};
