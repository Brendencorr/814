/**
 * feedhive-publish.js
 * Create/schedule a single post in FeedHive (replaces the old Buffer integration).
 *
 * POST body: { text, scheduled_at?, accounts?, media?, labels?, status? }
 *   - accounts: FeedHive social account IDs. If omitted, resolves from the
 *     FEEDHIVE_ACCOUNT_IDS env (comma-separated), else ALL active connected accounts.
 *   - profile_ids: accepted as an alias for accounts (Buffer drop-in compatibility).
 *
 * SAFETY DEFAULT: posts are created as "draft" so nothing publishes to the public
 * IG/FB accounts without a human approving/scheduling them inside FeedHive. Set the
 * env FEEDHIVE_AUTOSCHEDULE=true to let the pipeline auto-schedule (status "scheduled"
 * with the given scheduled_at). A caller can also force status explicitly in the body.
 *
 * Returns: { success, update_id, status } or { error } - same shape callers expect.
 */

const FEEDHIVE_API = "https://api.feedhive.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (statusCode, data) => ({
  statusCode,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

// Target accounts: explicit list → FEEDHIVE_ACCOUNT_IDS env → all ACTIVE connected accounts.
async function resolveAccounts(token, provided) {
  if (Array.isArray(provided) && provided.length) return provided;
  const envIds = (process.env.FEEDHIVE_ACCOUNT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (envIds.length) return envIds;
  try {
    const r = await fetch(`${FEEDHIVE_API}/socials`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    return (j?.data?.items || []).filter((a) => a.status === "active").map((a) => a.id);
  } catch (_) { return []; }
}

// FeedHive attaches media by ID, not URL. Upload a public image URL through the
// 3-step flow (create session -> PUT to S3 -> complete) and return the media record id.
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime" };
async function uploadMediaFromUrl(token, url) {
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`fetch media ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const clean = String(url).split("?")[0];
  const filename = clean.split("/").pop() || "image.png";
  const ext = (filename.split(".").pop() || "png").toLowerCase();
  const contentType = imgRes.headers.get("content-type") || MIME[ext] || "image/png";
  // 1) create upload session
  const sess = await fetch(`${FEEDHIVE_API}/media/uploads`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filename, content_type: contentType }),
  });
  const sj = await sess.json().catch(() => ({}));
  const up = sj && sj.data;
  if (!sess.ok || !up || !up.upload_url || !up.upload_id) throw new Error("upload session failed: " + JSON.stringify(sj).slice(0, 160));
  // 2) PUT the bytes to the signed S3 URL (same content-type)
  const put = await fetch(up.upload_url, { method: "PUT", headers: { "Content-Type": contentType }, body: buf });
  if (!put.ok) throw new Error(`S3 PUT ${put.status}`);
  // 3) complete -> media record id
  const comp = await fetch(`${FEEDHIVE_API}/media/uploads/${encodeURIComponent(up.upload_id)}/complete`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` },
  });
  const cj = await comp.json().catch(() => ({}));
  if (!comp.ok || !cj || !cj.data || !cj.data.id) throw new Error("complete failed: " + JSON.stringify(cj).slice(0, 160));
  return cj.data.id;
}

