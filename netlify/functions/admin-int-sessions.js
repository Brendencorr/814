/**
 * admin-int-sessions.js - Operator editor for the interactive Riley-led programs.
 *
 * Lets the operator review + refine the authored session content (int_sessions), flip a program
 * Live/draft, and replace the interim founder canon copy (the lapse_first_response "FOUNDER COPY
 * PENDING" workflow) - all without touching SQL. OPERATOR_KEY-gated (dashboard sends x-operator-key).
 *
 *   POST { action:'list' }
 *     → { programs:[{ program_key, name, status, sessions }] }   (the 4 interactive programs)
 *   POST { action:'get', program_key }
 *     → { sessions:[ full int_sessions rows, ordered ] }
 *   POST { action:'save', program_key, session_number, patch:{ ...editable } }
 *     → { ok }   (work_spec/commit_options accept a JSON string or an object)
 *   POST { action:'set_status', program_key, status }            (draft|locked|live|retired)
 *     → { ok }
 *   POST { action:'get_canon' }
 *     → { rows:[{ key, body, author, updated_at }] }
 *   POST { action:'save_canon', key, body, author? }             (author defaults to 'founder')
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

// Operator-editable session columns (never program_key/session_number/id).
const EDITABLE = ["phase", "title", "open_template", "learn_body", "work_spec", "commit_options", "is_milestone", "is_active"];
const JSON_FIELDS = ["work_spec", "commit_options"];
const STATUSES = ["draft", "locked", "live", "retired"];

// Accept a JSON string OR an already-parsed object/array for the jsonb fields; reject invalid JSON.
function coerceJson(v) {
  if (v == null) return { ok: true, val: null };
  if (typeof v === "object") return { ok: true, val: v };
  try { return { ok: true, val: JSON.parse(v) }; } catch (_) { return { ok: false }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const gate = requireOperator(event); if (gate) return gate;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const sb = getSupabaseClient();

  if (body.action === "list") {
    const { data: prods } = await sb.from("products").select("product_key, display_name, status, sort_order").eq("type", "program_interactive").order("sort_order");
    const { data: sess } = await sb.from("int_sessions").select("program_key");
    const counts = {};
    (sess || []).forEach((s) => { counts[s.program_key] = (counts[s.program_key] || 0) + 1; });
    const programs = (prods || []).map((p) => ({ program_key: p.product_key, name: p.display_name, status: p.status, sessions: counts[p.product_key] || 0 }));
    return json(200, { programs });
  }

  if (body.action === "get") {
    if (!body.program_key) return json(400, { error: "program_key required" });
    const { data, error } = await sb.from("int_sessions")
      .select("session_number, phase, title, open_template, learn_body, work_spec, commit_options, is_milestone, is_active")
      .eq("program_key", body.program_key).order("session_number", { ascending: true });
    if (error) return json(500, { error: error.message });
    return json(200, { sessions: data || [] });
  }

  if (body.action === "save") {
    const { program_key, patch } = body;
    const sessionNumber = parseInt(body.session_number, 10);
    if (!program_key || isNaN(sessionNumber) || !patch) return json(400, { error: "program_key, session_number, patch required" });
    const upd = {};
    for (const k of EDITABLE) {
      if (!(k in patch)) continue;
      if (JSON_FIELDS.includes(k)) {
        const c = coerceJson(patch[k]);
        if (!c.ok) return json(400, { error: `invalid JSON in ${k}` });
        upd[k] = c.val;
      } else {
        upd[k] = patch[k];
      }
    }
    if (!Object.keys(upd).length) return json(400, { error: "no editable fields in patch" });
    upd.updated_at = new Date().toISOString();
    const { error } = await sb.from("int_sessions").update(upd).eq("program_key", program_key).eq("session_number", sessionNumber);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (body.action === "set_status") {
    const { program_key, status } = body;
    if (!program_key || !STATUSES.includes(status)) return json(400, { error: "program_key + status(draft|locked|live|retired) required" });
    const { error } = await sb.from("products").update({ status }).eq("product_key", program_key).eq("type", "program_interactive");
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (body.action === "get_canon") {
    const { data, error } = await sb.from("canon_copy").select("key, body, author, updated_at").order("key");
    if (error) return json(500, { error: error.message });
    return json(200, { rows: data || [] });
  }

  if (body.action === "save_canon") {
    const { key } = body;
    const text = (body.body || "").trim();
    if (!key || !text) return json(400, { error: "key + body required" });
    const author = body.author === "interim" ? "interim" : "founder";   // saving here means the founder claimed it
    const { error } = await sb.from("canon_copy").upsert(
      { key, body: text, author, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
};
