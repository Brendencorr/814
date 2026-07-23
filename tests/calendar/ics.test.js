/**
 * ics.test.js - Phase 1 acceptance gates for the calendar feed (handoff §1.4).
 * Run: node tests/calendar/ics.test.js   (pure - no DB, no network, no env)
 */
"use strict";
const assert = require("assert");
const { buildIcs, __test } = require("../../netlify/functions/calendar-ics");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok - " + name); }
  catch (e) { failures++; console.error("  FAIL - " + name + "\n    " + e.message); }
}

console.log("calendar ICS - recurrence, duration, privacy law, escaping, folding");

const PROFILE = {
  timezone: "America/Denver",
  created_at: "2026-07-01T14:22:09Z",   // 08:22:09 MDT - the member's anchor time
  sobriety_date: "2019-11-20",
};
const ENROLLMENTS = [{ program_id: "prog_x", enrolled_at: "2026-07-20T15:00:00Z", duration_days: 7 }];
const NOW = "2026-07-23T12:00:00Z";

const feed = buildIcs(PROFILE, ENROLLMENTS, { includeMilestones: false, now: NOW });
const feedM = buildIcs(PROFILE, ENROLLMENTS, { includeMilestones: true, now: NOW });

// ── Gate 1/2: valid skeleton, daily recurrence at anchor time, duration exactly 8:14 ──
check("VCALENDAR skeleton + calname", () => {
  assert.ok(feed.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(feed.includes("X-WR-CALNAME:Riley"));
  assert.ok(feed.includes("VERSION:2.0"));
  assert.ok(feed.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(feed.includes("BEGIN:VTIMEZONE") && feed.includes("TZID:America/Denver"));
});

check("daily 8:14 recurs daily at the member's anchor time in their timezone", () => {
  assert.ok(feed.includes("RRULE:FREQ=DAILY"));
  assert.ok(feed.includes("DTSTART;TZID=America/Denver:20260701T082209"), "anchor = first-login local time-of-day");
  assert.ok(feed.includes("DURATION:PT8M14S"), "duration is literally 8 minutes 14 seconds");
  assert.ok(feed.includes("SUMMARY:Your 8:14"));
  assert.ok(feed.includes("Eight minutes\\, fourteen seconds. Start where you are."));
});

check("session days: one all-day VEVENT per day, numbered, dated from local enrollment day", () => {
  assert.ok(feed.includes("UID:session-prog_x-1@meetriley.us"));
  assert.ok(feed.includes("UID:session-prog_x-7@meetriley.us"));
  assert.ok(!feed.includes("session-prog_x-8@"), "no more days than the program has");
  assert.ok(feed.includes("SUMMARY:Session 1 is ready"));
  assert.ok(feed.includes("DTSTART;VALUE=DATE:20260720"), "enrolled 2026-07-20 09:00 MDT -> day 1 = 20260720");
  assert.ok(feed.includes("DTSTART;VALUE=DATE:20260726"), "day 7");
});

// ── Gate 4: PRIVACY LAW - discreet titles, no program names, no recovery language ──
check("privacy law: no program names or recovery language anywhere in the default feed", () => {
  for (const banned of ["Sobriety", "sobriety", "sober", "recovery", "Recovery", "prog_x is", "check-in", "Check-in"]) {
    assert.ok(!feed.includes("SUMMARY:" + banned) && !feed.toLowerCase().includes("summary:" + banned.toLowerCase()),
      "banned word in a summary: " + banned);
  }
  assert.ok(!/SUMMARY:.*(sober|recovery|relapse|addiction)/i.test(feed), "no recovery language in titles");
  assert.ok(!/DESCRIPTION:.*(sober|recovery|relapse|addiction)/i.test(feed), "no recovery language in descriptions");
});

check("milestones are OPT-IN and discreetly worded", () => {
  assert.ok(!feed.includes("milestone"), "default feed has no milestones");
  assert.ok(feedM.includes("UID:milestone-30@meetriley.us"));
  assert.ok(feedM.includes("UID:milestone-90@meetriley.us"));
  assert.ok(feedM.includes("UID:milestone-annual-1@meetriley.us"));
  assert.ok(feedM.includes("SUMMARY:A milestone worth marking"));
  assert.ok(!/SUMMARY:.*(sober|anniversary|recovery)/i.test(feedM), "milestone wording stays discreet");
  assert.ok(feedM.includes("DTSTART;VALUE=DATE:20191220"), "day 30 from 2019-11-20");
});

// ── RFC 5545 mechanics ──
check("escaping: backslash, semicolon, comma, newline", () => {
  assert.strictEqual(__test.esc("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
});

check("folding: no emitted line exceeds 75 octets", () => {
  for (const line of feed.split("\r\n")) {
    assert.ok(Buffer.from(line, "utf8").length <= 75, "long line: " + line.slice(0, 60) + "…");
  }
});

check("unknown timezone falls back to America/Denver", () => {
  assert.strictEqual(__test.safeTz("Mars/Olympus"), "America/Denver");
  const f = buildIcs({ timezone: "Europe/Paris", created_at: PROFILE.created_at }, [], { now: NOW });
  assert.ok(f.includes("TZID:America/Denver"));
});

check("UID format {eventkey}@meetriley.us everywhere", () => {
  const uids = feedM.split("\r\n").filter((l) => l.startsWith("UID:"));
  assert.ok(uids.length >= 9);
  for (const u of uids) assert.ok(/^UID:[a-z0-9_.-]+@meetriley\.us$/i.test(u), "bad UID: " + u);
});

check("all-day events use DTEND = DTSTART + 1 day", () => {
  assert.ok(feedM.includes("DTSTART;VALUE=DATE:20191220\r\nDTEND;VALUE=DATE:20191221"));
});

if (failures) { console.error("\n" + failures + " failing"); process.exit(1); }
console.log("\nall calendar ICS tests passing");
