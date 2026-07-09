/**
 * operator-notify.js - shared web-push sender for OPERATOR/ADMIN devices.
 *
 * Reads operator_push_subscriptions (service-key only) and pushes to every ACTIVE
 * device. FULLY fault-tolerant: never throws (must not break the caller - e.g. the
 * signup flow in auth-handler). Dead subscriptions (404/410) are auto-deactivated.
 * Payloads carry identity metadata only (member name + email) - NEVER conversation
 * content, matching the operator trust boundary.
 * Model: n/a
 */
const webpush = require("web-push");
const { getVapidConfig } = require("./supabase-client");

async function vapidReady() {
  const { publicKey, privateKey, subject } = await getVapidConfig();
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return true;
  } catch (_) { return false; }
}

// Send `payload` ({ title, body, url, tag }) to every ACTIVE operator device.
// Returns { ok, sent, devices, pruned }. Swallows every error - safe to await in a
// user-facing flow.
async function sendToAllOperators(supabase, payload) {
  try {
    if (!(await vapidReady())) return { ok: false, reason: "no-vapid", sent: 0 };
    const { data: devices } = await supabase
      .from("operator_push_subscriptions")
      .select("endpoint, subscription")
      .eq("active", true);
    if (!devices || !devices.length) return { ok: true, sent: 0, devices: 0 };

    const msg = JSON.stringify(payload || {});
    const dead = [];
    let sent = 0;
    await Promise.allSettled(devices.map(async (d) => {
      try {
        await webpush.sendNotification(d.subscription, msg);
        sent++;
      } catch (e) {
        // 404/410 = the browser dropped the subscription → stop sending to it.
        if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.push(d.endpoint);
        // other codes (429/5xx) are transient - leave the device active for next time.
      }
    }));

    if (dead.length) {
      try { await supabase.from("operator_push_subscriptions").update({ active: false }).in("endpoint", dead); } catch (_) {}
    }
    if (sent) {
      try { await supabase.from("operator_push_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("active", true); } catch (_) {}
    }
    return { ok: true, sent, devices: devices.length, pruned: dead.length };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || "error", sent: 0 };
  }
}

module.exports = { sendToAllOperators };
