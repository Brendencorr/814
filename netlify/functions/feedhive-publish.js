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
 * Returns: { success, update_id, status } or { error } — same shape callers expect.
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

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const token = process.env.FEEDHIVE_API_KEY;
    if (!token) return json(500, { error: "FEEDHIVE_API_KEY not configured" });

    const body = JSON.parse(event.body || "{}");
    const text = body.text;
    const scheduled_at = body.scheduled_at || null;
    if (!text) return json(400, { error: "text is required" });

    const accounts = await resolveAccounts(token, body.accounts || body.profile_ids);
    if (!accounts.length) return json(400, { error: "no target FeedHive accounts (set FEEDHIVE_ACCOUNT_IDS or connect an account)" });

    // Safety: draft unless a human/env explicitly opts into auto-scheduling.
    const autoSchedule = process.env.FEEDHIVE_AUTOSCHEDULE === "true";
    const status = body.status || (autoSchedule && scheduled_at ? "scheduled" : "draft");

    const payload = { text, accounts, status };
    if (status === "scheduled" && scheduled_at) payload.scheduled_at = scheduled_at;
    if (scheduled_at) payload.notes = `Intended time: ${scheduled_at}`; // preserved even for drafts
    if (Array.isArray(body.media) && body.media.length) payload.media = body.media;
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
