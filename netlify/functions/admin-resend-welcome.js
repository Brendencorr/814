/**
 * admin-resend-welcome.js — operator re-sends the welcome email to an EXISTING member.
 *
 * Separate from admin-create-user (which 409s on an existing member). Looks up the member's
 * email + name, sends the same welcome via sendWelcomeEmail() — which routes through
 * sendClientEmail(), so the send is LOGGED to email_log and shows up in the operator
 * correspondence views. Returns the real send result so the UI can show sent ✓ / failed + reason.
 *
 * OPERATOR_KEY-gated POST { user_id } → { ok, emailed:{sent,id?,status,reason?,detail?} } | { error }
 * Model: n/a
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { sendWelcomeEmail } = require("./email-welcome");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const gate = requireOperator(event); if (gate) return gate;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const userId = (body.user_id || "").toString().trim();
  if (!userId) return json(400, { error: "user_id required" });

  try {
    const sb = getSupabaseClient();
    const { data: prof, error } = await sb
      .from("user_profiles")
      .select("id, email, full_name, preferred_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!prof) return json(404, { error: "Member not found." });
    if (!prof.email) return json(400, { error: "That member has no email on file." });

    const name = (prof.full_name || prof.preferred_name || "").toString();
    const emailed = await sendWelcomeEmail({ email: prof.email, name, userId: prof.id });
    return json(200, { ok: true, emailed });
  } catch (e) {
    return json(500, { error: (e && e.message) || "error" });
  }
};
