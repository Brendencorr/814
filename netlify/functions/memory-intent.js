/**
 * memory-intent.js - "forget that" / "remember this" as first-class chat intents (upgrade #5).
 *
 * The member owns the map. When they ask Riley in conversation to forget or remember
 * something, this honors it in the data layer: forget = soft-delete (is_active=false, same
 * mechanic as the Life Map ×), remember = a priority riley_memory row (source
 * 'member_request', confidence 1.0). Riley's prompt carries a standing directive to confirm
 * warmly and never argue - the system side is this module.
 *
 * Regex-gated (near-zero cost on typical messages) → Haiku picks the exact targets from the
 * member's own active memories. Conservative by design: when the target is unclear, it does
 * nothing rather than deleting the wrong thing. Non-blocking, fail-open, like every utility.
 */
'use strict';

const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");
const { emitEvent } = require("./supabase-client");

const INTENT_RE = /\b(forget (that|this|it|about)|don'?t (remember|bring (that|this|it) up)|stop (remembering|bringing (that|this|it) up)|(delete|erase|remove) (that|this|it) (from|memory)|never mention|please remember|remember (this|that)|make sure you remember|don'?t forget)\b/i;

function mentionsMemoryIntent(text) { return INTENT_RE.test(String(text || "")); }

async function maybeHandleMemoryIntent(supabase, userId, conversation) {
  if (!supabase || !userId || !Array.isArray(conversation) || !conversation.length) return;
  try {
    const [memRes, mapRes] = await Promise.all([
      supabase.from("riley_memory").select("id,content").eq("user_id", userId).eq("is_active", true).limit(40),
      supabase.from("life_map").select("id,content,facet").eq("user_id", userId).eq("is_active", true).limit(60),
    ]);
    const mems = memRes.data || [], maps = mapRes.data || [];
    const memList = mems.map((m) => `M:${m.id} :: ${m.content}`).join("\n") || "(none)";
    const mapList = maps.map((m) => `L:${m.id} :: [${m.facet}] ${m.content}`).join("\n") || "(none)";
    const transcript = conversation.slice(-6)
      .map((m) => `${m.role === "user" ? "Person" : "Riley"}: ${String(m.content || "").slice(0, 500)}`).join("\n");

    const sys = `A person is talking to Riley, a wellness companion that keeps gentle long-term memory THEY control. Decide if, in their LAST message(s), they asked Riley to FORGET something it knows, or to REMEMBER something new.
Return ONLY JSON: {"op": "forget"|"remember"|null, "forget_ids": ["M:<id>" or "L:<id>", ...], "remember": "the fact, phrased in third person" or null}.
Rules:
- forget: include ONLY entries from the lists below that CLEARLY match what they asked to forget. If nothing clearly matches, op is null. Never guess - deleting the wrong memory is worse than missing.
- remember: only when they explicitly asked Riley to remember/keep something specific; phrase it as a durable third-person fact ("Her daughter's recital is every spring").
- Rhetorical uses ("forget it, let's move on", "I can't remember") → {"op": null}.
STORED MEMORIES:
${memList}
LIFE MAP:
${mapList}`;

    let raw;
    try {
      const r = await callClaude({ system: sys, messages: [{ role: "user", content: transcript }], max_tokens: 250, model: MODELS.memory, functionName: "memory-intent", userId, supabase });
      raw = r.text || "";
    } catch (_) { return; }
    raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    let out; try { out = JSON.parse(raw); } catch { return; }
    if (!out || !out.op) return;

    if (out.op === "forget" && Array.isArray(out.forget_ids) && out.forget_ids.length) {
      const memIds = [], mapIds = [];
      const memSet = new Set(mems.map((m) => String(m.id))), mapSet = new Set(maps.map((m) => String(m.id)));
      out.forget_ids.slice(0, 6).forEach((t) => {
        const s = String(t || "");
        if (s.startsWith("M:") && memSet.has(s.slice(2))) memIds.push(s.slice(2));
        if (s.startsWith("L:") && mapSet.has(s.slice(2))) mapIds.push(s.slice(2));
      });
      if (memIds.length) await supabase.from("riley_memory").update({ is_active: false }).in("id", memIds).eq("user_id", userId);
      if (mapIds.length) await supabase.from("life_map").update({ is_active: false }).in("id", mapIds).eq("user_id", userId);
      if (memIds.length || mapIds.length) emitEvent(supabase, userId, "memory_forgotten", { memories: memIds.length, map: mapIds.length });
      return;
    }

    if (out.op === "remember" && out.remember && String(out.remember).trim().length >= 5) {
      await supabase.from("riley_memory").insert({
        user_id: userId, memory_type: "long_term", content: String(out.remember).trim().slice(0, 300),
        source: "member_request", confidence: 1.0, is_active: true, status: "active",
        last_confirmed_at: new Date().toISOString(),
      });
      emitEvent(supabase, userId, "memory_requested", {});
    }
  } catch (e) { console.warn("memory-intent failed (non-fatal):", e.message); }
}

module.exports = { mentionsMemoryIntent, maybeHandleMemoryIntent };