// Normalize a caller's `media` (URLs or {url} objects) + `media_ids` (already uploaded)
// into an array of FeedHive media IDs, uploading any URLs. Best-effort per item.
async function resolveMediaIds(token, body) {
  const ids = Array.isArray(body.media_ids) ? body.media_ids.filter((x) => typeof x === "string" && x) : [];
  const urls = [];
  if (Array.isArray(body.media)) {
    for (const m of body.media) {
      const u = typeof m === "string" ? m : (m && m.url);
      if (u && typeof u === "string" && /^https?:\/\//.test(u)) urls.push(u);
    }
  }
  for (const u of urls) {
    try { ids.push(await uploadMediaFromUrl(token, u)); }
    catch (e) { console.error("feedhive media upload failed (skipped):", u, e.message); }
  }
  return ids;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // SECURITY: operator-only. This publishes to REAL Instagram/Facebook - it must never be reachable
  // unauthenticated (a public POST could post spam/abuse to the recovery brand + drain the FeedHive
  // quota). Called server-to-server by the pipeline + content-queue, which send x-operator-key.
  const _opk = process.env.OPERATOR_KEY;
  if (!_opk) return json(503, { error: "OPERATOR_KEY not configured" });
  if ((event.headers["x-operator-key"] || event.headers["X-Operator-Key"]) !== _opk) return json(401, { error: "Unauthorized" });

  try {
    const token = process.env.FEEDHIVE_API_KEY;
    if (!token) return json(500, { error: "FEEDHIVE_API_KEY not configured" });

    const body = JSON.parse(event.body || "{}");

    // ── GLOBAL HOLD SWITCH ──────────────────────────────────────────────────────
    // The single choke point for ALL FeedHive activity (every publisher path goes
    // through here). Default = 'hold': NOTHING is sent to FeedHive - no posts, no
    // drafts, no media uploads - until the operator gives the go-ahead by setting
    // SOCIAL_PUBLISH_MODE=draft (FeedHive drafts) or =live (scheduled/live).
    const publishMode = (process.env.SOCIAL_PUBLISH_MODE || "hold").toLowerCase();
    if (publishMode === "hold") {
      return json(200, { success: false, held: true, error: "Publishing is on hold (SOCIAL_PUBLISH_MODE=hold) - nothing sent to FeedHive." });
    }

    // Media pre-upload endpoint: upload once, reuse the IDs across N posts (avoids
    // re-uploading the same image per platform). content-queue calls this before its loop.
    if (body.action === "upload_media") {
      const urls = Array.isArray(body.urls) ? body.urls : [];
      const media_ids = await resolveMediaIds(token, { media: urls });
      return json(200, { success: true, media_ids });
    }

    const text = body.text;
    const scheduled_at = body.scheduled_at || null;
    if (!text) return json(400, { error: "text is required" });

    const accounts = await resolveAccounts(token, body.accounts || body.profile_ids);
    if (!accounts.length) return json(400, { error: "no target FeedHive accounts (set FEEDHIVE_ACCOUNT_IDS or connect an account)" });

    // Safety default = draft (CODE_SPEC §A7: FEEDHIVE_MODE=draft|live, default draft). Draft means
    // nothing auto-publishes - a human approves/schedules in FeedHive. "live" only schedules items the
    // pipeline already routed here (approval still gates upstream). Phase A will move this to a
    // DB-stored setting (admin toggle, no redeploy); the env var is the bootstrap default.
    const mode = (process.env.FEEDHIVE_MODE || "draft").toLowerCase();
    // Draft-vs-live. This endpoint is already operator-key-gated, so the trusted caller
    // (content-queue on Approve) may request live scheduling via `schedule:true` (still requires
    // a scheduled_at). FEEDHIVE_MODE=live is a second path. A forged body can't pass the
    // operator-key check above, so this doesn't weaken draft-safety for the public.
    const wantSchedule = body.schedule === true || mode === "live";
    const status = (wantSchedule && scheduled_at) ? "scheduled" : "draft";

    const payload = { text, accounts, status };
    if (status === "scheduled" && scheduled_at) payload.scheduled_at = scheduled_at;
    if (scheduled_at) payload.notes = `Intended time: ${scheduled_at}`; // preserved even for drafts
    // FeedHive wants media as an array of uploaded media IDs. Accept pre-uploaded
    // media_ids, or media URLs/objects (which we upload here), and attach the IDs.
    const mediaIds = await resolveMediaIds(token, body);
    if (mediaIds.length) payload.media = mediaIds;
    if (Array.isArray(body.labels) && body.labels.length) payload.labels = body.labels;

    const res = await fetch(`${FEEDHIVE_API}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error("FeedHive returned non-JSON: " + raw.slice(0, 200)); }

    if (!res.ok || data.success === false) {
      return json(502, { error: "FeedHive API error", detail: data.error || data.message || raw.slice(0, 300) });
    }

    const post = data.data || data;
    return json(200, { success: true, update_id: post.id || null, status: post.status || status });
  } catch (err) {
    console.error("feedhive-publish error:", err);
    return json(500, { error: "Internal server error: " + err.message });
  }
};
