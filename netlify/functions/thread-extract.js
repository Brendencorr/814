/**
 * thread-extract.js - the Continuity Loop's thread extractor (docs/08 §3b, the "mom test").
 *
 * After a conversation, extract OPEN LOOPS into member_threads: commitments ("going to call my
 * sister"), upcoming events ("interview Thursday"), worries, goals, joys. Each thread carries a
 * surface_after date so the check-in's dynamic layer can ask about it at the right moment
 * ("Did the call with your sister happen?").
 *
 * House rules: Haiku via callClaude (utility work, never the chat model), NON-BLOCKING and
 * fail-open - a failure here can never touch a member's reply. Caller (riley-chat) gates on
 * RHYTHM_ENABLED. Members can ask Riley what she's carrying; deletion on request sets
 * status='deleted' and the thread never resurfaces (08 acceptance #11).
 *
 * Dedup: normalized-text match against the member's existing open threads - re-mentioning the
 * same commitment reinforces (salience bump) instead of duplicating.
 */
"use strict";
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");
const { emitEvent } = require("./supabase-client");

const KINDS = ["commitment", "event", "worry", "goal", "joy"];

function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }

async function extractThreads(supabase, userId, sessionId, conversation) {
  if (!supabase || !userId || !conversation || conversation.length < 4) return;
  try {
    const { data: existing } = await supabase.from("member_threads")
      .select("id,text,salience,status").eq("user_id", userId).in("status", ["open", "deleted"]).limit(60);
    const byText = new Map();
    (existing || []).forEach((t) => byText.set(norm(t.text), t));

    const transcript = conversation.slice(-10)
      .map((m) => `${m.role === "user" ? "Person" : "Riley"}: ${m.content}`).join("\n");
    const todayStr = new Date().toISOString().slice(0, 10);

    const sys = `You extract OPEN LOOPS from a wellness conversation - things Riley should carry for this person and gently follow up on later. Today is ${todayStr}.
Return ONLY a JSON array (possibly empty). Each item:
{"kind": one of [commitment, event, worry, goal, joy], "text": "short natural phrase in their words ('the call with her sister', 'his interview at the plant')", "salience": 1-3, "surface_after": "YYYY-MM-DD or omit"}.
- commitment: something THEY said they would do ("going to call my sister") - surface_after = the day after it should have happened, or tomorrow if undated.
- event: a dated upcoming thing (interview, hearing, anniversary dinner) - surface_after = the day after the event.
- worry: something weighing on them worth checking on in a few days.
- goal: something they're working toward.
- joy: a bright spot worth asking about again.
Resolve relative dates ("Thursday", "next week") against today. Only REAL loops from THIS conversation - never invent, never extract crisis content, never diagnose. Empty array is a fine answer.`;

    const result = await callClaude({
      system: sys,
      messages: [{ role: "user", content: "Conversation:\n\n" + transcript + "\n\nExtract the open loops as JSON." }],
      max_tokens: 600, model: MODELS.utility, functionName: "thread-extract", userId, supabase,
    });
    let items = [];
    try {
      const m = String(result.text || "").match(/\[[\s\S]*\]/);
      items = m ? JSON.parse(m[0]) : [];
    } catch (_) { return; }
    if (!Array.isArray(items) || !items.length) return;

    const rows = [];
    for (const it of items.slice(0, 6)) {
      if (!it || KINDS.indexOf(it.kind) < 0) continue;
      const text = String(it.text || "").trim().slice(0, 300);
      if (!text) continue;
      const prior = byText.get(norm(text));
      if (prior) {
        // Deleted-on-request threads NEVER come back; re-mentioned open ones gain salience.
        if (prior.status === "open") {
          await supabase.from("member_threads").update({ salience: Math.min(5, (prior.salience || 1) + 1) }).eq("id", prior.id);
        }
        continue;
      }
      const sa = /^\d{4}-\d{2}-\d{2}$/.test(String(it.surface_after || "")) ? it.surface_after : null;
      rows.push({
        user_id: userId, kind: it.kind, text,
        salience: Math.min(3, Math.max(1, parseInt(it.salience, 10) || 1)),
        surface_after: sa, source_conversation: sessionId || null,
      });
    }
    if (rows.length) {
      await supabase.from("member_threads").insert(rows);
      emitEvent(supabase, userId, "thread_extracted", { count: rows.length });
    }
  } catch (e) {
    console.warn("thread-extract failed (non-fatal):", e.message);
  }
}

module.exports = { extractThreads };
