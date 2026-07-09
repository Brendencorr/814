/**
 * content-design.js - Riley grounds render engine (render_engine = 'riley-grounds').
 *
 * The server-side design step for CONTENT_ENGINE_v3, mirroring content-atlas.js but
 * rendering LOCALLY with @napi-rs/canvas onto the six locked grounds (no external
 * service, no Canva). Implements brand/template-kit/TEMPLATE_SPEC.md layouts.
 *
 *   Sage brief -> assign a compliant design (template-rotation.js) -> render PNG ->
 *   upload to Supabase Storage (content-assets) -> content_creative_assets row.
 *
 * Exports renderBrief(briefId, opts) for the pipeline / content-queue approve step.
 * HTTP handler (operator-gated):
 *   POST {action:'render', brief_id}                 -> render + persist assets
 *   POST {action:'swap', brief_id, ground, layout?}  -> re-render, replace assets
 *   GET  ?view=gallery                               -> the six grounds + layouts (thumbnails)
 *   GET  ?asset=grounds/veil--square-1080x1080.png   -> stream one kit image (base64)
 *
 * v1 renders ONE static image per brief (hook/body). Carousels (multi-slide) + reels
 * (motion) are a follow-on; the rotation still schedules them for manual handling.
 */

const fs = require("fs");
const path = require("path");
const { contentDb, CORS, requireOperator } = require("./content-lib");
const R = require("./template-rotation");

// Lazy-load the native canvas so a bundling/binary problem degrades the DESIGN step
// only (renderBrief returns {designed:false}) instead of breaking the whole
// content-queue function, which requires this module.
let _C = null;
function C() {
  if (!_C) _C = require("@napi-rs/canvas");
  return _C;
}

const BUCKET = "content-assets";

// ── locate the committed kit (bundled via netlify.toml included_files) ───────────
function findKit() {
  const cands = [
    path.join(process.cwd(), "brand/template-kit"),
    path.join(__dirname, "../../brand/template-kit"),
    path.join(__dirname, "brand/template-kit"),
    "/var/task/brand/template-kit",
  ];
  for (const c of cands) { try { if (fs.existsSync(path.join(c, "grounds"))) return c; } catch (e) {} }
  return cands[0];
}
const KIT = findKit();

// ── fonts (register once) ────────────────────────────────────────────────────────
let _fontsReady = false;
function ensureFonts() {
  if (_fontsReady) return;
  const F = path.join(KIT, "fonts");
  try {
    const { GlobalFonts } = C();
    GlobalFonts.registerFromPath(path.join(F, "DMSerifDisplay-Regular.ttf"), "DM Serif Display");
    GlobalFonts.registerFromPath(path.join(F, "DMSans-Regular.ttf"), "DM Sans");
    GlobalFonts.registerFromPath(path.join(F, "DMMono-Regular.ttf"), "DM Mono");
  } catch (e) { /* fall back to system stand-ins (proofs only) */ }
  _fontsReady = true;
}

// ── palette + ground metadata (Spec sections 1 + 3) ──────────────────────────────
const PARCH = "#f5f0e8", INK = "#0a0908", SMOKE = "#8a8578", UMBER = "#6b655b";
const GOLD = "#c9a84c", GOLD_DEEP = "#a8842f";
const LIGHT_GROUNDS = new Set(["parchment", "framed", "first-blush"]);
const GROUND_META = R.GROUNDS; // {mode, use_for} for the six locked grounds
const isLight = (g) => LIGHT_GROUNDS.has(g);

// map an internal format -> ground file suffix
const SUFFIX = { post: "portrait-1080x1350", square: "square-1080x1080", story: "story-1080x1920" };
const DIMS = { post: [1080, 1350], square: [1080, 1080], story: [1080, 1920] };

// eyebrow copy derived from the brief (Spec: eyebrows are CONTENT, not template names)
const PERSONA_EYEBROW = {
  griever: "ON GRIEF", burnt_out: "ON BURNOUT", body_first: "BODY REBUILD",
  stretched: "CARRYING A LOT", drinker_user: "NO LABEL REQUIRED", universal: "",
};
const PROGRAM_EYEBROW = {
  reset_814: "THE 8:14 RESET", riley_guide: "MEET RILEY", riley_companion: "MEET RILEY",
  riley_coach: "MEET RILEY", riley_mentor: "MEET RILEY", none: "",
};
function deriveEyebrow(brief) {
  return PERSONA_EYEBROW[brief.persona] || PROGRAM_EYEBROW[brief.program_tie] || "";
}

