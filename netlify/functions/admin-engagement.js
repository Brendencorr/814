/**
 * admin-engagement.js - Operator-only engagement analytics
 *
 * Uses SUPABASE_SERVICE_KEY to read across all users. Operator dashboard only
 * (admin.meetriley.us, password-gated). Built for 5,000-user scale: reads the
 * denormalized counters on user_profiles + a single week-window events scan.
 *
 * GET → {
 *   aggregate: { total, active, cooling, dormant, new, brief_opens_7d,
 *                riley_msgs_7d, app_opens_7d, new_signups_7d, avg_brief_opens,
 *                reeng_emails_7d, win_backs_7d },
 *   users: [ {id, first_name, last_name, name, email, state, last_active_at,
 *             brief_open_count, riley_msg_count, session_count, sober_days,
 *             recent_mood, tier, paid, products, has_purchases, active_program,
 *             last_crisis_level, welcome_email_sent, coupon} ],
 *   needs_attention: [ same shape - dormant/cooling or low recent mood ]
 * }
 *
 * tier/products ties each client's engagement directly back to what they've
 * actually purchased (reads user_active_products, same expansion entitlements.js
 * uses - Guide/Companion/Coach imply every program). active_program pulls their
 * current curriculum enrollment + days completed from user_program_progress.
 *
 * coupon: promo_code (human code the member typed) or stripe_coupon_id stamped by
 * stripe-webhook on checkout.session.completed. One scan of active subscriptions
 * rows that have a coupon - no per-member Stripe calls.
 */

const { getSupabaseClient, soberDaysForMember, requireOperator } = require("./supabase-client");
const { currentTier, stateFromLastActive } = require("./tier-utils"); // shared tier + state resolvers

/** Split full_name into { first_name, last_name }. Falls back to preferred_name as first. */
function splitName(fullName, preferredName) {
  const raw = (fullName || "").trim();
  if (raw) {
    const sp = raw.indexOf(" ");
    if (sp < 0) return { first_name: raw, last_name: "" };
    return { first_name: raw.slice(0, sp), last_name: raw.slice(sp + 1).trim() };
  }
  const pref = (preferredName || "").trim();
  return { first_name: pref, last_name: "" };
}

