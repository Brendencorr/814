/**
 * admin-home.js — one call powering the operator Home dashboard.
 * Returns the full client-engagement analytics blob from a single scale-safe
 * SQL function (admin_home_analytics): client counts, 14-day login & Riley
 * message series, top pages, top clicks, and the last-active client list.
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.rpc("admin_home_analytics");
    if (error) throw error;
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data || {}) };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
