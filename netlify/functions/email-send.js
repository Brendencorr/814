/**
 * email-send.js - the SINGLE choke point for every client email.
 *
 * sendClientEmail() sends via Resend AND writes:
 *   1. one row to email_log   - the operator correspondence record (metadata only, never the body)
 *   2. one row to email_events - the UNIFIED send ledger every governance rule reads (migration 100)
 *
 * ── CATEGORY IS REQUIRED ─────────────────────────────────────────────────────────────────────
 * Every caller must pass m.category, one of:
 *   transactional | crisis | brief | lifecycle | reengagement | program_nudge | operator
 * A missing/unknown category THROWS - a send path that can't say what it is doesn't send.
 *
 * ── GOVERNANCE (enforced HERE so no future caller can forget it) ─────────────────────────────
 * For the CAPPED categories (lifecycle, reengagement, program_nudge), before sending:
 *   1. CRISIS SUPPRESSION: any Level 2/3 crisis_log event (non-test) in the last 7 days for this
 *      member suppresses the send entirely (reason 'crisis_window'). A member in that window must
 *      never receive a pitch or a nudge. Fail-SAFE: if the crisis check itself errors, we suppress
 *      (reason 'crisis_check_error') - a missed nudge is cheaper than a wrong send.
 *   2. GLOBAL DAILY CAP: if ANY capped-category email was already sent to this member today
 *      (member-local day, 4am rollover via memberDay), suppress (reason 'daily_cap').
 * brief, crisis, transactional and operator are EXEMPT from both rules (receipts and crisis
 * check-ins must always send) but are still logged to the unified ledger.
 * Suppressed decisions are logged to email_events (status 'suppressed') with their reason.
 *
 * Logging is best-effort and NEVER blocks or breaks a send (a logging failure is swallowed).
 * Metadata only is logged (to, subject, kind, status, provider id / error) - never the email body.
 *
 * @param {{to:string, category:string, subject?:string, html?:string, text?:string, kind?:string,
 *          userId?:string, from?:string, replyTo?:string, headers?:object, meta?:object}} m
 * @returns {Promise<{sent:boolean, id:(string|null),
 *                    status:('sent'|'failed'|'skipped'|'suppressed'), reason?:string, detail?:string}>}
 */
const { getSupabaseClient, memberDay } = require("./supabase-client");

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// ── Canonical senders (all on meetriley.us). EVERY send path resolves its From here - no other
//    file may hardcode an address. riley@ is both the Riley voice AND the transactional/system
//    default (deliberately riley@, not hello@, so the member's inbox stays one thread, one voice).
//    brenden@ is for founder-authored letters ONLY.
const FROM_ADDRESSES = {
  riley: "Riley <riley@meetriley.us>",
  brenden: "Brenden <brenden@meetriley.us>",
  system: "Riley <riley@meetriley.us>",
};
const DEFAULT_FROM = FROM_ADDRESSES.system;

const CATEGORIES = ["transactional", "crisis", "brief", "lifecycle", "reengagement", "program_nudge", "operator"];
const CAPPED_CATEGORIES = ["lifecycle", "reengagement", "program_nudge"]; // daily-capped + crisis-suppressed
const CRISIS_WINDOW_DAYS = 7;
const DAY = 86400000;

async function logEmail(row) {
  // Fire-and-forget; a logging error must never affect the caller or the send.
  try {
    const sb = getSupabaseClient();
    await sb.from("email_log").insert(row);
  } catch (_) { /* swallow */ }
}

async function logEvent(row) {
  try {
    const sb = getSupabaseClient();
    await sb.from("email_events").insert(row);
  } catch (_) { /* swallow - ledger write must never break a send */ }
}

/**
 * Governance check for capped categories. Returns null (clear to send) or a suppression reason.
 * Only called when userId is present - a capped send without a member identity can't be governed,
 * so capped callers must always pass userId (they all do).
 */
