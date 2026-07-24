/**
 * touch-governor.js - ONE gate for every proactive touch, across EVERY channel
 * (founder call 2026-07-24: "every client should have only 1 gate").
 *
 * The email side already had this (email-send.js governCappedSend: member-local daily cap +
 * 7-day crisis suppression at the single email choke point). The hole was PUSH: rhythm and
 * reset nudges neither consulted that ledger nor counted toward it, so a member could get an
 * email and a push the same afternoon. This module closes the loop:
 *
 *   • One shared LEDGER: email touches live in email_events (written by email-send.js);
 *     push touches are recorded here as events name 'proactive_touch'. Both sides read both.
 *   • MEMBER-CHOSEN touches (daily brief, Reset program steps, crisis check-ins) always
 *     deliver - but they are COUNTED, so they claim the member's day.
 *   • DISCRETIONARY touches (rhythm nudges + the capped email categories) are limited to
 *     ONE per member per member-local day (4am rollover) across both channels.
 *   • Hard-date CARE touches bypass the daily cap (showing up on the day that matters is
 *     the product's promise - founder rule) but never bypass crisis suppression, and are
 *     still recorded.
 *   • Crisis suppression is FAIL-SAFE (an error suppresses); the cap check is FAIL-OPEN
 *     (an error degrades to each sender's own pacing, exactly what shipped before).
 */
'use strict';

const { memberDay, emitEvent } = require("./supabase-client");

const DAY = 86400000;
const CRISIS_WINDOW_DAYS = 7;
// Email categories that claim the member's day (brief included: it's counted, never blocked).
const COUNTED_EMAIL_CATEGORIES = ["lifecycle", "reengagement", "program_nudge", "brief"];

/** Any counted touch (either channel) already in the member's local day? Fail-open. */
async function touchedToday(sb, userId, tz) {
  const win = new Date(Date.now() - 2 * DAY).toISOString(); // 48h covers every tz offset
  const today = memberDay(tz);
  try {
    const { data: evs, error } = await sb.from("email_events").select("sent_at")
      .eq("user_id", userId).in("category", COUNTED_EMAIL_CATEGORIES).eq("status", "sent")
      .gte("sent_at", win).limit(20);
    if (!error && (evs || []).some((e) => memberDay(tz, e.sent_at) === today)) return true;
  } catch (_) {}
  try {
    const { data: pts, error } = await sb.from("events").select("created_at")
      .eq("user_id", userId).eq("name", "proactive_touch").gte("created_at", win).limit(20);
    if (!error && (pts || []).some((e) => memberDay(tz, e.created_at) === today)) return true;
  } catch (_) {}
  return false;
}

/**
 * Gate a DISCRETIONARY proactive touch. Returns null (clear to send) or a reason string.
 * opts.careTouch: hard-date care touch - bypasses the daily cap, never the crisis check.
 */
async function governProactiveTouch(sb, userId, opts) {
  opts = opts || {};
  if (!sb || !userId) return "no_identity";

  // 1. Crisis suppression - fail-SAFE, no touch type bypasses it (crisis-followup-cron
  //    owns that member's outreach).
  try {
    const since = new Date(Date.now() - CRISIS_WINDOW_DAYS * DAY).toISOString();
    const { data, error } = await sb.from("crisis_log").select("id")
      .eq("user_id", userId).gte("level", 2).eq("is_test", false)
      .gte("created_at", since).limit(1);
    if (error) return "crisis_check_error";
    if (data && data.length) return "crisis_window";
  } catch (_) { return "crisis_check_error"; }

  if (opts.careTouch) return null; // care touches skip the cap (still recorded by the sender)

  // 2. One touch per member-local day, across email AND push. Fail-open.
  try {
    let tz = null;
    try {
      const { data: prof } = await sb.from("user_profiles").select("timezone").eq("id", userId).maybeSingle();
      tz = (prof && prof.timezone) || null;
    } catch (_) {}
    if (await touchedToday(sb, userId, tz)) return "daily_cap";
  } catch (_) {}

  return null;
}

/** Record a push-channel touch in the shared ledger. Fire-and-forget. */
function recordProactiveTouch(sb, userId, source, channel) {
  try { emitEvent(sb, userId, "proactive_touch", { source, channel: channel || "push" }); } catch (_) {}
}

module.exports = { governProactiveTouch, recordProactiveTouch, touchedToday, COUNTED_EMAIL_CATEGORIES };
