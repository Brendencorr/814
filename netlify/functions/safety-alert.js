/**
 * safety-alert.js — Operator crisis notification (safety workflow only)
 *
 * When a Level 2/3 flag fires (riley-chat or checkin-scan), this emails the
 * operator a copy of the client info + recent conversation so a human can
 * follow up. This IS the safety workflow the Trust architecture §1.4 carves
 * out — it is the ONLY place crisis content leaves the system, and it goes to
 * one controlled address (SAFETY_ALERT_EMAIL), never to analytics or marketing.
 *
 * Config (Netlify env):
 *   SAFETY_ALERT_EMAIL — where alerts go (the operator's inbox). Required.
 *   RESEND_API_KEY     — email provider. Required to actually send.
 *   SAFETY_ALERT_FROM  — optional From (defaults to Riley <riley@meetriley.us>).
 *
 * If either required var is missing, it logs who WOULD be alerted and returns
 * cleanly — never throws, never blocks the member's crisis response.
 *
 * Export: sendOperatorAlert(supabase, { userId, level, matches, excerpt, source })
 */

const { soberDaysForMember } = require("./supabase-client");
const FROM_EMAIL = process.env.SAFETY_ALERT_FROM || process.env.REENGAGEMENT_FROM || "Riley <riley@meetriley.us>";
const LEVEL_LABEL = { 2: "Relapse risk (Level 2)", 3: "ACTIVE CRISIS / self-harm risk (Level 3)" };

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendOperatorAlert(supabase, opts) {
  const { userId, level, matches, excerpt, source } = opts || {};
  const to = process.env.SAFETY_ALERT_EMAIL;
  const key = process.env.RESEND_API_KEY;

  if (!to || !key) {
    console.log(`[safety-alert] would alert operator — level ${level}, user ${userId}, source ${source} (SAFETY_ALERT_EMAIL/RESEND_API_KEY not set)`);
    return { skipped: true };
  }
  if (!supabase || !userId) return { skipped: true };

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
      `Email: ${p.email || "—"}`,
      soberDays != null ? `Sobriety: ${soberDays} days` : null,
      `Last active: ${p.last_active_at ? new Date(p.last_active_at).toISOString() : "—"}`,
      `Flagged via: ${source || "—"}`,
      `What triggered it: ${(excerpt || "").slice(0, 400)}`,
      `Detected by rules: ${Array.isArray(matches) ? matches.join(" · ") : "—"}`,
    ].filter(Boolean);

    const convoText = convo.length
      ? convo.map(m => `${m.role === "user" ? name : "Riley"}: ${m.content}`).join("\n")
      : "(no recent Riley conversation on file)";

    const text =
`${urgent ? "⚠ URGENT — " : ""}Safety flag: ${label}

${infoLines.join("\n")}

— Recent conversation —
${convoText}

This is a safety notification for follow-up only. It contains sensitive personal
information — handle confidentially and do not forward. Open the operator
dashboard → Safety to mark this handled.`;

    const convoHtml = convo.length
      ? convo.map(m => `<div style="margin:0 0 8px"><b style="color:${m.role === "user" ? "#7a2e2e" : "#3a7c56"}">${m.role === "user" ? esc(name) : "Riley"}:</b> ${esc(m.content)}</div>`).join("")
      : "<div style='color:#888'>(no recent Riley conversation on file)</div>";

    const html =
`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a;line-height:1.6;font-size:14px">
  <div style="background:${urgent ? "#7a2e2e" : "#8a6d2f"};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:700;font-size:15px">${urgent ? "⚠ URGENT — " : ""}Safety flag: ${esc(label)}</div>
  <div style="border:1px solid #e3ddd4;border-top:none;border-radius:0 0 8px 8px;padding:18px">
    <table style="font-size:13.5px;border-collapse:collapse;margin-bottom:14px">
      <tr><td style="color:#888;padding:2px 12px 2px 0">Client</td><td>${esc(name)}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0">Email</td><td>${esc(p.email || "—")}</td></tr>
      ${soberDays != null ? `<tr><td style="color:#888;padding:2px 12px 2px 0">Sobriety</td><td>${soberDays} days</td></tr>` : ""}
      <tr><td style="color:#888;padding:2px 12px 2px 0">Flagged via</td><td>${esc(source || "—")}</td></tr>
      <tr><td style="color:#888;padding:2px 12px 2px 0;vertical-align:top">Triggered by</td><td>${esc((excerpt || "").slice(0, 400))}</td></tr>
    </table>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:14px 0 8px">Recent conversation</div>
    <div style="background:#faf8f4;border:1px solid #eee;border-radius:6px;padding:12px;font-size:13px">${convoHtml}</div>
    <div style="color:#999;font-size:11.5px;margin-top:16px">Safety notification for follow-up only. Sensitive — handle confidentially, do not forward. Mark handled in the operator dashboard → Safety.</div>
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
          subject: `${urgent ? "⚠ URGENT " : ""}Safety flag — ${name} (${label})`,
          html, text,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) { console.warn("[safety-alert] Resend", resp.status, (await resp.text()).slice(0, 160)); return { ok: false }; }
      return { ok: true };
    } finally { clearTimeout(timer); }
  } catch (e) {
    console.warn("[safety-alert] failed (non-fatal):", e.message);
    return { ok: false };
  }
}

module.exports = { sendOperatorAlert };
