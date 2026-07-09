/**
 * comms-sign.js - HMAC signing for lifecycle-comms email links (unsubscribe / preferences).
 *
 * A raw ?u=<uid> link lets anyone toggle another member's email prefs by guessing/altering the id.
 * We sign the id so only links WE generated are honored for opt-IN actions (resubscribe / letter-on).
 * Opt-OUT is still always honored elsewhere - we never trap a subscriber (RFC 8058 / CAN-SPAM).
 *
 * Secret = COMMS_UNSUB_SECRET (set + rotate in Netlify anytime) with a fallback to SUPABASE_SERVICE_KEY,
 * which is always present server-side - so signing works out of the box with NO new required env var.
 * Sign side: evaluate-comms.js (builds the emailed URLs). Verify side: comms-unsubscribe.js.
 */
const crypto = require("crypto");

function secret() { return process.env.COMMS_UNSUB_SECRET || process.env.SUPABASE_SERVICE_KEY || ""; }

// 128-bit hex tag over the member id. Empty string when no secret is configured (see verifyUid).
function signUid(uid) {
  const s = secret();
  if (!s || !uid) return "";
  return crypto.createHmac("sha256", s).update(String(uid)).digest("hex").slice(0, 32);
}

// True when sig matches (constant-time). If NO secret is configured (misconfig), returns true so a real
// request is never blocked - and the sign side emits no sig in that case, so behavior stays consistent.
function verifyUid(uid, sig) {
  const expected = signUid(uid);
  if (!expected) return true;                                  // no secret -> fail-open, never trap a user
  if (!sig || typeof sig !== "string" || sig.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch (e) { return false; }
}

module.exports = { signUid, verifyUid };
