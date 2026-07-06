/**
 * program-content.js — serve an OWNED program's content, entitlement-gated.
 *
 * POST { action:'get', token, program_key }
 *   -> { program, modules[], tier, progress[], footer }
 *   riley_layer is included ONLY for Companion/Coach (or admin / free-access testers).
 *   Standalone + Guide buyers get pure content (the brief's promise). Non-owners get 403 —
 *   paid content never leaks to someone who doesn't own it.
 * POST { action:'complete', token, program_key, module_number, done }
 *   -> toggle the per-module checklist (no streaks; the brief's "no tracking" promise).
 *
 * Ownership = user_active_products (the entitlement view) + active subscriptions + admin +
 * free_access_mode, mirroring entitlements.js so there's one truth. Guest (no-login) tokenized
 * access for standalone web buyers is added when Stripe checkout lands.
 * Model: n/a
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

// Resolve what this user owns + their tier, consistent with entitlements.js / user_active_products.
async function resolveAccess(sb, userId, programKey) {
  let admin = false, freeAccess = false;
  try { const { data: p } = await sb.from("user_profiles").select("is_admin").eq("id", userId).maybeSingle(); admin = !!(p && p.is_admin === true); } catch (_) {}
  try { const { data: fa } = await sb.from("app_settings").select("value").eq("key", "free_access_mode").maybeSingle(); freeAccess = !!(fa && String(fa.value).toLowerCase() === "true"); } catch (_) {}

  const owned = new Set();
  try { const { data: rows } = await sb.from("user_active_products").select("product_key").eq("user_id", userId); (rows || []).forEach((r) => owned.add(r.product_key)); } catch (_) {}
  try {
    const { data: subs } = await sb.from("subscriptions").select("plan_id, expires_at").eq("user_id", userId).eq("status", "active");
    const now = Date.now();
    (subs || []).forEach((s) => { const live = !s.expires_at || new Date(s.expires_at).getTime() > now; if (live && ["companion", "coach", "mentor"].includes(s.plan_id)) owned.add(s.plan_id); });
  } catch (_) {}

  let tier = (owned.has("coach") || owned.has("mentor")) ? "coach" : owned.has("companion") ? "companion" : "guide";
  if (admin || freeAccess) tier = "coach";                       // testers/admin see the full experience
  const owns = admin || freeAccess || owned.has(programKey);
  const rileyVisible = admin || freeAccess || tier === "companion" || tier === "coach";
  return { owns, tier, rileyVisible };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });

  const programKey = body.program_key;
  if (!programKey) return json(400, { error: "program_key required" });

  const access = await resolveAccess(sb, userId, programKey);
  if (!access.owns) return json(403, { error: "not-owned" });

  // Toggle a module's done state.
  if (body.action === "complete") {
    const n = parseInt(body.module_number, 10);
    if (!n) return json(400, { error: "module_number required" });
    if (body.done === false) {
      await sb.from("program_module_progress").delete().eq("user_id", userId).eq("program_key", programKey).eq("module_number", n);
    } else {
      await sb.from("program_module_progress").upsert(
        { user_id: userId, program_key: programKey, module_number: n, done_at: new Date().toISOString() },
        { onConflict: "user_id,program_key,module_number" }
      );
    }
    return json(200, { ok: true });
  }

  // Default: get the program's content.
  const { data: mods } = await sb.from("program_modules")
    .select("module_number, part_number, part_title, title, read_body, do_body, keep_title, keep_body, riley_layer, safety_footer")
    .eq("program_key", programKey).eq("is_active", true).order("module_number", { ascending: true });
  if (!mods || !mods.length) return json(404, { error: "no-content", note: "This program has no modules yet." });

  const { data: prog } = await sb.from("program_module_progress").select("module_number").eq("user_id", userId).eq("program_key", programKey);
  const { data: prod } = await sb.from("products").select("display_name, blurb").eq("product_key", programKey).maybeSingle();

  const modules = mods.map((m) => ({
    n: m.module_number, part: m.part_number, part_title: m.part_title, title: m.title,
    read: m.read_body, do: m.do_body, keep_title: m.keep_title, keep: m.keep_body,
    riley: access.rileyVisible ? m.riley_layer : null,
  }));

  return json(200, {
    program: { key: programKey, name: (prod && prod.display_name) || programKey, blurb: (prod && prod.blurb) || "" },
    modules,
    tier: access.tier,
    progress: (prog || []).map((p) => p.module_number),
    footer: (mods[0] && mods[0].safety_footer) || null,
  });
};
