#!/usr/bin/env node
/**
 * tests/crisis/runner.js — Crisis-detection regression suite (Phase 7.2).
 *
 * Dependency-free. Loads the HUMAN-AUTHORED corpus (fixtures.json) and runs every
 * phrase through the REAL deterministic detectors, asserting the exact level AND
 * the exact response path the handler would take. This is the net that must be
 * green before anyone touches riley-chat.js or crisis-detection.js.
 *
 * The path precedence here is a faithful mirror of riley-chat.js:
 *   Level 3 self-harm short-circuits first (fixed response, NO model call)
 *   → a disclosed slip (lapse-repair) beats relapse-risk Level 2
 *   → Level 2 → Level 1 ; diagnosis is an additive guardrail (separate boolean).
 *
 * Exit codes:
 *   0 = all real cases pass AND no placeholders remain (launch-ready)
 *   1 = one or more assertions FAILED (a broken rule — blocks the build)
 *   2 = corpus not populated (placeholders remain) — blocks launch, never silent
 */

const fs = require("fs");
const path = require("path");

const FN = path.join(__dirname, "..", "..", "netlify", "functions");
const { detectCrisis, detectDiagnosis } = require(path.join(FN, "crisis-detection"));
const { detectSlipDisclosure } = require(path.join(FN, "lapse-detection"));

const PLACEHOLDER = "PLACEHOLDER_HUMAN_AUTHORED";
const LAST_RUN = path.join(__dirname, ".last-run.json");

// Faithful mirror of the handler's safety ordering.
function classify(text) {
  const crisis = detectCrisis(text) || { level: 0 };
  const slip = detectSlipDisclosure(text) || { isSlip: false };
  const diagnosis = !!detectDiagnosis(text);
  let p;
  if (crisis.level === 3) p = "fixed_response_no_model";
  else if (slip.isSlip) p = "directive_lapse_repair";
  else if (crisis.level === 2) p = "directive_level_2";
  else if (crisis.level === 1) p = "directive_level_1";
  else p = "none";
  return { level: crisis.level, slip: !!slip.isSlip, diagnosis, path: p };
}

function main() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"));
  const cases = Array.isArray(raw.cases) ? raw.cases : [];
  if (!cases.length) { console.error("✗ fixtures.json has no cases."); process.exit(1); }

  const placeholders = cases.filter((c) => c.phrase === PLACEHOLDER);
  const real = cases.filter((c) => c.phrase !== PLACEHOLDER);

  const failures = [];
  const results = {};
  for (const c of real) {
    const got = classify(c.phrase);
    const exp = c.expect || {};
    const mism = [];
    for (const key of ["level", "slip", "diagnosis", "path"]) {
      if (key in exp && got[key] !== exp[key]) mism.push(`${key}: expected ${JSON.stringify(exp[key])}, got ${JSON.stringify(got[key])}`);
    }
    results[c.id] = mism.length ? "fail" : "pass";
    if (mism.length) failures.push({ id: c.id, category: c.category, mism, got });
  }

  // Regression diff vs last run (reporting only).
  let regressions = [];
  try {
    if (fs.existsSync(LAST_RUN)) {
      const prev = JSON.parse(fs.readFileSync(LAST_RUN, "utf8"));
      regressions = Object.keys(results).filter((id) => prev[id] === "pass" && results[id] === "fail");
    }
  } catch (_) {}
  try { fs.writeFileSync(LAST_RUN, JSON.stringify(results, null, 2)); } catch (_) {}

  // ── Report ──
  console.log(`\nCrisis suite — ${real.length} real cases, ${placeholders.length} placeholders remaining\n`);
  for (const f of failures) {
    console.log(`  ✗ ${f.id} [${f.category}]`);
    f.mism.forEach((m) => console.log(`      ${m}`));
  }
  if (!failures.length) console.log("  ✓ all real cases passed");
  if (regressions.length) console.log(`\n  ⚠ REGRESSIONS since last run: ${regressions.join(", ")}`);

  if (failures.length) {
    console.error(`\n✗ CRISIS SUITE FAILED — ${failures.length} assertion(s) broken. Build blocked.\n`);
    process.exit(1);
  }
  if (placeholders.length) {
    console.error(`\n⚠ CRISIS CORPUS NOT POPULATED — ${placeholders.length} placeholder(s) remain (${placeholders.map((p) => p.id).join(", ")}).`);
    console.error("  The human-authored corpus (Brenden + clinician) must replace every PLACEHOLDER_HUMAN_AUTHORED before launch.");
    console.error("  Exiting 2 — an empty crisis corpus blocks the build; it must never silently pass.\n");
    process.exit(2);
  }
  console.log("\n✓ CRISIS SUITE GREEN — corpus populated, all paths correct.\n");
  process.exit(0);
}

main();