// ── typography helpers (canvas port of the Pillow engine) ────────────────────────
function wrap(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
// shrink-to-fit: largest size in [min,start] where the wrapped block fits maxW x maxH
function fitHeadline(ctx, text, { maxW, maxH, start = 96, min = 30, lh = 1.16, family = "DM Serif Display" }) {
  let size = start;
  while (size > min) {
    ctx.font = `${size}px "${family}"`;
    const lines = wrap(ctx, text, maxW);
    const h = lines.length * size * lh;
    if (h <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines, lineH: size * lh };
    size -= 4;
  }
  ctx.font = `${min}px "${family}"`;
  return { size: min, lines: wrap(ctx, text, maxW), lineH: min * lh };
}
function drawTracked(ctx, text, cx, y, { size, tracking, fill, family = "DM Mono" }) {
  ctx.font = `${size}px "${family}"`; ctx.fillStyle = fill;
  const chars = [...String(text)];
  const total = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + tracking * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  for (const ch of chars) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + tracking; }
}
// headline block, centered, gold period on the final line if it ends in '.'
function drawHeadline(ctx, text, W, cy, { maxW, maxH, start, textColor, goldColor }) {
  const { size, lines, lineH } = fitHeadline(ctx, text, { maxW, maxH, start });
  ctx.font = `${size}px "DM Serif Display"`;
  let y = cy - (lines.length * lineH) / 2 + lineH * 0.78;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const last = i === lines.length - 1;
    const gp = last && line.endsWith(".") && !line.endsWith("..");
    const body = gp ? line.slice(0, -1) : line;
    const full = ctx.measureText(line).width;
    const x = (W - full) / 2;
    ctx.fillStyle = textColor; ctx.fillText(body, x, y);
    if (gp) { ctx.fillStyle = goldColor; ctx.fillText(".", x + ctx.measureText(body).width, y); }
    y += lineH;
  }
  return y;
}

// ── render one asset ──────────────────────────────────────────────────────────────
async function renderAsset({ ground, layout, format, eyebrow, headline }) {
  ensureFonts();
  const { createCanvas, loadImage } = C();
  const [W, H] = DIMS[format] || DIMS.post;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const light = isLight(ground);
  const textColor = light ? INK : PARCH;
  const goldColor = light ? GOLD_DEEP : GOLD;

  // ground
  const g = await loadImage(path.join(KIT, "grounds", `${ground}--${SUFFIX[format] || SUFFIX.post}.png`));
  ctx.drawImage(g, 0, 0, W, H);

  const story = format === "story";
  const M = 104;
  // eyebrow (hook) or sun-dot (body)
  if (layout === "hook" && eyebrow) {
    drawTracked(ctx, String(eyebrow).toUpperCase(), W / 2, story ? 300 : 150, { size: 26, tracking: 26 * 0.34, fill: goldColor });
  } else {
    const r = 9, yd = story ? 240 : 206;
    ctx.beginPath(); ctx.fillStyle = goldColor; ctx.arc(W / 2, yd, r, 0, Math.PI * 2); ctx.fill();
  }
  // headline
  const cy = story ? 830 : 620;
  const start = story ? 96 : 100;
  drawHeadline(ctx, headline, W, cy, { maxW: W - 208, maxH: story ? 700 : 620, start, textColor, goldColor });

  // gold URL line on stories
  if (story) drawTracked(ctx, "MEETRILEY.US", W / 2, H - 360, { size: 28, tracking: 10, fill: goldColor });

  // nav lockup (Spec section 5: dark -> white word, light -> ink word; no maker's mark)
  try {
    const nav = await loadImage(path.join(KIT, light ? "riley-nav-ink.png" : "riley-nav-logo.png"));
    const nw = story ? 190 : 180, nh = (nav.height * nw) / nav.width;
    const yb = story ? 118 : 78;
    ctx.drawImage(nav, (W - nw) / 2, H - nh - yb, nw, nh);
  } catch (e) { /* nav missing - skip */ }

  return { buffer: canvas.toBuffer("image/png"), width: W, height: H };
}

// ── design assignment via the rotation rules ──────────────────────────────────────
const HEAVY_RE = /grief|grieve|mourn|loss|lost|died|death|slip|relapse|2\s?am|rock bottom|alone/i;
async function recentHistory(db) {
  // reconstruct a rotation history from recent riley-grounds assets (for the run rules)
  const { data } = await db.from("content_creative_assets")
    .select("render_payload, created_at").eq("render_engine", "riley-grounds")
    .order("created_at", { ascending: false }).limit(12);
  return (data || []).reverse().map((a) => a.render_payload).filter((p) => p && p.ground)
    .map((p) => ({ format: p.format, ground: p.ground, mode: GROUND_META[p.ground] ? GROUND_META[p.ground].mode : "dark", layout: p.layout }));
}
function assignDesign(brief, history, override) {
  const at = Array.isArray(brief.asset_types) ? brief.asset_types : [];
  const format = at.includes("story") ? "story" : "post";
  const eyebrow = deriveEyebrow(brief);
  const layout = override && override.layout ? override.layout : (eyebrow ? "hook" : "body");
  let ground = override && override.ground;
  if (!ground) {
    const txt = `${brief.headline_hook || ""} ${brief.caption || ""} ${brief.design_notes || ""}`;
    if (brief.persona === "griever" || HEAVY_RE.test(txt)) ground = "veil"; // Spec: heavy -> Veil
    else {
      const pick = R.nextPick(history, { format, seed: (history.length + 1) * 7 });
      ground = pick ? pick.ground : "first-light";
    }
  }
  return { ground, layout, format, eyebrow };
}

