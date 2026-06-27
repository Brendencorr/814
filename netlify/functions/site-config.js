/**
 * site-config.js
 * Serves public frontend configuration from environment variables.
 * Keeps credentials out of static HTML source files.
 *
 * GET /.netlify/functions/site-config
 * Returns: { supabaseUrl, supabaseAnonKey }
 *
 * Note: SUPABASE_ANON_KEY is safe to expose in browser responses —
 * it is the public key and all data access is protected by Supabase RLS.
 */

exports.handler = async function (event) {
  const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const supabaseUrl     = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("site-config: SUPABASE_URL or SUPABASE_ANON_KEY not set");
    return {
      statusCode: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server configuration error — Supabase env vars not set" }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300", // cache for 5 min — values rarely change
    },
    body: JSON.stringify({ supabaseUrl, supabaseAnonKey }),
  };
};
