/**
 * waitlist-join.js — Doc 1 §4: membership / à la carte waitlist while payments_live = false.
 *
 * Marketing visitors are anonymous, and the `events` table's RLS blocks anon inserts, so this
 * server path (service key) is required to record the canonical `waitlist_joined` event. Isolated
 * + safe — nothing else depends on it. The admin waitlist (Doc 3 §Phase 3) reads these events.
 *
 * POST { email, plan } → { ok }. Emits events(name='waitlist_joined', props={ email, plan }).
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const plan = (body.plan || "").toString().slice(0, 40) || null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "A valid email is required." });

  try {
    const sb = getSupabaseClient();
    await sb.from("events").insert({ user_id: null, name: "waitlist_joined", props: { email, plan } });
    return json(200, { ok: true });
  } catch (e) {
    console.error("waitlist-join:", e.message);
    return json(500, { error: "Could not join the waitlist — try again." });
  }
};
