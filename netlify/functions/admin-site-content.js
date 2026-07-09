/**
 * admin-site-content.js - operator write path for the "Customize Website" editor.
 *
 * OPERATOR_KEY-gated (x-operator-key header). Persists per-slot overrides for the
 * public marketing pages into the `site_content` table (migration 070) and uploads
 * logos/images to the public `site-media` storage bucket. Uses the Supabase SERVICE
 * key (bypasses RLS) - the ONLY write path to that table, so the public pages stay
 * read-only from the browser.
 *
 * POST actions:
 *   list        { page? }                          → { items: [...] }
 *   upsert      { page, key, kind, props }          → { ok }
 *   bulk_upsert { changes: [{page,key,kind,props}]} → { ok, saved }
 *   reset       { page, key }                       → { ok }        (delete the override)
 *   upload_image{ page, key, dataUrl, filename? }   → { ok, url }   (base64 data URI)
 */

const { getSupabaseClient, requireOperator } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code, obj) => ({
  statusCode: code,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

const BUCKET = "site-media";
const KINDS = ["text", "image", "section"];

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const gate = requireOperator(event);   // returns a 401/503 response, or null when authorized
  if (gate) return gate;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

  try {
    const sb = getSupabaseClient();
    switch (body.action) {
      case "list":         return await listPage(sb, body.page);
      case "upsert":       return await bulkUpsert(sb, [body]);
      case "bulk_upsert":  return await bulkUpsert(sb, body.changes);
      case "reset":        return await resetOne(sb, body.page, body.key);
      case "upload_image": return await uploadImage(sb, body);
      default:             return json(400, { error: "Unknown action" });
    }
  } catch (err) {
    console.error("admin-site-content error:", err.message);
    return json(500, { error: err.message });
  }
};

async function listPage(sb, page) {
  let q = sb.from("site_content").select("page,key,kind,props,updated_at");
  if (page) q = q.eq("page", page);
  const { data, error } = await q;
  if (error) throw error;
  return json(200, { items: data || [] });
}

function validChange(c) {
  return c && typeof c.page === "string" && c.page &&
         typeof c.key === "string" && c.key &&
         KINDS.includes(c.kind);
}

async function bulkUpsert(sb, changes) {
  if (!Array.isArray(changes) || !changes.length) return json(400, { error: "No changes" });
  if (changes.some((c) => !validChange(c))) return json(400, { error: "Invalid change in batch" });
  const now = new Date().toISOString();
  const rows = changes.map((c) => ({
    page: c.page, key: c.key, kind: c.kind, props: c.props || {}, updated_at: now,
  }));
  const { error } = await sb.from("site_content").upsert(rows, { onConflict: "page,key" });
  if (error) throw error;
  return json(200, { ok: true, saved: rows.length });
}

async function resetOne(sb, page, key) {
  if (!page || !key) return json(400, { error: "page and key required" });
  const { error } = await sb.from("site_content").delete().eq("page", page).eq("key", key);
  if (error) throw error;
  return json(200, { ok: true });
}

async function uploadImage(sb, body) {
  const { page, key, dataUrl } = body;
  if (!page || !key || !dataUrl) return json(400, { error: "page, key, dataUrl required" });
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return json(400, { error: "dataUrl must be a base64 data URI" });
  const contentType = m[1];
  if (!/^image\//.test(contentType)) return json(400, { error: "Only image uploads are allowed" });
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) return json(413, { error: "Image too large (max 5MB)" });
  const ext = (contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  const safeKey = String(key).replace(/[^a-z0-9_-]/gi, "_");
  const path = `${page}/${safeKey}-${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  return json(200, { ok: true, url: pub.publicUrl, path });
}
