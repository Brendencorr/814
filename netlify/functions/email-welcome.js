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
const { shell, p, btn } = require("./comms-templates");
const LOGIN_URL = "https://login.meetriley.us";

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function welcomeHtml(first) {
  // Unified house shell (Ink header + serif). Google-only sign-in: the CTA says use THIS email with Google.
  return shell(
    '<p style="margin:0 0 14px;font-size:22px;line-height:1.3">You\'re in, ' + esc(first) + ".</p>" +
    p("I'm Riley — really glad you're here. Your space is ready whenever you are. There's no rush, and nothing you have to figure out first. We'll build this together.") +
    btn("Open Riley", LOGIN_URL) +
    p('<span style="font-size:13.5px;color:#6b655b">Sign in with <b>Google</b> using this email address, and you\'ll land right in your space.</span>') +
    '<p style="margin:16px 0 0;color:#6b655b">With you — Riley</p>',
    { preview: "Your space is ready whenever you are." }
  );
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
