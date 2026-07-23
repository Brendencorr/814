/**
 * calendar-ics.js - Phase 1 of the calendar integration (CALENDAR_INTEGRATION handoff §1.2).
 *
 * GET /.netlify/functions/calendar-ics?t={token}
 * Riley publishes a private ICS feed; the member subscribes from any calendar app.
 * No OAuth, no Google approval - the token IS the auth.
 *
 * PRIVACY LAW (non-negotiable, handoff §1.2): default event titles are DISCREET.
 * Calendars get shared with partners, families, and workplaces - nobody gets outed
 * by a subscribed feed. "Your 8:14", never a program name, never recovery language.
 * Milestones are opt-in AND discreetly worded.
 *
 * Security: unknown/revoked token -> 404 with an EMPTY body (no error detail, no
 * member enumeration). Feed responses are private-cacheable for 15 minutes.
 */
"use strict";

// supabase-client is lazy-required inside the handler so the pure buildIcs()
// stays importable by the test runner with no dependencies installed.

// ── Timezones ────────────────────────────────────────────────────────────────
// Minimal VTIMEZONE definitions for the zones we serve. Unknown zones fall back
// to America/Denver (the product default, matching memberDay()).
const VTIMEZONES = {
  "America/Denver": vtz("America/Denver", "MST", "-0700", "MDT", "-0600"),
  "America/Los_Angeles": vtz("America/Los_Angeles", "PST", "-0800", "PDT", "-0700"),
  "America/Chicago": vtz("America/Chicago", "CST", "-0600", "CDT", "-0500"),
  "America/New_York": vtz("America/New_York", "EST", "-0500", "EDT", "-0400"),
  "America/Anchorage": vtz("America/Anchorage", "AKST", "-0900", "AKDT", "-0800"),
  "America/Phoenix": vtzFixed("America/Phoenix", "MST", "-0700"),
  "Pacific/Honolulu": vtzFixed("Pacific/Honolulu", "HST", "-1000"),
  "UTC": vtzFixed("UTC", "UTC", "+0000"),
};

