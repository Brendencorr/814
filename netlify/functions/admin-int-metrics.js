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

  const [prodsR, enrR, progR, commR, artR] = await Promise.all([
    sb.from("products").select("product_key, display_name, status, sort_order").eq("type", "program_interactive").order("sort_order"),
    sb.from("int_enrollments").select("id, program_key, current_session, state, lapse_state, graduated_at"),
    sb.from("int_session_progress").select("enrollment_id, session_number"),
    sb.from("int_commitments").select("enrollment_id, confirmed_state"),
    sb.from("int_artifacts").select("enrollment_id"),
  ]);

  const products = prodsR.data || [];
  const enrollments = enrR.data || [];
  const progress = progR.data || [];
  const commitments = commR.data || [];
  const artifacts = artR.data || [];

  // enrollment_id → program_key, and per-enrollment reached-session sets.
  const enrProgram = {};
  const reached = {};   // enrollment_id → Set(session_number completed)
  enrollments.forEach((e) => { enrProgram[e.id] = e.program_key; reached[e.id] = new Set(); });
  progress.forEach((p) => { if (reached[p.enrollment_id]) reached[p.enrollment_id].add(p.session_number); });

  // Blank per-program bucket (every interactive product shows, even at zero).
  const blank = () => ({ enrolled: 0, session_zero: 0, session_four: 0, graduated: 0, commitments: 0, confirmed: 0, artifacts: 0, lapse_active: 0 });
  const byProg = {};
  products.forEach((p) => { byProg[p.product_key] = { key: p.product_key, name: p.display_name, status: p.status, ...blank() }; });
  const bucket = (k) => (byProg[k] = byProg[k] || { key: k, name: k, status: "?", ...blank() });

  enrollments.forEach((e) => {
    const b = bucket(e.program_key);
    b.enrolled++;
    const done = reached[e.id] || new Set();
    if (done.has(0)) b.session_zero++;
    if ((e.current_session || 0) >= 4 || done.has(4)) b.session_four++;
    if (e.graduated_at) b.graduated++;
    if (e.lapse_state === "lapse_active") b.lapse_active++;
  });
  commitments.forEach((c) => {
    const k = enrProgram[c.enrollment_id]; if (!k) return;
    const b = bucket(k); b.commitments++; if (c.confirmed_state) b.confirmed++;
  });
  artifacts.forEach((a) => {
    const k = enrProgram[a.enrollment_id]; if (!k) return;
    bucket(k).artifacts++;
  });

  const list = Object.values(byProg).map((b) => ({ ...b, confirm_rate: b.commitments ? Math.round((b.confirmed / b.commitments) * 100) : null }));
  const totals = list.reduce((t, b) => {
    ["enrolled", "session_zero", "session_four", "graduated", "commitments", "confirmed", "artifacts", "lapse_active"].forEach((k) => { t[k] += b[k]; });
    return t;
  }, blank());
  totals.confirm_rate = totals.commitments ? Math.round((totals.confirmed / totals.commitments) * 100) : null;

  return json(200, { programs: list, totals });
};
