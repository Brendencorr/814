/**
 * calendar-google.js - Phase 2 shared helpers: read-only Google Calendar (handoff §2.3).
 *
 * FEATURE-FLAGGED: everything here no-ops unless CALENDAR_GOOGLE_ENABLED=true in the
 * Netlify env. The flag stays OFF until Google OAuth verification clears - the connect
 * card must never show members the "unverified app" interstitial.
 *
 * Env (all required before the flag is turned on):
 *   CALENDAR_GOOGLE_ENABLED  "true" to enable
 *   GOOGLE_CAL_CLIENT_ID     OAuth client id (project riley-app)
 *   GOOGLE_CAL_CLIENT_SECRET OAuth client secret
 *   CAL_TOKEN_KEY            32-byte hex key for AES-256-GCM refresh-token encryption
 *
 * LIMITED USE (Google API Services User Data Policy): calendar data is reduced
 * in-memory to a digest {count, first_start, last_end, blocks[{start,end,label<=40}]},
 * cached at most 15 minutes, NEVER stored durably, never used for ads or training.
 * Raw event payloads never touch the database.
 */
"use strict";

const crypto = require("crypto");

const DIGEST_TTL_MIN = 15;                       // hard cap per the verification packet
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const REDIRECT_URI = "https://riley.meetriley.us/.netlify/functions/calendar-callback";

function calGoogleEnabled() {
  return String(process.env.CALENDAR_GOOGLE_ENABLED || "").toLowerCase() === "true";
}

// ── Refresh-token encryption (AES-256-GCM, key = CAL_TOKEN_KEY) ──────────────
function keyBuf() {
  const k = process.env.CAL_TOKEN_KEY || "";
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, "hex");
  return crypto.createHash("sha256").update(k).digest(); // tolerate non-hex keys
}
function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyBuf(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv.toString("base64"), enc.toString("base64"), c.getAuthTag().toString("base64")].join(".");
}
function decryptToken(blob) {
  const [iv, enc, tag] = String(blob).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", keyBuf(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

// ── OAuth state: signed member id, 10-minute expiry (handoff §2.3) ───────────
function signState(userId, nowMs) {
  const exp = (nowMs || Date.now()) + 10 * 60 * 1000;
  const p = Buffer.from(JSON.stringify({ u: userId, e: exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", keyBuf()).update(p).digest("base64url");
  return p + "." + sig;
}
function verifyState(state, nowMs) {
  try {
    const [p, sig] = String(state || "").split(".");
    const want = crypto.createHmac("sha256", keyBuf()).update(p).digest();
    const got = Buffer.from(sig || "", "base64url");
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    const j = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!j.u || (nowMs || Date.now()) > j.e) return null;
    return j.u;
  } catch (e) { return null; }
}

function authUrl(userId) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CAL_CLIENT_ID || "",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: signState(userId),
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
}

async function tokenPost(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || "token_error"); e.code = j.error; throw e; }
  return j;
}
async function exchangeCode(code) {
  return tokenPost({
    code, grant_type: "authorization_code",
    client_id: process.env.GOOGLE_CAL_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CAL_CLIENT_SECRET || "",
    redirect_uri: REDIRECT_URI,
  });
}
async function refreshAccess(refreshToken) {
  return tokenPost({
    refresh_token: refreshToken, grant_type: "refresh_token",
    client_id: process.env.GOOGLE_CAL_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CAL_CLIENT_SECRET || "",
  });
}
async function revokeAtGoogle(refreshToken) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(refreshToken), { method: "POST" });
  } catch (e) {}
}

// ── The digest: today only, reduced in-memory, cached <= 15 min ──────────────
function reduceEvents(items) {
  const blocks = (items || [])
    .filter((ev) => ev.start && (ev.start.dateTime || ev.start.date))
    .map((ev) => ({
      start: ev.start.dateTime || ev.start.date,
      end: (ev.end && (ev.end.dateTime || ev.end.date)) || null,
      label: String(ev.summary || "Busy").slice(0, 40),   // 40-char cap (handoff §2.3)
    }));
  return {
    count: blocks.length,
    first_start: blocks.length ? blocks[0].start : null,
    last_end: blocks.length ? blocks[blocks.length - 1].end : null,
    blocks: blocks.slice(0, 20),
  };
}

