/**
 * email-welcome.js — welcome email for operator-added members.
 *
 * RESEND-READY, but intentionally dormant until configured: with no RESEND_API_KEY
 * set it no-ops and returns { sent:false, reason:'resend_not_configured' }, so the
 * "email the member" toggle in the operator dashboard is wired end-to-end NOW and
 * starts sending the moment the key is dropped into Netlify env — no code change.
 *
 * When RESEND_API_KEY is present it POSTs to the Resend API and returns
 * { sent:true, id }. Always non-fatal: the caller (admin-create-user) must never
 * block member creation on the email.
 *
 * Env:
 *   RESEND_API_KEY  — Resend API key (set this to go live)
 *   RESEND_FROM     — optional From header (default 'Riley <hello@meetriley.us>')
 */
const { sendClientEmail } = require("./email-send");
const LOGIN_URL = "https://login.meetriley.us";

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function welcomeHtml(first) {
  // Google-only sign-in: the CTA tells them to use THIS email with Google.
  return `<!DOCTYPE html><html><body style="margin:0;background:#0a0908;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:40px 28px;color:#f5f0e8">
    <div style="font-size:30px;margin-bottom:8px">🐦</div>
    <div style="font-family:Georgia,serif;font-size:26px;line-height:1.35;color:#f5f0e8;margin-bottom:14px">You're in, ${esc(first)}.</div>
    <div style="font-size:15px;line-height:1.7;color:#cfc9bf">
      I'm Riley — really glad you're here. Your space is ready whenever you are.
      There's no rush, and nothing you have to figure out first. We'll build this together.
    </div>
    <div style="margin:28px 0">
      <a href="${LOGIN_URL}" style="display:inline-block;background:#c9a84c;color:#0a0908;font-weight:600;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:8px">Open Riley</a>
    </div>
    <div style="font-size:13px;line-height:1.65;color:#8a8578">
      Sign in with <b style="color:#cfc9bf">Google</b> using this email address, and you'll land right in your space.
    </div>
    <div style="margin-top:30px;font-size:12px;color:#6b655c">With you — Riley · meetriley.us</div>
  </div></body></html>`;
}

/**
 * @param {{email:string, name?:string, tier?:string}} member
 * @returns {Promise<{sent:boolean, id?:string, reason?:string, detail?:string}>}
 */
async function sendWelcomeEmail(member) {
  const email = (member && member.email || "").trim();
  const first = ((member && member.name) || "").split(" ")[0] || "there";
  return sendClientEmail({
    to: email,
    subject: "You're in — welcome to Riley",
    html: welcomeHtml(first),
    kind: "welcome",
    userId: (member && member.userId) || null,
    meta: { tier: (member && member.tier) || null },
  });
}

module.exports = { sendWelcomeEmail };
