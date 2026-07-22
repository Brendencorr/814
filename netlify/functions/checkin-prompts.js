/**
 * checkin-prompts.js - the living check-in's dynamic layer (docs/08 §3b-§4 · docs/07 §2c).
 *
 * FIXED SPINE, PERSONAL SKIN: the scored fields (mood, energy, sleep, heaviness, toggles, flags)
 * live in the client and NEVER change semantics. This endpoint supplies everything AROUND them:
 * tier-aware framing, up to TWO unscored dynamic items (due threads > hard dates > goal pulse),
 * and the R2+ return sequence. Template-bank v1 (07 §2c defensibility constraint): every string
 * comes from the static, Sentinel-safe bank below with memory slots - no free generation - and
 * every render is reproducible from the stored checkin_prompts row (framing + dynamic_items act
 * as the checkin_context).
 *
 * DARK: with RHYTHM_ENABLED unset this returns { enabled:false } and the client keeps its exact
 * static copy. Dynamic answers are context, never scores: nothing here writes to daily_checkins'
 * scored columns or user_daily_state - the 08 §3b data-integrity guardrail, enforced by shape.
 *
 * POST { action, token, ... }:
 *   'get'    {}                                 → { enabled, tier, checkin, framing, dynamic_items, return_sequence? }
 *   'answer' { answers:{ thread_id?, item_source?, answer?, skipped? } [] ,
 *              gap_summary?, gap_note?, goal_fork? }                     → { ok }
 *   'delete_thread' { thread_id }               → { ok }   ("let that one go" - never resurfaces)
 */
"use strict";
const { getSupabaseClient, getUserIdFromToken, emitEvent, memberDay } = require("./supabase-client");
const { returnTier, appDayGap, tierBehavior } = require("./rhythm");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const ENABLED = () => String(process.env.RHYTHM_ENABLED || "").toLowerCase() === "true";

// ── Template bank v1 (static, Sentinel-safe by construction; ids stored for reproducibility). ──
// No gap arithmetic anywhere; "stretch" framing covers R2+ without counting days (Never-Say).
const FRAMING = {
  standard: { id: "fr_standard_v1", intro: "Quick check-in - about 20 seconds, all of it optional." },
  stretch: { id: "fr_stretch_v1", intro: "Good to see you. For the check-in, just think about the last stretch overall - one answer covers it." },
  condensed: { id: "fr_condensed_v1", intro: "Good to see you. Short version today - we'll pick the rest back up as we go." },
  micro: { id: "fr_micro_v1", intro: "Welcome back. Three small questions, nothing else - everything's where you left it." },
};
const THREAD_Q = {
  commitment: { id: "dq_commit_v1", t: (x) => "Did " + x + " happen?" },
  event: { id: "dq_event_v1", t: (x) => "How did " + x + " go?" },
  worry: { id: "dq_worry_v1", t: (x) => "You mentioned " + x + " - how's it sitting today?" },
  goal: { id: "dq_goal_v1", t: (x) => "Still working toward " + x + " - is it still serving you?" },
  joy: { id: "dq_joy_v1", t: (x) => "How's " + x + " these days?" },
};
const HARDDATE_Q = { id: "dq_harddate_v1", t: (label) => (label ? label + " is close. How are you holding it this week?" : "A date you told me matters is close. How are you holding it this week?") };
const RETURN_SEQUENCE = [
  { id: "rs_1_v1", step: "gap_summary", text: "Good to see you. How have the last few days been?", options: ["rough", "mixed", "okay", "good"], optional_note: true },
  { id: "rs_2_v1", step: "anything", text: "Anything I should know?", free_text: true, skippable: true },
  { id: "rs_3_v1", step: "goal_fork", text: "Those goals from last time - keep going, adjust, or start something new?", options: ["keep", "adjust", "fresh"] },
];

