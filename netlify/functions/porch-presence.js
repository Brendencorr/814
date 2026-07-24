/**
 * porch-presence.js - Porch Lights LEVEL 1 (experience roadmap 2026-07-24). View-only.
 *
 * Two actions, both token-verified:
 *   heartbeat - counts the member as "on the porch" (rolling 24h). Lane = their focus lane.
 *               Server throttle: the row updates at most once / 10 min. Opt-out members
 *               (user_profiles.porch_opt_out) are never written and any old row is removed.
 *   counts    - AGGREGATE-ONLY numbers for the dashboard card. This endpoint structurally
 *               cannot return a member id: it selects only lane+seen_at and returns integers.
 *
 * PRIVACY LAWS (non-negotiable, enforced server-side):
 *   - Per-lane counts below 12 are NEVER returned (folded into the total).
 *   - Total below 12 -> { light: true } only ("The porch light is on tonight." - always true).
 *   - A member in a recent crisis window gets total-only (lane labels drop; presence IS the care).
 * Levels 2-5 deliberately unsupported: no join, no posts, nothing here presupposes them.
 */
'use strict';

const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (s, b) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(b) });
const MIN_LANE = 12;          // minimum-count rule: never display a per-lane count below this
const WINDOW_H = 24;
const THROTTLE_MIN = 10;

// Lane copy (Riley's voice; sentence case; no urgency). 'other' reads as starting over.
const LANE_COPY = {
  grief:    (n) => `${n} people are sitting with grief.`,
  sobriety: (n) => `${n} people are working on staying free.`,
  body:     (n) => `${n} people are rebuilding their health.`,
  other:    (n) => `${n} are starting over.`,
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  let sb; try { sb = getSupabaseClient(); } catch { return json(500, { error: "config" }); }
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  const action = body.action || "counts";

  if (action === "heartbeat") {
    try {
      const { data: prof } = await sb.from("user_profiles").select("porch_opt_out,focus_lane").eq("id", userId).maybeSingle();
      if (prof && prof.porch_opt_out === true) {
        await sb.from("porch_presence").delete().eq("user_id", userId);   // opt-out excludes immediately
        return json(200, { ok: true, counted: false });
      }
      const lane = ["grief", "sobriety", "body"].includes(prof && prof.focus_lane) ? prof.focus_lane : "other";
      const { data: row } = await sb.from("porch_presence").select("seen_at").eq("user_id", userId).maybeSingle();
      if (!row || Date.now() - Date.parse(row.seen_at) > THROTTLE_MIN * 60000) {
        await sb.from("porch_presence").upsert({ user_id: userId, lane, seen_at: new Date().toISOString() }, { onConflict: "user_id" });
      }
      return json(200, { ok: true, counted: true });
    } catch (e) { return json(200, { ok: false }); }
  }

  // counts - aggregate only. Never identities, at any level of the stack.
  try {
    const since = new Date(Date.now() - WINDOW_H * 3600000).toISOString();
    const { data: rows } = await sb.from("porch_presence").select("lane,seen_at").gte("seen_at", since).limit(20000);
    const total = (rows || []).length;

    // Crisis mode for THIS viewer: card stays, lane labels drop.
    let crisis = false;
    try {
      const { data: cr } = await sb.from("crisis_log").select("id").eq("user_id", userId)
        .gte("level", 2).eq("is_test", false).gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()).limit(1);
      crisis = !!(cr && cr.length);
    } catch (_) { crisis = true; }  // fail-safe: uncertain -> quieter card

    if (total < MIN_LANE) return json(200, { light: true, lines: ["The porch light is on tonight."], closing: "You don't have to say anything to be here." });

    const lines = [`${total} porch lights are on tonight.`];
    if (!crisis) {
      const byLane = {};
      (rows || []).forEach((r) => { const l = LANE_COPY[r.lane] ? r.lane : "other"; byLane[l] = (byLane[l] || 0) + 1; });
      const laneLines = Object.keys(byLane).filter((l) => byLane[l] >= MIN_LANE).map((l) => LANE_COPY[l](byLane[l]));
      if (laneLines.length) lines.push(...laneLines.slice(0, 3));
      else lines.push("You're not the only one here.");
    }
    return json(200, { light: true, lines, closing: "You don't have to say anything to be here." });
  } catch (e) {
    return json(200, { light: true, lines: ["The porch light is on tonight."], closing: "You don't have to say anything to be here." });
  }
};
