/**
 * admin-home.js — powers the operator Home dashboard.
 *   GET                       → full analytics blob (admin_home_analytics)
 *   GET ?detail=<kind>&val=.. → drill-down rows (admin_home_detail)
 *
 * detail kinds: total | active | new | logins | messages | page | click
 * (page/click take val=<page|target>; logins/messages accept optional val=MM-DD)
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
    const q = event.queryStringParameters || {};
    if (q.detail) {
      const { data, error } = await db.rpc("admin_home_detail", { kind: q.detail, val: q.val || null });
      if (error) throw error;
      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ rows: data || [] }) };
    }
    const { data, error } = await db.rpc("admin_home_analytics");
    if (error) throw error;
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data || {}) };
  } catch (err) {
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: err.message }) };
  }
};
