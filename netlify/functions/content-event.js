/**
 * content-event.js — State Engine Phase 3 (§7 + §7.1)
 *
 * Records a content interaction (status) and/or structured feedback, then feeds
 * the learning loop so future recommendations actually improve:
 *   - writes content_interactions (the rich §7 / §7.1 record)
 *   - maps feedback → recommendation_history.reaction (riley-brain reads this
 *     for novelty + preference)
 *   - "dont_show" adds the content_type to user_profiles.do_not_recommend
 *   - logs the Tier 2 engagement event (no full recompute — §2 scaling split)
 *
 * Request (POST JSON): { user_id, token?, content_id, content_type, status?, feedback? }
 * Response: { ok: true }
 *
 * Tier 2 by definition — content interaction is interest, not a wellbeing-state
 * change, so it never triggers the State Engine's full recalculation chain.
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });

const STATUSES = ["started", "completed", "skipped", "saved", "disliked", "recommended_again"];
const FEEDBACKS = ["helpful", "not_helpful", "wrong_timing", "too_intense", "more_like_this", "dont_show"];
// §7.1 feedback → the reaction vocabulary riley-brain already learns from.
const FEEDBACK_TO_REACTION = {
  helpful: "loved", more_like_this: "loved",
  not_helpful: "disliked", dont_show: "disliked",
  wrong_timing: "opened", too_intense: "opened",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  let userId = body.user_id || null;
  const { content_id, content_type } = body;
  const status   = STATUSES.includes(body.status) ? body.status : null;
  const feedback = FEEDBACKS.includes(body.feedback) ? body.feedback : null;
  if (!status && !feedback) return json(400, { error: "status or feedback required" });

  let supabase;
  try { supabase = getSupabaseClient(); } catch { return json(500, { error: "Server configuration error" }); }

  if (body.token) {
    try { const { data } = await supabase.auth.getUser(body.token); if (data?.user?.id) userId = data.user.id; } catch (_) {}
  }
  if (!userId) return json(400, { error: "user_id (or a valid token) is required" });

  const today = new Date().toISOString().slice(0, 10);

  // 1) Rich §7/§7.1 record.
  try {
    await supabase.from("content_interactions").insert({
      user_id: userId, content_id: content_id || null, content_type: content_type || null, status, feedback,
    });
  } catch (e) { console.warn("content_interactions insert failed (non-fatal):", e.message); }

  // 2) Feed the learning engine via recommendation_history (riley-brain reads it).
  if (content_id && feedback && FEEDBACK_TO_REACTION[feedback]) {
    try {
      await supabase.from("recommendation_history").insert({
        user_id: userId, content_id, recommended_on: today,
        reaction: FEEDBACK_TO_REACTION[feedback], reacted_at: new Date().toISOString(),
      });
    } catch (e) { /* non-fatal */ }
  }

  // 3) "Don't show this again" → respect it at the type level going forward.
  if (feedback === "dont_show" && content_type) {
    try {
      const { data: p } = await supabase.from("user_profiles").select("do_not_recommend").eq("id", userId).maybeSingle();
      const list = Array.isArray(p && p.do_not_recommend) ? p.do_not_recommend : [];
      if (!list.includes(content_type)) {
        await supabase.from("user_profiles").update({ do_not_recommend: [...list, content_type] }).eq("id", userId);
      }
    } catch (e) { /* non-fatal */ }
  }

  // 4) Tier 2 engagement event — logged, never a full recompute.
  const evt = status ? ("content_" + (status === "started" ? "started" : status))
            : feedback ? "content_feedback" : "content_clicked";
  try {
    await supabase.from("engagement_events").insert({ user_id: userId, event_type: evt, event_data: { content_id, content_type, status, feedback, tier: 2 } });
  } catch (e) { /* non-fatal */ }

  return json(200, { ok: true });
};
