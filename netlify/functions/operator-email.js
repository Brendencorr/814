/**
 * operator-email.js - the choke point for OPERATOR/ADMIN email alerts (to the founder).
 *
 * Every operator-facing transactional alert - new signup, new paid subscription, cancel,
 * refund, chargeback - goes through notifyOperator() so that:
 *   (a) it ALWAYS has a delivery address, even if no env var is set (hardcoded founder
 *       fallback) - an operator alert must never silently vanish for lack of config; and
 *   (b) it is LOGGED to email_log by construction (via the sendClientEmail choke point),
 *       so "did the alert fire?" is answerable from the operator dashboard.
 *
 * Crisis/safety alerts do NOT use this - they go through safety-alert.js (richer, contains
 * confidential context) - but share this OPERATOR_EMAIL fallback so a crisis alert can never
 * fail for lack of a destination address either.
 *
 * Config (all optional - the hardcoded fallback guarantees delivery):
 *   OPERATOR_ALERT_EMAIL - where operator alerts go. Falls back to SAFETY_ALERT_EMAIL, then the founder inbox.
 *   RESEND_FROM          - optional From (handled by email-send.js).
 */
const { sendClientEmail } = require("./email-send");

// Guaranteed destination: explicit env first, then the founder inbox. NEVER silently drop an operator alert.
const OPERATOR_EMAIL =
  process.env.OPERATOR_ALERT_EMAIL ||
  process.env.SAFETY_ALERT_EMAIL ||
  "brenden@meetriley.us";

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * notifyOperator - email the founder an operator alert, logged in email_log. NEVER throws.
 *
 * @param {{event:string, subject:string, lines?:Array<[string,string]>, url?:string}} opts
 *   event   - short key, becomes email_log.kind = "operator:<event>" (e.g. "signup","cancel","refund")
 *   subject - email subject line
 *   lines   - [label, value] rows rendered as a table
 *   url     - CTA link (defaults to the operator dashboard)
 * @returns {Promise<{sent:boolean,status:string,id?:string,reason?:string}>}
 */
async function notifyOperator(opts) {
  try {
    const o = opts || {};
    const lines = Array.isArray(o.lines) ? o.lines : [];
    const url = o.url || "https://meetriley.us/operator";
    const subject = o.subject || "Operator alert";
    const rows = lines
      .map(l => `<tr><td style="color:#888;padding:2px 14px 2px 0;white-space:nowrap;vertical-align:top">${esc(l[0])}</td><td style="color:#1a1a1a">${esc(l[1])}</td></tr>`)
      .join("");
    const html =
`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.6;font-size:14px">
  <div style="background:#0a0908;color:#c9a84c;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">${esc(subject)}</div>
  <div style="border:1px solid #e3ddd4;border-top:none;border-radius:0 0 8px 8px;padding:18px">
    <table style="font-size:13.5px;border-collapse:collapse;margin-bottom:16px">${rows}</table>
    <a href="${esc(url)}" style="display:inline-block;background:#c9a84c;color:#0a0908;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600;font-size:13px">Open operator dashboard</a>
  </div>
</div>`;
    const text = subject + "\n\n" + lines.map(l => `${l[0]}: ${l[1]}`).join("\n") + "\n\n" + url;
    return await sendClientEmail({
      to: OPERATOR_EMAIL,
      subject,
      html,
      text,
      kind: "operator:" + (o.event || "alert"),
      category: "operator",
      meta: { event: o.event || "alert" },
    });
  } catch (e) {
    try { console.warn("[operator-email] failed (non-fatal):", e && e.message); } catch (_) {}
    return { sent: false, status: "failed", reason: "notify_error" };
  }
}

module.exports = { notifyOperator, OPERATOR_EMAIL };
