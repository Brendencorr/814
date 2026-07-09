/**
 * content-templates.js - manage the design template library from the dashboard.
 * GET  → list all template families (slug, family, engine, engine_template_id, active)
 * POST {slug, engine_template_id}      → set a family's Canva/engine template id
 * POST {slug, active}                  → toggle a family on/off
 *
 * Lets Brenden paste each Canva Brand Template ID without touching SQL, which
 * is what "arms" Atlas to auto-design that family (Phase 2 §2.1).
 */
const { contentDb, CORS, requireOperator } = require("./content-lib");

function json(s, d) { return { statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) }; }

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const _gate = requireOperator(event); if (_gate) return _gate;
  const db = contentDb();
  try {
    if (event.httpMethod === "GET") {
      const { data } = await db.from("content_template_library")
        .select("slug, family_name, engine, engine_template_id, asset_type, platforms, use_case, active")
        .order("family_name");
      return json(200, { templates: data || [] });
    }
    const body = JSON.parse(event.body || "{}");
    if (!body.slug) return json(400, { error: "slug required" });
    const patch = {};
    if (typeof body.engine_template_id === "string") patch.engine_template_id = body.engine_template_id.trim() || "TBD";
    if (typeof body.active === "boolean") patch.active = body.active;
    if (!Object.keys(patch).length) return json(400, { error: "nothing to update" });
    const { data, error } = await db.from("content_template_library")
      .update(patch).eq("slug", body.slug).select().single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, template: data });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
