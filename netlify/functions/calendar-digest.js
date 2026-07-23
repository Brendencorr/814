/**
 * calendar-digest.js - Phase 2 QA endpoint (handoff §2.3 marks the digest INTERNAL:
 * the morning-brief generator and chat context builder import getDigest() from
 * calendar-google.js in-process). This endpoint exists only so a signed-in tester
 * can inspect their own digest during Testing-mode QA. Flag-gated like the rest.
 *
 * POST {token} -> { digest } (null when not connected)
 */
"use strict";

const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");
const cal = require("./calendar-google");

exports.handler = async (event) => {
  if (!cal.calGoogleEnabled()) return { statusCode: 404, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
  const digest = await cal.getDigest(sb, userId);
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ digest }) };
};
