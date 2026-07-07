/**
 * admin-int-metrics.js — Operator metrics for the interactive Riley-led programs (Phase 5).
 *
 * OPERATOR_KEY-gated. Aggregates the health of each program from the int_* tables:
 *   enrolled · Session-Zero completion · Session-4 retention · graduations · confirmation rate ·
 *   artifacts captured · active lapses. Computed in JS over small result sets (one truth, no drift).
 *
 *   POST { action:'get' } → { programs:[{ key, name, enrolled, session_zero, session_four, graduated,
 *                                          commitments, confirmed, confirm_rate, artifacts, lapse_active }],
 *                             totals:{...} }
 * Model: n/a
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const gate = requireOperator(event); if (gate) return gate;

  const sb = getSupabaseClient();

  // Aggregation happens in Postgres (int_program_metrics, migration 068) — one GROUP BY instead of
  // pulling every int_* row into the Lambda. Products query supplies names/status + zero-fills programs
  // with no enrollments yet. (If 068 isn't applied, the rpc errors → the metrics panel just hides.)
  const [prodsR, mR] = await Promise.all([
    sb.from("products").select("product_key, display_name, status, sort_order").eq("type", "program_interactive").order("sort_order"),
    sb.rpc("int_program_metrics"),
  ]);
  if (mR.error) return json(500, { error: "metrics-fn", detail: mR.error.message });

  const products = prodsR.data || [];
  const rows = mR.data || [];
  const num = (v) => Number(v || 0);
  const metric = {}; rows.forEach((m) => { metric[m.program_key] = m; });

  const nameBy = {}, statusBy = {}, orderBy = {};
  products.forEach((p) => { nameBy[p.product_key] = p.display_name; statusBy[p.product_key] = p.status; orderBy[p.product_key] = p.sort_order || 0; });
  const keys = new Set(products.map((p) => p.product_key)); rows.forEach((m) => keys.add(m.program_key));  // include stragglers

  const blank = () => ({ enrolled: 0, session_zero: 0, session_four: 0, graduated: 0, commitments: 0, confirmed: 0, artifacts: 0, lapse_active: 0 });
  const list = [...keys].sort((a, b) => (orderBy[a] || 0) - (orderBy[b] || 0)).map((k) => {
    const m = metric[k] || {};
    const b = {
      key: k, name: nameBy[k] || k, status: statusBy[k] || "?",
      enrolled: num(m.enrolled), session_zero: num(m.session_zero), session_four: num(m.session_four),
      graduated: num(m.graduated), commitments: num(m.commitments), confirmed: num(m.confirmed),
      artifacts: num(m.artifacts), lapse_active: num(m.lapse_active),
    };
    b.confirm_rate = b.commitments ? Math.round((b.confirmed / b.commitments) * 100) : null;
    return b;
  });
  const totals = list.reduce((t, b) => {
    ["enrolled", "session_zero", "session_four", "graduated", "commitments", "confirmed", "artifacts", "lapse_active"].forEach((k) => { t[k] += b[k]; });
    return t;
  }, blank());
  totals.confirm_rate = totals.commitments ? Math.round((totals.confirmed / totals.commitments) * 100) : null;

  return json(200, { programs: list, totals });
};
