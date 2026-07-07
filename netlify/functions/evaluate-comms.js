/**
 * evaluate-comms.js — hourly lifecycle-comms evaluator (handoff Task 4). Scheduled via netlify.toml.
 *
 * ── DARK BY DESIGN ──────────────────────────────────────────────────────────────────────────────
 * Nothing reaches a real inbox unless COMMS_ENABLED === 'true'. Otherwise every decision is still
 * evaluated and LOGGED to email_sends with suppressed=true, reason='comms_disabled' (or 'dry_run'
 * when DRY_RUN==='true'). Zero Resend calls while dark. Brenden flips COMMS_ENABLED at launch.
 *
 * ── STATE IS DERIVED SERVER-SIDE (Task 5 folded in) ─────────────────────────────────────────────
 * Rather than wire every client handler to write a service-role-only table, we DERIVE state each run
 * from tables that already exist: user_profiles (identity/signup), riley_conversations + daily_checkins
 * (last activity), subscriptions (plan), reset_enrollment (reset progress). More robust, less brittle.
 * user_comms_state is upserted with the derived snapshot so admin views + once-ever rules work.
 *
 * ⚠️ TIMING NOTE: the exact Guide-flow trigger table lives in riley-lifecycle-comms-spec-FINAL.md
 * (not in this repo). The day-based triggers below are a faithful reading of the copy's cadence and
 * should be reconciled against that spec before COMMS_ENABLED is flipped. Gone-Quiet ladder + gates
 * follow the handoff exactly. Once-per-template-ever is enforced here in code (not a DB constraint).
 */
const { getSupabaseClient } = require("./supabase-client");
const { render } = require("./comms-templates");

const APP = "https://riley.meetriley.us";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DAY = 86400000;

function firstName(profile) {
  const n = (profile && (profile.full_name || profile.name)) || "";
  return (n.split(" ")[0] || "there");
}
function prefUrl(uid) { return APP + "/preferences?u=" + encodeURIComponent(uid); }
function unsubUrl(uid) { return APP + "/.netlify/functions/comms-unsubscribe?u=" + encodeURIComponent(uid); }

function inQuietHours(tz) {
  try {
    const h = tz
      ? Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()))
      : new Date().getUTCHours();
    return h >= 21 || h < 8; // 9pm–8am local = quiet
  } catch (e) { return false; }
}

async function resendSend(msg, uid) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { id: null, error: "no_key" };
  const headers = msg.transactional ? {} : {
    "List-Unsubscribe": "<" + unsubUrl(uid) + ">, <mailto:support@meetriley.us?subject=unsubscribe>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: msg.from, to: [msg.to], reply_to: msg.replyTo, subject: msg.subject, html: msg.html, text: msg.text, headers }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { id: d.id || null } : { id: null, error: "http_" + r.status };
  } catch (e) { return { id: null, error: "exception" }; }
}

async function phEmit(templateKey, uid) {
  const key = process.env.POSTHOG_PROJECT_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!key) return;
  try {
    await fetch(host + "/capture/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, event: "email_sent", distinct_id: uid, properties: { template_key: templateKey } }),
    });
  } catch (e) {}
}

