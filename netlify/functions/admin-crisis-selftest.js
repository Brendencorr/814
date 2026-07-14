/**
 * admin-crisis-selftest.js - operator-gated 4-step verification of the crisis pipeline (v2.3 Batch 0.1).
 *
 * GET /.netlify/functions/admin-crisis-selftest   (requires the operator key)
 * Runs a SYNTHETIC Level-3 message end to end and reports pass/fail for each step:
 *   1. deterministic pre-LLM detection fires (detectCrisis -> level 3)
 *   2. the 988 crisis response is available to return to the member (LEVEL3_RESPONSE contains "988")
 *   3. the event writes to the crisis_log queue - marked is_test=true (excluded from the real queue + analytics)
 *   4. the operator alert email sends via the logged Resend path (sendOperatorAlert)
 * No real member is touched. Use this to prove the crisis pipeline is intact after any change.
 *
 * NOTE: the nightly-backstop-scan seed check (post-hoc-crisis-scan) is not yet wired in here - flagged
 * in V2.3_BUILD_LOG.md as a refinement.
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { detectCrisis, LEVEL3_RESPONSE } = require("./crisis-detection");
const { sendOperatorAlert } = require("./safety-alert");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireOperator(event); if (gate) return gate;
  const sb = getSupabaseClient();
  const steps = {};

  // 1. deterministic detection
  const SYNTH = "this is a crisis pipeline self-test - I don't want to be here anymore";
  const det = detectCrisis(SYNTH);
  steps.detection = { ok: det.level === 3, detail: `level ${det.level}, matched ${(det.matches || []).length} rule(s)` };

  // 2. the 988 response the member would receive
  const has988 = typeof LEVEL3_RESPONSE === "string" && LEVEL3_RESPONSE.indexOf("988") >= 0;
  steps.response_988 = { ok: has988, detail: has988 ? "LEVEL3_RESPONSE returns 988" : "988 response missing" };

  // 3. queue write (is_test -> hidden from the real queue)
  let logId = null;
  try {
    const { data, error } = await sb.from("crisis_log").insert({
      user_id: null, session_id: "crisis-selftest", level: 3, matched_rules: det.matches || [],
      message_excerpt: "[SELFTEST] crisis pipeline verification", is_test: true,
    }).select("id").maybeSingle();
    if (error) throw error;
    logId = data && data.id;
    steps.queue_write = { ok: !!logId, detail: logId ? "written to crisis_log (is_test=true)" : "no row id returned" };
  } catch (e) { steps.queue_write = { ok: false, detail: String((e && e.message) || e) }; }

  // 4. operator alert (through the real safety-alert path)
  try {
    const alert = await sendOperatorAlert(sb, {
      userId: null, anon: { anonId: "crisis-selftest", ipHash: "selftest" }, level: 3,
      matches: det.matches || [], excerpt: "[SELFTEST] crisis pipeline verification - please ignore",
      source: "admin-crisis-selftest",
    });
    steps.operator_alert = { ok: !!(alert && (alert.ok || alert.status === "sent")), detail: JSON.stringify(alert) };
  } catch (e) { steps.operator_alert = { ok: false, detail: String((e && e.message) || e) }; }

  const allOk = Object.values(steps).every(s => s.ok);
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: allOk, steps, test_log_id: logId, resend_configured: !!process.env.RESEND_API_KEY,
      note: "Synthetic crisis (no real member). The crisis_log row is is_test=true (hidden from the real queue). If any step is false, that stage of the crisis pipeline needs attention.",
    }),
  };
};
