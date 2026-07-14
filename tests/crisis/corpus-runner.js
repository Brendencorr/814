#!/usr/bin/env node
/**
 * corpus-runner.js - Riley crisis-detection corpus harness (v2.3 Batch 0.2).
 *
 * Runs every case in corpus.json through detectCrisis() and reports a per-case + summary
 * pass/fail diff. Run this after ANY change to crisis-detection.js OR to Riley's crisis
 * prompt language, to catch regressions before they ship.
 *
 *   node tests/crisis/corpus-runner.js
 *
 * Exit code: 0 if all non-known-gap cases pass; 1 if any hard failure (CI-friendly).
 * A case with "known_gap": true is reported separately and does NOT fail the run - it
 * documents a detector limitation for the clinical corpus, so gaps are visible, not hidden.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { detectCrisis } = require('../../netlify/functions/crisis-detection');

const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus.json'), 'utf8'));
const cases = Array.isArray(corpus.cases) ? corpus.cases : [];

// A case input may be a single string or an array of turns (escalation). For an array we take
// the MAX level across turns - a crisis anywhere in the conversation must be caught.
function levelFor(input) {
  const turns = Array.isArray(input) ? input : [input];
  let max = 0, matches = [];
  for (const t of turns) {
    const r = detectCrisis(t);
    if (r.level > max) { max = r.level; matches = r.matches; }
  }
  return { level: max, matches };
}

let pass = 0, fail = 0, knownGap = 0;
const failures = [];

for (const c of cases) {
  const got = levelFor(c.input);
  const ok = got.level === c.expected_level;
  if (ok) {
    pass++;
    console.log(`  PASS  ${c.id.padEnd(22)} level ${got.level} (${c.category})`);
  } else if (c.known_gap) {
    knownGap++;
    console.log(`  GAP   ${c.id.padEnd(22)} expected ${c.expected_level}, got ${got.level} - ${c.note || ''}`);
  } else {
    fail++;
    failures.push({ id: c.id, expected: c.expected_level, got: got.level, matches: got.matches, note: c.note });
    console.log(`  FAIL  ${c.id.padEnd(22)} expected ${c.expected_level}, got ${got.level}  << ${c.category}`);
  }
}

console.log('\n' + '-'.repeat(60));
console.log(`Crisis corpus: ${pass} passed, ${fail} FAILED, ${knownGap} known-gap  (of ${cases.length})`);
if (failures.length) {
  console.log('\nFailures (regressions to fix before shipping):');
  failures.forEach(f => console.log(`  ${f.id}: expected L${f.expected}, got L${f.got}${f.note ? '  - ' + f.note : ''}`));
}
process.exit(fail > 0 ? 1 : 0);
