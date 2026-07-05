/**
 * brief-delivery-cron.js — Netlify Scheduled Function (hourly)
 *
 * Riley shows up — without the person having to log in first. Each person chose
 * a check-in time in onboarding (morning/lunch/afternoon/evening/on_demand).
 * This runs every hour and emails their brief when it's that hour in THEIR
 * timezone.
 *
 * Cheap by design: NO LLM call here. If today's brief already exists we include
 * its focus line; otherwise we send a warm morning touch that drives them into
 * the app, where the full 45-second brief generates on open.
 *
 * Sends via Resend (RESEND_API_KEY). If the key isn't set, logs who WOULD be
 * emailed and exits clean. Tracks brief_email_sent_date to never double-send.
 *
 * Schedule: netlify.toml [functions."brief-delivery-cron"] schedule = "0 * * * *"
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");

const FROM_EMAIL = process.env.BRIEF_FROM || process.env.REENGAGEMENT_FROM || "Riley <riley@meetriley.us>";
const APP_URL    = "https://riley.meetriley.us";
const SCHEDULE_HOUR = { morning: 8, lunch: 12, afternoon: 15, evening: 19 }; // local hour per choice

function localHour(tz) {
  try { return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Denver", hour: "numeric", hour12: false }).format(new Date()), 10); }
  catch { return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: false }).format(new Date()), 10); }
}
function localDate(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Denver" }).format(new Date()); } // YYYY-MM-DD
  catch { return new Date().toISOString().slice(0, 10); }
}

function buildEmail(name, brief, schedule) {
  // Greeting moves with the delivery slot — a user on evening briefs never gets "Good morning" at 7pm.
  const GREET = { morning: "Good morning", lunch: "Good afternoon", afternoon: "Good afternoon", evening: "Good evening" };
  const greet = GREET[schedule] || "Good morning";
  const focus = brief?.modules?.focus || null;
  const note  = brief?.modules?.riley_note || brief?.modules?.mood_note || null;
  const greetLine = note ? note : "However today feels, you don't have to meet it alone.";
  const text = [
    `${greet}, ${name}.`, ``,
    greetLine, ``,
    focus ? `Today's focus: ${focus}` : `Your brief is ready whenever you are.`,
    ``,
    `It takes about 45 seconds. ${APP_URL}/brief`, ``,
    `— Riley`,
  ].join("\n");
  const html = `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;color:#1a1a1a;line-height:1.7;font-size:16px">
    <p style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:20px">Meet Riley</p>
    <p>${greet}, ${name}.</p>
    <p>${greetLine}</p>
    ${focus ? `<p style="padding:12px 16px;background:#f7f3ea;border-left:3px solid #c9a84c;border-radius:0 3px 3px 0"><strong>Today's focus:</strong> ${focus}</p>` : ``}
    <p style="margin:24px 0"><a href="${APP_URL}/brief" style="background:#c9a84c;color:#0a0908;text-decoration:none;padding:12px 28px;border-radius:3px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold">Open today's brief →</a></p>
    <p style="color:#999;font-size:13px">About 45 seconds. I'll be here.</p>
    <p style="color:#555">— Riley</p>
  </div>`;
  return { subject: `${greet}, ${name} — your brief is ready`, text, html };
}

async function sendEmail(to, email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true };
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: email.subject, html: email.html, text: email.text }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return await resp.json();
}

exports.handler = async function (event) {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;
  const supabase = getSupabaseClient();
  const todayUTC = new Date().toISOString().slice(0, 10);
  const result = { scanned: 0, due: 0, sent: 0, skipped: 0, errors: 0, provider_configured: !!process.env.RESEND_API_KEY };

  try {
    // Candidates: onboarded, has email, wants scheduled briefs, not already sent today (UTC guard)
    const { data: users, error } = await supabase
      .from("user_profiles")
      .select("id,email,full_name,preferred_name,timezone,notification_schedule,brief_email_sent_date")
      .eq("onboarding_completed", true)
      .not("email", "is", null)
      .neq("notification_schedule", "on_demand")
      .or(`brief_email_sent_date.is.null,brief_email_sent_date.neq.${todayUTC}`)
      .limit(2000);
    if (error) throw error;
    result.scanned = (users || []).length;

    for (const u of users || []) {
      const target = SCHEDULE_HOUR[u.notification_schedule || "morning"];
      if (target == null) continue;
      const hr = localHour(u.timezone);
      if (hr !== target) continue;                 // not their hour yet
      const localToday = localDate(u.timezone);
      if (u.brief_email_sent_date === localToday) continue; // already sent in their local day
      result.due++;

      try {
        // Today's brief (in their local date) if it exists — for the focus line. No generation.
        const { data: brief } = await supabase
          .from("daily_briefs").select("modules").eq("user_id", u.id).eq("brief_date", localToday).maybeSingle();
        const name = (u.preferred_name || u.full_name || "").split(" ")[0] || "friend";
        const r = await sendEmail(u.email, buildEmail(name, brief, u.notification_schedule || "morning"));
        if (r.skipped) { result.skipped++; continue; }
        await supabase.from("user_profiles").update({ brief_email_sent_date: localToday }).eq("id", u.id);
        await supabase.from("engagement_events").insert({ user_id: u.id, event_type: "brief_email_sent", event_data: {} });
        result.sent++;
      } catch (e) {
        result.errors++;
        console.error("brief email failed for", u.id, e.message);
      }
    }

    console.log("brief-delivery-cron:", JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error("brief-delivery-cron fatal:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
