/**
 * email-send.js — the SINGLE choke point for every client email.
 *
 * sendClientEmail() sends via Resend AND writes one row to email_log, so all
 * correspondence is captured by construction — no sender can forget to log. Logging is
 * best-effort and NEVER blocks or breaks a send (a logging failure is swallowed).
 *
 * Metadata only is logged (to, subject, kind, status, provider id / error) — never the
 * email body, matching the operator trust boundary.
 *
 * @param {{to:string, subject?:string, html?:string, text?:string, kind?:string,
 *          userId?:string, from?:string, meta?:object}} m
 * @returns {Promise<{sent:boolean, id:(string|null), status:('sent'|'failed'|'skipped'),
 *                    reason?:string, detail?:string}>}
 */
const { getSupabaseClient } = require("./supabase-client");

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Riley <hello@meetriley.us>";

async function logEmail(row) {
  // Fire-and-forget; a logging error must never affect the caller or the send.
  try {
    const sb = getSupabaseClient();
    await sb.from("email_log").insert(row);
  } catch (_) { /* swallow */ }
}

async function sendClientEmail(m) {
  m = m || {};
  const to = (m.to || "").toString().trim();
  const kind = m.kind || "other";
  const subject = m.subject != null ? String(m.subject) : null;
  const userId = m.userId || null;
  const meta = m.meta && typeof m.meta === "object" ? m.meta : {};
  const from = m.from || process.env.RESEND_FROM || DEFAULT_FROM;
  const base = { user_id: userId, to_email: to.toLowerCase(), kind, subject, provider: "resend" };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    await logEmail({ ...base, status: "skipped", error: "resend_not_configured", meta });
    return { sent: false, id: null, status: "skipped", reason: "resend_not_configured" };
  }
  if (!to) {
    await logEmail({ ...base, status: "skipped", error: "no_recipient", meta });
    return { sent: false, id: null, status: "skipped", reason: "no_recipient" };
  }

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html: m.html, ...(m.text ? { text: m.text } : {}) }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 300); } catch (_) {}
      await logEmail({ ...base, status: "failed", error: `resend_http_${r.status}`, meta: { ...meta, detail } });
      return { sent: false, id: null, status: "failed", reason: `resend_http_${r.status}`, detail };
    }
    const j = await r.json().catch(() => ({}));
    await logEmail({ ...base, status: "sent", provider_id: j.id || null, meta });
    return { sent: true, id: j.id || null, status: "sent" };
  } catch (e) {
    const detail = (e && e.message) || String(e);
    await logEmail({ ...base, status: "failed", error: "resend_error", meta: { ...meta, detail } });
    return { sent: false, id: null, status: "failed", reason: "resend_error", detail };
  }
}

module.exports = { sendClientEmail };
