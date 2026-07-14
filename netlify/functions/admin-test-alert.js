/**
 * admin-test-alert.js - operator-gated end-to-end test of the alert pipeline.
 *
 * GET /.netlify/functions/admin-test-alert   (requires the operator key)
 *   Fires BOTH:
 *     1. a test OPERATOR email (notifyOperator) - the signup / cancel / refund channel, and
 *     2. a test CRISIS/safety alert (sendOperatorAlert, anonymous TEST payload - no real member data),
 *   to the resolved operator address, then returns the send results + that address.
 *
 * Use this any time to PROVE the alert emails are wired and deliverable - so a silent failure of
 * "am I getting signup / cancel / refund / crisis emails?" can be checked in one click, not discovered weeks later.
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { notifyOperator, OPERATOR_EMAIL } = require("./operator-email");
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
  const stamp = new Date().toISOString();

  // 1. Operator alert (the signup / cancel / refund channel).
  let operator_alert;
  try {
    operator_alert = await notifyOperator({
      event: "test",
      subject: "Test - operator alert pipeline",
      lines: [
        ["Test", "This is a test operator alert"],
        ["Fired at", stamp],
        ["Confirms", "Signup / cancel / refund emails will reach this inbox"],
      ],
    });
  } catch (e) { operator_alert = { sent: false, status: "failed", reason: String((e && e.message) || e) }; }

  // 2. Crisis/safety alert (anonymous TEST payload - never touches real member data).
  let safety_alert;
  try {
    safety_alert = await sendOperatorAlert(sb, {
      userId: null,
      anon: { anonId: "pipeline-test", ipHash: "pipeline-test" },
      level: 3,
      matches: ["pipeline-test"],
      excerpt: "This is a TEST crisis alert - please ignore.",
      source: "admin-test-alert",
    });
  } catch (e) { safety_alert = { ok: false, reason: String((e && e.message) || e) }; }

  const resend_configured = !!process.env.RESEND_API_KEY;
  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      recipient: OPERATOR_EMAIL,
      resend_configured,
      operator_alert,
      safety_alert,
      note: resend_configured
        ? `Two test emails were sent to ${OPERATOR_EMAIL}. If they don't arrive, the mailbox or its DNS/deliverability needs attention.`
        : "RESEND_API_KEY is not set in Netlify env - no email could be sent.",
    }),
  };
};
