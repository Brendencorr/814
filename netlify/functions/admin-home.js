/**
 * admin-home.js - powers the operator Home dashboard.
 *   GET                       → full analytics blob (admin_home_analytics)
 *   GET ?detail=<kind>&val=.. → drill-down rows (admin_home_detail)
 *
 * detail kinds: total | active | new | logins | messages | page | click
 * (page/click take val=<page|target>; logins/messages accept optional val=MM-DD)
 *
 * Each member in recent_signups now includes:
 *   first_name, last_name - split from full_name (first token / remainder); falls back to preferred_name
 *   paid         - boolean: true if tier is companion, coach, or mentor
 *   has_purchases - boolean: true if any row in purchases table
 *   welcome_email_sent - boolean|null: true if email_log has kind=welcome with status=sent
 *   coupon       - string|null: promo_code (human code) or stripe_coupon_id from subscriptions row;
 *                  null if no promo was applied. Populated by stripe-webhook on checkout.session.completed.
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { currentTier, stateFromLastActive } = require("./tier-utils"); // shared with admin-engagement

/** Split full_name into { first_name, last_name }. Falls back to preferred_name as first. */
function splitName(fullName, preferredName) {
  const raw = (fullName || "").trim();
  if (raw) {
    const sp = raw.indexOf(" ");
    if (sp < 0) return { first_name: raw, last_name: "" };
    return { first_name: raw.slice(0, sp), last_name: raw.slice(sp + 1).trim() };
  }
  const pref = (preferredName || "").trim();
  return { first_name: pref, last_name: "" };
}

const PAID_TIERS = new Set(["companion", "coach", "mentor"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  // Operator gate: constant-time key check + CORS allow-list (M-3).
  const gate = requireOperator(event); if (gate) return gate;
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
      // Bridge active subscriptions → owned (SAME resolution entitlements.js uses for the member).
      // A Stripe-checkout Companion/Coach lands in `subscriptions` but not always in user_active_products,
      // so without this a PAYING member renders as unpaid here even though their app correctly unlocks.
      // Fault-tolerant: a failure just leaves tier as-is.
      if (ids.length) {
        try {
          const now = Date.now();
          const { data: tierSubs } = await db.from("subscriptions")
            .select("user_id, plan_id, expires_at").in("user_id", ids).eq("status", "active");
          (tierSubs || []).forEach((s) => {
            const live = !s.expires_at || new Date(s.expires_at).getTime() > now;
            if (live && (s.plan_id === "companion" || s.plan_id === "coach" || s.plan_id === "mentor")) {
              const arr = (ownedByUser[s.user_id] ||= []);
              if (!arr.includes(s.plan_id)) arr.push(s.plan_id);
            }
          });
        } catch (_) {}
      }
      // Coupon/promo-code per user: read from subscriptions rows stamped by the webhook.
      // promo_code is the human code the customer typed; fall back to stripe_coupon_id.
      const couponById = {};
      if (ids.length) {
        try {
          const { data: subs } = await db.from("subscriptions")
            .select("user_id,promo_code,stripe_coupon_id")
            .in("user_id", ids)
            .eq("status", "active")
            .not("stripe_coupon_id", "is", null);
          (subs || []).forEach((s) => {
            // One active sub per user; first one wins. Prefer human promo_code over internal id.
            if (!couponById[s.user_id]) couponById[s.user_id] = s.promo_code || s.stripe_coupon_id || null;
          });
        } catch (_) {}
      }
      // Latest mood + latest email + purchases per recent signup (small .in on ~25 ids - no scale concern).
      const moodById = {}, lastEmailById = {}, emailKindsById = {}, hasPurchaseById = {};
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
        try {
          // One-time program purchases (purchases table) - distinct from subscription tier.
          const { data: purch } = await db.from("purchases").select("user_id").in("user_id", ids);
          (purch || []).forEach((p) => { hasPurchaseById[p.user_id] = true; });
        } catch (_) {}
      }
      // 7-day activity - reuse the analytics blob's last_active (already computed) rather than re-querying.
      const eventsById = {};
      (Array.isArray(blob.last_active) ? blob.last_active : []).forEach((u) => { if (u && u.user_id) eventsById[u.user_id] = u.events_7d || 0; });
      // Enriched to the engRow shape so the Home "Clients" widget renders the SAME rich row as
      // Client Overview. Keeps id/name/email/created_at/programs/events_7d for back-compat.
      blob.recent_signups = (signups || []).map((s) => {
        const owned = ownedByUser[s.id] || [];
        const tier = currentTier(owned);
        const names = splitName(s.full_name, s.preferred_name);
        const emailKinds = emailKindsById[s.id] || {};
        // welcome_email_sent: true only if a welcome-kind email landed as 'sent'
        const welcomeSent = emailKinds["welcome"] === "sent" ? true : (emailKinds["welcome"] ? false : null);
        return {
          id: s.id,
          // Structured name fields for the Home table
          first_name: names.first_name,
          last_name: names.last_name,
          // Legacy single-name field kept for back-compat (engRow still uses u.name)
          name: s.preferred_name || s.full_name || (s.email || "").split("@")[0] || "Member",
          email: s.email || null,
          avatar_url: s.avatar_url || null,
          created_at: s.created_at,
          last_active_at: s.last_active_at || null,
          state: stateFromLastActive(s.last_active_at),
          tier,
          // paid: true if the member has an active paid plan (companion, coach, mentor)
          paid: PAID_TIERS.has(tier),
          programs: progCount[s.id] || 0,
          // has_purchases: true if any one-time purchase row exists
          has_purchases: hasPurchaseById[s.id] ? true : false,
          brief_open_count: s.brief_open_count || 0,
          riley_msg_count: s.riley_msg_count || 0,
          recent_mood: moodById[s.id] ?? null,
          last_crisis_level: s.last_crisis_level || null,
          reengaged: !!s.reengagement_sent_at,
          events_7d: eventsById[s.id] || 0,
          last_email: lastEmailById[s.id] || null,
          email_kinds: emailKinds,
          // emailed: have we sent this member ANY email (brief/lifecycle/welcome)? Drives the "Emailed"
          // column - so someone who got 6 briefs but no welcome no longer reads as "never emailed".
          emailed: !!lastEmailById[s.id],
          welcome_email_sent: welcomeSent,
          // coupon: promo_code (human code) or stripe_coupon_id stamped by the webhook on checkout.
          // null when no promo was applied or the member has no active subscription yet.
          coupon: couponById[s.id] || null,
        };
      });
    } catch (_) { blob.recent_signups = []; }
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(blob) };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
