#!/usr/bin/env node
/**
 * tests/golden/runner.js - Riley voice/rules quality gate (Spec §7.1).
 *
 * Dependency-free. Scores Riley replies against deterministic assertions drawn from
 * RILEY_BASE_PROMPT: length, one-question-or-step, banned words, and per-case content
 * rules. Self-test cases (expectFail) prove each checker catches violations, so the
 * suite validates its own machinery while staying green.
 *
 * Grow tests/golden/cases.json with anonymized real exchanges over time. A live mode
 * (call the deployed function, score the real reply) is a future add - the checkers here
 * are the reusable core.
 *
 * Exit 0 = all cases behave as expected; exit 1 = a real regression.
 */

const fs = require("fs");
const path = require("path");

const BANNED = ["journey", "just", "simply", "amazing", "incredible", "powerful", "transformative", "game-changer", "holistic"];
const LAST_RUN = path.join(__dirname, ".last-run.json");

function sentences(t) { return String(t).split(/[.!?]+/).map((s) => s.trim()).filter(Boolean); }
function questions(t) { return (String(t).match(/\?/g) || []).length; }
function bannedHits(t) {
  const low = " " + String(t).toLowerCase().replace(/[^a-z0-9\- ]/g, " ") + " ";
  return BANNED.filter((w) => low.includes(" " + w + " "));
}

// Returns the list of assert-keys that FAILED for a case.
function evaluate(c) {
  const a = c.assert || {};
  const failed = [];
  if (a.maxSentences != null && sentences(c.reply).length > a.maxSentences) failed.push("maxSentences");
  if (a.maxQuestions != null && questions(c.reply) > a.maxQuestions) failed.push("maxQuestions");
  if (a.noBanned && bannedHits(c.reply).length) failed.push("noBanned");
  if (Array.isArray(a.mustNotContain) && a.mustNotContain.some((s) => c.reply.toLowerCase().includes(String(s).toLowerCase()))) failed.push("mustNotContain");
  if (Array.isArray(a.mustContain) && !a.mustContain.every((s) => c.reply.toLowerCase().includes(String(s).toLowerCase()))) failed.push("mustContain");
  return failed;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  const failures = [];
  const results = {};

  for (const c of cases) {
    const failed = evaluate(c);
    const expect = Array.isArray(c.expectFail) ? c.expectFail.slice().sort() : [];
    const got = failed.slice().sort();
    const ok = expect.length
      ? JSON.stringify(expect) === JSON.stringify(got)          // self-test: must fail exactly these
      : got.length === 0;                                       // normal: must pass everything
    results[c.id] = ok ? "pass" : "fail";
    if (!ok) failures.push({ id: c.id, expected: expect, got });
  }

  let regressions = [];
  try {
    if (fs.existsSync(LAST_RUN)) {
      const prev = JSON.parse(fs.readFileSync(LAST_RUN, "utf8"));
      regressions = Object.keys(results).filter((id) => prev[id] === "pass" && results[id] === "fail");
    }
  } catch (_) {}
  try { fs.writeFileSync(LAST_RUN, JSON.stringify(results, null, 2)); } catch (_) {}

  console.log(`\nGolden suite - ${cases.length} cases\n`);
  for (const f of failures) console.log(`  ✗ ${f.id}  expected-fail=[${f.expected}] got=[${f.got}]`);
  if (!failures.length) console.log("  ✓ all cases behaved as expected");
  if (regressions.length) console.log(`\n  ⚠ REGRESSIONS since last run: ${regressions.join(", ")}`);

  if (failures.length) { console.error(`\n✗ GOLDEN SUITE FAILED - ${failures.length} case(s). Build blocked.\n`); process.exit(1); }
  console.log("\n✓ GOLDEN SUITE GREEN\n");
  process.exit(0);
}

main();
