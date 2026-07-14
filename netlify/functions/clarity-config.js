/**
 * clarity-config.js — Clarity v2.2 customization endpoint (§10, member-facing).
 *
 * Members choose which Practice dims count toward their score + whether nourishment
 * (fuel) is tracked. This is the config the v2 engine reads. Guards per spec:
 *   • max 1 change / 7 days — EXCEPT changes made during onboarding (origin:'onboarding')
 *   • a normal change applies NEXT app-day (4am rollover); onboarding applies immediately
 *   • config_version bumps when a change takes effect (so state rows are attributable)
 *
 * POST JSON { token, action:'get'|'save', config?, origin?, today?, onboarding_stage? }
 * Identity comes ONLY from the verified token (service key bypasses RLS).
 */
'use strict';

const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");
const { validateConfig, effectiveConfig, nextAppDay } = require("./clarity-config-util");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (statusCode, data) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) });
const DAY_MS = 86400000;

async function loadRow(sb, userId) {
  try { const { data } = await sb.from("user_clarity_config").select("*").eq("user_id", userId).maybeSingle(); return data || null; }
  catch (e) { return null; }
}

// A.3: sobriety-lane removal-with-grace. Fire the event + drop a LOW-severity FYI into the operator
// safety queue (visible context, NOT an alert email, NOT a crisis classification). Never blocks.
async function noteSobrietyLaneDisabled(sb, userId) {
  try { emitEvent(sb, userId, "sobriety_lane_disabled", {}); } catch (_) {}
  try {
    await sb.from("crisis_log").insert({
      user_id: userId, session_id: "clarity-config", level: 0,
      matched_rules: ["sobriety_lane_disabled"],
      message_excerpt: "[FYI] Member turned off the sobriety focus lane in Clarity. Not a crisis - context for awareness. Riley left the door open ('if you ever want it back, just say the word').",
      is_test: false, resolved: false,
    });
  } catch (_) {}
}

// Lazily promote a due pending change to live (keeps reads honest without a cron).
async function promoteIfDue(sb, userId, row, today) {
  const eff = effectiveConfig(row, today);
  if (eff.promotePending) {
    try {
      await sb.from("user_clarity_config").update({
        config: row.pending_config, config_version: eff.version,
        pending_config: null, pending_apply_on: null,
      }).eq("user_id", userId);
    } catch (e) {}
    row = Object.assign({}, row, { config: row.pending_config, config_version: eff.version, pending_config: null, pending_apply_on: null });
  }
  return row;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  let sb;
  try { sb = getSupabaseClient(); } catch (e) { return json(500, { error: "Server configuration error" }); }

  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  const action = body.action || "get";

  // ── GET: current config + any staged change + onboarding stage ──
  if (action === "get") {
    let row = await loadRow(sb, userId);
    if (row) row = await promoteIfDue(sb, userId, row, today);
    const cfg = (row && row.config) || { enabled_practice: [], fuel_opt_out: false };
    return json(200, {
      config: cfg,
      config_version: (row && row.config_version) || 1,
      onboarding_stage: (row && row.onboarding_stage) || 0,
      pending: row && row.pending_config ? { config: row.pending_config, apply_on: row.pending_apply_on } : null,
    });
  }

  // ── SEEN: record an onboarding-stage advance (modal dismissed / opened) without
  //    touching config. Monotonic - never lowers the stage. ──
  if (action === "seen") {
    const row = await loadRow(sb, userId);
    const want = Number.isInteger(body.onboarding_stage) ? body.onboarding_stage : 1;
    const stage = Math.max((row && row.onboarding_stage) || 0, want);
    try {
      await sb.from("user_clarity_config").upsert({
        user_id: userId, onboarding_stage: stage,
        config: (row && row.config) || { enabled_practice: [], fuel_opt_out: false },
        config_version: (row && row.config_version) || 1,
      }, { onConflict: "user_id" });
    } catch (e) { return json(200, { ok: false, error: e.message }); }
    return json(200, { ok: true, onboarding_stage: stage });
  }

  // ── SAVE: validate, rate-limit (7d, onboarding-exempt), stage or apply ──
  if (action === "save") {
    const config = validateConfig(body.config);
    const onboarding = body.origin === "onboarding";
    let row = await loadRow(sb, userId);
    if (row) row = await promoteIfDue(sb, userId, row, today);
    // A.3: detect a sobriety-lane disable (was on -> now explicitly off) for grace handling below.
    const _prevLanes = (row && row.config && row.config.lanes) || {};
    const _sobrietyLaneDisabled = (_prevLanes.sobriety !== false) && !!(config.lanes && config.lanes.sobriety === false);

    // 1 change / 7 days — onboarding-origin bypasses.
    if (!onboarding && row && row.last_changed_at) {
      const since = Date.now() - Date.parse(row.last_changed_at);
      if (isFinite(since) && since < 7 * DAY_MS) {
        const nextAllowed = new Date(Date.parse(row.last_changed_at) + 7 * DAY_MS).toISOString().slice(0, 10);
        return json(200, { ok: false, reason: "rate_limited", next_allowed: nextAllowed, config: (row && row.config) || config });
      }
    }

    const nowISO = new Date().toISOString();
    const stage = Math.max((row && row.onboarding_stage) || 0, Number.isInteger(body.onboarding_stage) ? body.onboarding_stage : 0);

    if (onboarding) {
      // Applies immediately (first-run setup): config live now, version bumps.
      const upsert = {
        user_id: userId, config, config_version: ((row && row.config_version) || 1) + (row ? 1 : 0),
        pending_config: null, pending_apply_on: null, last_changed_at: nowISO, onboarding_stage: stage,
      };
      try { await sb.from("user_clarity_config").upsert(upsert, { onConflict: "user_id" }); }
      catch (e) { return json(500, { error: "save failed: " + e.message }); }
      // §12 + §10 events: config took effect now; onboarding completed (custom vs defaults).
      try {
        emitEvent(sb, userId, "clarity_config_changed", { config_version: upsert.config_version, applied: "now", origin: "onboarding" });
        emitEvent(sb, userId, "clarity_customize_completed", { mode: (config.enabled_practice && config.enabled_practice.length === 3 && !config.fuel_opt_out) ? "defaults" : "custom" });
      } catch (e) {}
      if (_sobrietyLaneDisabled) await noteSobrietyLaneDisabled(sb, userId);
      return json(200, { ok: true, applied: "now", config, config_version: upsert.config_version, onboarding_stage: stage });
    }

    // Normal change: stage for next app-day; current config stays live until then.
    const applyOn = nextAppDay(today);
    const upsert = {
      user_id: userId, config: (row && row.config) || { enabled_practice: [], fuel_opt_out: false },
      config_version: (row && row.config_version) || 1,
      pending_config: config, pending_apply_on: applyOn, last_changed_at: nowISO, onboarding_stage: stage,
    };
    try { await sb.from("user_clarity_config").upsert(upsert, { onConflict: "user_id" }); }
    catch (e) { return json(500, { error: "save failed: " + e.message }); }
    try { emitEvent(sb, userId, "clarity_config_changed", { applied: applyOn, origin: "update" }); } catch (e) {}
    if (_sobrietyLaneDisabled) await noteSobrietyLaneDisabled(sb, userId);
    return json(200, { ok: true, applied: applyOn, pending: config, onboarding_stage: stage });
  }

  return json(400, { error: "Unknown action" });
};
