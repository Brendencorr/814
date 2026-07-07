/**
 * admin-home.js — powers the operator Home dashboard.
 *   GET                       → full analytics blob (admin_home_analytics)
 *   GET ?detail=<kind>&val=.. → drill-down rows (admin_home_detail)
 *
 * detail kinds: total | active | new | logins | messages | page | click
 * (page/click take val=<page|target>; logins/messages accept optional val=MM-DD)
 */
const { getSupabaseClient } = require("./supabase-client");
const { currentTier, stateFromLastActive } = require("./tier-utils"); // shared with admin-engagement

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  // Operator-only. Fail closed: without the secret, never serve member analytics/PII (names, emails).
  const expected = process.env.OPERATOR_KEY;
  if (!expected) return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: "Not configured. Set OPERATOR_KEY." }) };
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Unauthorized" }) };
  try {
    const db = getSupabaseClient();
    const q = event.queryStringParameters || {};
    if (q.detail) {
      const { data, error } = await db.rpc("admin_home_detail", { kind: q.detail, val: q.val || null });
      if (error) throw error;
      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ rows: data || [] }) };
    }
    const { data, error } = await db.rpc("admin_home_analytics");
    if (error) throw error;
    const blob = data || {};
    // Recent signups → drives the operator Home "Latest sign-ups" section (newest first), enriched with
    // customer info + programs owned + 7-day activity so one section replaces the old two. Resilient: any
    // sub-query failing just degrades that field; the Home still renders.
    try {
      const { data: signups } = await db.from("user_profiles")
        .select("id,full_name,preferred_name,email,avatar_url,created_at,last_active_at,brief_open_count,riley_msg_count,last_crisis_level,reengagement_sent_at")
        .order("created_at", { ascending: false }).limit(25);
      const ids = (signups || []).map((s) => s.id);
      // Owned products per user → program count + tier (same resolution as admin-engagement).
      const ownedByUser = {}, progCount = {};
      if (ids.length) {
        try {
          const { data: uap } = await db.from("user_active_products").select("user_id, product_key").in("user_id", ids);
          (uap || []).forEach((r) => {
            (ownedByUser[r.user_id] ||= []).push(r.product_key);
            if (String(r.product_key).startsWith("prog_")) progCount[r.user_id] = (progCount[r.user_id] || 0) + 1;
          });
        } catch (_) {}
      }
      // Latest mood + latest email per recent signup (small .in on ~25 ids — no scale concern).
      const moodById = {}, lastEmailById = {}, emailKindsById = {};
      if (ids.length) {
        try {
          const { data: ck } = await db.from("daily_checkins").select("user_id,mood,checkin_date")
            .in("user_id", ids).not("mood", "is", null).order("checkin_date", { ascending: false });
          (ck || []).forEach((c) => { if (moodById[c.user_id] === undefined) moodById[c.user_id] = c.mood; });
        } catch (_) {}
        try {
          const { data: em } = await db.from("email_log").select("user_id,status,subject,kind,created_at")
            .in("user_id", ids).order("created_at", { ascending: false });
          (em || []).forEach((e) => {
            if (!e.user_id) return;
            if (lastEmailById[e.user_id] === undefined) lastEmailById[e.user_id] = { status: e.status, subject: e.subject, kind: e.kind, created_at: e.created_at };
            const km = (emailKindsById[e.user_id] ||= {});
            if (e.kind && km[e.kind] === undefined) km[e.kind] = e.status;
          });
        } catch (_) {}
      }
      // 7-day activity — reuse the analytics blob's last_active (already computed) rather than re-querying.
      const eventsById = {};
      (Array.isArray(blob.last_active) ? blob.last_active : []).forEach((u) => { if (u && u.user_id) eventsById[u.user_id] = u.events_7d || 0; });
      // Enriched to the engRow shape so the Home "Clients" widget renders the SAME rich row as
      // Client Overview. Keeps id/name/email/created_at/programs/events_7d for back-compat.
      blob.recent_signups = (signups || []).map((s) => ({
        id: s.id,
        name: s.preferred_name || s.full_name || (s.email || "").split("@")[0] || "Member",
        email: s.email || null,
        avatar_url: s.avatar_url || null,
        created_at: s.created_at,
        last_active_at: s.last_active_at || null,
        state: stateFromLastActive(s.last_active_at),
        tier: currentTier(ownedByUser[s.id] || []),
        programs: progCount[s.id] || 0,
        brief_open_count: s.brief_open_count || 0,
        riley_msg_count: s.riley_msg_count || 0,
        recent_mood: moodById[s.id] ?? null,
        last_crisis_level: s.last_crisis_level || null,
        reengaged: !!s.reengagement_sent_at,
        events_7d: eventsById[s.id] || 0,
        last_email: lastEmailById[s.id] || null,
        email_kinds: emailKindsById[s.id] || {},
      }));
    } catch (_) { blob.recent_signups = []; }
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(blob) };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
