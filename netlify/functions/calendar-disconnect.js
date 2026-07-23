/**
 * calendar-disconnect.js - Phase 2 (handoff §2.3).
 * POST {token} -> revoke at Google -> delete connection + cache rows -> 200.
 * UI confirms: "Disconnected. Riley no longer sees your calendar."
 * Works even with the feature flag OFF - a member must always be able to sever access.
 */
"use strict";

const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");
const cal = require("./calendar-google");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };

  try {
    const { data: conn } = await sb.from("calendar_connections")
      .select("refresh_token_enc").eq("member_id", userId).maybeSingle();
    if (conn) {
      try { await cal.revokeAtGoogle(cal.decryptToken(conn.refresh_token_enc)); } catch (e) {}
    }
    await cal.deleteConnection(sb, userId);
    emitEvent(sb, userId, "calendar_disconnected", {});
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("calendar-disconnect:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: "disconnect_failed" }) };
  }
};
