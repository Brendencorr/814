/**
 * site-content.js — PUBLIC read path for marketing-page overrides.
 *
 * GET /.netlify/functions/site-content?page=home
 *   → { page, overrides: { <key>: { kind, props } } }
 *
 * The marketing pages call this on load and apply any overrides on top of their
 * hardcoded defaults (see site-cms.js). Read-only; returns an empty map on any
 * error so a page always falls back to its shipped content.
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const page = (event.queryStringParameters && event.queryStringParameters.page) || "";
  if (!page) {
    return { statusCode: 400, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "page required" }) };
  }

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from("site_content").select("key,kind,props").eq("page", page);
    if (error) throw error;
    const overrides = {};
    (data || []).forEach((r) => { overrides[r.key] = { kind: r.kind, props: r.props || {} }; });
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=20" },
      body: JSON.stringify({ page, overrides }),
    };
  } catch (err) {
    console.error("site-content error:", err.message);
    // Never break the marketing page — fall back to shipped content.
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ page, overrides: {} }) };
  }
};
