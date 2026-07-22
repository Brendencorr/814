/**
 * crisis-followup-cron.js - Netlify Scheduled Function
 *
 * Trust architecture §2.4 - Crisis Follow-Up. After any Level 2 or Level 3
 * interaction, Riley follows up at defined intervals: later that same day, the
 * next morning, 3 days later, 7 days later. Follow-up is supportive, NEVER
 * punitive, and never references the moment in a clinical or alarming tone.
 *
 * Stage gating (hours since the logged event):
 *   stage 1 - same day      ≥ 6h
 *   stage 2 - next morning   ≥ 20h
 *   stage 3 - 3 days         ≥ 72h
 *   stage 4 - 7 days         ≥ 168h   → then resolved
 *
 * Consent (§2.4): a member can decline future check-ins for a moment
 * (crisis_log.declined_followup) or all of them (user_profiles.crisis_followup_opt_out).
 * Both are honored here - declining is respected, never read as giving up on them.
 *
 * Crisis data stays OUT of the analytics stream - no engagement_events writes
 * here. Only crisis_log is touched. (§1.4 restricted access.)
 *
 * Email via Resend (RESEND_API_KEY). If the key isn't set, the function logs who
 * WOULD be checked in on and exits cleanly - never crashes pre-provider.
 *
 * Schedule (netlify.toml): a few times a day so the same-day + next-morning
 * stages land at humane hours. schedule = "0 1,15,21 * * *"
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const { sendClientEmail, FROM_ADDRESSES } = require("./email-send");
const { shell, p, btn, esc } = require("./comms-templates");

const FROM_EMAIL = process.env.REENGAGEMENT_FROM || FROM_ADDRESSES.riley;
const APP_URL    = "https://riley.meetriley.us";

const THRESHOLD_HOURS = { 1: 6, 2: 20, 3: 72, 4: 168 };

// ── Gentle, non-clinical check-ins - one per stage. Never mentions the moment. ─
function buildFollowup(stage, u) {
  const name = (u.preferred_name || u.full_name || "").split(" ")[0] || "friend";
  const M = {
    1: {
      subject: `Just checking in, ${name}`,
      body: `It's Riley. I've been thinking about you since we talked. No agenda here - I just wanted to see how you're doing right now. I'm here whenever you want to talk, even if it's just to sit for a minute.`,
    },
    2: {
      // Stage 2 is the "next day" restart. Copy stays time-neutral - this cron fires at
      // several UTC hours, so it must never assert "morning" when it's someone's evening.
      subject: `A new day, ${name}`,
      body: `It's Riley. A new day. I just wanted you to know I'm still here, and I'm really glad you are too. However today feels, you don't have to carry it on your own.`,
    },
    3: {
      subject: `Thinking of you, ${name}`,
      body: `It's Riley. A few days have gone by and you've been on my mind. There's no pressure to reply - I only wanted you to know the door's open whenever you want it.`,
    },
    4: {
      subject: `Still here, ${name}`,
      body: `It's Riley. It's been about a week. I'm not going anywhere. Whenever you're ready - today, next week, whenever - I'm right here.`,
    },
  };
  const m = M[stage] || M[1];

  const text = [
    `Hi ${name},`, ``, m.body, ``,
    `Whenever you want, I'm right here:`, APP_URL, ``,
    `- Riley`, ``,
    `(If you'd rather I didn't check in like this, just reply and say so - I'll always respect that.)`,
  ].join("\n");

  // Unified house shell: Ink header + Riley. wordmark, serif body, signed "- Riley". Crisis emails
  // are sensitive (§1.4) - a custom footer (reply-to-opt-out + 988), NOT the marketing unsubscribe.
  const bodyHtml =
    p("Hi " + esc(name) + ",") +
    p(esc(m.body)) +
    p("Whenever you want, I'm right here.") +
    btn("Talk with Riley →", APP_URL) +
    '<p style="margin:16px 0 0;color:#6b655b">- Riley</p>';
  const crisisFooter =
    '<tr><td style="padding:22px 32px 28px;border-top:1px solid #e5ded0">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8a8578">' +
    "If you'd rather I didn't check in like this, just reply and say so - I'll always respect that." +
    "<br>In crisis? Call or text 988, anytime." +
    "</div></td></tr>";
  const html = shell(bodyHtml, { preview: String(m.body).slice(0, 90), footerHtml: crisisFooter });

  return { subject: m.subject, text, html };
}

// Routed through the sendClientEmail choke point (category 'crisis': always sends - exempt from
// the daily cap and, by definition, from crisis suppression) so these check-ins finally appear in
// the unified ledger + email_log like every other send. Subject/metadata only is logged, never the
// body, so the §1.4 restricted-access boundary holds.
async function sendEmail(to, email, userId) {
  const r = await sendClientEmail({ to, subject: email.subject, html: email.html, text: email.text, kind: "crisis_followup", category: "crisis", from: FROM_EMAIL, userId });
  if (r.status === "skipped") return { skipped: true };
  if (!r.sent) throw new Error((r.reason || "send_failed") + (r.detail ? ": " + r.detail : ""));
  return { id: r.id };
}

exports.handler = async function (event) {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;
  const supabase = getSupabaseClient();
  const now = Date.now();
  const result = { candidates: 0, sent: 0, skipped: 0, resolved: 0, declined: 0, errors: 0, provider_configured: !!process.env.RESEND_API_KEY };

  try {
    // Open Level 2/3 events still in the follow-up window.
    const { data: rows, error } = await supabase
      .from("crisis_log")
      .select("id,user_id,level,followup_stage,created_at,declined_followup,resolved")
      .gte("level", 2)
      .eq("resolved", false)
      .eq("declined_followup", false)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    result.candidates = (rows || []).length;
    if (!rows || !rows.length) {
      console.log("crisis-followup-cron:", JSON.stringify(result));
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    // Batch-fetch the relevant profiles (avoid N+1).
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id,email,full_name,preferred_name,crisis_followup_opt_out")
      .in("id", userIds);
    const pmap = new Map((profiles || []).map((p) => [p.id, p]));

    for (const row of rows) {
      try {
        const hours = (now - new Date(row.created_at).getTime()) / 3600000;

        // Stop following up after ~15 days - close the loop quietly.
        if (hours > 360) {
          await supabase.from("crisis_log").update({ resolved: true }).eq("id", row.id);
          result.resolved++;
          continue;
        }

        const prof = pmap.get(row.user_id);
        // Member opted out of all crisis check-ins → respect it, stop the sequence.
        if (prof && prof.crisis_followup_opt_out) {
          await supabase.from("crisis_log").update({ resolved: true }).eq("id", row.id);
          result.declined++;
          continue;
        }

        const nextStage = (row.followup_stage || 0) + 1;
        if (nextStage > 4) {
          await supabase.from("crisis_log").update({ resolved: true }).eq("id", row.id);
          result.resolved++;
          continue;
        }
        if (hours < THRESHOLD_HOURS[nextStage]) continue; // not due yet

        // No email on file → can't reach them this way; leave for in-app follow-up.
        if (!prof || !prof.email) { result.skipped++; continue; }

        const email = buildFollowup(nextStage, prof);
        if (!process.env.RESEND_API_KEY) { result.skipped++; continue; } // no provider - don't advance; retry when configured
        // Advance the stage FIRST, conditional on the stage we read. This makes the follow-up
        // idempotent: a crash/timeout after sending never re-sends the same stage, and two
        // overlapping runs can't both send. A rare missed send is far kinder than a duplicate
        // "just checking in" email to someone in crisis.
        const { data: adv } = await supabase.from("crisis_log").update({
          followup_stage:   nextStage,
          last_followup_at: new Date().toISOString(),
          resolved:         nextStage >= 4,
        }).eq("id", row.id).eq("followup_stage", row.followup_stage || 0).select("id");
        if (!adv || !adv.length) continue; // another run already advanced this row - don't re-send
        await sendEmail(prof.email, email, row.user_id);
        result.sent++;
      } catch (e) {
        result.errors++;
        console.error("crisis-followup failed for log", row.id, e.message);
      }
    }

    // Clear lingering crisis flags. user_daily_state.crisis_flag is a per-day MIRROR of an
    // active crisis; once a member has no unresolved crisis_log, that flag must not stay
    // stuck true (it would keep Riley's tone/plan in "crisis mode" forever). For each member
    // we touched, if they have no open crises left, clear any remaining flags.
    const touched = [...new Set(rows.map((r) => r.user_id))];
    for (const uid of touched) {
      try {
        const { data: open } = await supabase.from("crisis_log")
          .select("id").eq("user_id", uid).eq("resolved", false).limit(1);
        if (!open || !open.length) {
          await supabase.from("user_daily_state")
            .update({ crisis_flag: false }).eq("user_id", uid).eq("crisis_flag", true);
        }
      } catch (e) { console.warn("crisis-flag clear failed for", uid, e.message); }
    }

    console.log("crisis-followup-cron:", JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error("crisis-followup-cron fatal:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
