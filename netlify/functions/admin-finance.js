/**
 * admin-finance.js — operator finance: live revenue (from subscriptions) + editable
 * operating expenses (operating_expenses table). OPERATOR_KEY gated. Powers the Riley
 * Overview tab + the Home revenue/expense snapshot. Read-only on member data.
 *
 * POST { action } with header x-operator-key:
 *   'summary'        → { revenue:{mrr, breakdown, programs}, expenses:{monthly, list}, net }
 *   'expense_upsert' { id?, service, category, amount_monthly, billing, status, notes, sort_order }
 *   'expense_delete' { id }
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

// Canonical pricing (PRICING memory): Companion $19/mo ($175/yr), Coach $34/mo ($350/yr). Mentor TBD.
const PRICE = {
  companion: { monthly: 19, annual: 175 / 12 },
  coach:     { monthly: 34, annual: 350 / 12 },
  mentor:    { monthly: 0,  annual: 0 },
};
const STATUSES = ["active", "upcoming", "optional", "retired"];
const round2 = (n) => Math.round(n * 100) / 100;

async function summary(sb) {
  // ── Revenue: MRR from ACTIVE, NON-comped subscriptions (comps/weekend grants = $0). ──
  const { data: subs } = await sb.from("subscriptions").select("plan_id, term, status, comped, expires_at").eq("status", "active");
  const now = Date.now();
  const breakdown = { companion: 0, coach: 0, mentor: 0 };
  let mrr = 0;
  (subs || []).forEach((s) => {
    const live = !s.expires_at || new Date(s.expires_at).getTime() > now;
    if (!live || s.comped) return;                 // expired or comped → no revenue
    const p = PRICE[s.plan_id];
    if (!p) return;
    mrr += (s.term === "annual") ? p.annual : p.monthly;
    if (breakdown[s.plan_id] != null) breakdown[s.plan_id] += 1;
  });

  // Program purchases — one-time (à la carte). Lifetime count + total.
  let programs = { count: 0, total: 0 };
  try {
    const { data: purch } = await sb.from("purchases").select("amount_cents");
    programs.count = (purch || []).length;
    programs.total = round2((purch || []).reduce((a, p) => a + (p.amount_cents || 0), 0) / 100);
  } catch (_) {}

  // ── Expenses ──
  const { data: exp } = await sb.from("operating_expenses").select("*").order("sort_order", { ascending: true }).order("service", { ascending: true });
  const list = exp || [];
  const monthly = round2(list.filter((e) => e.status === "active").reduce((a, e) => a + Number(e.amount_monthly || 0), 0));

  return json(200, {
    revenue: { mrr: round2(mrr), breakdown, programs },
    expenses: { monthly, list },
    net: round2(mrr - monthly),
  });
}

async function expenseUpsert(sb, body) {
  const service = (body.service || "").toString().trim().slice(0, 120);
  if (!service) return json(400, { error: "service is required" });
  const row = {
    service,
    category: body.category ? String(body.category).slice(0, 60) : null,
    amount_monthly: (body.amount_monthly == null || isNaN(+body.amount_monthly)) ? 0 : Math.max(0, +body.amount_monthly),
    billing: body.billing ? String(body.billing).slice(0, 24) : "monthly",
    status: STATUSES.includes(body.status) ? body.status : "active",
    notes: body.notes ? String(body.notes).slice(0, 300) : null,
    sort_order: (body.sort_order == null || isNaN(+body.sort_order)) ? 100 : parseInt(body.sort_order, 10),
    updated_at: new Date().toISOString(),
  };
  if (body.id) {
    const { error } = await sb.from("operating_expenses").update(row).eq("id", body.id);
    if (error) return json(500, { error: error.message });
  } else {
    const { error } = await sb.from("operating_expenses").insert(row);
    if (error) return json(500, { error: error.message });
  }
  return json(200, { ok: true });
}

async function expenseDelete(sb, id) {
  if (!id) return json(400, { error: "id required" });
  const { error } = await sb.from("operating_expenses").delete().eq("id", id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const gate = requireOperator(event);
  if (gate) return gate;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  try {
    const sb = getSupabaseClient();
    switch (body.action) {
      case "summary":        return await summary(sb);
      case "expense_upsert": return await expenseUpsert(sb, body);
      case "expense_delete": return await expenseDelete(sb, body.id);
      default:               return json(400, { error: "Unknown action" });
    }
  } catch (e) {
    console.error("admin-finance:", e.message);
    return json(500, { error: e.message });
  }
};
