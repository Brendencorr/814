/**
 * auth-handler.js
 * Handles user authentication and Riley conversation persistence.
 *
 * Actions:
 *   get_session    — verify JWT, return user profile + recent conversation
 *   save_message   — persist a single message to riley_conversations
 *   update_profile — update fields in user_profiles
 *
 * Uses SERVICE_KEY to bypass RLS after verifying the user's JWT.
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

// Verify a JWT and return the Supabase user object
async function verifyToken(supabase, token) {
  if (!token) throw new Error("No token provided");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired token");
  return data.user;
}

// ── Action: get_session ───────────────────────────────────────────────────────
async function getSession(supabase, body) {
  const { token, session_id } = body;
  const user = await verifyToken(supabase, token);

  // Get or create user profile
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Auto-create profile on first sign-in
  if (profileError?.code === "PGRST116" || !profile) {
    const newProfile = {
      id:        user.id,
      email:     user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
      avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    };
    await supabase.from("user_profiles").upsert(newProfile);
    return json(200, { user: { id: user.id, email: user.email, ...newProfile }, messages: [] });
  }

  // Load recent conversation for this session
  let messages = [];
  if (session_id) {
    const { data: convData } = await supabase
      .from("riley_conversations")
      .select("role, content, created_at")
      .eq("user_id", user.id)
      .eq("session_id", session_id)
      .order("created_at", { ascending: true })
      .limit(20);
    messages = (convData || []).map((m) => ({ role: m.role, content: m.content }));
  } else {
    // Load most recent session if no session_id given
    const { data: lastMsg } = await supabase
      .from("riley_conversations")
      .select("session_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastMsg?.session_id) {
      const { data: convData } = await supabase
        .from("riley_conversations")
        .select("role, content")
        .eq("user_id", user.id)
        .eq("session_id", lastMsg.session_id)
        .order("created_at", { ascending: true })
        .limit(20);
      messages = (convData || []).map((m) => ({ role: m.role, content: m.content }));
    }
  }

  return json(200, { user: profile, messages });
}

// ── Action: save_message ──────────────────────────────────────────────────────
async function saveMessage(supabase, body) {
  const { token, user_id, session_id, role, content } = body;

  // Verify identity — must match the JWT
  if (token) {
    const user = await verifyToken(supabase, token);
    if (user.id !== user_id) throw new Error("Token / user_id mismatch");
  }

  if (!user_id || !session_id || !role || !content) {
    return json(400, { error: "user_id, session_id, role, and content are required" });
  }
  if (!["user", "assistant"].includes(role)) {
    return json(400, { error: "role must be 'user' or 'assistant'" });
  }

  const { error } = await supabase.from("riley_conversations").insert({
    user_id,
    session_id,
    role,
    content,
  });

  if (error) {
    console.error("save_message insert error:", error.message);
    return json(500, { error: "Failed to save message" });
  }

  return json(200, { success: true });
}

// ── Action: update_profile ────────────────────────────────────────────────────
async function updateProfile(supabase, body) {
  const { token, user_id, ...fields } = body;

  // Verify identity
  const user = await verifyToken(supabase, token);
  if (user.id !== user_id) throw new Error("Token / user_id mismatch");

  // Only allow safe fields to be updated
  const allowed = ["full_name", "sobriety_date", "programs_purchased", "community_member", "avatar_url"];
  const update = {};
  for (const key of allowed) {
    if (key in fields) update[key] = fields[key];
  }

  if (!Object.keys(update).length) {
    return json(400, { error: "No valid fields to update" });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .update(update)
    .eq("id", user_id)
    .select()
    .single();

  if (error) {
    console.error("update_profile error:", error.message);
    return json(500, { error: "Failed to update profile" });
  }

  return json(200, { profile: data });
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { action } = body;
  if (!action) return json(400, { error: "action is required" });

  try {
    const supabase = getSupabaseClient();

    switch (action) {
      case "get_session":    return await getSession(supabase, body);
      case "save_message":   return await saveMessage(supabase, body);
      case "update_profile": return await updateProfile(supabase, body);
      default:               return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error("auth-handler error:", err.message);
    const status = err.message.includes("Invalid") || err.message.includes("expired") ? 401 : 500;
    return json(status, { error: err.message });
  }
};
