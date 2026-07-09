/**
 * story-submit.js - Task 6 / Decision #14: public "Share your story" form (no auth).
 *
 * Anonymous inserts are blocked by RLS on `user_stories`, so this service-role path records
 * the submission. Rate-limited (per-email window). On success it emails Brenden the full
 * submission AND sends the submitter a warm confirmation (Resend; no-ops if RESEND_API_KEY unset).
 * Nothing publishes without review - status workflow: submitted -> reviewed -> consented -> published.
 *
 * POST { name?, email, story, consent } -> { ok }
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const { sendClientEmail } = require("./email-send");

async function sendEmail(to, subject, html, kind) {
  return sendClientEmail({ to, subject, html, kind: kind || "story" });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const name = (body.name || "").toString().trim().slice(0, 120) || null;
  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const story = (body.story || "").toString().trim().slice(0, 6000);
  const consent = body.consent === true;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "A valid email is required." });
  if (story.length < 10) return json(400, { error: "Please share a little more of your story." });

  try {
    const sb = getSupabaseClient();

    // Rate limit: max 3 submissions per email in the last 15 minutes.
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await sb.from("user_stories")
      .select("id", { count: "exact", head: true })
      .eq("email", email).gte("created_at", since);
    if ((count || 0) >= 3) return json(429, { error: "You've submitted a few already - give it a little while." });
    // Global flood cap - per-email alone is bypassable by rotating the address; bound total volume too.
    try {
      const { count: total } = await sb.from("user_stories").select("id", { count: "exact", head: true }).gte("created_at", since);
      if ((total || 0) >= 30) return json(429, { error: "We're getting a lot of submissions right now - please try again shortly." });
    } catch (_) {}

    await sb.from("user_stories").insert({ name, email, story, consent, status: "submitted", source: "home" });

    const first = name ? esc(name.split(" ")[0]) : "";
    await Promise.allSettled([
      // Notify the operator with the full submission. Recipient comes from the
      // SAFETY_ALERT_EMAIL env var (already configured to Brenden) - NEVER hardcoded,
      // so the address can't trip Netlify's secret scanner. No-ops if the var is unset.
      sendEmail(process.env.SAFETY_ALERT_EMAIL, "New story submission - Meet Riley",
        `<div style="font-family:sans-serif;line-height:1.6;color:#222">
          <h2 style="color:#111">New story submission</h2>
          <p><b>Name:</b> ${esc(name) || "(not given)"}<br>
             <b>Email:</b> ${esc(email)}<br>
             <b>OK to share publicly:</b> ${consent ? "Yes" : "No"}</p>
          <p><b>Story:</b></p>
          <blockquote style="border-left:3px solid #c9a84c;padding-left:14px;white-space:pre-wrap">${esc(story)}</blockquote>
          <p style="color:#888;font-size:13px">Nothing publishes without your review. Status: submitted &rarr; reviewed &rarr; consented &rarr; published.</p>
        </div>`, "story_alert"),
      // Warm confirmation to the submitter.
      sendEmail(email, "Thank you for sharing your story",
        `<div style="font-family:sans-serif;line-height:1.7;color:#222">
          <p>${first ? first + "," : "Hi,"}</p>
          <p>Thank you for trusting us with your story. It matters more than you know - this is exactly how the next person feels a little less alone.</p>
          <p><b>Nothing is ever published without your written OK.</b> If we'd love to share yours, we'll reach out to you first - always.</p>
          <p>With care,<br>Brenden &amp; Riley</p>
        </div>`, "story"),
    ]);

    return json(200, { ok: true });
  } catch (e) {
    console.error("story-submit:", e.message);
    return json(500, { error: "Could not submit - please try again." });
  }
};
