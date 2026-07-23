/**
 * calendar-callback.js - Phase 2 OAuth redirect target (handoff §2.3).
 * Registered in Google Cloud as https://riley.meetriley.us/.netlify/functions/calendar-callback
 *
 * Verifies the signed state (10-min expiry), exchanges the code, ENCRYPTS the refresh
 * token (AES-256-GCM, CAL_TOKEN_KEY) and upserts calendar_connections, then redirects
 * to /dashboard?calendar=connected. Any failure lands on /dashboard?calendar=error -
 * no error internals in the URL.
 */
"use strict";

const { getSupabaseClient } = require("./supabase-client");
const cal = require("./calendar-google");

const DASH = "https://riley.meetriley.us/dashboard";
const go = (qs) => ({ statusCode: 302, headers: { Location: DASH + qs, "Cache-Control": "no-store" }, body: "" });

exports.handler = async (event) => {
  if (!cal.calGoogleEnabled()) return go("");
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "" };
  const q = event.queryStringParameters || {};
  if (q.error) return go("?calendar=declined");

  const userId = cal.verifyState(q.state);
  if (!userId || !q.code) return go("?calendar=error");

  try {
    const tok = await cal.exchangeCode(q.code);
    if (!tok.refresh_token) return go("?calendar=error"); // consent w/o offline grant - retry with prompt=consent
    const sb = getSupabaseClient();
    await sb.from("calendar_connections").upsert({
      member_id: userId,
      provider: "google",
      refresh_token_enc: cal.encryptToken(tok.refresh_token),
      granted_scopes: tok.scope || cal.SCOPE,
      connected_at: new Date().toISOString(),
    });
    try { await sb.from("calendar_digest_cache").delete().eq("member_id", userId); } catch (e) {}
    return go("?calendar=connected");
  } catch (e) {
    console.error("calendar-callback:", e.message);
    return go("?calendar=error");
  }
};
