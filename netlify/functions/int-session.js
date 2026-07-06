/**
 * int-session.js — the interactive Riley-led session ENGINE (data-driven, content-agnostic).
 *
 * Runs ANY of the four interactive programs from `int_sessions` rows — no program logic is hardcoded
 * here; content is data (doc 00 §3 session loop OPEN/LEARN/WORK/COMMIT/CONFIRM). Entitlement-gated:
 * a member reaches a program only if they OWN it (Coach includes all four via the entitlement view;
 * Guide/Companion via a direct purchase). Ownership reuses resolveAccess so there is ONE truth,
 * identical to program-content.js / entitlements.js.
 *
 * Actions (POST { action, token, ... }):
 *   state        { program_key }                          -> enrollment + map + artifacts + open commitment
 *   enroll       { program_key, cadence_pref?, nudge_channels? } -> create/fetch enrollment, returns state
 *   session      { program_key, session_number }          -> one session's content + prior commitment (OPEN)
 *   save_artifact{ program_key, session_number, name, body } -> upsert a WORK artifact (versioned)
 *   commit       { program_key, session_number, text, due_at } -> write commitment + close/advance session
 *   confirm      { commitment_id, confirmed_state, note } -> Done/Partly/Not-yet (any answer closes the loop)
 *   pin_artifact { artifact_id, pinned }                  -> toggle the "My Tools" shelf
 *
 * Sessions unlock sequentially (the work builds) but completed ones are always revisitable (doc 00 §3).
 * Model: n/a
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

const MAX_SESSION = 14;
const CONFIRM_STATES = ["done", "partly", "not_yet"];

// Ownership + tier, consistent with program-content.js / entitlements.js (single source of truth).
async function resolveAccess(sb, userId, programKey) {
  let admin = false, freeAccess = false;
  try { const { data: p } = await sb.from("user_profiles").select("is_admin").eq("id", userId).maybeSingle(); admin = !!(p && p.is_admin === true); } catch (_) {}
  try { const { data: fa } = await sb.from("app_settings").select("value").eq("key", "free_access_mode").maybeSingle(); freeAccess = !!(fa && String(fa.value).toLowerCase() === "true"); } catch (_) {}

  const owned = new Set();
  try { const { data: rows } = await sb.from("user_active_products").select("product_key").eq("user_id", userId); (rows || []).forEach((r) => owned.add(r.product_key)); } catch (_) {}
  try {
    const { data: subs } = await sb.from("subscriptions").select("plan_id, expires_at").eq("user_id", userId).eq("status", "active");
    const now = Date.now();
    (subs || []).forEach((s) => { const live = !s.expires_at || new Date(s.expires_at).getTime() > now; if (live && ["companion", "coach", "mentor"].includes(s.plan_id)) owned.add(s.plan_id); });
  } catch (_) {}

  let tier = (owned.has("coach") || owned.has("mentor")) ? "coach" : owned.has("companion") ? "companion" : "guide";
  if (admin || freeAccess) tier = "coach";
  const owns = admin || freeAccess || owned.has(programKey);
  return { owns, tier };
}

// Fetch (do not create) this user's enrollment for a program.
async function getEnrollment(sb, userId, programKey) {
  const { data } = await sb.from("int_enrollments").select("*").eq("user_id", userId).eq("program_key", programKey).maybeSingle();
  return data || null;
}

// The full client-side state: enrollment, per-session completion, artifacts, the latest open commitment.
async function buildState(sb, enr) {
  const [{ data: prog }, { data: arts }, { data: commits }, { data: cat }] = await Promise.all([
    sb.from("int_session_progress").select("session_number, completed_at").eq("enrollment_id", enr.id),
    sb.from("int_artifacts").select("id, session_number, name, body, version, pinned, updated_at").eq("enrollment_id", enr.id).order("updated_at", { ascending: false }),
    sb.from("int_commitments").select("id, session_number, text, due_at, confirmed_state, confirmed_at, note").eq("enrollment_id", enr.id).order("session_number", { ascending: false }),
    // The session catalog (titles/phases only — safe for owners) so the client can render the 14-node map in one call.
    sb.from("int_sessions").select("session_number, phase, title, is_milestone").eq("program_key", enr.program_key).eq("is_active", true).order("session_number", { ascending: true }),
  ]);
  const done = (prog || []).map((p) => p.session_number);
  const openCommit = (commits || []).find((c) => !c.confirmed_state) || null;   // newest unconfirmed
  return {
    enrolled: true,
    enrollment: {
      id: enr.id, program_key: enr.program_key, state: enr.state, lapse_state: enr.lapse_state,
      current_session: enr.current_session, cadence_pref: enr.cadence_pref,
      nudge_channels: enr.nudge_channels || [], graduated_at: enr.graduated_at, started_at: enr.started_at,
    },
    completed: done,
    artifacts: arts || [],
    commitments: commits || [],
    open_commitment: openCommit,
    sessions: cat || [],
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  const action = body.action || "state";

  // ---- confirm + pin resolve ownership through the commitment/artifact -> enrollment -> user chain ----
  if (action === "confirm") {
    const cid = body.commitment_id;
    const st = body.confirmed_state;
    if (!cid || !CONFIRM_STATES.includes(st)) return json(400, { error: "commitment_id + confirmed_state(done|partly|not_yet) required" });
    const { data: c } = await sb.from("int_commitments").select("id, enrollment_id").eq("id", cid).maybeSingle();
    if (!c) return json(404, { error: "no-commitment" });
    const { data: enr } = await sb.from("int_enrollments").select("id, user_id, program_key, lapse_state").eq("id", c.enrollment_id).maybeSingle();
    if (!enr || enr.user_id !== userId) return json(403, { error: "not-owned" });
    await sb.from("int_commitments").update({ confirmed_state: st, confirmed_at: new Date().toISOString(), note: (body.note || "").slice(0, 2000) || null }).eq("id", cid);
    // Resume-not-restart: confirming a commitment on Staying Free is re-engagement → clear an armed lapse.
    if (enr.program_key === "prog_int_staying_free" && enr.lapse_state === "lapse_active") {
      await sb.from("int_enrollments").update({ lapse_state: null, updated_at: new Date().toISOString() }).eq("id", enr.id);
    }
    return json(200, { ok: true });
  }

  if (action === "pin_artifact") {
    const aid = body.artifact_id;
    if (!aid) return json(400, { error: "artifact_id required" });
    const { data: a } = await sb.from("int_artifacts").select("id, enrollment_id").eq("id", aid).maybeSingle();
    if (!a) return json(404, { error: "no-artifact" });
    const { data: enr } = await sb.from("int_enrollments").select("id, user_id").eq("id", a.enrollment_id).maybeSingle();
    if (!enr || enr.user_id !== userId) return json(403, { error: "not-owned" });
    await sb.from("int_artifacts").update({ pinned: body.pinned !== false }).eq("id", aid);
    return json(200, { ok: true });
  }

  // ---- all remaining actions are program-scoped; verify ownership of the program ----
  const programKey = body.program_key;
  if (!programKey) return json(400, { error: "program_key required" });
  const access = await resolveAccess(sb, userId, programKey);
  if (!access.owns) return json(403, { error: "not-owned" });

  // Program display name for the client header/intro (single fetch, reused by every response below).
  let programName = programKey;
  try { const { data: pr } = await sb.from("products").select("display_name").eq("product_key", programKey).maybeSingle(); if (pr && pr.display_name) programName = pr.display_name; } catch (_) {}

  if (action === "enroll") {
    let enr = await getEnrollment(sb, userId, programKey);
    if (!enr) {
      const defaultCadence = programKey === "prog_int_grief" ? "weekly" : "twice_weekly";   // grief pacing (doc 02 §Session Zero)
      const insert = {
        user_id: userId, program_key: programKey,
        cadence_pref: ["twice_weekly", "weekly"].includes(body.cadence_pref) ? body.cadence_pref : defaultCadence,
        nudge_channels: Array.isArray(body.nudge_channels) ? body.nudge_channels.filter((c) => ["popup", "push", "email"].includes(c)) : [],
        state: "active", current_session: 0,
      };
      const { data: created, error } = await sb.from("int_enrollments").insert(insert).select("*").single();
      if (error) return json(500, { error: "enroll-failed", detail: error.message });
      enr = created;
    } else if (body.cadence_pref || body.nudge_channels) {
      // allow updating preferences on re-enroll
      const patch = {};
      if (["twice_weekly", "weekly"].includes(body.cadence_pref)) patch.cadence_pref = body.cadence_pref;
      if (Array.isArray(body.nudge_channels)) patch.nudge_channels = body.nudge_channels.filter((c) => ["popup", "push", "email"].includes(c));
      if (Object.keys(patch).length) { patch.updated_at = new Date().toISOString(); await sb.from("int_enrollments").update(patch).eq("id", enr.id); Object.assign(enr, patch); }
    }
    const state = await buildState(sb, enr);
    return json(200, { ...state, tier: access.tier, program_name: programName });
  }

  if (action === "session") {
    const enr = await getEnrollment(sb, userId, programKey);
    if (!enr) return json(409, { error: "not-enrolled" });
    const n = parseInt(body.session_number, 10);
    if (isNaN(n) || n < 0 || n > MAX_SESSION) return json(400, { error: "session_number 0..14 required" });
    if (n > (enr.current_session || 0)) return json(423, { error: "locked", note: "Finish the prior session first — the work builds." });

    const { data: s } = await sb.from("int_sessions")
      .select("session_number, phase, title, open_template, learn_body, work_spec, commit_options, is_milestone")
      .eq("program_key", programKey).eq("session_number", n).eq("is_active", true).maybeSingle();
    if (!s) return json(404, { error: "no-content", note: "This session isn't authored yet." });

    // OPEN context: the prior session's commitment + its confirm state, so Riley opens from memory.
    let priorCommit = null;
    if (n > 0) {
      const { data: pc } = await sb.from("int_commitments").select("id, session_number, text, due_at, confirmed_state, note")
        .eq("enrollment_id", enr.id).lt("session_number", n).order("session_number", { ascending: false }).limit(1).maybeSingle();
      priorCommit = pc || null;
    }
    const { data: doneRow } = await sb.from("int_session_progress").select("completed_at").eq("enrollment_id", enr.id).eq("session_number", n).maybeSingle();

    return json(200, {
      session: s, enrollment_id: enr.id, prior_commitment: priorCommit,
      completed_at: doneRow ? doneRow.completed_at : null, tier: access.tier, program_name: programName,
    });
  }

  if (action === "save_artifact") {
    const enr = await getEnrollment(sb, userId, programKey);
    if (!enr) return json(409, { error: "not-enrolled" });
    const n = parseInt(body.session_number, 10);
    const name = (body.name || "").trim();
    if (!name) return json(400, { error: "name required" });
    // Version: if an artifact with this name exists for this enrollment, bump version + overwrite body.
    const { data: existing } = await sb.from("int_artifacts").select("id, version").eq("enrollment_id", enr.id).eq("name", name).order("version", { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      await sb.from("int_artifacts").update({ body: body.body || "", version: (existing.version || 1) + 1, session_number: isNaN(n) ? null : n, updated_at: new Date().toISOString() }).eq("id", existing.id);
      return json(200, { ok: true, artifact_id: existing.id });
    }
    const { data: created, error } = await sb.from("int_artifacts").insert({ enrollment_id: enr.id, session_number: isNaN(n) ? null : n, name, body: body.body || "" }).select("id").single();
    if (error) return json(500, { error: "artifact-failed", detail: error.message });
    return json(200, { ok: true, artifact_id: created.id });
  }

  if (action === "commit") {
    const enr = await getEnrollment(sb, userId, programKey);
    if (!enr) return json(409, { error: "not-enrolled" });
    const n = parseInt(body.session_number, 10);
    if (isNaN(n) || n < 0 || n > MAX_SESSION) return json(400, { error: "session_number 0..14 required" });
    const text = (body.text || "").trim();
    if (!text) return json(400, { error: "commitment text required" });
    let dueAt = null;
    if (body.due_at) { const d = new Date(body.due_at); if (!isNaN(d.getTime())) dueAt = d.toISOString(); }

    // Write the commitment (implementation intention).
    await sb.from("int_commitments").insert({ enrollment_id: enr.id, session_number: n, text: text.slice(0, 2000), due_at: dueAt });
    // Close the session (COMMIT set => complete) and advance the unlock pointer.
    await sb.from("int_session_progress").upsert({ enrollment_id: enr.id, session_number: n, completed_at: new Date().toISOString() }, { onConflict: "enrollment_id,session_number" });
    const next = Math.min(MAX_SESSION, Math.max(enr.current_session || 0, n + 1));
    const patch = { current_session: next, updated_at: new Date().toISOString() };
    if (n >= MAX_SESSION) { patch.state = "maintenance"; patch.graduated_at = new Date().toISOString(); }
    // Resume-not-restart (doc 05 §5 exit): a new commitment on Staying Free clears an armed lapse —
    // the member is moving forward again, so nudges resume and the tone flag lifts.
    if (enr.program_key === "prog_int_staying_free" && enr.lapse_state === "lapse_active") patch.lapse_state = null;
    await sb.from("int_enrollments").update(patch).eq("id", enr.id);
    return json(200, { ok: true, current_session: next, graduated: n >= MAX_SESSION });
  }

  // Default: state (also used to check ownership + resume).
  const enr = await getEnrollment(sb, userId, programKey);
  if (!enr) return json(200, { enrolled: false, owns: true, tier: access.tier, program_name: programName });
  const state = await buildState(sb, enr);
  return json(200, { ...state, tier: access.tier, program_name: programName });
};
