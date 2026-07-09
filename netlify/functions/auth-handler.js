/**
 * auth-handler.js
 * Handles user authentication and Riley conversation persistence.
 *
 * Actions:
 *   get_session    - verify JWT, return user profile + recent conversation
 *   save_message   - persist a single message to riley_conversations
 *   update_profile - update fields in user_profiles
 *
 * Uses SERVICE_KEY to bypass RLS after verifying the user's JWT.
 */

const { getSupabaseClient, emitEvent } = require("./supabase-client");
const { getRemaining, incrementUsage } = require("./usage-limits");
const { currentTier } = require("./tier-utils");

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
    emitEvent(supabase, user.id, "signup_guide", {});   // Doc 0 §9 - a new Guide account
    // v4 pricing - grantGuideOnSignup(): every new account gets Riley Guide
    // immediately, no purchase needed. (entitlements.js also defends against
    // any signup path that doesn't reach this function, so this is belt-and-
    // suspenders for a clean audit row, not the only guarantee.)
    try {
      await supabase.from("entitlements")
        .upsert({ user_id: user.id, product_key: "reset_free", status: "active", source: "implied" }, { onConflict: "user_id,product_key" });
    } catch (e) { console.warn("grantGuideOnSignup failed (non-fatal):", e.message); }
    // Operator alert: web-push every registered admin device that a new member joined.
    // Awaited (so the Lambda stays alive to actually send) but fully fault-tolerant -
    // sendToAllOperators never throws, so this can't delay or break signup. Identity
    // metadata only (name + email); never conversation content.
    try {
      // Lazy require so a module-load hiccup here can NEVER break the critical auth path.
      const { sendToAllOperators } = require("./operator-notify");
      const who = newProfile.full_name || (user.email || "").split("@")[0] || "New member";
      await sendToAllOperators(supabase, {
        title: "New member 🎉",
        body: who + (user.email ? "\n" + user.email : ""),
        url: "/operator",
        tag: "new-signup",
      });
    } catch (_) {}
    return json(200, { user: { id: user.id, email: user.email, ...newProfile }, messages: [] });
  }

  // Load recent conversation. Also return the session id + last-activity time so
  // the chat can smart-resume (auto-continue < 24h, else ask). This is the reliable
  // path - the browser's own RLS read was coming back empty inside the popup iframe.
  let messages = [];
  let lastSessionId = session_id || null;
  let lastAt = null;
  if (session_id) {
    const { data: convData } = await supabase
      .from("riley_conversations")
      .select("role, content, created_at")
      .eq("user_id", user.id)
      .eq("session_id", session_id)
      .order("created_at", { ascending: true })
      .limit(20);
    messages = (convData || []).map((m) => ({ role: m.role, content: m.content }));
    if (convData && convData.length) lastAt = convData[convData.length - 1].created_at;
  } else {
    // Load most recent session if no session_id given
    const { data: lastMsg } = await supabase
      .from("riley_conversations")
      .select("session_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastMsg?.session_id) {
      lastSessionId = lastMsg.session_id;
      lastAt = lastMsg.created_at;
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

  return json(200, { user: profile, messages, last_session_id: lastSessionId, last_at: lastAt });
}

// ── Action: save_message ──────────────────────────────────────────────────────
async function saveMessage(supabase, body) {
  const { token, user_id, session_id, role, content } = body;

  // SECURITY: identity MUST match a verified JWT - an untokened call could inject forged messages into
  // any user's chat history (Riley reads them back as context). Token required (like the other actions).
  if (!token) return json(401, { error: "Unauthorized: token required" });
  const user = await verifyToken(supabase, token);
  if (user.id !== user_id) throw new Error("Token / user_id mismatch");

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
// crisis_log is intentionally EXCLUDED - it's restricted safety data handled
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
  sobriety_date: null, sobriety_interest: false, avatar_url: null, full_name: null,
  onboarding_completed: false, onboarding_step: 0, phase2_progress: null,
};

// ── Action: export_data - give the member everything stored about them ────────
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

// ── Action: delete_data - wipe the member's personal/journal data ─────────────
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

// Tables wiped on a FULL account deletion (self-service, irreversible). Superset of
// USER_DATA_TABLES - everything keyed to the member's user_id, incl. billing
// (subscriptions/purchases/entitlements/credits) so any subscription is terminated.
//
// DELIBERATELY RETAINED: crisis_log. Per clinical/therapeutic norms and GDPR's
// vital-interests / safety carve-out to the right-to-erasure, crisis-safety records
// are kept as a DE-IDENTIFIED safety record - once the auth user + user_profiles
// (name/email) are gone, and with no cascade FKs, the remaining rows are no longer
// linked to an identifiable person. This is disclosed to the member at delete time
// (bounded ~12-month retention; a purge cron can enforce the window later).
// DELIBERATELY UNTOUCHED: admins (operator role infra, not member personal data).
const ACCOUNT_DELETE_TABLES = [
  "chat_usage", "client_alert_reads", "client_alerts", "client_events",
  "content_interactions", "credits", "daily_briefs", "daily_checkins",
  "engagement_events", "entitlements", "events", "fitness_logs",
  "habit_completions", "habits", "important_dates", "journey_step_completions",
  "legacy_vault", "life_events", "life_map", "member_docs", "notification_consents",
  "nutrition_logs", "profile_details", "purchases", "recommendation_history",
  "reset_enrollment", "reset_progress", "riley_conversations", "riley_memory",
  "sleep_logs", "sobriety_checkins", "sobriety_tracker", "subscriptions",
  "usage_counters", "user_daily_state", "user_goals", "user_program_progress",
  "week_one_letters", "wellness_baseline", "wellness_plans", "wellness_profile",
  "wellness_weekly",
  // Memory v2 tables (Master Build Spec) - erase these too. (api_cost_log / system_incidents
  // store only a hashed id, never user_id, so they're already de-identified.)
  "session_summaries", "chat_turn_signals",
  // Newer member-owned tables (verified against the LIVE schema 2026-07-09) - added so a delete truly
  // erases everything: interactive programs, clinical assessment scores, program progress, products,
  // comms state + email logs. Deliberately NOT here: crisis_log (retained, de-identified when the
  // profile row is removed), payments (financial record; Stripe is authoritative), admins (operator).
  "int_enrollments", "phq_gad_scores", "who5_scores", "program_module_progress",
  "user_active_products", "user_comms_state", "email_log", "email_sends", "feature_interest",
  "member_followups",
];

// ── Action: delete_account - permanently close the account + erase all data ────
// Wipes every member-owned row, the profile, and the auth login itself (the member
// cannot sign back in). crisis_log is retained, de-identified (see note above).
// Shared erasure by user id - used by BOTH member self-serve delete_account AND the operator
// admin-account "delete" action. ONE table list, one code path, so neither can drift.
async function eraseMemberById(supabase, userId) {
  // Best-effort: remove an uploaded avatar from storage (skip external OAuth photos).
  try {
    const { data: prof } = await supabase.from("user_profiles").select("avatar_url").eq("id", userId).maybeSingle();
    const url = prof?.avatar_url || "";
    const marker = "/storage/v1/object/public/avatars/";
    if (url.includes(marker)) {
      const path = decodeURIComponent(url.split(marker)[1].split("?")[0]);
      await supabase.storage.from("avatars").remove([path]);
    }
  } catch (e) { console.warn("eraseMember avatar cleanup (non-fatal):", e.message); }

  // Wipe all member-owned rows. Two passes so any FK-ordering hiccup self-heals.
  let failed = ACCOUNT_DELETE_TABLES.slice();
  for (let pass = 0; pass < 2 && failed.length; pass++) {
    const targets = failed;
    const results = await Promise.allSettled(targets.map((t) => supabase.from(t).delete().eq("user_id", userId)));
    failed = targets.filter((t, i) => results[i].status !== "fulfilled" || results[i].value.error);
  }
  if (failed.length) console.error("eraseMember residual table failures:", failed.join(", "));

  // Delete the profile row entirely - this de-identifies any retained crisis_log.
  try { await supabase.from("user_profiles").delete().eq("id", userId); }
  catch (e) { console.error("eraseMember profile delete failed:", e.message); failed.push("user_profiles"); }

  // Remove the auth login - the account is now truly closed.
  let authDeleted = false;
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;
    authDeleted = true;
  } catch (e) { console.error("eraseMember auth.admin.deleteUser failed:", e.message); }

  return { authDeleted, failed };
}