exports.handler = async () => {
  const ENABLED = String(process.env.COMMS_ENABLED || "").toLowerCase() === "true";
  const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "true";
  const sb = getSupabaseClient();
  const now = Date.now();
  const out = { ok: true, enabled: ENABLED, dry_run: DRY_RUN, evaluated: 0, decisions: {} };
  const bump = (k) => { out.decisions[k] = (out.decisions[k] || 0) + 1; };

  // ── Load source data (batched, not N+1) ──
  const [profR, stateR, sendsR, subsR, convR, ciR] = await Promise.allSettled([
    sb.from("user_profiles").select("id,email,full_name,name,created_at,onboarding_completed"),
    sb.from("user_comms_state").select("*"),
    sb.from("email_sends").select("user_id,template_key,flow,sent_at,suppressed"),
    sb.from("subscriptions").select("user_id,plan_id,status").eq("status", "active"),
    sb.from("riley_conversations").select("user_id,created_at").order("created_at", { ascending: false }),
    sb.from("daily_checkins").select("user_id,checkin_date").order("checkin_date", { ascending: false }),
  ]);
  const g = (r) => (r.status === "fulfilled" ? r.value.data : null) || [];
  const profiles = g(profR), states = g(stateR), sends = g(sendsR), subs = g(subsR), convs = g(convR), cis = g(ciR);
  if (!profiles.length) return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...out, note: "no users" }) };

  const stateByUser = {}; states.forEach((s) => (stateByUser[s.user_id] = s));
  const planByUser = {}; subs.forEach((s) => { const t = String(s.plan_id || "").toLowerCase(); planByUser[s.user_id] = t.indexOf("coach") >= 0 || t.indexOf("concierge") >= 0 ? "coach" : t.indexOf("companion") >= 0 ? "companion" : planByUser[s.user_id] || "guide"; });
  const lastMsgByUser = {}; convs.forEach((c) => { if (!lastMsgByUser[c.user_id]) lastMsgByUser[c.user_id] = c.created_at; });
  const lastCiByUser = {}; cis.forEach((c) => { if (!lastCiByUser[c.user_id]) lastCiByUser[c.user_id] = c.checkin_date; });
  // Sent templates + "sent a non-transactional today" per user.
  const sentKeys = {}; const sentTodayNonTx = {};
  const todayStr = new Date().toISOString().slice(0, 10);
  sends.forEach((s) => {
    (sentKeys[s.user_id] = sentKeys[s.user_id] || new Set()).add(s.template_key);
    if (!s.suppressed && s.flow !== "transactional" && String(s.sent_at || "").slice(0, 10) === todayStr) sentTodayNonTx[s.user_id] = true;
  });

  // Log a decision (send or suppression) to email_sends, and (if live) actually send.
  async function decide(uid, email, key, msg, forceReason) {
    let suppressed = true, reason = forceReason || null, resend_id = null;
    if (!forceReason) {
      if (!ENABLED) { reason = "comms_disabled"; }
      else if (DRY_RUN) { reason = "dry_run"; }
      else {
        const res = await resendSend({ ...msg, to: email }, uid);
        if (res.id) { suppressed = false; resend_id = res.id; phEmit(key, uid); }
        else { reason = "resend_" + (res.error || "error"); }
      }
    }
    await sb.from("email_sends").insert({ user_id: uid, template_key: key, flow: msg.flow, resend_id, suppressed, suppression_reason: reason });
    bump(suppressed ? "suppressed:" + (reason || "?") : "sent:" + key);
  }

  for (const prof of profiles) {
    const uid = prof.id; if (!uid) continue;
    out.evaluated++;
    const st = stateByUser[uid] || {};
    const signupAt = st.signup_at ? +new Date(st.signup_at) : (prof.created_at ? +new Date(prof.created_at) : now);
    const lastMsg = lastMsgByUser[uid] ? +new Date(lastMsgByUser[uid]) : null;
    const lastCi = lastCiByUser[uid] ? +new Date(lastCiByUser[uid] + "T12:00:00Z") : null;
    const lastActive = Math.max(signupAt, lastMsg || 0, lastCi || 0);
    const plan = planByUser[uid] || st.plan || "guide";
    const daysSinceSignup = Math.floor((now - signupAt) / DAY);
    const daysAbsent = Math.floor((now - lastActive) / DAY);
    const everMessaged = !!lastMsg;
    const ladder = st.ladder_position || 0;
    const keys = sentKeys[uid] || new Set();
    const vars = { first_name: firstName(prof), session_count: (convs.filter((c) => c.user_id === uid).length) || 0, plan };
    const urls = { unsub: unsubUrl(uid), pref: prefUrl(uid) };

    // Refresh the derived snapshot (upsert) — this is the Task-5 state, server-derived.
    const snap = {
      user_id: uid, signup_at: new Date(signupAt).toISOString(),
      last_login_at: st.last_login_at || null,
      last_riley_message_at: lastMsg ? new Date(lastMsg).toISOString() : (st.last_riley_message_at || null),
      plan, updated_at: new Date().toISOString(),
    };
    await sb.from("user_comms_state").upsert(snap, { onConflict: "user_id" });

    // 1) GLOBAL GATES
    if (st.unsubscribed_lifecycle) { bump("skip:unsubscribed"); continue; }
    if (st.lapse_repair) { bump("skip:lapse_repair"); continue; }
    if (sentTodayNonTx[uid]) { bump("skip:already_today"); continue; }
    if (inQuietHours(st.timezone)) { bump("skip:quiet_hours"); continue; } // retry next run

    let fired = false;
    const send = async (key) => {
      if (keys.has(key)) return false;         // once-per-template-ever (except reset_daily handled separately)
      const r = render(key, vars, urls);
      await decide(uid, prof.email, key, r);
      keys.add(key); fired = true; return true;
    };

    // 2) GONE QUIET (owns absent users)
    const resetStarted = !!st.reset_started, resetDay = st.reset_day || 0;
    const daysSinceResetActivity = resetStarted ? daysAbsent : 999;
    if (daysAbsent >= 2) {
      if (resetStarted && resetDay < 7 && daysSinceResetActivity >= 2 && !keys.has("quiet_reset")) {
        await send("quiet_reset");
      } else if (daysAbsent >= 21 && ladder <= 2) {
        if (await send("quiet_3")) await sb.from("user_comms_state").update({ ladder_position: 3 }).eq("user_id", uid);
      } else if (daysAbsent >= 7 && ladder <= 1) {
        if (await send("quiet_2")) await sb.from("user_comms_state").update({ ladder_position: 2 }).eq("user_id", uid);
      } else if (daysAbsent >= 2 && !everMessaged && ladder === 0) {
        if (await send("quiet_1")) await sb.from("user_comms_state").update({ ladder_position: 1 }).eq("user_id", uid);
      }
      if (fired) continue;
    }

    // 3) GUIDE FLOW (only if NOT absent). Day-based reading of the copy cadence (reconcile w/ spec).
    if (!fired && daysAbsent < 2) {
      if (daysSinceSignup >= 30) await send("guide_7");
      else if (daysSinceSignup >= 12) await send("guide_6");
      else if (daysSinceSignup >= 7) await send("guide_5");
      else if (resetDay >= 4 || daysSinceSignup >= 4) await send("guide_4");
      // reset_daily: days 2–7, only if push not opted in, for the next uncompleted reset day.
      else if (resetStarted && resetDay >= 1 && resetDay < 7 && !st.push_opted_in) {
        const n = resetDay + 1;
        const rd = render("reset_daily", { ...vars, n, module_title: "Day " + n, module_theme: "today's step" }, urls);
        // reset_daily is the ONE template allowed to repeat (once per day, gated by "already_today" above).
        await decide(uid, prof.email, "reset_daily", rd);
        fired = true;
      }
      else if (resetDay >= 1) await send("guide_3");
      else if (daysSinceSignup >= 1) await send("guide_2");
      // guide_1 is sent at signup by the signup hook (not the cron); the cron backstops brand-new
      // users who somehow have no guide_1 yet and are <1 day old.
      else if (daysSinceSignup < 1 && !keys.has("guide_1")) await send("guide_1");
    }

    // 4) PAID / ADDON (cron-driven parts). Event-driven paid_1/paid_2/addon_1 fire on webhooks (dark).
    if (!fired && st.subscription_started_at) {
      const dSub = Math.floor((now - +new Date(st.subscription_started_at)) / DAY);
      if (dSub >= 25) await send("paid_3");
    }
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(out) };
};
