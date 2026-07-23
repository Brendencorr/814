/**
 * calendar-connect.js - Phase 2 (handoff §2.3). FLAG-GATED: 404 until
 * CALENDAR_GOOGLE_ENABLED=true (post Google verification).
 *
 * GET  ?token={supabase access token}   -> 302 to Google's consent screen
 * POST {token, action:"status"}         -> {enabled, connected} for the connect card
 */
"use strict";

const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");
const cal = require("./calendar-google");

exports.handler = async (event) => {
  if (!cal.calGoogleEnabled()) return { statusCode: 404, body: "" };
  const sb = getSupabaseClient();

  if (event.httpMethod === "POST") {
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (e) {}
    const userId = await getUserIdFromToken(sb, body.token);
    if (!userId) return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
    if (body.action === "status") {
      let connected = false;
      try {
        const { data } = await sb.from("calendar_connections").select("member_id").eq("member_id", userId).maybeSingle();
        connected = !!data;
      } catch (e) {}
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, connected }) };
    }
    // POST default: hand the client the consent URL (for fetch-then-navigate flows).
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: cal.authUrl(userId) }) };
  }

  if (event.httpMethod === "GET") {
    const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
    const userId = await getUserIdFromToken(sb, token);
    if (!userId) return { statusCode: 302, headers: { Location: "https://riley.meetriley.us" }, body: "" };
    return { statusCode: 302, headers: { Location: cal.authUrl(userId), "Cache-Control": "no-store" }, body: "" };
  }

  return { statusCode: 405, body: "" };
};
