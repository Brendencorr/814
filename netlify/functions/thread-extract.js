/**
 * thread-extract.js — the continuity loop's first arrow (docs/08 §3b, "the mom test").
 * After every conversation, extract open loops into member_threads: commitments, upcoming
 * events, worries, goals, joys. Runs on the utility model (Haiku, fail-open) beside
 * extractMemories - a bad extraction can never break a member's reply. Members can ask
 * Riley what she's carrying and delete any thread ("let that one go").
 */
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");
const { emitEvent } = require("./supabase-client");

const SYS = `Extract OPEN LOOPS from this conversation between a member and Riley - things a caring friend would remember to ask about later.
Return ONLY a JSON array (max 4), each: {"kind":"commitment|event|worry|goal|joy","text":"<short, member's own words, no names of third parties beyond first names>","salience":1-5,"surface_after":"YYYY-MM-DD or null"}.
- commitment: something the member said they would do ("going to call my sister")
- event: something coming up with a date ("interview Thursday") - set surface_after to the day after it
- worry / goal / joy: what they're carrying, working toward, or lit up about
Only clear, member-stated items. Nothing clinical. Nothing inferred about third parties. [] if nothing qualifies.`;

async function extractThreads(supabase, userId, conversation, conversationId) {
  try {
    if (!supabase || !userId || !Array.isArray(conversation) || conversation.length < 2) return;
    const transcript = conversation.slice(-16).map((m) => `${m.role === "user" ? "Member" : "Riley"}: ${m.content}`).join("\n").slice(0, 8000);
    const r = await callClaude({
      system: SYS, messages: [{ role: "user", content: transcript }],
      max_tokens: 400, model: MODELS.memory, functionName: "thread-extract", userId, supabase,
    });
    let raw = (r && r.text) || "[]";
    const s = raw.indexOf("["), e = raw.lastIndexOf("]");
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
    let items = [];
    try { items = JSON.parse(raw); } catch (_) { return; }
    if (!Array.isArray(items) || !items.length) return;
    const KINDS = new Set(["commitment", "event", "worry", "goal", "joy"]);
    const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = items
      .filter((t) => t && KINDS.has(t.kind) && t.text && String(t.text).length <= 200)
      .slice(0, 4)
      .map((t) => ({
        user_id: userId, kind: t.kind, text: String(t.text).slice(0, 200),
        salience: Math.min(5, Math.max(1, Number(t.salience) || 3)),
        surface_after: /^\d{4}-\d{2}-\d{2}$/.test(t.surface_after || "") ? t.surface_after : today,
        source_conversation: conversationId || null,
      }));
    if (!rows.length) return;
    await supabase.from("member_threads").insert(rows);
    rows.forEach(() => emitEvent(supabase, userId, "thread_extracted", {}));
  } catch (e) { console.warn("thread-extract failed (non-fatal):", e.message); }
}

module.exports = { extractThreads };
