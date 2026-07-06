/**
 * admin-attribution.js — Operator-only PostHog attribution view.
 *
 * Reads posthog_daily_conversions (mirrored nightly by posthog-conversion-cron.js)
 * and aggregates "which campaign drove signups" for the operator dashboard.
 * OPERATOR_KEY gated, SERVICE_KEY read — same pattern as admin-engagement.js.
 *
 * GET /.netlify/functions/admin-attribution?days=30 → {
 *   window_days,
 *   configured,                         // false when the attribution table is empty / cron not running yet
 *   totals:      { pageview, signup_guide, reset_completed, upgrade },
 *   by_source:   [ {utm_source,   pageview, signup_guide, reset_completed, upgrade, signup_rate} ],
 *   by_campaign: [ {utm_campaign, pageview, signup_guide, reset_completed, upgrade, signup_rate} ],
 *   daily:       [ {day, pageview, signup_guide, reset_completed, upgrade} ]
 * }
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const METRICS = ["pageview", "signup_guide", "reset_completed", "upgrade"];
function blank() { return { pageview: 0, signup_guide: 0, reset_completed: 0, upgrade: 0 }; }
function rate(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; } // % to 1dp

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  // Operator-only. Fail closed.
  const expected = process.env.OPERATOR_KEY;
  if (!expected) return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: "Not configured. Set OPERATOR_KEY in the environment." }) };
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const days = Math.min(180, Math.max(1, parseInt((event.queryStringParameters || {}).days, 10) || 30));
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const db = getSupabaseClient(); // SERVICE_KEY
    const { data: rows, error } = await db
      .from("posthog_daily_conversions")
      .select("day, utm_source, utm_campaign, metric, count")
      .gte("day", since)
      .limit(20000);
    if (error) throw new Error(error.message);

    const totals = blank();
    const bySource = {};
    const byCampaign = {};
    const byDay = {};

    for (const r of rows || []) {
      const m = r.metric;
      if (!METRICS.includes(m)) continue;
      const n = Number(r.count) || 0;
      totals[m] += n;
      const src = r.utm_source || "(none)";
      const camp = r.utm_campaign || "(none)";
      (bySource[src]   ||= blank())[m] += n;
      (byCampaign[camp]||= blank())[m] += n;
      (byDay[r.day]    ||= blank())[m] += n;
    }

    const toRows = (obj, keyName) => Object.keys(obj).map((k) => {
      const v = obj[k];
      return { [keyName]: k, ...v, signup_rate: rate(v.signup_guide, v.pageview) };
    }).sort((a, b) => b.signup_guide - a.signup_guide || b.pageview - a.pageview);

    const daily = Object.keys(byDay).sort().map((d) => ({ day: d, ...byDay[d] }));

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        window_days: days,
        configured: (rows || []).length > 0,
        totals,
        by_source:   toRows(bySource, "utm_source"),
        by_campaign: toRows(byCampaign, "utm_campaign"),
        daily,
      }),
    };
  } catch (err) {
    console.error("admin-attribution error:", err.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
