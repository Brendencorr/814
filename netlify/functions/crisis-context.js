/**
 * crisis-context.js - contextual verification for SOFT safety classifications
 * (founder call 2026-07-24, after "reading a book outside" fired a RELAPSE RISK alert).
 *
 * The deterministic regex detectors stay as the TRIGGER - fast, dependable, fail-safe.
 * But Level 1-2 and slip classifications now get judged IN THE CONTEXT OF THE
 * CONVERSATION before they flip Riley's register and page the operator: a quick
 * utility-model check asks "given what was actually being talked about, is this a
 * genuine present-moment risk disclosure, or an idiom / metaphor / recovery-positive
 * statement / story about someone else?"
 *
 * HARD RULES:
 *   • LEVEL 3 IS NEVER GATED. Explicit crisis language gets the deterministic
 *     response instantly - context never delays a lifeline. Callers must not
 *     route Level 3 through here (and verifyRiskInContext refuses if they do).
 *   • FAIL-SAFE: any model error, timeout, or ambiguity CONFIRMS the flag. The
 *     only way an alert is suppressed is an unambiguous "innocuous" verdict.
 *   • Suppressions are still logged (crisis_log level 0, matched_rules prefixed
 *     'suppressed_fp:') so the operator can audit what the gate filtered.
 *   • Latency: this runs ONLY on flagged messages (rare), hard 2.5s timeout.
 */
'use strict';

const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");

/**
 * @param {object} sb supabase (for cost logging; may be null)
 * @param {{text:string, history?:Array<{role:string,content:string}>, kind:string, matches?:string[], userId?:string}} p
 *   kind: 'slip' | 'level2' | 'level1'
 * @returns {Promise<{confirmed:boolean, reason:string}>}
 */
async function verifyRiskInContext(sb, p) {
  p = p || {};
  if (p.kind === "level3") return { confirmed: true, reason: "level3_never_gated" };
  try {
    const recent = (p.history || []).slice(-6)
      .map((m) => `${m.role === "user" ? "Person" : "Riley"}: ${String(m.content || "").slice(0, 400)}`).join("\n");
    const sys = `You review an automated safety flag from a wellness companion. A pattern matcher flagged the person's LAST message as ${p.kind === "slip" ? "a disclosure that they drank/used (a slip)" : "possible relapse risk or acute distress"}. Pattern matchers miss context - idioms ("I used to travel", "losing yourself in a book"), metaphors, stories about other people, recovery-POSITIVE statements, hypotheticals, and quotes all cause false alarms.
Given the conversation, answer ONLY with JSON: {"genuine": true|false, "why": "under 12 words"}.
- genuine=true if the person is plausibly disclosing real present-moment risk, use, or acute struggle - INCLUDING ambiguous cases. When in doubt, true. Err toward care.
- genuine=false ONLY when it is unambiguous that the flagged language is innocuous in context (an idiom, a hobby, someone else's story, a recovery-positive statement).`;
    const user = `CONVERSATION (most recent last):\n${recent || "(no prior context)"}\n\nFLAGGED MESSAGE:\n${String(p.text || "").slice(0, 800)}`;
    const r = await callClaude({ system: sys, messages: [{ role: "user", content: user }], max_tokens: 80, model: MODELS.classify, functionName: "crisis-context-verify", userId: p.userId || null, supabase: sb, timeoutMs: 2500 });
    let raw = String(r.text || "").trim();
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
    const out = JSON.parse(raw);
    if (out && out.genuine === false && typeof out.why === "string") {
      return { confirmed: false, reason: out.why.slice(0, 80) };
    }
    return { confirmed: true, reason: (out && out.why) ? String(out.why).slice(0, 80) : "affirmed" };
  } catch (e) {
    return { confirmed: true, reason: "verify_error_fail_safe" };   // any failure -> the flag stands
  }
}

module.exports = { verifyRiskInContext };
