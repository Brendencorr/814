/**
 * reengagement-cron.js - Netlify Scheduled Function
 *
 * Runs daily. Finds people who logged in, then went quiet for about a week,
 * and sends them one gentle win-back email in Riley's voice:
 * "Welcome back. We saved your place." - never guilt, never pressure.
 *
 * Trigger logic (matches the product intent: "a week after first login, only
 * if they haven't signed back in"):
 *   - onboarding_completed = true AND has an email
 *   - last_active_at between 7 and 10 days ago (the 1-week lapse window)
 *   - reengagement_sent_at IS NULL (never sent, or they returned since →
 *     log_engagement clears the flag on any activity, re-arming the win-back)
 *
 * Email is sent via Resend (RESEND_API_KEY). If the key isn't set yet, the
 * function logs who WOULD have been emailed and exits cleanly - so it never
 * crashes before the provider is configured.
 *
 * Schedule: netlify.toml [functions."reengagement-cron"] schedule = "0 16 * * *"
 *   (16:00 UTC = 10am Mountain - a kind hour to land in someone's inbox)
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const { sendClientEmail } = require("./email-send");
const { shell, p, btn, esc } = require("./comms-templates");

const FROM_EMAIL = process.env.REENGAGEMENT_FROM || "Riley <riley@meetriley.us>";
const APP_URL    = "https://riley.meetriley.us";

// ── Compose the email - warm, specific, never guilt ──────────────────────────
function buildEmail(u) {
  const name = (u.preferred_name || u.full_name || "").split(" ")[0] || "friend";
  const why  = u.why_here ? String(u.why_here).split(";")[0].trim() : null;
  const vision = u.one_year_vision ? String(u.one_year_vision).trim() : null;

  const lines = [
    `Hi ${name},`,
    ``,
    `It's Riley.`,
    ``,
    `It's been about a week since we first talked, and I noticed you haven't been back. I'm not writing to nudge you or make you feel behind - there's none of that here.`,
    ``,
    `I just wanted you to know your place is exactly where you left it. We saved it. Nothing expired. Nothing reset.`,
  ];
  if (vision) lines.push(``, `What you told me you're reaching for - "${vision}" - is still worth it. And you don't have to do it all at once. Just the next small step.`);
  else if (why) lines.push(``, `You came here for a reason that mattered to you. That reason is still valid. So are you.`);
  lines.push(
    ``,
    `Whenever you're ready, I'm right here.`,
    ``,
    `${APP_URL}`,
    ``,
    `- Riley`,
    ``,
    `(If you'd rather not hear from me, just reply and say so - no hard feelings, ever.)`
  );
  const text = lines.join("\n");

  const safeVision = vision ? vision.replace(/</g, "&lt;").replace(/>/g, "&gt;") : null;
  const html = shell(
    p("Hi " + esc(name) + ",") +
    p("It's Riley.") +
    p("It's been about a week since we first talked, and I noticed you haven't been back. I'm not writing to nudge you or make you feel behind - there's none of that here.") +
    p("I just wanted you to know your place is exactly where you left it. We saved it. Nothing expired. Nothing reset.") +
    (safeVision ? p('What you told me you\'re reaching for - <em>"' + safeVision + '"</em> - is still worth it. And you don\'t have to do it all at once. Just the next small step.') : (why ? p("You came here for a reason that mattered to you. That reason is still valid. So are you.") : "")) +
    p("Whenever you're ready, I'm right here.") +
    btn("Come back home →", APP_URL) +
    '<p style="margin:16px 0 0;color:#6b655b">- Riley</p>',
    { preview: "Your place is exactly where you left it - nothing expired." }
  );

  return { subject: `${name}, your place is still here`, text, html };
}

// ── Send via Resend ──────────────────────────────────────────────────────────
async function sendEmail(to, email, userId) {
  const r = await sendClientEmail({ to, subject: email.subject, html: email.html, text: email.text, kind: "reengagement", from: FROM_EMAIL, userId });
  if (r.status === "skipped") return { skipped: true };
  if (!r.sent) throw new Error((r.reason || "send_failed") + (r.detail ? ": " + r.detail : ""));
  return { id: r.id };
}

exports.handler = async function (event) {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;

  // Win-back ownership handoff: while the lifecycle comms system is DARK this cron is the only
  // active win-back. The moment COMMS_ENABLED=true, the lifecycle Gone-Quiet ladder (quiet_1/2/3
  // in evaluate-comms) owns lapsed-member outreach - so this cron stands down automatically to
  // avoid double-emailing. No coverage gap (it runs until the flip), no overlap (it stops at it).
  if (String(process.env.COMMS_ENABLED || "").toLowerCase() === "true") {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: "comms_enabled_owns_winback" }) };
  }

  const supabase = getSupabaseClient();
  const now = Date.now();
  const sevenAgo = new Date(now - 7 * 86400000).toISOString();
  const tenAgo   = new Date(now - 10 * 86400000).toISOString();
  const result = { eligible: 0, sent: 0, skipped: 0, errors: 0, provider_configured: !!process.env.RESEND_API_KEY };

  try {
    // Lapsed ~1 week, never re-engaged, has email
    const { data: users, error } = await supabase
      .from("user_profiles")
      .select("id,email,full_name,preferred_name,why_here,one_year_vision,last_active_at")
      .eq("onboarding_completed", true)
      .not("email", "is", null)
      .is("reengagement_sent_at", null)
      .lte("last_active_at", sevenAgo)
      .gte("last_active_at", tenAgo)
      .limit(2000);   // headroom for 5k-user scale; a day's lapsed pool stays well under this
    if (error) throw error;

    result.eligible = (users || []).length;

    // Honor the email-notifications preference (migration 047). Resilient: if the column doesn't
    // exist yet, this returns no rows → nobody filtered → behavior unchanged.
    const emailOff = new Set();
    const _ids = (users || []).map((u) => u.id);
    if (_ids.length) {
      const { data: offs } = await supabase.from("user_profiles").select("id").eq("email_notifications", false).in("id", _ids);
      (offs || []).forEach((o) => emailOff.add(o.id));
    }

    for (const u of users || []) {
      if (emailOff.has(u.id)) continue;              // opted out of email updates
      try {
        const email = buildEmail(u);
        const r = await sendEmail(u.email, email, u.id);
        if (r.skipped) { result.skipped++; continue; }  // no provider key yet
        // Mark sent + log the touch as an engagement event
        await supabase.from("user_profiles").update({ reengagement_sent_at: new Date().toISOString() }).eq("id", u.id);
        await supabase.from("engagement_events").insert({ user_id: u.id, event_type: "reengagement_email_sent", event_data: { to: u.email } });
        result.sent++;
      } catch (e) {
        result.errors++;
        console.error("reengagement send failed for", u.id, e.message);
      }
    }

    console.log("reengagement-cron:", JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error("reengagement-cron fatal:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