const PAID_TIERS = new Set(["companion", "coach", "mentor"]);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  // Operator gate: constant-time key check + CORS allow-list (M-3).
  const gate = requireOperator(event); if (gate) return gate;

  try {
    const supabase = getSupabaseClient(); // SERVICE_KEY
    const now      = Date.now();
    const sevenAgoTs  = new Date(now - 7 * 86400000).toISOString();
    const sevenAgoDay = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    const fourteenAgoTs = new Date(now - 14 * 86400000).toISOString();

    const [usersRes, eventsRes, checkinsRes, prodRes, entRes, progRes, emailRes, purchRes, couponRes] = await Promise.all([
      supabase.from("user_profiles")
        .select("id,full_name,preferred_name,email,avatar_url,last_active_at,engagement_state,session_count,brief_open_count,last_brief_opened_at,riley_msg_count,sobriety_date,created_at,reengagement_sent_at,last_crisis_level")
        .eq("onboarding_completed", true)
        .order("last_active_at", { ascending: false, nullsFirst: false })
        .limit(5000),
      supabase.from("engagement_events")
        .select("event_type,user_id,created_at")
        .gte("created_at", fourteenAgoTs)
        .limit(200000),
      supabase.from("daily_checkins")
        .select("user_id,mood,checkin_date")
        .gte("checkin_date", sevenAgoDay)
        .not("mood", "is", null)
        .order("checkin_date", { ascending: false })
        .limit(50000),
      // tier/products config - same tables entitlements.js reads
      supabase.from("products").select("product_key,display_name,tier_level,status"),
      supabase.from("user_active_products").select("user_id,product_key").limit(50000),
      // current curriculum enrollment, most-recently-active first
      supabase.from("user_program_progress")
        .select("user_id,program_name,days_completed,day_completed,status,last_activity,programs(title,duration_days)")
        .eq("status", "active")
        .order("last_activity", { ascending: false })
        .limit(20000),
      // latest client email per user - one indexed scan of recent email_log rows
      // (created_at DESC), grouped in JS. Fixed-size window scales without a giant .in(5000 ids) URL.
      // Users beyond the window show no chip (their panel has full history).
      supabase.from("email_log")
        .select("user_id,status,subject,kind,created_at")
        .order("created_at", { ascending: false })
        .limit(10000),
      // One-time program purchases - one full-table scan to build a Set of user_ids with any purchase.
      // No N+1; scales fine (distinct user_ids, index on user_id).
      supabase.from("purchases").select("user_id").limit(50000),
      // Coupon/promo-code: one scan of active subscriptions that have a coupon stamped by the webhook.
      // Only rows with a coupon; avoids scanning the full subscriptions table unnecessarily.
      supabase.from("subscriptions")
        .select("user_id,promo_code,stripe_coupon_id")
        .eq("status", "active")
        .not("stripe_coupon_id", "is", null)
        .limit(50000),
    ]);

    const users   = usersRes.data   || [];
    const events  = eventsRes.data  || [];
    const checkins= checkinsRes.data|| [];
    const prodDefs= prodRes.data    || [];
    const entRows = entRes.data     || [];
    const progRows= progRes.data    || [];
    const emailRows= emailRes.data  || [];
    // Build a Set of user_ids who have any one-time purchase
    const purchaserSet = new Set((purchRes.data || []).map(p => p.user_id).filter(Boolean));
    // couponById: promo_code (human code) preferred over stripe_coupon_id (internal id).
    const couponById = {};
    (couponRes.data || []).forEach(s => {
      if (!couponById[s.user_id]) couponById[s.user_id] = s.promo_code || s.stripe_coupon_id || null;
    });

    // Latest email per user (rows already newest-first) → { status, subject, kind, created_at }.
    const lastEmailByUser = {}, emailKindsByUser = {};
    for (const e of emailRows) {
      if (!e.user_id) continue;
      if (lastEmailByUser[e.user_id] === undefined) lastEmailByUser[e.user_id] = { status: e.status, subject: e.subject, kind: e.kind, created_at: e.created_at };
      const km = (emailKindsByUser[e.user_id] ||= {});
      if (e.kind && km[e.kind] === undefined) km[e.kind] = e.status; // latest status per kind → segment email checks
    }

    // Latest mood per user (checkins already newest-first)
    const latestMood = {};
    for (const c of checkins) { if (latestMood[c.user_id] === undefined) latestMood[c.user_id] = c.mood; }

    // Owned products per user (user_active_products already expands
    // implies_all_programs - same resolved view entitlements.js uses).
    const prodByKey = {};
    prodDefs.forEach(p => { prodByKey[p.product_key] = p; });
    const ownedByUser = {};
    entRows.forEach(r => { (ownedByUser[r.user_id] ||= []).push(r.product_key); });
    // First active curriculum enrollment per user (rows already newest-first).
    const activeProgramByUser = {};
    progRows.forEach(r => {
      if (activeProgramByUser[r.user_id]) return;
      const title = (r.programs && r.programs.title) || r.program_name || "Program";
      const total = (r.programs && r.programs.duration_days) || null;
      activeProgramByUser[r.user_id] = { title, days_completed: r.days_completed ?? r.day_completed ?? 0, duration_days: total };
    });

    // 14-day event scan: current-7d tallies, prior-7d tallies (for deltas), and
    // per-day series (for sparklines/trend charts). Win-back uses current-7d only.
    const sevenAgo = new Date(now - 7 * 86400000);
    const dayList = [];
    for (let i = 13; i >= 0; i--) dayList.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
    const serApp = {}, serRiley = {}, serBrief = {};
    dayList.forEach(d => { serApp[d] = 0; serRiley[d] = 0; serBrief[d] = 0; });
    let briefOpens7d = 0, rileyMsgs7d = 0, appOpens7d = 0, reengEmails7d = 0;
    let briefOpensPrev = 0, rileyMsgsPrev = 0, appOpensPrev = 0;
    const lastEmailAt = {}, lastOpenAt = {};
    for (const e of events) {
      const t = new Date(e.created_at), cur = t >= sevenAgo, dk = (e.created_at || "").slice(0, 10);
      if (e.event_type === "brief_opened")  { if (cur) briefOpens7d++; else briefOpensPrev++; if (serBrief[dk] !== undefined) serBrief[dk]++; }
      else if (e.event_type === "riley_message") { if (cur) rileyMsgs7d++; else rileyMsgsPrev++; if (serRiley[dk] !== undefined) serRiley[dk]++; }
      else if (e.event_type === "app_open")  { if (cur) { appOpens7d++; if (!lastOpenAt[e.user_id] || t > lastOpenAt[e.user_id]) lastOpenAt[e.user_id] = t; } else appOpensPrev++; if (serApp[dk] !== undefined) serApp[dk]++; }
      else if (e.event_type === "reengagement_email_sent") { if (cur) { reengEmails7d++; if (!lastEmailAt[e.user_id] || t > lastEmailAt[e.user_id]) lastEmailAt[e.user_id] = t; } }
    }
    const mkSeries = (obj) => dayList.map(d => ({ label: d.slice(5), n: obj[d] }));
    // Win-backs: emailed in the window, then opened the app AFTER the email
    let winBacks7d = 0;
    for (const uid in lastEmailAt) { if (lastOpenAt[uid] && lastOpenAt[uid] > lastEmailAt[uid]) winBacks7d++; }

    // Per-user rows + aggregate state counts
    const counts = { active: 0, cooling: 0, dormant: 0, new: 0 };
    let newSignups7d = 0, newSignupsPrev = 0, totalBriefOpens = 0;

    const rows = users.map(u => {
      const state = stateFromLastActive(u.last_active_at);
      counts[state] = (counts[state] || 0) + 1;
      if (u.created_at) {
        const ct = new Date(u.created_at);
        if (ct >= new Date(sevenAgoTs)) newSignups7d++;
        else if (ct >= new Date(fourteenAgoTs)) newSignupsPrev++;
      }
      totalBriefOpens += u.brief_open_count || 0;
      const soberDays = u.sobriety_date ? soberDaysForMember(u.sobriety_date) : null;
      const owned = ownedByUser[u.id] || [];
      const tier = currentTier(owned);
      const names = splitName(u.full_name, u.preferred_name);
      const emailKinds = emailKindsByUser[u.id] || {};
      const welcomeSent = emailKinds["welcome"] === "sent" ? true : (emailKinds["welcome"] ? false : null);
      return {
        id: u.id,
        // Structured name fields for the Home table and Client Overview filter UI
        first_name: names.first_name,
        last_name: names.last_name,
        // Legacy single-name field kept for back-compat (engRow still uses u.name)
        name: (u.preferred_name || u.full_name || u.email || "Member"),
        email: u.email,
        avatar_url: u.avatar_url || null,
        state,
        last_active_at: u.last_active_at,
        brief_open_count: u.brief_open_count || 0,
        riley_msg_count: u.riley_msg_count || 0,
        session_count: u.session_count || 0,
        sober_days: soberDays,
        recent_mood: latestMood[u.id] ?? null,
        reengaged: !!u.reengagement_sent_at,
        reengaged_at: u.reengagement_sent_at || null,
        won_back: !!(lastEmailAt[u.id] && lastOpenAt[u.id] && lastOpenAt[u.id] > lastEmailAt[u.id]),
        tier,
        // paid: true if the member has an active paid plan (companion, coach, mentor)
        paid: PAID_TIERS.has(tier),
        // Exclude reset_free (implied for everyone) and retired products (noisy to show).
        products: owned.filter(k => k !== "reset_free" && (prodByKey[k] || {}).status !== "retired").map(k => (prodByKey[k] || {}).display_name || k),
        // has_purchases: true if any one-time purchase row exists in the purchases table
        has_purchases: purchaserSet.has(u.id),
        active_program: activeProgramByUser[u.id] || null,
        last_crisis_level: u.last_crisis_level || null,
        last_email: lastEmailByUser[u.id] || null,
        email_kinds: emailKinds,
        welcome_email_sent: welcomeSent,
        // coupon: promo_code (human code) or stripe_coupon_id stamped by the webhook on checkout.
        coupon: couponById[u.id] || null,
      };
    });

    // Needs attention - cooling/dormant, or recent mood is low (1-2)
    const needs_attention = rows
      .filter(r => r.state === "dormant" || r.state === "cooling" || (r.recent_mood !== null && r.recent_mood <= 2))
      .sort((a, b) => {
        const rank = s => s === "dormant" ? 0 : s === "cooling" ? 1 : 2;
        return rank(a.state) - rank(b.state);
      })
      .slice(0, 50);

    const aggregate = {
      total: users.length,
      active: counts.active, cooling: counts.cooling, dormant: counts.dormant, new: counts.new,
      brief_opens_7d: briefOpens7d,
      riley_msgs_7d: rileyMsgs7d,
      app_opens_7d: appOpens7d,
      new_signups_7d: newSignups7d,
      avg_brief_opens: users.length ? Math.round(totalBriefOpens / users.length * 10) / 10 : 0,
      reeng_emails_7d: reengEmails7d,
      win_backs_7d: winBacks7d,
    };

    // Prior-7d values for trend deltas + 14-day daily series for sparklines/trend chart.
    const deltas = {
      brief_opens_7d: briefOpensPrev,
      riley_msgs_7d: rileyMsgsPrev,
      app_opens_7d: appOpensPrev,
      new_signups_7d: newSignupsPrev,
    };
    const series_14d = { app_opens: mkSeries(serApp), riley: mkSeries(serRiley), brief: mkSeries(serBrief) };

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ aggregate, deltas, series_14d, users: rows, needs_attention }),
    };

  } catch (err) {
    console.error("admin-engagement error:", err.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
