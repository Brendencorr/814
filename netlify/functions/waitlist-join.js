/**
 * waitlist-join.js — membership / à la carte waitlist while payments_live = false.
 *
 * Marketing visitors are anonymous and RLS blocks anon inserts, so this service-role path records
 * the join. Writes a DURABLE, deduped row to `waitlist` (Task 7) AND keeps the canonical
 * `events(name='waitlist_joined')` row that Echo's Phase-2 counter reads. Sends a warm Resend
 * confirmation (no-ops if RESEND_API_KEY is unset). Plan intent is preserved from the CTA.
 *
 * POST { email, plan } -> { ok }
 */
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const RESEND_ENDPOINT = "https://api.resend.com/emails";

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  const from = process.env.RESEND_FROM || "Riley <hello@meetriley.us>";
  try {
    await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch (e) { /* non-fatal */ }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 200);
  const plan = (body.plan || "").toString().slice(0, 40) || null;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "A valid email is required." });

  try {
    const sb = getSupabaseClient();
    // Durable, deduped list (latest plan intent wins).
    await sb.from("waitlist").upsert(
      { email, plan_intent: plan, updated_at: new Date().toISOString() },
      { onConflict: "email" }
    );
    // Canonical analytics event (Echo Phase-2 counter reads these).
    await sb.from("events").insert({ user_id: null, name: "waitlist_joined", props: { email, plan } });
    // Warm confirmation — from the founder's voice.
    await sendEmail(email, "You're on the list — Meet Riley",
      `<div style="font-family:sans-serif;line-height:1.7;color:#222">
        <p>You're on the list.</p>
        <p>Memberships aren't open yet, but you'll be the first to know the moment they are — no charge, no spam, just a quiet note when it's time.</p>
        <p>In the meantime, Riley is already here whenever you want to talk. Come say hello anytime.</p>
        <p>With care,<br>Brenden &amp; Riley</p>
      </div>`);
    return json(200, { ok: true });
  } catch (e) {
    console.error("waitlist-join:", e.message);
    return json(500, { error: "Could not join the waitlist — try again." });
  }
};
