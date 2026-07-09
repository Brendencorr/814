/**
 * post-hoc-crisis-scan.js — safety BACKSTOP (Master Build Spec §7.3).
 *
 * Nightly, STANDARD Haiku (NEVER batched — its purpose is speed-to-operator; the safety
 * layer is never optimized for cost). It re-reads the last day of member messages that the
 * deterministic detector did NOT flag, and asks a model whether any indirect / metaphorical /
 * misspelled phrasing MIGHT be crisis language a keyword rule could miss.
 *
 * It NEVER blocks, alters, delays, or substitutes the deterministic path — that already ran
 * live. Flags land in a review queue (system_incidents kind='possible_missed_crisis', operator-
 * only, service-role). Confirmed misses become new deterministic rules + new crisis test cases.
 *
 * Crisis conversations already handled live are excluded (they're in crisis_log). Gated.
 * Schedule: netlify.toml [functions."post-hoc-crisis-scan"] = "0 8 * * *" (~1am MT).
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const { detectCrisis } = require("./crisis-detection");
const { detectSlipDisclosure } = require("./lapse-detection");
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");

const crypto = require("crypto");
const hashId = (id) => { try { return crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 16); } catch (_) { return null; } };
const ok = (body) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, ...body }) });

const SYS = `You are a SAFETY BACKSTOP for a recovery/wellness app. A deterministic keyword detector ALREADY ran on these member messages and did NOT flag them. Your ONLY job is to catch language that MIGHT indicate an active crisis a keyword rule could miss: suicidal ideation, self-harm, or imminent danger — expressed indirectly, metaphorically, with slang, or misspelled.
Flag when genuinely ambiguous toward risk. Do NOT flag ordinary sadness, stress, grief, venting, or normal recovery talk. Precision matters — this goes to a human, not the member.
Return ONLY a JSON array (possibly empty) of {"i": <index number>, "reason": "<=8 words"}. Nothing else.`;

exports.handler = async function (event) {
  const gate = requireScheduledOrOperator(event); if (gate) return gate;

  let supabase;
  try { supabase = getSupabaseClient(); } catch (_) { return { statusCode: 500, body: "config" }; }

  const since = new Date(Date.now() - 26 * 3600 * 1000).toISOString(); // last day + margin
  let msgs = [];
  try {
    const { data } = await supabase.from("riley_conversations")
      .select("id,user_id,session_id,content,created_at")
      .eq("role", "user").gte("created_at", since).order("created_at", { ascending: false }).limit(500);
    msgs = data || [];
  } catch (e) { return ok({ scanned: 0, flagged: 0, error: "read" }); }

  // Only messages the deterministic path did NOT already catch (those were handled live).
  const candidates = msgs.filter((m) => {
    const t = (m.content || "").trim();
    if (!t) return false;
    try { return detectCrisis(t).level === 0 && !detectSlipDisclosure(t).isSlip; } catch (_) { return false; }
  }).slice(0, 120);

  if (!candidates.length) return ok({ scanned: 0, flagged: 0 });

  const numbered = candidates.map((m, i) => `${i}. ${String(m.content).replace(/\s+/g, " ").slice(0, 240)}`).join("\n");

  let raw;
  try {
    const r = await callClaude({ system: SYS, messages: [{ role: "user", content: numbered }], max_tokens: 500, model: MODELS.classify, functionName: "post-hoc-crisis-scan", supabase });
    raw = r.text || "[]";
  } catch (_) { return ok({ scanned: candidates.length, flagged: 0, error: "classify" }); }

  raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = raw.indexOf("["), b = raw.lastIndexOf("]");
  if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
  let flags; try { flags = JSON.parse(raw); } catch (_) { return ok({ scanned: candidates.length, flagged: 0, error: "parse" }); }
  if (!Array.isArray(flags) || !flags.length) return ok({ scanned: candidates.length, flagged: 0 });

  let written = 0;
  for (const f of flags.slice(0, 30)) {
    const m = candidates[f && f.i];
    if (!m) continue;
    try {
      await supabase.from("system_incidents").insert({
        kind: "possible_missed_crisis",
        function_name: "post-hoc-crisis-scan",
        detail: {
          user_hash: hashId(m.user_id),
          session_id: m.session_id || null,
          excerpt: String(m.content).slice(0, 300),
          reason: String((f && f.reason) || "").slice(0, 80),
          message_at: m.created_at,
        },
      });
      written++;
    } catch (_) {}
  }

  console.log(`[post-hoc-crisis-scan] scanned=${candidates.length} flagged=${written}`);
  return ok({ scanned: candidates.length, flagged: written });
};
