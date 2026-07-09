/**
 * posthog-conversion-cron.js - nightly attribution pull (scheduled 07:10 UTC).
 *
 * Pulls yesterday's funnel counts from PostHog (grouped by first-touch UTM) via
 * the HogQL Query API and mirrors them into Supabase (posthog_daily_conversions),
 * so the operator dashboard + weekly learnings digest can read "which campaign
 * drove signups" straight from the canonical DB - without hitting PostHog live.
 *
 * PostHog stays the collection lens; Supabase stays the source of truth.
 *
 * GATED + NON-FATAL: needs POSTHOG_PERSONAL_KEY (phx_… read key) + POSTHOG_PROJECT_ID.
 * Without them it no-ops cleanly. Never throws out of the handler.
 *
 * Env:
 *   POSTHOG_PERSONAL_KEY  personal API key with Query read scope (phx_…)  [server only]
 *   POSTHOG_PROJECT_ID    numeric project id (Settings → Project → General)
 *   POSTHOG_HOST          defaults to https://us.i.posthog.com
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");

const HOST = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
// Funnel events we track attribution for. $pageview = top of funnel (landing);
// the named events are the conversions instrumented client + server side.
const FUNNEL_EVENTS = ["$pageview", "signup_guide", "reset_completed", "upgrade"];

// yesterday's UTC calendar day, as YYYY-MM-DD bounds
function yesterdayBounds() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // today 00:00
  const start = new Date(end.getTime() - 864e5); // yesterday 00:00
  const iso = (d) => d.toISOString().slice(0, 19).replace("T", " ");
  return { day: start.toISOString().slice(0, 10), start: iso(start), end: iso(end) };
}

async function runQuery(query) {
  const key = process.env.POSTHOG_PERSONAL_KEY;
  const pid = process.env.POSTHOG_PROJECT_ID;
  if (!key || !pid) return { skipped: "POSTHOG_PERSONAL_KEY or POSTHOG_PROJECT_ID not set" };

  const res = await fetch(`${HOST}/api/projects/${pid}/query/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PostHog query ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

exports.handler = async function (event) {
  // Un-bypassable gate: only the Netlify scheduler or an operator-key manual trigger.
  // Netlify does not reliably block direct HTTP invocation of scheduled functions,
  // so this app-level guard prevents anonymous direct calls (cost-drain / tamper).
  const _g = requireScheduledOrOperator(event); if (_g) return _g;

  const { day, start, end } = yesterdayBounds();
  try {
    const inList = FUNNEL_EVENTS.map((e) => `'${e}'`).join(", ");
    // Count each funnel event by first-touch utm_source / utm_campaign for yesterday.
    const hogql = `
      SELECT
        coalesce(nullIf(properties.utm_source, ''), '(none)')   AS utm_source,
        coalesce(nullIf(properties.utm_campaign, ''), '(none)') AS utm_campaign,
        event                                                   AS metric,
        count()                                                 AS n
      FROM events
      WHERE timestamp >= toDateTime('${start}')
        AND timestamp <  toDateTime('${end}')
        AND event IN (${inList})
      GROUP BY utm_source, utm_campaign, metric
      ORDER BY n DESC
      LIMIT 500`;

    const data = await runQuery(hogql);
    if (data.skipped) { console.log("[posthog-conversion]", data.skipped); return { statusCode: 200, body: "" }; }

    const rows = (data.results || []).map((r) => ({
      day,
      utm_source: r[0],
      utm_campaign: r[1],
      metric: r[2] === "$pageview" ? "pageview" : r[2],
      count: Number(r[3]) || 0,
    }));

    if (rows.length) {
      const db = getSupabaseClient();
      // Idempotent: re-running for the same day overwrites that day's rows.
      await db.from("posthog_daily_conversions")
        .upsert(rows, { onConflict: "day,utm_source,utm_campaign,metric" });
    }
    console.log(`[posthog-conversion] ${day}: upserted ${rows.length} attribution rows`);
  } catch (e) {
    console.error("posthog-conversion-cron error (non-fatal):", e.message);
  }
  return { statusCode: 200, body: "" };
};
