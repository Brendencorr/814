/**
 * content-atlas.js — Phase 2 automated design (Canva Connect Autofill).
 *
 * Turns a Sage brief into rendered creative:
 *   Atlas prompt -> render payload -> Canva Autofill API -> poll -> export ->
 *   download PNG -> upload to Supabase Storage (content-assets) ->
 *   content_creative_assets row -> Sentinel -> approval_queue.
 *
 * FULLY GATED + NON-FATAL (mirrors the Buffer pattern):
 *   - Needs env CANVA_CONNECT_TOKEN (OAuth access token from a Canva
 *     Developer integration; Autofill API requires an eligible Canva plan).
 *   - Needs the chosen template family to have a REAL engine_template_id
 *     (content_template_library.engine_template_id != 'TBD').
 *   If either is missing, Atlas does NOT fake it — it returns
 *   {designed:false, reason} and the brief stays a text item for review.
 *
 * Engine is pluggable (schema supports canva|creatomate|bannerbear|placid).
 * Only Canva is implemented here; add others behind the same renderBrief() API.
 *
 * Exports renderBrief(briefId) for the pipeline; HTTP handler allows manual
 * "Generate design" / retry from the Review screen.
 */

const { contentDb, loadPrompt, callClaude, extractJson, notify, CORS } = require("./content-lib");

const CANVA_API = "https://api.canva.com/rest/v1";
const BUCKET = "content-assets";

function canvaHeaders() {
  const token = process.env.CANVA_CONNECT_TOKEN;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// Poll a Canva job endpoint until terminal state (success/failed) or timeout.
async function pollCanva(url, headers, { tries = 20, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Canva poll ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const status = j.job?.status || j.status;
    if (status === "success") return j;
    if (status === "failed") throw new Error("Canva job failed: " + JSON.stringify(j).slice(0, 200));
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error("Canva job timed out");
}

/**
 * Render every asset a brief calls for. Returns
 * { designed:boolean, assets:[], reason?:string }.
 */
async function renderBrief(briefId) {
  const db = contentDb();
  const headers = canvaHeaders();

  const { data: brief } = await db.from("content_briefs").select("*").eq("id", briefId).single();
  if (!brief) return { designed: false, reason: "brief not found" };

  // Template gate
  const { data: tpl } = await db.from("content_template_library")
    .select("*").eq("slug", brief.template_family || "").eq("active", true).single();

  if (!headers) return { designed: false, reason: "CANVA_CONNECT_TOKEN not set" };
  if (!tpl) return { designed: false, reason: `no template family '${brief.template_family}'` };
  if (!tpl.engine_template_id || tpl.engine_template_id === "TBD") {
    return { designed: false, reason: `template '${tpl.slug}' has no engine_template_id yet` };
  }
  if (tpl.engine !== "canva") return { designed: false, reason: `engine '${tpl.engine}' not implemented` };

  await db.from("content_briefs").update({ status: "in_design" }).eq("id", briefId);

  // Atlas → render payload(s)
  const atlasPrompt = await loadPrompt("atlas");
  const raw = await callClaude({
    system: atlasPrompt,
    user: `BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nTEMPLATE RECORD:\n${JSON.stringify({ slug: tpl.slug, engine: tpl.engine, engine_template_id: tpl.engine_template_id, asset_type: tpl.asset_type, platforms: tpl.platforms, variables: tpl.variables }, null, 2)}\n\nProduce the renders JSON.`,
    maxTokens: 2500,
  });
  const out = extractJson(raw) || { renders: [] };
  const renders = Array.isArray(out.renders) ? out.renders : [];

  const assets = [];
  for (const rnd of renders) {
    try {
      // 1) Autofill job
      const afRes = await fetch(`${CANVA_API}/autofills`, {
        method: "POST", headers,
        body: JSON.stringify({ brand_template_id: tpl.engine_template_id, data: (rnd.payload && rnd.payload.data) || rnd.payload || {} }),
      });
      if (!afRes.ok) throw new Error(`autofill ${afRes.status}: ${(await afRes.text()).slice(0, 200)}`);
      const afJob = await afRes.json();
      const afDone = await pollCanva(`${CANVA_API}/autofills/${afJob.job.id}`, headers);
      const designId = afDone.job.result.design.id;

      // 2) Export to PNG
      const exRes = await fetch(`${CANVA_API}/exports`, {
        method: "POST", headers,
        body: JSON.stringify({ design_id: designId, format: { type: "png" } }),
      });
      if (!exRes.ok) throw new Error(`export ${exRes.status}: ${(await exRes.text()).slice(0, 200)}`);
      const exJob = await exRes.json();
      const exDone = await pollCanva(`${CANVA_API}/exports/${exJob.job.id}`, headers);
      const canvaUrl = exDone.job.result.urls[0];

      // 3) Download + store in Supabase Storage for permanence
      let fileUrl = canvaUrl, storagePath = null;
      try {
        const img = await fetch(canvaUrl);
        const buf = Buffer.from(await img.arrayBuffer());
        const path = `${new Date().toISOString().slice(0,10)}/${(rnd.filename || designId)}.png`;
        const up = await contentDb().storage.from(BUCKET).upload(path, buf, { contentType: "image/png", upsert: true });
        if (!up.error) {
          storagePath = path;
          fileUrl = contentDb().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }
      } catch (e) { console.warn("storage upload failed, using Canva URL:", e.message); }

      // 4) Automated QA (alt text present + ≤125 chars)
      const altOk = rnd.alt_text && rnd.alt_text.length <= 125;

      const { data: asset } = await db.from("content_creative_assets").insert({
        brief_id: briefId,
        asset_type: ["static","carousel","video","story","thumbnail","text_only"].includes(rnd.asset_type) ? rnd.asset_type : "static",
        platform: ["instagram","tiktok","linkedin","facebook","youtube_shorts","pinterest","x"].includes(rnd.platform) ? rnd.platform : "instagram",
        render_engine: "canva",
        template_id: tpl.engine_template_id,
        file_url: fileUrl,
        storage_path: storagePath,
        alt_text: rnd.alt_text || null,
        filename: rnd.filename || null,
        dimensions: rnd.dimensions || null,
        render_payload: rnd.payload || null,
        qa_passed: !!altOk,
      }).select().single();
      if (asset) assets.push(asset);
    } catch (e) {
      console.warn("render failed for one asset (non-fatal):", e.message);
    }
  }

  await db.from("content_briefs").update({ status: "designed" }).eq("id", briefId);
  return { designed: assets.length > 0, assets, reason: assets.length ? null : "all renders failed" };
}

// HTTP: manual design/retry for one brief from the Review screen.
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.brief_id) return { statusCode: 400, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "brief_id required" }) };
    const result = await renderBrief(body.brief_id);
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};

exports.renderBrief = renderBrief;
