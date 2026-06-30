/**
 * admin-engagement.js — Operator-only engagement analytics
 *
 * Uses SUPABASE_SERVICE_KEY to read across all users. Operator dashboard only
 * (admin.eight14.us, password-gated). Built for 5,000-user scale: reads the
 * denormalized counters on user_profiles + a single week-window events scan.
 *
 * GET → {
 *   aggregate: { total, active, cooling, dormant, new, brief_opens_7d,
 *                riley_msgs_7d, app_opens_7d, new_signups_7d, avg_brief_opens },
 *   users: [ {id, name, email, state, last_active_at, brief_open_count,
 *             riley_msg_count, session_count, sober_days, recent_mood} ],
 *   needs_attention: [ same shape — dormant/cooling or low recent mood ]
 * }
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function stateFromLastActive(lastActive) {
  if (!lastActive) return "new";
  const days = (Date.now() - new Date(lastActive)) / 86400000;
  if (days <= 2) return "active";
  if (days <= 7) return "cooling";
  return "dormant";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const supabase = getSupabaseClient(); // SERVICE_KEY
    const now      = Date.now();
    const sevenAgoTs  = new Date(now - 7 * 86400000).toISOString();
    const sevenAgoDay = new Date(now - 7 * 86400000).toISOString().slice(0, 10);

    const [usersRes, eventsRes, checkinsRes] = await Promise.all([
      supabase.from("user_profiles")
        .select("id,full_name,preferred_name,email,last_active_at,engagement_state,session_count,brief_open_count,last_brief_opened_at,riley_msg_count,sobriety_date,created_at")
        .eq("onboarding_completed", true)
        .order("last_active_at", { ascending: false, nullsFirst: false })
        .limit(5000),
      supabase.from("engagement_events")
        .select("event_type,user_id,created_at")
        .gte("created_at", sevenAgoTs)
        .limit(100000),
      supabase.from("daily_checkins")
        .select("user_id,mood,checkin_date")
        .gte("checkin_date", sevenAgoDay)
        .not("mood", "is", null)
        .order("checkin_date", { ascending: false })
        .limit(50000),
    ]);

    const users   = usersRes.data   || [];
    const events  = eventsRes.data  || [];
    const checkins= checkinsRes.data|| [];

    // Latest mood per user (checkins already newest-first)
    const latestMood = {};
    for (const c of checkins) { if (latestMood[c.user_id] === undefined) latestMood[c.user_id] = c.mood; }

    // Week event tallies
    let briefOpens7d = 0, rileyMsgs7d = 0, appOpens7d = 0;
    for (const e of events) {
      if (e.event_type === "brief_opened")  briefOpens7d++;
      else if (e.event_type === "riley_message") rileyMsgs7d++;
      else if (e.event_type === "app_open")  appOpens7d++;
    }

    // Per-user rows + aggregate state counts
    const counts = { active: 0, cooling: 0, dormant: 0, new: 0 };
    let newSignups7d = 0, totalBriefOpens = 0;

    const rows = users.map(u => {
      const state = stateFromLastActive(u.last_active_at);
      counts[state] = (counts[state] || 0) + 1;
      if (u.created_at && new Date(u.created_at) >= new Date(sevenAgoTs)) newSignups7d++;
      totalBriefOpens += u.brief_open_count || 0;
      const soberDays = u.sobriety_date ? Math.max(0, Math.floor((now - new Date(u.sobriety_date)) / 86400000)) : null;
      return {
        id: u.id,
        name: (u.preferred_name || u.full_name || u.email || "Member"),
        email: u.email,
        state,
        last_active_at: u.last_active_at,
        brief_open_count: u.brief_open_count || 0,
        riley_msg_count: u.riley_msg_count || 0,
        session_count: u.session_count || 0,
        sober_days: soberDays,
        recent_mood: latestMood[u.id] ?? null,
      };
    });

    // Needs attention — cooling/dormant, or recent mood is low (1-2)
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
    };

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ aggregate, users: rows, needs_attention }),
    };

  } catch (err) {
    console.error("admin-engagement error:", err.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
