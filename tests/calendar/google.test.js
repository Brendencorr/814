/**
 * google.test.js - Phase 2 acceptance gates that can run without Google (handoff §2.4).
 * Gate 2 (encrypted-only refresh tokens) and gate 3 (cache TTL <= 15 min, no raw events)
 * run as SOURCE gates; state signing and digest reduction run as unit tests.
 * Run: node tests/calendar/google.test.js   (pure - no DB, no network; sets a test key)
 */
"use strict";
process.env.CAL_TOKEN_KEY = "ab".repeat(32); // deterministic 32-byte test key
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cal = require("../../netlify/functions/calendar-google");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok - " + name); }
  catch (e) { failures++; console.error("  FAIL - " + name + "\n    " + e.message); }
}
const src = (f) => fs.readFileSync(path.join(__dirname, "../../netlify/functions", f), "utf8");

console.log("calendar google - encryption, state, digest reduction, source gates");

check("feature flag defaults OFF", () => {
  delete process.env.CALENDAR_GOOGLE_ENABLED;
  assert.strictEqual(cal.calGoogleEnabled(), false);
  process.env.CALENDAR_GOOGLE_ENABLED = "true";
  assert.strictEqual(cal.calGoogleEnabled(), true);
  delete process.env.CALENDAR_GOOGLE_ENABLED;
});

check("refresh token round-trips through AES-256-GCM and never appears in the blob", () => {
  const secret = "1//0abc-refresh-token-value";
  const blob = cal.encryptToken(secret);
  assert.ok(!blob.includes(secret), "ciphertext must not contain the plaintext");
  assert.strictEqual(blob.split(".").length, 3, "iv.ciphertext.tag format");
  assert.strictEqual(cal.decryptToken(blob), secret);
});

check("tampered ciphertext fails closed", () => {
  const blob = cal.encryptToken("tok");
  const parts = blob.split(".");
  parts[1] = Buffer.from("tampered!").toString("base64");
  assert.throws(() => cal.decryptToken(parts.join(".")));
});

check("OAuth state: signed, member-bound, 10-minute expiry", () => {
  const now = Date.now();
  const st = cal.signState("user-123", now);
  assert.strictEqual(cal.verifyState(st, now + 5 * 60 * 1000), "user-123");
  assert.strictEqual(cal.verifyState(st, now + 11 * 60 * 1000), null, "expired state must fail");
  assert.strictEqual(cal.verifyState(st.slice(0, -2) + "xx", now), null, "bad signature must fail");
});

check("digest reduction: counts, bounds, 40-char label cap, no raw payload fields", () => {
  const items = [
    { summary: "x".repeat(90), start: { dateTime: "2026-07-23T15:00:00Z" }, end: { dateTime: "2026-07-23T16:00:00Z" }, attendees: [{ email: "a@b.c" }], description: "secret notes" },
    { summary: "Standup", start: { dateTime: "2026-07-23T17:00:00Z" }, end: { dateTime: "2026-07-23T17:30:00Z" } },
  ];
  const d = cal.__test.reduceEvents(items);
  assert.strictEqual(d.count, 2);
  assert.strictEqual(d.first_start, "2026-07-23T15:00:00Z");
  assert.strictEqual(d.last_end, "2026-07-23T17:30:00Z");
  assert.strictEqual(d.blocks[0].label.length, 40, "labels truncate to 40 chars");
  const json = JSON.stringify(d);
  assert.ok(!json.includes("attendees") && !json.includes("secret notes"), "raw payload fields never survive reduction");
});

check("digest context line instructs one gentle sentence, never a list", () => {
  const line = cal.digestContextLine({ count: 3, first_start: "2026-07-23T15:00:00Z", last_end: "2026-07-23T23:30:00Z", blocks: [] });
  assert.ok(/AT MOST one gentle/.test(line));
  assert.ok(/never list events/.test(line));
  assert.strictEqual(cal.digestContextLine({ count: 0 }), "", "empty day adds nothing");
});

// ── Source gates ──
check("gate: cache TTL is hard-capped at 15 minutes", () => {
  assert.strictEqual(cal.DIGEST_TTL_MIN, 15);
  assert.ok(src("calendar-google.js").includes("DIGEST_TTL_MIN = 15"));
});

check("gate: no plaintext refresh-token column anywhere - only refresh_token_enc via encryptToken", () => {
  for (const f of ["calendar-google.js", "calendar-callback.js", "calendar-connect.js", "calendar-disconnect.js", "calendar-digest.js"]) {
    const s = src(f);
    const writes = s.match(/refresh_token(?!_enc)\s*:/g) || [];
    // exchange/refresh REQUEST params legitimately name refresh_token; DB writes must not.
    for (const w of writes) assert.ok(!s.includes("upsert") || !new RegExp('upsert\\([^)]*refresh_token\\s*:').test(s), f + " writes a plaintext token column");
  }
  assert.ok(src("calendar-callback.js").includes("refresh_token_enc: cal.encryptToken("), "callback stores the ENCRYPTED blob");
});

check("gate: raw event payloads never touch the database (only the reduced digest is upserted)", () => {
  const s = src("calendar-google.js");
  assert.ok(s.includes('upsert({ member_id: userId, digest'), "cache upsert stores the digest object");
  assert.ok(!/upsert\([^)]*items/.test(s), "raw items are never persisted");
});

check("gate: invalid_grant deletes the connection (reconnect state)", () => {
  assert.ok(/invalid_grant.*deleteConnection|deleteConnection.*invalid_grant/s.test(src("calendar-google.js")));
});

if (failures) { console.error("\n" + failures + " failing"); process.exit(1); }
console.log("\nall calendar google tests passing");
