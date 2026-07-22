/**
 * safety-alert.js - Operator crisis notification (safety workflow only)
 *
 * When a Level 2/3 flag fires (riley-chat or checkin-scan), this emails the
 * operator a copy of the client info + recent conversation so a human can
 * follow up. This IS the safety workflow the Trust architecture §1.4 carves
 * out - it is the ONLY place crisis content leaves the system, and it goes to
 * one controlled address, never to analytics or marketing.
 *
 * Recipient (in order): SAFETY_ALERT_EMAIL, then OPERATOR_ALERT_EMAIL, then the
 * founder inbox (operator-email.OPERATOR_EMAIL). A crisis alert must NEVER be
 * silently dropped for lack of a configured address - so there is always one.
 *
 * Every send is logged to email_log (kind='safety_alert', METADATA ONLY - level +
 * source, never the crisis content), so "did the alert fire?" is auditable in the
 * operator dashboard. Logging is best-effort and never blocks the alert.
 *
 * Config (Netlify env):
 *   SAFETY_ALERT_EMAIL / OPERATOR_ALERT_EMAIL - where alerts go (optional; founder fallback).
 *   RESEND_API_KEY     - email provider. Required to actually send.
 *   SAFETY_ALERT_FROM  - optional From (defaults to Riley <riley@meetriley.us>).
 *
 * Export: sendOperatorAlert(supabase, { userId, anon, level, matches, excerpt, source })
 */

const { soberDaysForMember } = require("./supabase-client");
const { OPERATOR_EMAIL } = require("./operator-email");
const { FROM_ADDRESSES } = require("./email-send");
const FROM_EMAIL = process.env.SAFETY_ALERT_FROM || process.env.REENGAGEMENT_FROM || FROM_ADDRESSES.riley;
const LEVEL_LABEL = { 2: "Relapse risk (Level 2)", 3: "ACTIVE CRISIS / self-harm risk (Level 3)" };

// The alert destination. Always resolves to a real address (never null) so a crisis alert
// cannot be skipped for lack of config. Set SAFETY_ALERT_EMAIL to override the founder default.
const ALERT_TO = process.env.SAFETY_ALERT_EMAIL || process.env.OPERATOR_ALERT_EMAIL || OPERATOR_EMAIL;

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Audit row for the operator dashboard. METADATA ONLY - never the crisis excerpt/conversation.
async function logSafetyAlert(supabase, { to, userId, level, source, status, providerId, error }) {
  try {
    if (!supabase) return;
    await supabase.from("email_log").insert({
      user_id: userId || null,
      to_email: String(to || "").toLowerCase(),
      kind: "safety_alert",
      subject: `Safety flag - level ${level}`,
      status,                         // 'sent' | 'failed'
      provider: "resend",
      provider_id: providerId || null,
      error: error || null,
      meta: { level, source: source || null },
    });
  } catch (_) { /* swallow - logging must never affect the alert */ }
}

async function sendOperatorAlert(supabase, opts) {
  const { userId, anon, level, matches, excerpt, source } = opts || {};
  const to = ALERT_TO;
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    // Only reason we can't send: no email provider. Loud console so it surfaces in logs.
    console.error(`[safety-alert] CANNOT SEND crisis alert (RESEND_API_KEY not set) - level ${level}, ${userId ? "user " + userId : "anonymous visitor"}, source ${source}`);
    await logSafetyAlert(supabase, { to, userId, level, source, status: "failed", error: "resend_not_configured" });
    return { skipped: true };
  }
  // H-3: an anonymous visitor has no profile / no stored conversation - send the minimal anon alert.
  if (!userId) {
    if (!anon) return { skipped: true };
    return sendAnonAlert({ supabase, to, key, anon, level, matches, excerpt, source });
  }
  if (!supabase) return { skipped: true };

  try {
    // Client info + recent conversation (the safety context the operator needs).
    const [profRes, convRes] = await Promise.allSettled([
      supabase.from("user_profiles")
        .select("full_name,preferred_name,email,sobriety_date,last_active_at,last_crisis_level")
        .eq("id", userId).maybeSingle(),
      supabase.from("riley_conversations")
        .select("role,content,created_at").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(16),
    ]);

    const p = (profRes.status === "fulfilled" && profRes.value.data) || {};
    const name = p.preferred_name || p.full_name || "Member";
    const soberDays = p.sobriety_date ? soberDaysForMember(p.sobriety_date) : null;
    const convo = ((convRes.status === "fulfilled" && convRes.value.data) || []).slice().reverse();

    const label = LEVEL_LABEL[level] || `Level ${level}`;
    const urgent = level >= 3;

    const infoLines = [
      `Client: ${name}`,
      `Email: ${p.email || "-"}`,
      soberDays != null ? `Sobriety: ${soberDays} days` : null,
      `Last active: ${p.last_active_at ? new Date(p.last_active_at).toISOString() : "-"}`,
      `Flagged via: ${source || "-"}`,
      `What triggered it: ${(excerpt || "").slice(0, 400)}`,
      `Detected by rules: ${Array.isArray(matches) ? matches.join(" · ") : "-"}`,
    ].filter(Boolean);

    const convoText = convo.length
      ? convo.map(m => `${m.role === "user" ? name : "Riley"}: ${m.content}`).join("\n")
      : "(no recent Riley conversation on file)";

    const text =
`${urgent ? "⚠ URGENT - " : ""}Safety flag: ${label}

${infoLines.join("\n")}

- Recent conversation -
${convoText}

This is a safety notification for follow-up only. It contains sensitive personal
information - handle confidentially and do not forward. Open the operator
dashboard → Safety to mark this handled.`;

    const convoHtml = convo.length
      ? convo.map(m => `<div style="margin:0 0 8px"><b style="color:${m.role === "user" ? "#7a2e2e" : "#3a7c56"}">${m.role === "user" ? esc(name) : "Riley"}:</b> ${esc(m.content)}</div>`).join("")
      : "<div style='color:#888'>(no recent Riley conversation on file)</div>";

    const html =
`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a;line-height:1.6;font-size:14px">
  <div style="background:${urgent ? "#7a2e2e" : "#8a6d2f"};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">${urgent ? "⚠ URGENT - " : ""}Safety flag: ${esc(label)}</div>
  <div style="border:1px solid #e3ddd4;border-top:none;border-radius:0 0 8px 8px;padding:18px">
    <table style="font-size:13.5px;border-collapse:collapse;margin-bottom:14px">
      <tr><td style="color:#888;padding:2px 12px 2px 0">Client</td><td>${esc(name)}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0">Email</td><td>${esc(p.email || "-")}</td></tr>
      ${soberDays != null ? `<tr><td style="color:#888;padding:2px 12px 2px 0">Sobriety</td><td>${soberDays} days</td></tr>` : ""}
      <tr><td style="color:#888;padding:2px 12px 2px 0">Flagged via</td><td>${esc(source || "-")}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0;vertical-align:top">Triggered by</td><td>${esc((excerpt || "").slice(0, 400))}</td></tr>
    </table>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:14px 0 8px">Recent conversation</div>
    <div style="background:#faf8f4;border:1px solid #eee;border-radius:6px;padding:12px;font-size:13px">${convoHtml}</div>
    <div style="color:#999;font-size:11.5px;margin-top:16px">Safety notification for follow-up only. Sensitive - handle confidentially, do not forward. Mark handled in the operator dashboard → Safety.</div>
  </div>
</div>`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL, to: [to],
          subject: `${urgent ? "⚠ URGENT " : ""}Safety flag - ${name} (${label})`,
          html, text,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const detail = (await resp.text().catch(() => "")).slice(0, 160);
        console.warn("[safety-alert] Resend", resp.status, detail);
        await logSafetyAlert(supabase, { to, userId, level, source, status: "failed", error: `resend_http_${resp.status}` });
        return { ok: false };
      }
      const jid = await resp.json().then(j => j && j.id).catch(() => null);
      await logSafetyAlert(supabase, { to, userId, level, source, status: "sent", providerId: jid });
      return { ok: true };
    } finally { clearTimeout(timer); }
  } catch (e) {
    console.warn("[safety-alert] failed (non-fatal):", e.message);
    await logSafetyAlert(supabase, { to, userId, level, source, status: "failed", error: "resend_error" });
    return { ok: false };
  }
}