// US DST rule (2007+): forward 2nd Sunday March 02:00, back 1st Sunday November 02:00.
function vtz(tzid, stdName, stdOffset, dayName, dayOffset) {
  return [
    "BEGIN:VTIMEZONE",
    "TZID:" + tzid,
    "BEGIN:STANDARD",
    "DTSTART:20071104T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "TZOFFSETFROM:" + dayOffset,
    "TZOFFSETTO:" + stdOffset,
    "TZNAME:" + stdName,
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:20070311T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "TZOFFSETFROM:" + stdOffset,
    "TZOFFSETTO:" + dayOffset,
    "TZNAME:" + dayName,
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n");
}
function vtzFixed(tzid, name, offset) {
  return [
    "BEGIN:VTIMEZONE",
    "TZID:" + tzid,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:" + offset,
    "TZOFFSETTO:" + offset,
    "TZNAME:" + name,
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
}
function safeTz(tz) { return VTIMEZONES[tz] ? tz : "America/Denver"; }

// Local wall-clock parts of an instant in a timezone.
function localParts(dateLike, tz) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  if (p.hour === "24") p.hour = "00"; // Intl quirk
  return p; // {year,month,day,hour,minute,second}
}
function icsLocal(p) { return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`; }
function icsDate(p) { return `${p.year}${p.month}${p.day}`; }
function addDaysYmd(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// ── RFC 5545 text escaping + 75-octet line folding ───────────────────────────
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 74) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    let take = Math.min(74, bytes.length - start);
    // never split a UTF-8 sequence
    while (take > 1 && start + take < bytes.length && (bytes[start + take] & 0xc0) === 0x80) take--;
    out.push((start === 0 ? "" : " ") + bytes.slice(start, start + take).toString("utf8"));
    start += take;
  }
  return out.join("\r\n");
}

/**
 * Pure feed builder (unit-tested in tests/calendar/ics.test.js).
 * profile: { timezone, created_at, sobriety_date }
 * enrollments: [{ program_id, enrolled_at, duration_days }]
 * opts: { includeMilestones, now }  (now injectable for deterministic tests)
 */
function buildIcs(profile, enrollments, opts) {
  const o = opts || {};
  const tz = safeTz((profile && profile.timezone) || "America/Denver");
  const now = o.now ? new Date(o.now) : new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const events = [];

  // 1) The daily 8:14 - anchored at the member's first-login time-of-day (canon).
  //    DTSTART pinned to the signup instant's LOCAL date+time so the feed is stable
  //    across fetches; DURATION is literally 8 minutes 14 seconds - the brand lives
  //    in the metadata.
  const anchor = localParts(profile && profile.created_at ? profile.created_at : now, tz);
  events.push([
    "BEGIN:VEVENT",
    "UID:daily-814@meetriley.us",
    "DTSTAMP:" + stamp,
    `DTSTART;TZID=${tz}:` + icsLocal(anchor),
    "DURATION:PT8M14S",
    "RRULE:FREQ=DAILY",
    "SUMMARY:" + esc("Your 8:14"),
    "DESCRIPTION:" + esc("Eight minutes, fourteen seconds. Start where you are."),
    "END:VEVENT",
  ]);

  // 2) Program session days - all-day, one per scheduled day, NO program names
  //    (privacy law: discreet titles only).
  for (const en of enrollments || []) {
    const days = Math.max(1, Math.min(60, en.duration_days || 0));
    if (!en.enrolled_at || !days) continue;
    const day1 = icsDate(localParts(en.enrolled_at, tz));
    for (let n = 1; n <= days; n++) {
      const d = addDaysYmd(day1, n - 1);
      events.push([
        "BEGIN:VEVENT",
        `UID:session-${en.program_id}-${n}@meetriley.us`,
        "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + d,
        "DTEND;VALUE=DATE:" + addDaysYmd(d, 1),
        "SUMMARY:" + esc(`Session ${n} is ready`),
        "END:VEVENT",
      ]);
    }
  }

  // 3) Milestones - OPT-IN ONLY, discreetly worded (day 30, day 90, annuals).
  if (o.includeMilestones && profile && profile.sobriety_date) {
    const start = String(profile.sobriety_date).slice(0, 10).replace(/-/g, "");
    const marks = [["milestone-30", addDaysYmd(start, 30)], ["milestone-90", addDaysYmd(start, 90)]];
    for (let y = 1; y <= 5; y++) {
      marks.push([`milestone-annual-${y}`, `${+start.slice(0, 4) + y}${start.slice(4)}`]);
    }
    for (const [key, d] of marks) {
      events.push([
        "BEGIN:VEVENT",
        `UID:${key}@meetriley.us`,
        "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + d,
        "DTEND;VALUE=DATE:" + addDaysYmd(d, 1),
        "SUMMARY:" + esc("A milestone worth marking"),
        "END:VEVENT",
      ]);
    }
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Riley//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Riley",
    "X-WR-TIMEZONE:" + tz,
  ];
  lines.push(...VTIMEZONES[tz].split("\r\n"));
  for (const ev of events) lines.push(...ev);
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ── Handler ──────────────────────────────────────────────────────────────────
const NOT_FOUND = { statusCode: 404, headers: { "Cache-Control": "no-store" }, body: "" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "" };
  const token = (event.queryStringParameters && event.queryStringParameters.t) || "";
  if (!token || token.length < 16 || token.length > 128) return NOT_FOUND;

  let sb;
  try { sb = require("./supabase-client").getSupabaseClient(); } catch (e) { return NOT_FOUND; }

  try {
    const { data: feed } = await sb.from("calendar_feeds")
      .select("member_id,include_milestones")
      .eq("token", token).is("revoked_at", null).maybeSingle();
    if (!feed) return NOT_FOUND;

    const [{ data: profile }, { data: enrolls }] = await Promise.all([
      sb.from("user_profiles").select("timezone,created_at,sobriety_date").eq("id", feed.member_id).maybeSingle(),
      sb.from("user_program_progress")
        .select("program_id,enrolled_at,programs(duration_days)")
        .eq("user_id", feed.member_id)
        .or("status.is.null,status.eq.active"),
    ]);

    const enrollments = (enrolls || [])
      .filter((e) => e.program_id && e.enrolled_at)
      .map((e) => ({
        program_id: e.program_id,
        enrolled_at: e.enrolled_at,
        duration_days: (e.programs && e.programs.duration_days) || 0,
      }));

    const body = buildIcs(profile || {}, enrollments, { includeMilestones: !!feed.include_milestones });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, max-age=900",
        "X-Robots-Tag": "noindex",
      },
      body,
    };
  } catch (e) {
    console.error("calendar-ics:", e.message);
    return NOT_FOUND; // leak nothing, ever
  }
};

module.exports.buildIcs = buildIcs;
module.exports.__test = { esc, fold, localParts, addDaysYmd, safeTz };