// Local-day bounds for the member's timezone (today only - we never read further).
function dayBounds(tz, now) {
  const d = now || new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const ymd = fmt.format(d); // YYYY-MM-DD
  // Resolve the UTC instant of local midnight by scanning the tz offset at noon UTC.
  const probe = new Date(ymd + "T12:00:00Z");
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hour12: false }).format(probe);
  const offsetH = 12 - parseInt(local, 10); // hours the tz lags UTC at that instant
  const startMs = Date.parse(ymd + "T00:00:00Z") + offsetH * 3600000;
  return { timeMin: new Date(startMs).toISOString(), timeMax: new Date(startMs + 24 * 3600000).toISOString() };
}

async function deleteConnection(sb, userId) {
  try { await sb.from("calendar_connections").delete().eq("member_id", userId); } catch (e) {}
  try { await sb.from("calendar_digest_cache").delete().eq("member_id", userId); } catch (e) {}
}

/**
 * getDigest(sb, userId) -> digest object | null.
 * Null means: flag off, not connected, or reconnect needed. Fail-open everywhere -
 * a calendar hiccup must never break a brief or a chat reply.
 */
async function getDigest(sb, userId) {
  if (!calGoogleEnabled() || !userId) return null;
  try {
    const { data: cached } = await sb.from("calendar_digest_cache")
      .select("digest,expires_at").eq("member_id", userId).maybeSingle();
    if (cached && new Date(cached.expires_at) > new Date()) return cached.digest;

    const { data: conn } = await sb.from("calendar_connections")
      .select("refresh_token_enc").eq("member_id", userId).maybeSingle();
    if (!conn) return null;

    let access;
    try {
      access = (await refreshAccess(decryptToken(conn.refresh_token_enc))).access_token;
    } catch (e) {
      if (e.code === "invalid_grant") await deleteConnection(sb, userId); // surface "reconnect" state
      return null;
    }

    let tz = "America/Denver";
    try {
      const { data: p } = await sb.from("user_profiles").select("timezone").eq("id", userId).maybeSingle();
      if (p && p.timezone) tz = p.timezone;
    } catch (e) {}
    const { timeMin, timeMax } = dayBounds(tz);

    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
    const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + q.toString(), {
      headers: { Authorization: "Bearer " + access },
    });
    if (r.status === 401) { await deleteConnection(sb, userId); return null; }
    if (!r.ok) return null;
    const j = await r.json();
    const digest = reduceEvents(j.items);

    const expires = new Date(Date.now() + DIGEST_TTL_MIN * 60 * 1000).toISOString();
    try {
      await sb.from("calendar_digest_cache").upsert({ member_id: userId, digest, expires_at: expires });
    } catch (e) {}
    return digest;
  } catch (e) {
    return null; // never let the calendar break anything downstream
  }
}

// One prompt-context line for the brief / chat builders. The consuming prompt is told:
// AT MOST one gentle time-aware sentence, never a list of events, never surveillance.
function digestContextLine(digest) {
  if (!digest || !digest.count) return "";
  const t = (iso) => {
    try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return ""; }
  };
  return `CALENDAR TODAY (weave AT MOST one gentle time-aware sentence - never list events, never name meetings unless the member does): ${digest.count} event${digest.count === 1 ? "" : "s"}, first at ${t(digest.first_start)}, last ends ${t(digest.last_end)}.`;
}

module.exports = {
  calGoogleEnabled, encryptToken, decryptToken, signState, verifyState,
  authUrl, exchangeCode, refreshAccess, revokeAtGoogle,
  getDigest, digestContextLine, deleteConnection,
  DIGEST_TTL_MIN, SCOPE, REDIRECT_URI,
  __test: { reduceEvents, dayBounds, keyBuf },
};