// H-3: anonymous-visitor safety alert. No profile, no stored conversation (anonymous chat is not
// persisted). The operator still gets the excerpt + the anon key so a human is aware a stranger
// hit a crisis and received the 988 response. Never throws.
async function sendAnonAlert({ supabase, to, key, anon, level, matches, excerpt, source }) {
  const label  = LEVEL_LABEL[level] || `Level ${level}`;
  const urgent = level >= 3;
  const anonId = (anon && anon.anonId) || "-";
  const ipHash = (anon && anon.ipHash) || "-";
  const trig   = (excerpt || "").slice(0, 400);
  const rules  = Array.isArray(matches) ? matches.join(" · ") : "-";

  const text =
`${urgent ? "⚠ URGENT - " : ""}Safety flag: ${label} (anonymous visitor)

Client: Anonymous visitor (no account)
Anon key: ${anonId}
IP hash: ${ipHash}
Flagged via: ${source || "-"}
What triggered it: ${trig}
Detected by rules: ${rules}

There is no stored conversation for an anonymous visitor. This person received the
988 crisis response. Safety notification for follow-up awareness only - handle
confidentially, do not forward.`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a;line-height:1.6;font-size:14px">
  <div style="background:${urgent ? "#7a2e2e" : "#8a6d2f"};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">${urgent ? "⚠ URGENT - " : ""}Safety flag: ${esc(label)} (anonymous)</div>
  <div style="border:1px solid #e3ddd4;border-top:none;border-radius:0 0 8px 8px;padding:18px">
    <table style="font-size:13.5px;border-collapse:collapse;margin-bottom:14px">
      <tr><td style="color:#888;padding:2px 12px 2px 0">Client</td><td>Anonymous visitor (no account)</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0">Anon key</td><td>${esc(anonId)}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0">IP hash</td><td>${esc(ipHash)}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0">Flagged via</td><td>${esc(source || "-")}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0;vertical-align:top">Triggered by</td><td>${esc(trig)}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0">Rules</td><td>${esc(rules)}</td></tr>
    </table>
    <div style="color:#999;font-size:11.5px;margin-top:8px">No stored conversation for an anonymous visitor. They received the 988 response. Handle confidentially, do not forward.</div>
  </div>
</div>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL, to: [to],
        subject: `${urgent ? "⚠ URGENT " : ""}Safety flag - Anonymous visitor (${label})`,
        html, text,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => "")).slice(0, 160);
      console.warn("[safety-alert] Resend(anon)", resp.status, detail);
      await logSafetyAlert(supabase, { to, userId: null, level, source, status: "failed", error: `resend_http_${resp.status}` });
      return { ok: false };
    }
    const jid = await resp.json().then(j => j && j.id).catch(() => null);
    await logSafetyAlert(supabase, { to, userId: null, level, source, status: "sent", providerId: jid });
    return { ok: true };
  } catch (e) {
    console.warn("[safety-alert] anon failed (non-fatal):", e.message);
    await logSafetyAlert(supabase, { to, userId: null, level, source, status: "failed", error: "resend_error" });
    return { ok: false };
  } finally { clearTimeout(timer); }
}

module.exports = { sendOperatorAlert };
