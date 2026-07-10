/**
 * evaluate-comms.js - hourly lifecycle-comms evaluator (handoff Task 4). Scheduled via netlify.toml.
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
const { getSupabaseClient, requireScheduledOrOperator, memberDay, inQuietHours } = require("./supabase-client");
const { render, TRIGGERS } = require("./comms-templates");
const { sendClientEmail } = require("./email-send");
const { signUid } = require("./comms-sign");

const APP = "https://riley.meetriley.us";
const DAY = 86400000;

function firstName(profile) {
  const n = (profile && (profile.preferred_name || profile.full_name)) || "";
  return (n.split(" ")[0] || "there");
}
// Sign the member id so only links we generated are honored for opt-IN (see comms-sign.js). Empty when
// no secret is configured, in which case comms-unsubscribe fails open - never blocking a real request.
function sigParam(uid) { const s = signUid(uid); return s ? "&s=" + s : ""; }
function prefUrl(uid) { return APP + "/preferences?u=" + encodeURIComponent(uid) + sigParam(uid); }
function unsubUrl(uid) { return APP + "/.netlify/functions/comms-unsubscribe?u=" + encodeURIComponent(uid) + sigParam(uid); }

async function resendSend(msg, uid) {
  // Route through the single client-email choke point (email-send.js) so every lifecycle
  // send is also captured in email_log / the operator correspondence view. Reply-To
  // (support@) and the RFC 8058 one-click List-Unsubscribe headers ride along via the
  // choke point's additive replyTo/headers params.
  const headers = msg.transactional ? undefined : {
    "List-Unsubscribe": "<" + unsubUrl(uid) + ">, <mailto:support@meetriley.us?subject=unsubscribe>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
  const r = await sendClientEmail({
    to: msg.to, from: msg.from, replyTo: msg.replyTo, subject: msg.subject,
    html: msg.html, text: msg.text, headers,
    kind: "lifecycle:" + (msg.flow || "comms"), userId: uid,
    meta: { template_key: msg.template_key },
  });
  return r.sent ? { id: r.id } : { id: null, error: r.reason || "error" };
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

exports.handler = async (event) => {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;   // scheduler or operator-key only
  const ENABLED = String(process.env.COMMS_ENABLED || "").toLowerCase() === "true";
  const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "true";
  const sb = getSupabaseClient();
  const now = Date.now();
  const out = { ok: true, enabled: ENABLED, dry_run: DRY_RUN, evaluated: 0, decisions: {} };
  const bump = (k) => { out.decisions[k] = (out.decisions[k] || 0) + 1; };

  // ── Load source data (batched, not N+1) ──
  const [profR, stateR, sendsR, subsR, convR, ciR, tplR] = await Promise.allSettled([
    sb.from("user_profiles").select("id,email,full_name,preferred_name,created_at,onboarding_completed,timezone"),
    sb.from("user_comms_state").select("*"),
    sb.from("email_sends").select("user_id,template_key,flow,sent_at,suppressed"),
    sb.from("subscriptions").select("user_id,plan_id,status").eq("status", "active"),
    sb.from("riley_conversations").select("user_id,created_at").order("created_at", { ascending: false }),
    sb.from("daily_checkins").select("user_id,checkin_date").order("checkin_date", { ascending: false }),
    sb.from("comms_templates").select("*"),  // operator overrides (copy/timing/enabled)
  ]);
  // Surface query failures instead of masking them as "no users": a bad column name makes
  // PostgREST reject the whole query (fulfilled promise, but value.error set) - record it.
  const loadErrors = {};
  const g = (r, label) => {
    if (r.status !== "fulfilled") { loadErrors[label] = String(r.reason).slice(0, 200); return []; }
    if (r.value && r.value.error) { loadErrors[label] = (r.value.error.message || String(r.value.error)).slice(0, 200); return []; }
    return (r.value && r.value.data) || [];
  };
  const profiles = g(profR, "user_profiles"), states = g(stateR, "user_comms_state"), sends = g(sendsR, "email_sends"), subs = g(subsR, "subscriptions"), convs = g(convR, "riley_conversations"), cis = g(ciR, "daily_checkins");
  if (Object.keys(loadErrors).length) out.load_errors = loadErrors;
  if (!profiles.length) return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...out, note: "no users" }) };

  // Operator overrides (comms_templates): per-template copy/sender + editable day thresholds + enable.
  const tplOverride = {}; g(tplR, "comms_templates").forEach((o) => (tplOverride[o.template_key] = o));
  const dayFor = (key, def) => { const o = tplOverride[key]; return o && o.trigger_days != null ? o.trigger_days : def; };
  const tplOff = (key) => { const o = tplOverride[key]; return !!(o && o.enabled === false); };

  const stateByUser = {}; states.forEach((s) => (stateByUser[s.user_id] = s));
  const planByUser = {}; subs.forEach((s) => { const t = String(s.plan_id || "").toLowerCase(); planByUser[s.user_id] = t.indexOf("coach") >= 0 || t.indexOf("concierge") >= 0 ? "coach" : t.indexOf("companion") >= 0 ? "companion" : planByUser[s.user_id] || "guide"; });
  const lastMsgByUser = {}; convs.forEach((c) => { if (!lastMsgByUser[c.user_id]) lastMsgByUser[c.user_id] = c.created_at; });
  const lastCiByUser = {}; cis.forEach((c) => { if (!lastCiByUser[c.user_id]) lastCiByUser[c.user_id] = c.checkin_date; });
  // sentKeys = templates ACTUALLY sent (suppressed=false) - the once-per-template-ever dedup.
  // loggedKeys = any decision row incl. suppressed - used only to avoid re-logging the same
  // suppressed decision every hour while dark. A suppressed (never-sent) decision must NOT
  // block the real send at go-live, or the dark period would silently burn every template.
  const sentKeys = {}; const loggedKeys = {}; const nonTxSendsByUser = {}; const lastEmailByUser = {};
  sends.forEach((s) => {
    (loggedKeys[s.user_id] = loggedKeys[s.user_id] || new Set()).add(s.template_key);
    if (!s.suppressed) {
      (sentKeys[s.user_id] = sentKeys[s.user_id] || new Set()).add(s.template_key);
      // "our last touch" = the last email we actually SENT them (suppressed rows while dark don't count).
      const t = +new Date(s.sent_at || 0);
      if (t && (!lastEmailByUser[s.user_id] || t > lastEmailByUser[s.user_id])) lastEmailByUser[s.user_id] = t;
      // Collect non-transactional send times so the "one email per day" cap can be evaluated in the
      // MEMBER'S local day (4am rollover via memberDay), not UTC - matches the app-wide member-day standard.
      if (s.flow !== "transactional" && s.sent_at) (nonTxSendsByUser[s.user_id] = nonTxSendsByUser[s.user_id] || []).push(s.sent_at);
    }
  });

  // Log a decision (send or suppression) to email_sends, and (if live) actually send.
  async function decide(uid, email, key, msg, forceReason, logged, plan) {
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
    // Don't re-insert the same suppressed decision every hour while dark (would bloat the log);
    // the real once-ever dedup lives in sentKeys (actual sends), never in the suppressed rows.
    if (suppressed && logged && logged.has(key)) { bump("suppressed_dupe:" + (reason || "?")); return; }
    await sb.from("email_sends").insert({ user_id: uid, template_key: key, flow: msg.flow, resend_id, suppressed, suppression_reason: reason, plan: plan || null });
    if (logged) logged.add(key);
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
    // "Last touch" = the later of the member's own activity and the last email WE sent them. Gone-Quiet
    // is keyed on QUIET_GAP days of NO touch (default 14, editable via quiet_1.trigger_days). Because the
    // onboarding series keeps emailing, each email refreshes the touch - so win-back can never start
    // mid-onboarding, and the ladder auto-spaces (each quiet email is itself a touch).
    const lastTouch = Math.max(lastActive, lastEmailByUser[uid] || 0);
    const daysSinceTouch = Math.floor((now - lastTouch) / DAY);
    const QUIET_GAP = dayFor("quiet_1", 14);
    const ladder = st.ladder_position || 0;
    const keys = sentKeys[uid] || new Set();       // actually-sent → once ever
    const logged = loggedKeys[uid] || new Set();   // any logged decision → avoids dark re-logging
    const vars = { first_name: firstName(prof), session_count: (convs.filter((c) => c.user_id === uid).length) || 0, plan };
    const urls = { unsub: unsubUrl(uid), pref: prefUrl(uid) };

    // Refresh the derived snapshot (upsert) - this is the Task-5 state, server-derived.
    const memberTz = prof.timezone || st.timezone || null;   // their captured location; quiet hours honor THIS
    const snap = {
      user_id: uid, signup_at: new Date(signupAt).toISOString(),
      last_login_at: st.last_login_at || null,
      last_riley_message_at: lastMsg ? new Date(lastMsg).toISOString() : (st.last_riley_message_at || null),
      timezone: memberTz,
      plan, updated_at: new Date().toISOString(),
    };
    await sb.from("user_comms_state").upsert(snap, { onConflict: "user_id" });

    // 1) GLOBAL GATES
    if (st.unsubscribed_lifecycle) { bump("skip:unsubscribed"); continue; }
    if (st.lapse_repair) { bump("skip:lapse_repair"); continue; }
    const localToday = memberDay(memberTz); // member's app-day (local, 4am rollover)
    if ((nonTxSendsByUser[uid] || []).some((ts) => memberDay(memberTz, ts) === localToday)) { bump("skip:already_today"); continue; }
    if (inQuietHours(memberTz)) { bump("skip:quiet_hours"); continue; } // their LOCAL quiet hours; retry next run

    let fired = false;
    const send = async (key) => {
      if (keys.has(key)) return false;         // once-per-template-ever (except reset_daily handled separately)
      if (tplOff(key)) return false;           // operator disabled this template in the dashboard
      const r = render(key, vars, urls, tplOverride[key]);
      await decide(uid, prof.email, key, r, null, logged, plan);
      keys.add(key); fired = true; return true;
    };

    // 2) GONE QUIET (owns absent users)
    const resetStarted = !!st.reset_started, resetDay = st.reset_day || 0;
    const daysSinceResetActivity = resetStarted ? daysAbsent : 999;
    // Win-back starts only after QUIET_GAP days of NO touch (from us OR them). Each quiet email is
    // itself a touch, so the ladder (quiet_1→2→3) auto-spaces at QUIET_GAP-day intervals.
    if (daysSinceTouch >= QUIET_GAP) {
      if (resetStarted && resetDay < 7 && !keys.has("quiet_reset")) {
        await send("quiet_reset");
      } else if (ladder === 0) {
        if (await send("quiet_1")) await sb.from("user_comms_state").update({ ladder_position: 1 }).eq("user_id", uid);
      } else if (ladder === 1) {
        if (await send("quiet_2")) await sb.from("user_comms_state").update({ ladder_position: 2 }).eq("user_id", uid);
      } else if (ladder === 2) {
        if (await send("quiet_3")) await sb.from("user_comms_state").update({ ladder_position: 3 }).eq("user_id", uid);
      }
      if (fired) continue;
    }

    // 3) GUIDE FLOW (runs while still "in touch" - i.e., not yet in win-back). The onboarding series
    // keeps refreshing the touch, so it completes on its calendar before Gone-Quiet can start.
    if (!fired && daysSinceTouch < QUIET_GAP) {
      // Month One founder letter (day 29) now owns the one-month moment; guide_7 retired. NO tier gate here -
      // every client, regardless of tier, gets this letter (active users only; Gone-Quiet owns the absent above).
      if (daysSinceSignup >= dayFor("guide_5", 29)) await send("guide_5");
      // Companion pitch: Guide tier ONLY (Option A - never upsell a paid member the tier they already have).
      // Paid members enter this branch and send nothing, so they never fall through to an earlier email.
      else if (daysSinceSignup >= dayFor("guide_6", 12)) { if (plan === "guide") await send("guide_6"); }
      else if (resetDay >= dayFor("guide_4", 4) || daysSinceSignup >= dayFor("guide_4", 4)) await send("guide_4");
      // reset_daily: days 2–7, only if push not opted in, for the next uncompleted reset day.
      else if (resetStarted && resetDay >= 1 && resetDay < 7 && !st.push_opted_in && !tplOff("reset_daily")) {
        const n = resetDay + 1;
        const rd = render("reset_daily", { ...vars, n, module_title: "Day " + n, module_theme: "today's step" }, urls, tplOverride["reset_daily"]);
        // reset_daily is the ONE template allowed to repeat (once per day, gated by "already_today" above).
        await decide(uid, prof.email, "reset_daily", rd, null, logged, plan);
        fired = true;
      }
      else if (resetDay >= 1) await send("guide_3");
      else if (daysSinceSignup >= dayFor("guide_2", 1)) await send("guide_2");
      // guide_1 (welcome) is sent HERE by the cron for brand-new users (<1 day old) who don't have it yet.
      // Routing the welcome through the cron - not a synchronous signup hook - is deliberate: it makes the
      // welcome honor quiet hours + the member's timezone (a 4:31am signup gets it at 7am local, not at night).
      else if (daysSinceSignup < 1 && !keys.has("guide_1")) await send("guide_1");
    }

    // 4) PAID / ADDON (cron-driven parts). Event-driven paid_1/paid_2/addon_1 fire on webhooks (dark).
    if (!fired && st.subscription_started_at) {
      const dSub = Math.floor((now - +new Date(st.subscription_started_at)) / DAY);
      if (dSub >= dayFor("paid_3", 25)) await send("paid_3");
    }
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(out) };
};
