/**
 * link-health-check.js — nightly link health for the live content library.
 *
 * Scheduled (netlify.toml: 09:00 UTC = 3am MT); a schedule makes it a background fn
 * (no synchronous timeout). HEADs every approved+active content_url; only a DEFINITIVE
 * dead signal (HTTP 404/410, or an ENOTFOUND domain) flips link_status → 'broken'.
 * Bot-blocks (403/405→GET/429), 5xx, and timeouts are treated as OK so we never
 * false-hide a live Spotify/YouTube link. Broken items drop from client surfacing
 * (match-content filters link_status==='ok'); recovered links flip back to ok.
 * Model: n/a
 */
const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");

const TIMEOUT_MS = 8000;
const CONCURRENCY = 10;

// Returns 'ok' | 'broken'. Defaults to OK on anything ambiguous — never false-reject a live link.
async function checkOne(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "broken";
  const dead = (s) => s === 404 || s === 410;
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 405 || res.status === 501) { // HEAD not allowed → confirm with GET
      res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    }
    return dead(res.status) ? "broken" : "ok";
  } catch (e) {
    const code = (e && e.cause && e.cause.code) || "";
    return code === "ENOTFOUND" ? "broken" : "ok"; // domain gone = broken; timeouts/resets = transient → ok
  }
}

async function runLinkHealth(supabase) {
  const { data: rows, error } = await supabase
    .from("content_library")
    .select("id, content_url")
    .eq("approval_status", "approved")
    .eq("is_active", true);
  if (error) throw error;
  const list = (rows || []).filter((r) => r.content_url);

  let ok = 0, broken = 0;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const chunk = list.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (r) => {
      const status = await checkOne(r.content_url);
      if (status === "broken") broken++; else ok++;
      try {
        await supabase.from("content_library")
          .update({ link_status: status, link_checked_at: new Date().toISOString() })
          .eq("id", r.id);
      } catch (_) {}
    }));
  }
  return { checked: list.length, ok, broken };
}

exports.handler = async (event) => {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;
  try {
    const supabase = getSupabaseClient();
    const result = await runLinkHealth(supabase);
    console.log("link-health:", JSON.stringify(result));
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (e) {
    console.error("link-health error:", e.message);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};
