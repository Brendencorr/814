/**
 * admin-users.js - Operator-only user management endpoint
 *
 * Uses SUPABASE_SERVICE_KEY to bypass RLS so the admin can read all user data.
 * This endpoint is NOT for public use - it should only be called from
 * the operator dashboard (admin.meetriley.us) which is password-protected.
 *
 * GET /.netlify/functions/admin-users
 *   → returns list of all user_profiles with summary stats
 *
 * GET /.netlify/functions/admin-users?user_id=<uuid>
 *   → returns full profile + riley_conversations + program_progress for that user
 *
 * GET /.netlify/functions/admin-users?search=<query>
 *   → returns users matching name or email (case-insensitive)
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  // Operator-only. Fail closed: no configured secret -> never serve user data.
  const expected = process.env.OPERATOR_KEY;
  if (!expected) return { statusCode: 503, headers: CORS_HEADERS, body: JSON.stringify({ error: "Not configured. Set OPERATOR_KEY in the environment." }) };
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const supabase = getSupabaseClient(); // SERVICE_KEY - bypasses RLS
    const params   = event.queryStringParameters || {};
    const userId   = params.user_id;
    // Strip PostgREST filter metacharacters so `search` can't alter the .or() filter logic (injection).
    const search   = (params.search || "").replace(/[,()*:%]/g, " ").trim();

    // ── Single user detail (+ 30-day trends for the profile deep-dive) ──────────
    if (userId) {
      const now = Date.now();
      const thirtyAgoTs  = new Date(now - 30 * 86400000).toISOString();
      const thirtyAgoDay = thirtyAgoTs.slice(0, 10);
      const sevenAgo     = new Date(now - 7 * 86400000);

      const [profileRes, convsRes, progRes, evRes, ciRes] = await Promise.all([
        supabase.from("user_profiles").select("*").eq("id", userId).single(),
        supabase.from("riley_conversations").select("session_id, created_at").eq("user_id", userId).order("created_at", { ascending: true }).limit(200),
        supabase.from("user_program_progress").select("*").eq("user_id", userId).order("last_activity", { ascending: false }),
        supabase.from("engagement_events").select("event_type,created_at").eq("user_id", userId).gte("created_at", thirtyAgoTs).limit(20000),
        supabase.from("daily_checkins").select("mood,checkin_date").eq("user_id", userId).gte("checkin_date", thirtyAgoDay).not("mood", "is", null).order("checkin_date", { ascending: true }).limit(400),
      ]);

      // Session METADATA ONLY - the operator must NEVER see members' conversation content.
      // (Hard rule: "these are people's lives and secrets." Counts/timestamps only, never text.)
      const convsBySession = {};
      (convsRes.data || []).forEach((msg) => {
        const sid = msg.session_id || "default";
        if (!convsBySession[sid]) convsBySession[sid] = [];
        convsBySession[sid].push(msg.created_at);
      });
      const sessions = Object.entries(convsBySession)
        .map(([sid, times]) => ({
          session_id: sid,
          message_count: times.length,
          started_at: times[0],
          last_message_at: times[times.length - 1],
        }))
        .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

      // Per-user 30-day series (all activity + Riley) with 7d-vs-prior-7d deltas
      const dayList = [];
      for (let i = 29; i >= 0; i--) dayList.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
      const serAll = {}, serRiley = {};
      dayList.forEach((d) => { serAll[d] = 0; serRiley[d] = 0; });
      let ev7 = 0, evPrev = 0, ri7 = 0, riPrev = 0, brief30 = 0;
      (evRes.data || []).forEach((e) => {
        const dk = (e.created_at || "").slice(0, 10), cur = new Date(e.created_at) >= sevenAgo;
        if (serAll[dk] !== undefined) serAll[dk]++;
        if (cur) ev7++; else evPrev++;
        if (e.event_type === "riley_message") { if (serRiley[dk] !== undefined) serRiley[dk]++; if (cur) ri7++; else riPrev++; }
        if (e.event_type === "brief_opened") brief30++;
      });
      const mk = (obj) => dayList.map((d) => ({ label: d.slice(5), n: obj[d] }));
      const checkins = ciRes.data || [];
      const moodSeries = checkins.map((c) => ({ label: (c.checkin_date || "").slice(5), n: c.mood }));
      const avgMood = checkins.length ? Math.round(checkins.reduce((a, c) => a + c.mood, 0) / checkins.length * 10) / 10 : null;
      const la = profileRes.data && profileRes.data.last_active_at;
      const days = la ? (now - new Date(la)) / 86400000 : 999;
      const state = !la ? "new" : days <= 2 ? "active" : days <= 7 ? "cooling" : "dormant";

      // Redact personal, journal-like reflective fields - the operator gets operational data only,
      // never the member's private onboarding reflections / Human OS. (Same hard rule as above.)
      const _pfull = profileRes.data || null;
      const safeProfile = _pfull
        ? (({ why_here, one_year_vision, human_os, last_engagement_note, influences, primary_goals, preferred_encouragement, communication_style, ...rest }) => rest)(_pfull)
        : null;

      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          profile:  safeProfile,
          sessions: sessions,
          progress: progRes.data     || [],
          series: { activity_30d: mk(serAll), riley_30d: mk(serRiley), mood: moodSeries },
          stats:  { state, events_7d: ev7, events_prev_7d: evPrev, riley_7d: ri7, riley_prev_7d: riPrev, brief_30d: brief30, checkins_30d: checkins.length, avg_mood: avgMood },
        }),
      };
    }

    // ── User list (with optional search) ─────────────────────────────────────
    let query = supabase
      .from("user_profiles")
      .select("id, email, full_name, avatar_url, sobriety_date, programs_purchased, community_member, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);

    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: users, error } = await query;
    if (error) throw error;

    // Enrich each user with their conversation count
    const userIds = (users || []).map((u) => u.id);
    let convCounts = {};
    if (userIds.length) {
      const { data: counts } = await supabase
        .from("riley_conversations")
        .select("user_id")
        .in("user_id", userIds);
      (counts || []).forEach((r) => {
        convCounts[r.user_id] = (convCounts[r.user_id] || 0) + 1;
      });
    }

    const enriched = (users || []).map((u) => ({
      ...u,
      message_count: convCounts[u.id] || 0,
    }));

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ users: enriched }),
    };

  } catch (err) {
    console.error("admin-users error:", err.message);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error: " + err.message }),
    };
  }
};
