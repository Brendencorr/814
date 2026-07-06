/**
 * admin-program-modules.js — Operator editor for self-guided program CONTENT (program_modules).
 *
 * Lets the operator fix/adjust module copy without touching SQL. OPERATOR_KEY-gated
 * (same as the other admin tools; the dashboard's fetch injector sends x-operator-key).
 *
 *   POST { action:'list' }
 *     → { programs:[{ program_key, name, modules }] }
 *   POST { action:'get', program_key }
 *     → { modules:[ full program_modules rows, ordered ] }
 *   POST { action:'save', program_key, module_number, patch:{ ...editable fields } }
 *     → { ok }
 * Model: n/a
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

// Only these columns are operator-editable (never program_key/module_number/id).
const EDITABLE = ["title", "part_title", "read_body", "do_body", "keep_title", "keep_body", "riley_layer", "safety_footer", "is_active"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const gate = requireOperator(event); if (gate) return gate;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const sb = getSupabaseClient();

  if (body.action === "list") {
    const { data: prods } = await sb.from("products").select("product_key, display_name, status").eq("type", "program").order("sort_order");
    const { data: mods } = await sb.from("program_modules").select("program_key");
    const counts = {};
    (mods || []).forEach((m) => { counts[m.program_key] = (counts[m.program_key] || 0) + 1; });
    // Only surface programs that actually have module content to edit.
    const programs = (prods || [])
      .map((p) => ({ program_key: p.product_key, name: p.display_name, status: p.status, modules: counts[p.product_key] || 0 }))
      .filter((p) => p.modules > 0);
    return json(200, { programs });
  }

  if (body.action === "get") {
    if (!body.program_key) return json(400, { error: "program_key required" });
    const { data, error } = await sb.from("program_modules")
      .select("module_number, part_number, part_title, title, read_body, do_body, keep_title, keep_body, riley_layer, safety_footer, is_active")
      .eq("program_key", body.program_key).order("module_number", { ascending: true });
    if (error) return json(500, { error: error.message });
    return json(200, { modules: data || [] });
  }

  if (body.action === "save") {
    const { program_key, module_number, patch } = body;
    if (!program_key || !module_number || !patch) return json(400, { error: "program_key, module_number, patch required" });
    const upd = {};
    EDITABLE.forEach((k) => { if (k in patch) upd[k] = patch[k]; });
    if (!Object.keys(upd).length) return json(400, { error: "no editable fields in patch" });
    upd.updated_at = new Date().toISOString();
    const { error } = await sb.from("program_modules").update(upd)
      .eq("program_key", program_key).eq("module_number", module_number);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
};
