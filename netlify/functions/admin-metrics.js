/**
 * admin-metrics.js - Doc 3 Phase 1: the investor dashboard's data source.
 *
 * The funnel + north-star metrics, computed ONLY from the canonical `events` table (no shadow
 * counting - Doc 3 do-not) plus `subscriptions` for the churn denominator. OPERATOR_KEY gated,
 * read-only (service key). Structurally private: this function only ever reads `events` and
 * `subscriptions` - never a message body, never conversation content.
 *
 * POST { days? } with header x-operator-key → { range, northStars, rows, funnel, counts }.
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // Operator-only. Fail closed if unset; 401 on mismatch (same gate as the other admin-* fns).
  const _op = process.env.OPERATOR_KEY;
  if (!_op) return json(503, { error: "Not configured" });
  if ((event.headers["x-operator-key"] || event.headers["X-Operator-Key"]) !== _op) return json(401, { error: "Unauthorized" });

  try {
    const sb = getSupabaseClient();
    let days = 0; try { days = parseInt(JSON.parse(event.body || "{}").days, 10) || 0; } catch (_) {}

    let q = sb.from("events").select("name, user_id, props, created_at");
    if (days > 0) q = q.gte("created_at", new Date(Date.now() - days * 86400000).toISOString());
    const { data: evs } = await q;
    const E = evs || [];

    const byName = {};
    E.forEach((e) => { byName[e.name] = (byName[e.name] || 0) + 1; });
    const c = (n) => byName[n] || 0;
    const distinct = (n) => new Set(E.filter((e) => e.name === n && e.user_id).map((e) => e.user_id)).size;
    const annualUpg = E.filter((e) => e.name === "upgrade_completed" && e.props && e.props.term === "annual").length;

    // Active monthly subs - the churn denominator (from subscriptions, no content).
    let activeMonthly = 0;
    try { const { data: subs } = await sb.from("subscriptions").select("id").eq("status", "active").eq("term", "monthly"); activeMonthly = (subs || []).length; } catch (_) {}

    const northStars = [
      { key: "reset_completion", label: "Reset completion", value: pct(c("reset_completed"), c("signup_guide")), unit: "%", target: "≥ 30%", detail: c("reset_completed") + " of " + c("signup_guide") + " signups" },
      { key: "day7_paid",        label: "Day-7 → paid",      value: pct(c("upgrade_completed"), c("week_one_letter_viewed")), unit: "%", target: "≥ 8–10%", detail: c("upgrade_completed") + " upgrades / " + c("week_one_letter_viewed") + " letters (14d-window refinement TODO)" },
    ];
    const rows = [
      { label: "Companion Weekend engagement", value: pct(distinct("companion_weekend_chat"), c("companion_weekend_started")), unit: "%", target: "≥ 60%" },
      { label: "Chat-limit encounters",        value: distinct("chat_limit_reached"), unit: " users", target: "10–25% band" },
      { label: "Annual mix",                   value: pct(annualUpg, c("upgrade_completed")), unit: "%", target: "≥ 60%" },
      { label: "Paid monthly churn",           value: pct(c("cancel_completed"), activeMonthly), unit: "%", target: "< 8%" },
      { label: "Credit redemption",            value: pct(c("credit_redeemed"), c("alacarte_purchased")), unit: "%", target: "≥ 10%" },
      { label: "Waitlist signups",             value: c("waitlist_joined"), unit: "", target: "launch list" },
    ];
    const funnel = [
      { step: "Signups (Guide)",          count: c("signup_guide") },
      { step: "Reset Day-1",              count: E.filter((e) => e.name === "reset_day_completed" && e.props && e.props.day === 1).length },
      { step: "Reset complete (Day-7)",   count: c("reset_completed") },
      { step: "Week One Letter",          count: c("week_one_letter_viewed") },
      { step: "Companion Weekend chat",   count: distinct("companion_weekend_chat") },
      { step: "Upgraded",                 count: c("upgrade_completed") },
    ];

    // Waitlist (Doc 3 Phase 3): who's waiting to buy, newest first. From waitlist_joined events
    // (email/plan captured server-side by waitlist-join.js). Operator-only, like everything here.
    const waitlist = E.filter((e) => e.name === "waitlist_joined")
      .map((e) => ({ email: (e.props && e.props.email) || null, plan: (e.props && e.props.plan) || null, at: e.created_at }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 100);

    return json(200, { range: days ? days + "d" : "all", northStars, rows, funnel, waitlist, counts: byName });
  } catch (e) {
    console.error("admin-metrics:", e.message);
    return json(500, { error: "Failed to compute metrics" });
  }
};
