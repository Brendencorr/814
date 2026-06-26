/**
 * pipeline-status.js
 * Read-only dashboard data endpoint.
 * Returns recent pipeline_runs, echo_scores, and published_posts.
 * GET /.netlify/functions/pipeline-status
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const supabase = getSupabaseClient();

    const [runsRes, scoresRes, postsRes, scoutRes] = await Promise.all([
      supabase
        .from("pipeline_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("echo_scores")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(4),
      supabase
        .from("published_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(48),
      supabase
        .from("scout_history")
        .select("top_theme, topics_covered, pillars_covered, week_of")
        .order("week_of", { ascending: false })
        .limit(1),
    ]);

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        pipeline_runs: runsRes.data || [],
        echo_scores:   scoresRes.data || [],
        published_posts: postsRes.data || [],
        latest_scout:  scoutRes.data?.[0] || null,
      }),
    };
  } catch (err) {
    console.error("pipeline-status error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error: " + err.message }),
    };
  }
};
