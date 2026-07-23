/**
 * style-learn.js - auto-learned communication style (memory/recall upgrade #2).
 *
 * A quiet Haiku observer that infers HOW each member likes to be talked to - reply length,
 * directness vs gentleness, humor, faith/spiritual language, emoji tolerance, when they're
 * sharpest - and writes one short prose line to user_profiles.communication_style, which the
 * daily brief, riley-brain, and member docs already read (and riley-chat now injects).
 *
 * Guardrails:
 *   • NEVER clobbers a member-set style: if communication_style is non-null and we have no
 *     record of ever writing it (events name 'style_learned'), the member/dashboard set it -
 *     it is theirs, we do not touch it.
 *   • Rate-limited to once per 14 days per member (events-based, no schema change).
 *   • Only runs on conversations deep enough to carry signal (>= 12 messages).
 *   • Haiku, non-blocking, fail-open - can never touch the member's reply. Style describes
 *     HOW they communicate, never WHAT they said (no content, no diagnosis, no mood).
 */
'use strict';

const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");
const { emitEvent } = require("./supabase-client");

const MIN_MESSAGES = 12;
const RELEARN_DAYS = 14;

async function maybeLearnStyle(supabase, userId, conversation) {
  if (!supabase || !userId || !Array.isArray(conversation) || conversation.length < MIN_MESSAGES) return;
  try {
    const sinceISO = new Date(Date.now() - RELEARN_DAYS * 86400000).toISOString();
    const [{ data: recent }, { data: ever }, { data: prof }] = await Promise.all([
      supabase.from("events").select("id").eq("user_id", userId).eq("name", "style_learned").gte("created_at", sinceISO).limit(1),
      supabase.from("events").select("id").eq("user_id", userId).eq("name", "style_learned").limit(1),
      supabase.from("user_profiles").select("communication_style").eq("id", userId).maybeSingle(),
    ]);
    if (recent && recent.length) return;                                   // learned recently
    const memberSet = prof && prof.communication_style && !(ever && ever.length);
    if (memberSet) return;                                                 // theirs - never touch

    const userLines = conversation.filter((m) => m.role === "user").slice(-14)
      .map((m) => String(m.content || "").slice(0, 400));
    if (userLines.length < 5) return;

    const sys = `You observe HOW a person communicates in a wellness chat - never WHAT they share. From their messages below, write ONE plain line (max 160 chars) a companion could follow to match their style. Consider ONLY: preferred reply length (short/long), directness vs gentleness, humor, emoji use, formality, faith or spiritual language (only if THEY use it), and any stated preferences ("keep it short", "don't sugarcoat"). Use plain hyphens, never em-dashes.
Return ONLY JSON: {"style": "the line" or null}. Return null unless the evidence is clear and consistent - when in doubt, null. NEVER include topics, feelings, diagnoses, or anything they talked about - style only.`;

    let raw;
    try {
      const r = await callClaude({ system: sys, messages: [{ role: "user", content: userLines.join("\n---\n") }], max_tokens: 120, model: MODELS.memory, functionName: "style-learn", userId, supabase });
      raw = r.text || "";
    } catch (_) { return; }
    raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    let out; try { out = JSON.parse(raw); } catch { return; }
    const style = out && typeof out.style === "string" ? out.style.trim().replace(/—|–/g, "-").slice(0, 160) : null;
    if (!style || style.length < 12) return;

    await supabase.from("user_profiles").update({ communication_style: style }).eq("id", userId);
    emitEvent(supabase, userId, "style_learned", { chars: style.length });
  } catch (e) { console.warn("style-learn failed (non-fatal):", e.message); }
}

module.exports = { maybeLearnStyle };
