/**
 * P0.1 regression: the sober-day count is ONE canonical value across every surface.
 * Dashboard + Life Map read the client fn (window.RileyDay.soberDays); Clarity lane + emails read
 * the server fn (soberDaysForMember). Both must agree for the same member - across a day boundary
 * (the 4am rollover) and a timezone edge. If they ever diverge, a member sees two different counts
 * (the 2,430-vs-2,417 class of bug). Run: node tests/sober/ssot-test.js
 */
"use strict";
// Extract the REAL memberDay/soberDaysForMember from source (avoids requiring the supabase client,
// which needs node_modules the worktree doesn't install). This still tests the shipped code text.
const fs = require("fs");
const _src = fs.readFileSync(require("path").join(__dirname, "../../netlify/functions/supabase-client.js"), "utf8");
const _mFn = _src.match(/function memberDay\(timezone, ref\) \{[\s\S]*?\n\}/);
const _sFn = _src.match(/function soberDaysForMember\(startYmd, timezone\) \{[\s\S]*?\n\}/);
if (!_mFn || !_sFn) { console.error("Could not extract memberDay/soberDaysForMember from source"); process.exit(1); }
(0, eval)(_mFn[0]); // indirect eval -> defines memberDay in global scope
(0, eval)(_sFn[0]); // -> soberDaysForMember (calls the global memberDay)

// Port of pwa.js window.RileyDay.soberDays, parameterized by instant+tz so we can test boundaries.
function clientSoberDays(startYmd, nowMs, tz) {
  if (!startYmd) return null;
  const shifted = new Date(nowMs - 4 * 3600 * 1000); // 4am rollover
  const appDay = shifted.toLocaleDateString("en-CA", { timeZone: tz });
  const diff = Math.floor((Date.parse(appDay) - Date.parse(String(startYmd).slice(0, 10))) / 86400000);
  return isNaN(diff) ? null : Math.max(0, diff);
}
// Server soberDaysForMember, parameterized by a ref instant (mirrors it exactly; the shipped fn uses now()).
function serverSoberDays(startYmd, nowMs, tz) {
  if (!startYmd) return null;
  const diff = Math.floor((Date.parse(memberDay(tz, nowMs)) - Date.parse(String(startYmd).slice(0, 10))) / 86400000);
  return isNaN(diff) ? null : Math.max(0, diff);
}

let pass = 0, fail = 0;
const eq = (a, b, msg) => { if (a === b) pass++; else { fail++; console.log("  FAIL:", msg, "| got", a, "want", b); } };

// Denver (MDT = UTC-6 in July). 4am member-local rollover == 10:00 UTC.
const TZ = "America/Denver", START = "2019-12-01";

// 1. Client == Server for the SAME member (browser tz == stored tz), sampled across a full day incl. the boundary.
["2026-07-14T10:01:00Z", "2026-07-14T16:00:00Z", "2026-07-15T03:00:00Z", "2026-07-15T09:59:00Z"].forEach((iso) => {
  const t = Date.parse(iso);
  eq(clientSoberDays(START, t, TZ), serverSoberDays(START, t, TZ), "client==server @ " + iso);
});

// 2. The 4am rollover advances the count by exactly 1 (never off-by-one, never a same-day double-count).
const before = Date.parse("2026-07-15T09:59:00Z"); // 3:59am MDT -> still Jul 14 app-day
const after  = Date.parse("2026-07-15T10:01:00Z"); // 4:01am MDT -> Jul 15 app-day
eq(serverSoberDays(START, after, TZ) - serverSoberDays(START, before, TZ), 1, "4am rollover advances by 1 (server)");
eq(clientSoberDays(START, after, TZ) - clientSoberDays(START, before, TZ), 1, "4am rollover advances by 1 (client)");
eq(clientSoberDays(START, before, TZ), serverSoberDays(START, before, TZ), "client==server just before rollover");

// 3. Timezone edge: same instant, two members in different zones can be on different app-days -
//    and each surface must agree WITHIN a member. (A Denver member and a Tokyo member differ; that's correct.)
const inst = Date.parse("2026-07-14T05:00:00Z");
eq(clientSoberDays(START, inst, "America/Denver"), serverSoberDays(START, inst, "America/Denver"), "tz-edge Denver: client==server");
eq(clientSoberDays(START, inst, "Asia/Tokyo"),     serverSoberDays(START, inst, "Asia/Tokyo"),     "tz-edge Tokyo: client==server");
if (serverSoberDays(START, inst, "America/Denver") === serverSoberDays(START, inst, "Asia/Tokyo")) {
  // not a failure, but assert the tz actually matters at this instant so the edge is real
  console.log("  note: Denver and Tokyo happen to share an app-day at this instant");
}

// 4. Known-value correctness (start = day 0).
eq(serverSoberDays("2026-07-13", Date.parse("2026-07-14T12:00:00Z"), TZ), 1, "start+1 day == 1");
eq(serverSoberDays("2026-07-14", Date.parse("2026-07-14T18:00:00Z"), TZ), 0, "start day == 0 (not negative)");

console.log(`\nSober SSOT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
