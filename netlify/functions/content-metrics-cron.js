/**
 * content-metrics-cron.js - Phase 3 learning loop (scheduled nightly 23:30 MT).
 *
 * 1. For each published publishing_job with a buffer_post_id, pull Buffer's
 *    per-post statistics -> content_performance_metrics.
 * 2. Once a week (Sundays), summarize what performed by persona + platform +
 *    template and store a digest in content_learnings. Sage reads the latest
 *    digest on every brief so the engine gradually learns what the audience
 *    actually wants.
 *
 * GATED + NON-FATAL: needs BUFFER_API_TOKEN. Without it, the metrics pull is
 * skipped (the digest step still runs on whatever metrics exist).
 */

const { contentDb, loadPrompt, callClaude, extractJson, notify, requireScheduledOrOperator } = require("./content-lib");

const BUFFER_API = "https://api.bufferapp.com/1";

async function pullBufferMetrics(db) {
  const token = process.env.BUFFER_API_TOKEN;
  if (!token) return { pulled: 0, skipped: "no BUFFER_API_TOKEN" };

  // Published jobs from the last 30 days that have a Buffer id
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: jobs } = await db.from("content_publishing_jobs")
    .select("id, buffer_post_id, platform")
    .eq("state", "published")
    .gte("created_at", since)
    .not("buffer_post_id", "is", null)
    .limit(200);

  let pulled = 0;
  for (const job of jobs || []) {
    if (!job.buffer_post_id || job.buffer_post_id === "scheduled") continue;
    try {
      const r = await fetch(`${BUFFER_API}/updates/${job.buffer_post_id}.json?access_token=${token}`);
      if (!r.ok) continue;
      const u = await r.json();
      const s = u.statistics || {};
      await db.from("content_performance_metrics").insert({
        job_id: job.id,
        impressions: s.impressions || s.reach || 0,
        reach: s.reach || 0,
        likes: s.favorites || s.likes || 0,
        comments: s.comments || 0,
        shares: s.shares || s.retweets || 0,
        saves: s.saves || 0,
        clicks: s.clicks || 0,
        follows: s.follows || 0,
        video_views: s.video_views || 0,
      });
      pulled++;
    } catch (e) { console.warn("buffer metric pull failed for job", job.id, e.message); }
  }
  return { pulled };
}

// Weekly digest - runs only on Sundays. Summarizes recent performance so Sage learns.
async function weeklyDigest(db) {
  const today = new Date();
  if (today.getUTCDay() !== 0) return { skipped: "not Sunday" };

  // Join last 14 days of metrics with their post's persona/platform via approval->brief
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: jobs } = await db.from("content_publishing_jobs")
    .select("id, platform, caption_final, approval_id, created_at")
    .eq("state", "published").gte("created_at", since).limit(200);
  if (!jobs || !jobs.length) return { skipped: "no published jobs" };

  const jobIds = jobs.map((j) => j.id);
  const { data: metrics } = await db.from("content_performance_metrics")
    .select("*").in("job_id", jobIds);
  if (!metrics || !metrics.length) return { skipped: "no metrics yet" };

  // Build a compact performance table for the LLM
  const byJob = {};
  metrics.forEach((m) => { byJob[m.job_id] = m; });
  const rows = jobs.filter((j) => byJob[j.id]).map((j) => {
    const m = byJob[j.id];
    const eng = (m.likes || 0) + (m.comments || 0) + (m.shares || 0) + (m.saves || 0);
    return { platform: j.platform, engagement: eng, clicks: m.clicks || 0, reach: m.reach || 0, caption: (j.caption_final || "").slice(0, 80) };
  });

  const raw = await callClaude({
    system: "You are the 8:14 content analyst. Summarize what performed best/worst by platform and topic from this data. Output JSON: {\"digest\":\"3-5 sentence plain summary with concrete next-week guidance for the content team\",\"top_platforms\":{\"platform\":score},\"guidance\":[\"1-3 short directives for Sage\"]}. Be specific and honest.",
    user: `Last 14 days of published-post performance:\n${JSON.stringify(rows, null, 2)}`,
    maxTokens: 1200,
  });
  const out = extractJson(raw) || {};
  if (out.digest) {
    await db.from("content_learnings").insert({
      digest: out.digest + (out.guidance?.length ? "\n\nSage guidance: " + out.guidance.join("; ") : ""),
      top_platforms: out.top_platforms || {},
    });
    await notify(`📈 Weekly content learnings updated: ${out.digest.slice(0, 140)}`);
  }
  return { digest: !!out.digest };
}

exports.handler = async function (event) {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;
  const db = contentDb();
  try {
    const m = await pullBufferMetrics(db);
    const d = await weeklyDigest(db);
    console.log("[content-metrics]", JSON.stringify({ m, d }));
  } catch (e) {
    console.error("content-metrics-cron error:", e.message);
  }
  return { statusCode: 200, body: "" };
};
