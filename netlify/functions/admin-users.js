/**
 * admin-users.js — Operator-only user management endpoint
 *
 * Uses SUPABASE_SERVICE_KEY to bypass RLS so the admin can read all user data.
 * This endpoint is NOT for public use — it should only be called from
 * the operator dashboard (admin.eight14.us) which is password-protected.
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
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const supabase = getSupabaseClient(); // SERVICE_KEY — bypasses RLS
    const params   = event.queryStringParameters || {};
    const userId   = params.user_id;
    const search   = params.search;

    // ── Single user detail ────────────────────────────────────────────────────
    if (userId) {
      const [profileRes, convsRes, progRes] = await Promise.all([
        supabase
          .from("user_profiles")
          .select("*")
          .eq("id", userId)
          .single(),
        supabase
          .from("riley_conversations")
          .select("role, content, session_id, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(200),
        supabase
          .from("user_program_progress")
          .select("*")
          .eq("user_id", userId)
          .order("last_activity", { ascending: false }),
      ]);

      // Group conversations by session
      const convsBySession = {};
      (convsRes.data || []).forEach((msg) => {
        const sid = msg.session_id || "default";
        if (!convsBySession[sid]) convsBySession[sid] = [];
        convsBySession[sid].push({ role: msg.role, content: msg.content, created_at: msg.created_at });
      });

      // Most recent session first
      const sessions = Object.entries(convsBySession)
        .map(([sid, msgs]) => ({
          session_id: sid,
          message_count: msgs.length,
          started_at: msgs[0]?.created_at,
          last_message_at: msgs[msgs.length - 1]?.created_at,
          messages: msgs,
        }))
        .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          profile:  profileRes.data  || null,
          sessions: sessions,
          progress: progRes.data     || [],
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
