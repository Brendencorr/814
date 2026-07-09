/**
 * comms-unsubscribe.js - one-click List-Unsubscribe (RFC 8058) + the email-tappable preference links
 * (monthly-letter opt in/out, resubscribe). Handoff Task 6.
 *
 * Identified by ?u=<uid> so it works from an email with no login (one tap). Actions:
 *   (default) / ?action=unsub  → unsubscribed_lifecycle=true
 *   ?lifecycle=1               → unsubscribed_lifecycle=false (resubscribe)
 *   ?letter=1 / ?letter=0      → monthly_letter_optin true/false
 * Transactional email is unaffected (exempt from these prefs, enforced in evaluate-comms).
 *
 * A POST (the one-click header hit) returns 200 with no body. A GET returns a small confirmation page.
 * NOTE: uid-in-URL is fine for launch phase (worst case: someone toggles another user's lifecycle
 * prefs, fully reversible). A signed HMAC token is a pre-launch hardening - flagged.
 */
const { getSupabaseClient } = require("./supabase-client");

const PAGE = (title, msg, uid) =>
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>" + title + " - Riley</title></head>" +
  '<body style="margin:0;background:#0a0908;color:#f5f0e8;font-family:-apple-system,Segoe UI,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">' +
  '<div style="max-width:420px"><div style="width:40px;height:40px;border-radius:50%;margin:0 auto 20px;background:radial-gradient(circle at 40% 35%,#e8d5a3,#c9a84c 55%,#a8842f)"></div>' +
  '<h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 10px">' + title + "</h1>" +
  '<p style="font-size:14px;color:#8a8578;line-height:1.7;margin:0 0 22px">' + msg + "</p>" +
  '<a href="https://riley.meetriley.us/preferences?u=' + encodeURIComponent(uid) + '" style="display:inline-block;background:#c9a84c;color:#0a0908;padding:11px 24px;border-radius:4px;font-size:13px;font-weight:600;text-decoration:none">Manage preferences</a>' +
  "</div></body></html>";

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const uid = (q.u || "").toString().slice(0, 60);
  const patch = { updated_at: new Date().toISOString() };
  let title = "You're unsubscribed", msg = "You won't receive lifecycle emails from Riley anymore. Anything you've bought, and the app itself, keep working exactly the same. You can turn these back on anytime.";

  if (q.lifecycle === "1") { patch.unsubscribed_lifecycle = false; title = "Welcome back"; msg = "Lifecycle emails are on again - never more than one a day, and less if you're already here."; }
  else if (q.letter === "1") { patch.monthly_letter_optin = true; title = "You're on the list"; msg = "You'll get one short letter a month from Brenden about what we're building. That's it."; }
  else if (q.letter === "0") { patch.monthly_letter_optin = false; title = "Kept quiet"; msg = "No monthly letter. Everything you've built is right where you left it, whenever you want it."; }
  else { patch.unsubscribed_lifecycle = true; }

  if (uid) {
    try {
      const sb = getSupabaseClient();
      await sb.from("user_comms_state").upsert({ user_id: uid, ...patch }, { onConflict: "user_id" });
    } catch (e) { /* non-fatal */ }
  }

  if (event.httpMethod === "POST") return { statusCode: 200, body: "" }; // RFC 8058 one-click
  return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: PAGE(title, msg, uid) };
};