async function governCappedSend(sb, userId) {
  // 1. Crisis suppression - fail-SAFE (an error suppresses; never risk nudging someone in crisis).
  try {
    const since = new Date(Date.now() - CRISIS_WINDOW_DAYS * DAY).toISOString();
    const { data, error } = await sb.from("crisis_log").select("id")
      .eq("user_id", userId).gte("level", 2).eq("is_test", false)
      .gte("created_at", since).limit(1);
    if (error) return "crisis_check_error";
    if (data && data.length) return "crisis_window";
  } catch (_) { return "crisis_check_error"; }

  // 2. Global daily cap across ALL capped categories, in the MEMBER'S local day (4am rollover).
  //    Fail-open: pre-migration (email_events absent) the cap simply doesn't bind - each caller's
  //    own per-channel dedup still applies, so behavior degrades to exactly what ships today.
  try {
    let tz = null;
    try {
      const { data: prof } = await sb.from("user_profiles").select("timezone").eq("id", userId).maybeSingle();
      tz = (prof && prof.timezone) || null;
    } catch (_) {}
    const win = new Date(Date.now() - 2 * DAY).toISOString(); // 48h window covers every tz offset
    const { data: evs, error } = await sb.from("email_events").select("sent_at")
      .eq("user_id", userId).in("category", CAPPED_CATEGORIES).eq("status", "sent")
      .gte("sent_at", win).limit(20);
    if (!error && evs && evs.length) {
      const today = memberDay(tz);
      if (evs.some((e) => memberDay(tz, e.sent_at) === today)) return "daily_cap";
    }
  } catch (_) { /* fail-open on cap check only */ }

  return null;
}

async function sendClientEmail(m) {
  m = m || {};
  const to = (m.to || "").toString().trim();
  const kind = m.kind || "other";
  const category = m.category;
  // FAIL LOUDLY: a send path that doesn't declare its category doesn't get to send.
  if (!category || CATEGORIES.indexOf(category) < 0) {
    throw new Error("sendClientEmail: category is required and must be one of " + CATEGORIES.join("|") + " (got " + JSON.stringify(category) + ")");
  }
  const subject = m.subject != null ? String(m.subject) : null;
  const userId = m.userId || null;
  const meta = m.meta && typeof m.meta === "object" ? m.meta : {};
  const from = m.from || process.env.RESEND_FROM || DEFAULT_FROM;
  const replyTo = m.replyTo || null;
  const extraHeaders = m.headers && typeof m.headers === "object" ? m.headers : null;
  const template = (meta && meta.template_key) || kind;
  const base = { user_id: userId, to_email: to.toLowerCase(), kind, subject, provider: "resend" };
  const evBase = { user_id: userId, to_email: to.toLowerCase(), template, category };

  const sb = getSupabaseClient();

  // ── Governance: daily cap + crisis suppression for capped categories (see header) ──
  if (CAPPED_CATEGORIES.indexOf(category) >= 0 && userId) {
    const reason = await governCappedSend(sb, userId);
    if (reason) {
      await logEvent({ ...evBase, status: "suppressed", reason });
      await logEmail({ ...base, status: "skipped", error: reason, meta });
      return { sent: false, id: null, status: "suppressed", reason };
    }
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    await logEvent({ ...evBase, status: "skipped", reason: "resend_not_configured" });
    await logEmail({ ...base, status: "skipped", error: "resend_not_configured", meta });
    return { sent: false, id: null, status: "skipped", reason: "resend_not_configured" };
  }
  if (!to) {
    await logEvent({ ...evBase, status: "skipped", reason: "no_recipient" });
    await logEmail({ ...base, status: "skipped", error: "no_recipient", meta });
    return { sent: false, id: null, status: "skipped", reason: "no_recipient" };
  }

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html: m.html, ...(m.text ? { text: m.text } : {}), ...(replyTo ? { reply_to: replyTo } : {}), ...(extraHeaders ? { headers: extraHeaders } : {}) }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 300); } catch (_) {}
      await logEvent({ ...evBase, status: "failed", reason: `resend_http_${r.status}` });
      await logEmail({ ...base, status: "failed", error: `resend_http_${r.status}`, meta: { ...meta, detail } });
      return { sent: false, id: null, status: "failed", reason: `resend_http_${r.status}`, detail };
    }
    const j = await r.json().catch(() => ({}));
    await logEvent({ ...evBase, status: "sent", reason: null });
    await logEmail({ ...base, status: "sent", provider_id: j.id || null, meta });
    return { sent: true, id: j.id || null, status: "sent" };
  } catch (e) {
    const detail = (e && e.message) || String(e);
    await logEvent({ ...evBase, status: "failed", reason: "resend_error" });
    await logEmail({ ...base, status: "failed", error: "resend_error", meta: { ...meta, detail } });
    return { sent: false, id: null, status: "failed", reason: "resend_error", detail };
  }
}

module.exports = { sendClientEmail, FROM_ADDRESSES, CATEGORIES, CAPPED_CATEGORIES, CRISIS_WINDOW_DAYS };
