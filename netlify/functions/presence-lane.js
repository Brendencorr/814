/**
 * presence-lane.js - Clarity v2.4 Presence lane (grief), pure + testable.
 * Spec: docs/07A_CLARITY_V2_4_AMENDMENT.md. Law: we never grade grief itself - there is no
 * grieving correctly. Presence scores the SHOWING UP as occurrence density over 14 days.
 * Multiple qualifying behaviors on one day = ONE day (this measures returning, not volume).
 * The door counts; the words never do (occurrence-only - no content, no sentiment, ever).
 */
"use strict";
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// day-of hard date, day before, day after = the protected window (spec §1)
function inHardDateWindow(dateISO, hardDates) {
  const t = Date.parse(dateISO + "T00:00:00Z");
  return (hardDates || []).some((h) => {
    const d = Date.parse(String(h && h.date ? h.date : h) + "T00:00:00Z");
    return !isNaN(d) && Math.abs(t - d) <= DAY;
  });
}

/**
 * Distinct qualifying days over the trailing 14 (today inclusive).
 * inputs: checkins [{checkin_date, hard_day, heaviness, connection, kept_ritual}] (any range - filtered here),
 * hardDates [{date}], extraDays: Set/array of ISO dates that qualify from other sources
 * (grief-program step completed, grief check-in tool use, conversation on a hard date -
 * OCCURRENCE dates only; callers must never pass content).
 */
function qualifyingDays14(todayISO, checkins, hardDates, extraDays) {
  const end = Date.parse(todayISO + "T00:00:00Z");
  const start = end - 13 * DAY;
  const days = new Set();
  const inWin = (dISO) => { const t = Date.parse(dISO + "T00:00:00Z"); return !isNaN(t) && t >= start && t <= end; };
  for (const c of checkins || []) {
    const d = c && c.checkin_date;
    if (!d || !inWin(d)) continue;
    const heavy = c.hard_day === true || (typeof c.heaviness === "number" && c.heaviness >= 4);
    if (heavy) days.add(d);                                        // check-in completed on a hard day
    if (c.kept_ritual === true) days.add(d);                       // kept the ritual (counted, never described)
    if (c.connection === true && heavy) days.add(d);               // talked to a human on a heavy day
    if (inHardDateWindow(d, hardDates)) days.add(d);               // any check-in inside a hard-date window
  }
  for (const d of extraDays || []) if (d && inWin(String(d).slice(0, 10))) days.add(String(d).slice(0, 10));
  return days.size;
}

// lane = 100 · density^0.8 over 14 days (standard lane floor is the caller's clamp to >= 0)
function presenceLaneScore(qualDays) {
  const density = Math.max(0, Math.min(1, (qualDays || 0) / 14));
  return Math.max(0, Math.min(100, 100 * Math.pow(density, 0.8)));
}

// Protected today = member-flagged hard day OR within ±1 day of any hard date.
// Inside protection the lane may rise or hold ONLY (never fall) and freshness decay pauses.
function isProtectedDay(todayISO, hardDayToday, hardDates) {
  return !!hardDayToday || inHardDateWindow(todayISO, hardDates);
}

// v2.4 multi-lane weights (global rule): 1 lane = 12 of Practice's 40 · 2 lanes = 10 each
// (20 combined) · max two lanes ever - chosen practice dims always retain real weight.
function laneWeight(activeLaneCount) {
  if (activeLaneCount >= 2) return 20;
  if (activeLaneCount === 1) return 12;
  return 0;
}

module.exports = { qualifyingDays14, presenceLaneScore, isProtectedDay, inHardDateWindow, laneWeight };