async function deleteAccount(supabase, body) {
  const user = await verifyToken(supabase, body.token);
  if (body.confirm !== true) return json(400, { error: "confirm:true is required to delete the account" });
  const { authDeleted, failed } = await eraseMemberById(supabase, user.id);
  console.log(`delete_account ${user.id}: auth_deleted=${authDeleted}, table_failures=${failed.length}`);
  if (!authDeleted) {
    return json(500, { error: "Your data was cleared, but the login couldn't be fully removed. Please contact support so we can finish closing the account.", auth_deleted: false });
  }
  return json(200, { success: true, auth_deleted: true });
}

// ── Action: checkin_charge - count a completed daily check-in against the Guide cap ──
// Check-ins are Riley-led; none of their exchanges go through riley-chat.js, so they
// don't auto-count. This action credits a fixed 5 to the same usage_counters row that
// riley-chat uses, leaving ~15 free-form messages for the day. Guide only - paid tiers
// are unlimited and untouched. Non-fatal: a DB failure still returns ok:false, never 5xx.
const CHECKIN_CHARGE = 5; // check-in consumes ~5 of the 20/day Guide cap
async function checkinCharge(supabase, body) {
  const { token } = body;
  const user = await verifyToken(supabase, token);

  // Paid tiers are unlimited - nothing to charge.
  let ownedProducts = [];
  try {
    const { data: ent } = await supabase.from("user_active_products").select("product_key").eq("user_id", user.id);
    ownedProducts = (ent || []).map((r) => r.product_key);
    // Mirror the subscription bridge in riley-chat / getClientData so comp/paid members
    // whose entitlement row hasn't landed yet are still correctly identified as uncapped.
    const { data: subs } = await supabase.from("subscriptions").select("plan_id, expires_at").eq("user_id", user.id).eq("status", "active");
    const now = Date.now();
    (subs || []).forEach((s) => {
      const live = !s.expires_at || new Date(s.expires_at).getTime() > now;
      if (live && ["companion", "coach", "mentor"].includes(s.plan_id) && !ownedProducts.includes(s.plan_id)) ownedProducts.push(s.plan_id);
    });
  } catch (e) { console.warn("checkinCharge: entitlement read failed (fail-open):", e.message); }

  const tier = currentTier(ownedProducts) || "guide";
  const isUncapped = tier === "companion" || tier === "coach" || tier === "mentor" || tier === "concierge";
  if (isUncapped) return json(200, { ok: true, charged: 0, reason: "uncapped_tier" });

  // Respect free_access_mode - when everything is open, no cap to charge.
  try {
    const { data: fa } = await supabase.from("app_settings").select("value").eq("key", "free_access_mode").maybeSingle();
    if (fa && String(fa.value).toLowerCase() === "true") return json(200, { ok: true, charged: 0, reason: "free_access_mode" });
  } catch (e) {}

  // Find the active cap row for riley_chat / reset_free so we charge the right period.
  const prods = ownedProducts.length ? ownedProducts : ["reset_free"];
  const before = await getRemaining(supabase, user.id, "riley_chat", prods);
  if (!before) return json(200, { ok: true, charged: 0, reason: "no_cap_row" }); // no cap defined for this user

  // Increment CHECKIN_CHARGE times using the same period / RPC the chat cap uses.
  for (let i = 0; i < CHECKIN_CHARGE; i++) {
    await incrementUsage(supabase, user.id, "riley_chat", before.periodStart).catch(() => {});
  }

  // Read back so the client can update its "remaining" display accurately.
  const after = await getRemaining(supabase, user.id, "riley_chat", prods).catch(() => null);
  const remaining = after ? after.remaining : Math.max(0, before.remaining - CHECKIN_CHARGE);
  return json(200, { ok: true, charged: CHECKIN_CHARGE, remaining });
}

// Exported so the operator admin-account function reuses the exact same erasure.
exports.eraseMemberById = eraseMemberById;

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
      case "get_session":     return await getSession(supabase, body);
      case "save_message":    return await saveMessage(supabase, body);
      case "update_profile":  return await updateProfile(supabase, body);
      case "export_data":     return await exportData(supabase, body);
      case "delete_data":     return await deleteData(supabase, body);
      case "delete_account":  return await deleteAccount(supabase, body);
      case "checkin_charge":  return await checkinCharge(supabase, body);
      default:                return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error("auth-handler error:", err.message);
    const status = err.message.includes("Invalid") || err.message.includes("expired") ? 401 : 500;
    return json(status, { error: err.message });
  }
};
