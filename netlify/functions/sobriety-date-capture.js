/**
 * sobriety-date-capture.js - ask-once sobriety date capture (founder call 2026-07-23).
 *
 * Members who tell onboarding they're working on sobriety are never asked a date there -
 * Riley asks ONCE in chat, and only when sobriety is already the topic (the prompt
 * directive lives in riley-chat buildUserContext). This util is the capture side: when a
 * sobriety-interest member with no date on file mentions their own sobriety/clean date in
 * conversation (a date, or "90 days today"), a Haiku pass extracts it and saves it to
 * user_profiles.sobriety_date (+ an active sobriety_tracker row so every surface agrees).
 * A decline ("I'd rather not", "I don't count days") is written to riley_memory so the
 * NEVER RE-ASK law covers it forever.
 *
 * House rules honored: Haiku via callClaude (utility model), non-blocking, fail-open -
 * a failure here can never touch the member's reply. The date is only ever written when
 * the column is still null (guarded update), so nothing a member set elsewhere is clobbered.
 */
'use strict';

const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");

// Cheap pre-filter: only spend a Haiku call when the latest user message is plausibly
// about their sobriety. Deliberately broad - Haiku does the real judging.
const SOBRIETY_RE = /\b(sober|sobriety|clean|drink|drank|drinking|relapse|slipped?|recovery|aa\b|na\b|days? (?:free|without))\b/i;

function mentionsSobriety(text) { return SOBRIETY_RE.test(String(text || "")); }

/**
 * Fire-and-forget. `conversation` is the full [{role,content}] history incl. Riley's reply.
 * Does its own light profile fetch so callers don't have to thread profile state through.
 */
async function maybeCaptureSobrietyDate(supabase, userId, conversation) {
  if (!supabase || !userId || !Array.isArray(conversation) || !conversation.length) return;
  try {
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    if (!lastUser || !mentionsSobriety(lastUser.content)) return;

    const { data: prof } = await supabase.from("user_profiles")
      .select("sobriety_date,sobriety_interest,focus_lane,why_here").eq("id", userId).maybeSingle();
    if (!prof || prof.sobriety_date) return; // already on file - nothing to capture
    const sobrietyMember = prof.sobriety_interest === true || prof.focus_lane === "sobriety"
      || /sobriety/i.test(prof.why_here || "");
    if (!sobrietyMember) return;

    // Already declined once? The law says never again - and never re-extract either.
    const { data: declined } = await supabase.from("riley_memory").select("id")
      .eq("user_id", userId).eq("is_active", true)
      .ilike("content", "%rather not share a sobriety date%").limit(1);
    if (declined && declined.length) return;

    const transcript = conversation.slice(-8)
      .map((m) => `${m.role === "user" ? "Person" : "Riley"}: ${m.content}`).join("\n");
    const todayStr = new Date().toISOString().slice(0, 10);
    const sys = `You extract ONE fact from a wellness conversation: the person's own sobriety/clean start date, if they stated it. Today is ${todayStr}.
Return ONLY JSON: {"found": true|false, "date": "YYYY-MM-DD" or null, "declined": true|false}.
- found/date: ONLY if THEY clearly stated their own sobriety or clean date - an explicit date ("sober since March 3rd") or a day count you can resolve against today ("90 days today", "six months sober"). Resolve counts to a calendar date. The date must be in the past.
- declined: true ONLY if they were asked about a sobriety date and clearly deflected or declined ("I'd rather not", "I don't count days", "no date").
- Anything ambiguous, hypothetical, about someone else, or about a FUTURE quit date: {"found": false, "date": null, "declined": false}. When unsure, found is false.`;

    let raw;
    try {
      const r = await callClaude({ system: sys, messages: [{ role: "user", content: transcript }], max_tokens: 120, model: MODELS.memory, functionName: "sobriety-date-capture", userId, supabase });
      raw = r.text || "";
    } catch (_) { return; }
    raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    let out; try { out = JSON.parse(raw); } catch { return; }

    if (out && out.found && /^\d{4}-\d{2}-\d{2}$/.test(String(out.date || "")) && out.date <= todayStr) {
      // Guarded: only fills an EMPTY column - a date set in Settings mid-flight always wins.
      await supabase.from("user_profiles").update({ sobriety_date: out.date })
        .eq("id", userId).is("sobriety_date", null);
      try {
        const { data: tr } = await supabase.from("sobriety_tracker").select("id")
          .eq("user_id", userId).eq("is_active", true).limit(1);
        if (!tr || !tr.length) await supabase.from("sobriety_tracker").insert({ user_id: userId, start_date: out.date, is_active: true });
      } catch (_) {}
      try {
        const { emitEvent } = require("./supabase-client");
        emitEvent(supabase, userId, "sobriety_date_captured", { source: "chat" });
      } catch (_) {}
      return;
    }

    if (out && out.declined) {
      try {
        await supabase.from("riley_memory").insert({
          user_id: userId, memory_type: "preference",
          content: "They'd rather not share a sobriety date - they may not count days, and that is a valid way to do this. NEVER ask about it again. If they ever share a date on their own, it will be saved automatically.",
          source: "conversation", confidence: 1.0, is_active: true, status: "active",
          last_confirmed_at: new Date().toISOString(),
        });
      } catch (_) {}
    }
  } catch (e) { console.warn("sobriety-date-capture failed (non-fatal):", e.message); }
}

module.exports = { maybeCaptureSobrietyDate, mentionsSobriety };