// ── renderBrief: the pipeline entry point ─────────────────────────────────────────
async function renderBrief(briefId, opts = {}) {
  const db = contentDb();
  const { data: brief } = await db.from("content_briefs").select("*").eq("id", briefId).single();
  if (!brief) return { designed: false, reason: "brief not found" };

  await db.from("content_briefs").update({ status: "in_design" }).eq("id", briefId);

  const history = await recentHistory(db);
  const design = assignDesign(brief, history, opts.override);
  const headline = brief.headline_hook || (brief.caption || "").split(/[.!?\n]/)[0] || "Start where you are.";
  const platform = (Array.isArray(brief.platforms) && brief.platforms[0]) || "instagram";
  const assetType = design.format === "story" ? "story" : "static";

  let asset = null;
  try {
    const { buffer, width, height } = await renderAsset({ ...design, headline });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${briefId}-${design.ground}-${design.format}.png`;
    const storagePath = `designs/${stamp}/${filename}`;
    let fileUrl = null;
    const up = await db.storage.from(BUCKET).upload(storagePath, buffer, { contentType: "image/png", upsert: true });
    if (!up.error) fileUrl = db.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
    else return { designed: false, reason: `storage upload failed: ${up.error.message}` };

    const altText = `${headline} - Riley`.slice(0, 125);
    const payload = { ground: design.ground, layout: design.layout, format: design.format, eyebrow: design.eyebrow, headline };
    const { data: row } = await db.from("content_creative_assets").insert({
      brief_id: briefId,
      asset_type: assetType,
      platform: ["instagram","tiktok","linkedin","facebook","youtube_shorts","pinterest","x"].includes(platform) ? platform : "instagram",
      render_engine: "riley-grounds",
      template_id: `${design.format}:${design.ground}:${design.layout}`,
      file_url: fileUrl,
      storage_path: storagePath,
      alt_text: altText,
      filename,
      dimensions: `${width}x${height}`,
      render_payload: payload,
      qa_passed: altText.length <= 125,
    }).select().single();
    asset = row;
  } catch (e) {
    await db.from("content_briefs").update({ status: "brief" }).eq("id", briefId);
    return { designed: false, reason: `render failed: ${e.message}` };
  }

  await db.from("content_briefs").update({ status: "designed" }).eq("id", briefId);
  return { designed: !!asset, assets: asset ? [asset] : [], design };
}

// ── the six-grounds gallery (Designs tab) ─────────────────────────────────────────
async function galleryThumb(ground) {
  const { createCanvas, loadImage } = C();
  const canvas = createCanvas(240, 240);
  const ctx = canvas.getContext("2d");
  const img = await loadImage(path.join(KIT, "grounds", `${ground}--square-1080x1080.png`));
  ctx.drawImage(img, 0, 0, 240, 240);
  return canvas.toBuffer("image/png").toString("base64");
}
async function gallery() {
  const grounds = [];
  for (const g of Object.keys(GROUND_META)) {
    let thumb = null; try { thumb = await galleryThumb(g); } catch (e) {}
    grounds.push({ ground: g, mode: GROUND_META[g].mode, use_for: GROUND_META[g].use_for, thumb });
  }
  return {
    grounds,
    layouts: [
      { key: "hook", label: "Hook", desc: "Eyebrow + headline. Feed lead / single posts." },
      { key: "body", label: "Body", desc: "Sun-dot + headline. Interior / calm posts." },
      { key: "story", label: "Story", desc: "1080x1920 with the MEETRILEY.US line." },
    ],
    rules: "Rotation (template-rotation.js): never the same template >2x in a row; never >3 dark or >3 light in a row; weekly mix of post/story/reel/carousel; Week 1 all Riley/launch; Weeks 2-4 >=4 Riley posts.",
  };
}

function json(status, data) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireOperator(event); if (gate) return gate; // model-cost/tamper: operator only
  try {
    if (event.httpMethod === "GET") {
      const q = event.queryStringParameters || {};
      if (q.view === "gallery") return json(200, await gallery());
      if (q.asset) {
        const safe = String(q.asset).replace(/\.\.+/g, "").replace(/^\/+/, "");
        const p = path.join(KIT, safe);
        if (!p.startsWith(KIT) || !fs.existsSync(p)) return json(404, { error: "not found" });
        return json(200, { dataUrl: `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` });
      }
      return json(400, { error: "unknown view" });
    }
    const body = JSON.parse(event.body || "{}");
    if (body.action === "render") {
      if (!body.brief_id) return json(400, { error: "brief_id required" });
      return json(200, await renderBrief(body.brief_id));
    }
    if (body.action === "swap") {
      if (!body.brief_id || !body.ground) return json(400, { error: "brief_id and ground required" });
      const db = contentDb();
      // remove prior riley-grounds assets for this brief, then re-render with the chosen ground
      await db.from("content_creative_assets").delete().eq("brief_id", body.brief_id).eq("render_engine", "riley-grounds");
      return json(200, await renderBrief(body.brief_id, { override: { ground: body.ground, layout: body.layout } }));
    }
    return json(400, { error: "unknown action" });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

exports.renderBrief = renderBrief;
exports.assignDesign = assignDesign;
exports.renderAsset = renderAsset;
exports.gallery = gallery;
