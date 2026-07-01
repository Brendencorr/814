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
    // v4 pricing — grantGuideOnSignup(): every new account gets Riley Guide
    // immediately, no purchase needed. (entitlements.js also defends against
    // any signup path that doesn't reach this function, so this is belt-and-
    // suspenders for a clean audit row, not the only guarantee.)
    try {
      await supabase.from("entitlements")
        .upsert({ user_id: user.id, product_key: "reset_free", status: "active", source: "implied" }, { onConflict: "user_id,product_key" });
    } catch (e) { console.warn("grantGuideOnSignup failed (non-fatal):", e.message); }
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

// Tables holding a member's personal / journal data, keyed by user_id.
// crisis_log is intentionally EXCLUDED — it's restricted safety data handled
// only inside the safety workflow (Trust architecture §1.4), not self-service.
const USER_DATA_TABLES = [
  "daily_checkins", "riley_conversations", "riley_memory", "user_goals",
  "habits", "habit_completions", "sobriety_tracker", "life_events",
  "important_dates", "user_program_progress", "engagement_events",
];

// Personal fields cleared from the profile on delete (the shell stays so the
// member can still sign in; email + consent + safety flags are preserved).
const PROFILE_CLEAR = {
  preferred_name: null, pronouns: null, birthday: null, city: null,
  why_here: null, why_here_detail: null, one_year_vision: null, human_os: null,
  primary_goals: null, communication_style: null, preferred_encouragement: null,
  sobriety_date: null, avatar_url: null, full_name: null,
  onboarding_completed: false, onboarding_step: 0, phase2_progress: null,
};

// ── Action: export_data — give the member everything stored about them ────────
async function exportData(supabase, body) {
  const user = await verifyToken(supabase, body.token);
  const out = { exported_at: new Date().toISOString(), account: { id: user.id, email: user.email } };

  const { data: profile } = await supabase.from("user_profiles").select("*").eq("id", user.id).maybeSingle();
  out.profile = profile || null;

  const results = await Promise.allSettled(
    USER_DATA_TABLES.map((t) => supabase.from(t).select("*").eq("user_id", user.id))
  );
  out.data = {};
  USER_DATA_TABLES.forEach((t, i) => {
    out.data[t] = results[i].status === "fulfilled" ? (results[i].value.data || []) : [];
  });

  out.note = "This is everything Riley has stored for you. Crisis-safety records, if any, are kept separately and only used to keep you safe.";
  return json(200, out);
}

// ── Action: delete_data — wipe the member's personal/journal data ─────────────
async function deleteData(supabase, body) {
  const user = await verifyToken(supabase, body.token);
  if (body.confirm !== true) return json(400, { error: "confirm:true is required to delete data" });

  const results = await Promise.allSettled(
    USER_DATA_TABLES.map((t) => supabase.from(t).delete().eq("user_id", user.id))
  );
  const cleared = [];
  const failed = [];
  USER_DATA_TABLES.forEach((t, i) => {
    (results[i].status === "fulfilled" && !results[i].value.error ? cleared : failed).push(t);
  });

  // Reset the profile to a minimal shell (keep email, consent, safety flags).
  try {
    await supabase.from("user_profiles")
      .update({ ...PROFILE_CLEAR, data_deleted_at: new Date().toISOString() })
      .eq("id", user.id);
  } catch (e) {
    console.error("delete_data profile reset failed:", e.message);
    failed.push("user_profiles");
  }

  console.log(`delete_data for ${user.id}: cleared ${cleared.length}, failed ${failed.length}`);
  return json(200, { success: failed.length === 0, cleared, failed });
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
      case "export_data":    return await exportData(supabase, body);
      case "delete_data":    return await deleteData(supabase, body);
      default:               return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error("auth-handler error:", err.message);
    const status = err.message.includes("Invalid") || err.message.includes("expired") ? 401 : 500;
    return json(status, { error: err.message });
  }
};
