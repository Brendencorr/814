/**
 * admin-programs.js — Operator Program Manager. Team-only.
 *
 * Full CRUD over the `programs` table (the program catalog the client app +
 * storefront draw from), plus the free-access master switch. Toggling a program
 * ON (is_active=true) makes it appear in the client app immediately
 * (programs.html lists is_active=true); the Squarespace storefront is mirrored
 * manually on Brenden's side.
 *
 * Protected by OPERATOR_KEY (x-operator-key header), same as the other admin
 * tools. Fails closed if OPERATOR_KEY is unset.
 *
 * POST { action: "list" }                          → { programs, free_access_mode }
 * POST { action: "upsert", program: {...} }        → { program }   (id → update, else insert)
 * POST { action: "set_active", id, is_active }     → { ok }        (toggle / freeze)
 * POST { action: "delete", id }                    → { ok }        (hard delete; refuses if enrolled)
 * POST { action: "set_free_access", value: bool }  → { ok }
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });
const num = (v) => (v === "" || v == null || isNaN(+v)) ? null : Math.round(+v);
const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function getFreeAccess(sb) {
  try {
    const { data } = await sb.from("app_settings").select("value").eq("key", "free_access_mode").maybeSingle();
    return !!(data && String(data.value).toLowerCase() === "true");
  } catch { return false; }
}

async function listPrograms(sb) {
  const { data, error } = await sb
    .from("programs")
    .select("id,slug,title,description,emoji,duration_days,price_cents,tagline,is_active,sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return json(200, { programs: data || [], free_access_mode: await getFreeAccess(sb) });
}

async function upsertProgram(sb, p) {
  if (!p || !p.title) return json(400, { error: "title is required" });
  const row = {
    slug: p.slug ? slugify(p.slug) : slugify(p.title),
    title: String(p.title).slice(0, 200),
    description: p.description ? String(p.description).slice(0, 4000) : null,
    emoji: p.emoji ? String(p.emoji).slice(0, 8) : null,
    duration_days: num(p.duration_days),
    price_cents: num(p.price_cents) ?? 0,
    tagline: p.tagline ? String(p.tagline).slice(0, 300) : null,
    sort_order: num(p.sort_order) ?? 0,
    is_active: p.is_active !== false,
  };
  if (p.id) {
    const { data, error } = await sb.from("programs").update(row).eq("id", p.id).select().maybeSingle();
    if (error) return json(500, { error: error.message });
    return json(200, { program: data });
  }
  const { data, error } = await sb.from("programs").insert(row).select().maybeSingle();
  if (error) return json(500, { error: error.message });
  return json(200, { program: data });
}

async function setActive(sb, id, isActive) {
  if (!id) return json(400, { error: "id required" });
  const { error } = await sb.from("programs").update({ is_active: isActive !== false }).eq("id", id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

async function deleteProgram(sb, id) {
  if (!id) return json(400, { error: "id required" });
  // Guard: don't orphan member progress. If anyone is enrolled, refuse the hard
  // delete and tell the operator to Freeze instead (reversible, keeps history).
  try {
    const { count } = await sb.from("user_program_progress").select("*", { count: "exact", head: true }).eq("program_id", id);
    if (count && count > 0) {
      return json(409, { error: `Can't delete — ${count} member(s) are enrolled. Freeze it instead (it'll hide from the app but keep their progress).` });
    }
  } catch (_) { /* if the check fails, fall through to attempt delete */ }
  const { error } = await sb.from("programs").delete().eq("id", id);
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

async function setFreeAccess(sb, value) {
  const v = value ? "true" : "false";
  const { error } = await sb.from("app_settings")
    .upsert({ key: "free_access_mode", value: v, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, free_access_mode: value === true });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  const expected = process.env.OPERATOR_KEY;
  if (!expected) return json(503, { error: "Program manager not configured. Set OPERATOR_KEY in the environment." });
  const provided = event.headers["x-operator-key"] || event.headers["X-Operator-Key"];
  if (provided !== expected) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  try {
    const sb = getSupabaseClient();
    switch (body.action) {
      case "list":            return await listPrograms(sb);
      case "upsert":          return await upsertProgram(sb, body.program);
      case "set_active":      return await setActive(sb, body.id, body.is_active);
      case "delete":          return await deleteProgram(sb, body.id);
      case "set_free_access": return await setFreeAccess(sb, body.value === true);
      default:                return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-programs error:", err.message);
    return json(500, { error: err.message });
  }
};