// Nearest occurrence of an annual date within [-1, +2] days of today (mirrors int-proactive math).
function hardDateNear(dateStr, recurrence, todayYmd) {
  const [y, m, d] = String(dateStr).split("-").map((n) => parseInt(n, 10));
  const t = Date.parse(todayYmd);
  const offs = [];
  if (recurrence === "annual") {
    const cy = new Date(t).getUTCFullYear();
    for (const yr of [cy - 1, cy, cy + 1]) offs.push(Math.round((Date.UTC(yr, m - 1, d) - t) / 86400000));
  } else offs.push(Math.round((Date.UTC(y, m - 1, d) - t) / 86400000));
  return offs.some((o) => o >= -1 && o <= 2);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if (!ENABLED()) return json(200, { enabled: false });

  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });
  const action = body.action || "get";

  try {
    const { data: prof } = await sb.from("user_profiles")
      .select("timezone,last_active_at,fuel_opt_out").eq("id", userId).maybeSingle();
    const tz = (prof && prof.timezone) || null;
    const appDay = memberDay(tz);

    if (action === "delete_thread") {
      if (!body.thread_id) return json(400, { error: "thread_id required" });
      await sb.from("member_threads").update({ status: "deleted", closed_at: new Date().toISOString() })
        .eq("id", body.thread_id).eq("user_id", userId);
      return json(200, { ok: true });
    }

    if (action === "answer") {
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, 4) : [];
      for (const a of answers) {
        if (a && a.thread_id) {
          if (a.skipped) {
            emitEvent(sb, userId, "dynamic_item_skipped", { source: a.item_source || "thread" });
          } else {
            // Any real answer closes the loop (v1: commitments/events close; the answer itself
            // lives in checkin_prompts.answered - context, never a score).
            await sb.from("member_threads").update({ status: "closed", closed_at: new Date().toISOString() })
              .eq("id", a.thread_id).eq("user_id", userId).eq("status", "open");
            emitEvent(sb, userId, "dynamic_item_answered", { source: a.item_source || "thread" });
            emitEvent(sb, userId, "thread_closed", {});
          }
        } else if (a) {
          emitEvent(sb, userId, a.skipped ? "dynamic_item_skipped" : "dynamic_item_answered", { source: a.item_source || "context" });
        }
      }
      await sb.from("checkin_prompts").update({ answered: { answers, at: new Date().toISOString() } })
        .eq("user_id", userId).eq("app_day", appDay);

      // Return-sequence extras. Gap answers create CONTEXT, never scores (08 §3b guardrail):
      // gap_summaries only - no daily_checkins, no user_daily_state, ever, from this path.
      if (body.gap_summary && ["rough", "mixed", "okay", "good"].indexOf(body.gap_summary) >= 0) {
        const lastYmd = prof && prof.last_active_at ? memberDay(tz, prof.last_active_at) : null;
        const gapDays = lastYmd ? appDayGap(appDay, lastYmd) : null;
        await sb.from("gap_summaries").upsert(
          { user_id: userId, returned_on: appDay, gap_days: gapDays, summary: body.gap_summary, note: (body.gap_note || "").slice(0, 500) || null },
          { onConflict: "user_id,returned_on" });
        emitEvent(sb, userId, "gap_summary_logged", { summary: body.gap_summary });
      }
      if (body.gap_note && String(body.gap_note).trim()) {
        // "Anything I should know?" - written to durable memory in their own words.
        try {
          await sb.from("riley_memory").insert({
            user_id: userId, content: String(body.gap_note).trim().slice(0, 500),
            memory_type: "long_term", source: "explicit", is_active: true,
          });
        } catch (_) {}
      }
      if (body.goal_fork && ["keep", "adjust", "fresh"].indexOf(body.goal_fork) >= 0) {
        emitEvent(sb, userId, "goals_forked", { choice: body.goal_fork });
      }
      return json(200, { ok: true });
    }

    // ── action === 'get' ──
    // Reproducibility: an already-rendered day returns the stored row verbatim (07 §2c).
    const { data: stored } = await sb.from("checkin_prompts").select("framing,dynamic_items")
      .eq("user_id", userId).eq("app_day", appDay).maybeSingle();
    const lastYmd = prof && prof.last_active_at ? memberDay(tz, prof.last_active_at) : null;
    const gap = lastYmd ? appDayGap(appDay, lastYmd) : null;
    const tier = gap == null ? "R0" : returnTier(gap);
    const beh = tierBehavior(tier);
    if (stored) {
      return json(200, {
        enabled: true, tier, checkin: beh.checkin, framing: stored.framing,
        dynamic_items: stored.dynamic_items || [],
        return_sequence: (tier === "R2" || tier === "R3" || tier === "R4") ? RETURN_SEQUENCE : null,
      });
    }

    // Compose today's layer: framing + up to TWO dynamic items (due threads > hard dates > goal pulse).
    const framing = FRAMING[beh.reframe === "stretch" ? "stretch" : beh.checkin] || FRAMING.standard;
    const items = [];
    // 1) due open threads (skipped threads resurface exactly once: surfaced_count <= 1).
    const { data: due } = await sb.from("member_threads")
      .select("id,kind,text,salience,surfaced_count")
      .eq("user_id", userId).eq("status", "open").lte("surfaced_count", 1)
      .or("surface_after.is.null,surface_after.lte." + appDay)
      .order("salience", { ascending: false }).limit(2);
    for (const th of due || []) {
      if (items.length >= 2) break;
      const q = THREAD_Q[th.kind] || THREAD_Q.worry;
      items.push({ template_id: q.id, source: "thread", thread_id: th.id, text: q.t(th.text) });
      await sb.from("member_threads").update({ surfaced_count: (th.surfaced_count || 0) + 1 }).eq("id", th.id);
      emitEvent(sb, userId, "thread_surfaced", { kind: th.kind });
    }
    // 2) hard-date proximity. OBSERVED REALITY: this repo's hard_dates doubles as the hard-DAY
    // flag store (source 'checkin_tap', one row per flagged day - clarity-v2-write reads those).
    // Only LABELED calendar entries (anniversaries etc.) count here - a hard day last week must
    // never resurface as "a date that matters is close".
    if (items.length < 2) {
      const { data: hds } = await sb.from("hard_dates").select("date,label,recurrence,source")
        .eq("user_id", userId).not("label", "is", null).limit(20);
      const near = (hds || []).find((h) => h.source !== "checkin_tap" && hardDateNear(h.date, h.recurrence || "annual", appDay));
      if (near) items.push({ template_id: HARDDATE_Q.id, source: "harddate", text: HARDDATE_Q.t(near.label) });
    }
    // 3) goal pulse (only when nothing more timely; generic template, no goal internals needed).
    if (items.length === 0 && tier === "R0") {
      // quiet day, nothing due - no dynamic item at all beats a filler question (20-second rule)
    }
    items.forEach((it) => emitEvent(sb, userId, "dynamic_item_shown", { source: it.source }));

    await sb.from("checkin_prompts").upsert(
      { user_id: userId, app_day: appDay, framing, dynamic_items: items },
      { onConflict: "user_id,app_day" });

    return json(200, {
      enabled: true, tier, checkin: beh.checkin, framing, dynamic_items: items,
      return_sequence: (tier === "R2" || tier === "R3" || tier === "R4") ? RETURN_SEQUENCE : null,
    });
  } catch (e) {
    console.error("checkin-prompts:", e.message);
    // The check-in must never block on this layer - the client falls back to static copy.
    return json(200, { enabled: false, error: "degraded" });
  }
};
