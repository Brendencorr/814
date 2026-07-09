/**
 * template-rotation.js - Riley social template rotation & cadence rules (LOCKED v1.0).
 *
 * The template designs are locked (see brand/template-kit/TEMPLATE_SPEC.md); only the
 * CONTENT varies, and templates are meant to be used RANDOMLY within a set of rules.
 * This module is the single source of truth for those rules so the Operator's social
 * funnel (and any agent) composes a compliant plan. Pure, dependency-free, testable.
 *
 * Rules enforced (Spec section 11):
 *   A. Never use the same template (format+ground) more than 2 times in a row.
 *   B. Never more than 3 dark OR 3 light grounds in a row before the opposite appears.
 *   C. Weekly mix: every week includes post, story, reel AND carousel.
 *   D. Launch phasing: Week 1 = ALL Riley/launch content; Weeks 2-4 = at least 4
 *      Riley/program posts per week, the remainder may be web-sourced.
 *   (rhythm, soft) ~2 light posts per 10; avoid the exact same ground back-to-back;
 *   heavy/grief content lands on Veil.
 *
 * Usage:
 *   const R = require('./template-rotation');
 *   const plan = R.planCampaign(4);                 // 4-week launch plan
 *   const next = R.nextPick(history, {format:'post'}); // append one compliant slot
 *   const { ok, violations } = R.validateSequence(plan.slots);
 *   node netlify/functions/template-rotation.js --selftest
 */

'use strict';

// ── The six LOCKED grounds (Spec section 1). Anything else is retired. ──────────
const GROUNDS = {
  'dawn':        { mode: 'dark',  use_for: 'wins, milestones, beginnings, hope-forward' },
  'first-light': { mode: 'dark',  use_for: 'the dark workhorse - general, product, practices' },
  'veil':        { mode: 'dark',  use_for: 'heavy subjects (grief, slips, 2am), stat/dense - max quiet' },
  'parchment':   { mode: 'light', use_for: 'the light workhorse - lists, practices, lexicon' },
  'framed':      { mode: 'light', use_for: 'statement posts, definitions, collectible content' },
  'first-blush': { mode: 'light', use_for: 'gentle light-mode wins, mornings, soft CTAs' },
};
const DARK  = Object.keys(GROUNDS).filter(g => GROUNDS[g].mode === 'dark');
const LIGHT = Object.keys(GROUNDS).filter(g => GROUNDS[g].mode === 'light');

// ── Formats (canvases) ─────────────────────────────────────────────────────────
const FORMATS = ['carousel', 'post', 'story', 'reel'];
const LAYOUTS = {
  carousel: ['carousel'],                                  // multi-slide: hook->body...->signoff
  post:     ['hook', 'body', 'stat', 'list'],              // single feed post 1080x1350
  story:    ['story-quote', 'story-poll', 'story-cta'],    // 1080x1920
  reel:     ['reel'],                                      // 1080x1920 motion, 8s
};

// ── Tunable constants (the rules, as numbers) ───────────────────────────────────
const MAX_TEMPLATE_RUN   = 2;   // Rule A: at most 2 identical templates consecutively
const MAX_MODE_RUN       = 3;   // Rule B: at most 3 of one mode consecutively
const MIN_RILEY_PER_WEEK = 4;   // Rule D: weeks 2..4 need >= 4 Riley/program posts
const LAUNCH_WEEKS       = 4;    // the launch campaign spans 4 weeks
const LIGHT_TARGET       = 0.2;  // rhythm: ~2 light per 10 (soft bias, not a hard rule)
const DEFAULT_MIX = { carousel: 2, post: 2, story: 2, reel: 1 }; // 7 posts/week, all 4 formats

// ── Helpers ─────────────────────────────────────────────────────────────────────
const modeOf     = g => GROUNDS[g] ? GROUNDS[g].mode : null;
const templateId = s => `${s.format}:${s.ground}`;         // the visual "template"

// deterministic RNG (mulberry32) so --selftest is reproducible; Operator may pass any seed
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Would appending `cand` to `seq` violate a HARD run rule (A or B)?
function violatesRun(seq, cand) {
  const n = seq.length;
  // Rule A: no 3rd identical template in a row
  if (n >= MAX_TEMPLATE_RUN &&
      seq.slice(n - MAX_TEMPLATE_RUN).every(s => templateId(s) === templateId(cand))) {
    return true;
  }
  // Rule B: no 4th identical mode in a row
  if (n >= MAX_MODE_RUN &&
      seq.slice(n - MAX_MODE_RUN).every(s => s.mode === cand.mode)) {
    return true;
  }
  return false;
}

// Ordered ground candidates for a format, given the running sequence. Honors Rules A/B
// as hard filters; applies the soft rhythm (avoid same ground back-to-back, ~20% light)
// and randomness as ordering preference.
function groundCandidates(seq, format, rand) {
  const prev = seq[seq.length - 1];
  const lightSoFar = seq.filter(s => s.mode === 'light').length;
  const wantLight = seq.length > 0 && (lightSoFar / seq.length) < LIGHT_TARGET;
  // start from a shuffled full set, then sort by soft preference
  let cands = shuffle(Object.keys(GROUNDS), rand).map(ground => {
    const cand = { format, ground, mode: modeOf(ground) };
    return cand;
  }).filter(cand => !violatesRun(seq, cand));
  cands.sort((x, y) => score(y) - score(x));
  function score(c) {
    let s = 0;
    if (prev && c.ground === prev.ground) s -= 10;         // avoid exact same ground back-to-back
    if (wantLight && c.mode === 'light') s += 3;           // nudge toward the light quota
    if (!wantLight && c.mode === 'dark') s += 1;           // otherwise lean dark (workhorse)
    return s;
  }
  return cands;
}

/**
 * nextPick(history, ctx) - choose ONE compliant slot to append after `history`.
 * ctx: { format?, topicSource?, seed?, rand?, layout? }
 * Returns a slot or null if no ground satisfies the run rules (shouldn't happen with 6 grounds).
 */
function nextPick(history, ctx = {}) {
  const rand = ctx.rand || rng((ctx.seed != null ? ctx.seed : 1) + (history ? history.length : 0));
  const seq = history || [];
  const format = ctx.format || shuffle(FORMATS, rand)[0];
  const cands = groundCandidates(seq, format, rand);
  if (!cands.length) return null;
  const pick = cands[0];
  const layoutPool = LAYOUTS[format] || ['hook'];
  return {
    format,
    ground: pick.ground,
    mode: pick.mode,
    layout: layoutPool[Math.floor(rand() * layoutPool.length)],
    topicSource: ctx.topicSource || 'riley',
  };
}

// Expand a weekly mix object into a format multiset, e.g. {carousel:2,...} -> [...]
function expandMix(mix) {
  const out = [];
  for (const f of FORMATS) for (let i = 0; i < (mix[f] || 0); i++) out.push(f);
  return out;
}

// Pick which positions in a week are Riley (vs web), spread evenly, not clumped.
function rileyPositions(nSlots, rileyCount) {
  if (rileyCount >= nSlots) return new Set(Array.from({ length: nSlots }, (_, i) => i));
  const set = new Set();
  for (let k = 0; k < rileyCount; k++) {
    set.add(Math.round((k + 0.5) * nSlots / rileyCount));
  }
  // guard against rounding collisions
  let i = 0;
  while (set.size < rileyCount) { if (!set.has(i)) set.add(i); i++; }
  return set;
}

/**
 * Order one week's slots so all HARD rules hold, using backtracking over the format
 * multiset + ground choice. `tail` = the last few slots of the prior week (so runs
 * don't cross the week boundary). Returns the week's slots or null if infeasible.
 */
function planWeekOrder(formats, tail, rand) {
  const target = formats.length;
  const seq = tail.slice();                 // includes prior-week tail for run checks
  const startLen = seq.length;
  const remaining = {};
  for (const f of formats) remaining[f] = (remaining[f] || 0) + 1;

  function backtrack() {
    if (seq.length - startLen === target) return true;
    const formatsToTry = shuffle(Object.keys(remaining).filter(f => remaining[f] > 0), rand);
    for (const f of formatsToTry) {
      for (const cand of groundCandidates(seq, f, rand)) {
        remaining[f]--;
        seq.push(cand);
        if (backtrack()) return true;
        seq.pop();
        remaining[f]++;
      }
    }
    return false;
  }
  if (!backtrack()) return null;
  return seq.slice(startLen);
}

/**
 * planCampaign(numWeeks, opts) - build a compliant multi-week plan.
 * opts: { mix?, seed?, minRileyPerWeek?, startWeek? }
 * Returns { slots:[...], weeks:[[...]], mix }.
 * Slot: { week, day, format, ground, mode, layout, topicSource, theme }
 */
function planCampaign(numWeeks = LAUNCH_WEEKS, opts = {}) {
  const mix = opts.mix || DEFAULT_MIX;
  const minRiley = opts.minRileyPerWeek != null ? opts.minRileyPerWeek : MIN_RILEY_PER_WEEK;
  const startWeek = opts.startWeek || 0;
  const rand = rng((opts.seed != null ? opts.seed : 42) >>> 0);
  const formats = expandMix(mix);
  const nSlots = formats.length;

  const weeks = [];
  const all = [];
  let tail = [];
  for (let w = 0; w < numWeeks; w++) {
    const weekIndex = startWeek + w;
    // Rule D: week 0 = all Riley/launch; otherwise >= minRiley Riley posts.
    const isLaunchWeek = weekIndex === 0;
    const rileyCount = isLaunchWeek ? nSlots : Math.min(nSlots, minRiley);
    const rileySet = rileyPositions(nSlots, rileyCount);

    let ordered = null;
    for (let attempt = 0; attempt < 200 && !ordered; attempt++) {
      ordered = planWeekOrder(formats, tail.slice(-MAX_MODE_RUN), rand);
    }
    if (!ordered) throw new Error(`could not build a compliant week ${weekIndex} plan`);

    const weekSlots = ordered.map((s, i) => ({
      week: weekIndex,
      day: i + 1,
      format: s.format,
      ground: s.ground,
      mode: s.mode,
      layout: (LAYOUTS[s.format] || ['hook'])[Math.floor(rand() * (LAYOUTS[s.format] || ['hook']).length)],
      topicSource: (isLaunchWeek || rileySet.has(i)) ? 'riley' : 'web',
      theme: isLaunchWeek ? 'launch' : (rileySet.has(i) ? 'riley/program' : 'web-sourced'),
    }));
    weeks.push(weekSlots);
    all.push(...weekSlots);
    tail = tail.concat(weekSlots);
  }
  return { slots: all, weeks, mix };
}

/**
 * validateSequence(slots) - check a flat, chronological slot list against the HARD
 * rules (A-D). Returns { ok, violations:[...], advisories:[...] }.
 */
function validateSequence(slots) {
  const violations = [];
  const advisories = [];
  // A + B: run rules
  for (let i = 0; i < slots.length; i++) {
    if (i >= MAX_TEMPLATE_RUN &&
        slots.slice(i - MAX_TEMPLATE_RUN, i + 1).every(s => templateId(s) === templateId(slots[i]))) {
      violations.push(`Rule A: template "${templateId(slots[i])}" repeats >${MAX_TEMPLATE_RUN}x at slot ${i}`);
    }
    if (i >= MAX_MODE_RUN &&
        slots.slice(i - MAX_MODE_RUN, i + 1).every(s => s.mode === slots[i].mode)) {
      violations.push(`Rule B: ${slots[i].mode} ground run >${MAX_MODE_RUN} at slot ${i}`);
    }
    if (i > 0 && slots[i].ground === slots[i - 1].ground) {
      advisories.push(`rhythm: same ground "${slots[i].ground}" back-to-back at slot ${i}`);
    }
  }
  // C + D: per-week checks
  const byWeek = {};
  for (const s of slots) (byWeek[s.week] = byWeek[s.week] || []).push(s);
  for (const wk of Object.keys(byWeek)) {
    const ws = byWeek[wk];
    const formatsPresent = new Set(ws.map(s => s.format));
    for (const f of FORMATS) {
      if (!formatsPresent.has(f)) violations.push(`Rule C: week ${wk} is missing format "${f}"`);
    }
    const riley = ws.filter(s => s.topicSource === 'riley').length;
    if (Number(wk) === 0 && riley !== ws.length) {
      violations.push(`Rule D: week 1 (launch) must be ALL Riley - only ${riley}/${ws.length} are`);
    }
    if (Number(wk) >= 1 && Number(wk) <= LAUNCH_WEEKS - 1 && riley < MIN_RILEY_PER_WEEK) {
      violations.push(`Rule D: week ${Number(wk) + 1} needs >=${MIN_RILEY_PER_WEEK} Riley posts - only ${riley}`);
    }
  }
  return { ok: violations.length === 0, violations, advisories };
}

module.exports = {
  GROUNDS, DARK, LIGHT, FORMATS, LAYOUTS, DEFAULT_MIX,
  MAX_TEMPLATE_RUN, MAX_MODE_RUN, MIN_RILEY_PER_WEEK, LAUNCH_WEEKS,
  modeOf, templateId, nextPick, planCampaign, validateSequence,
};

// ── CLI self-test ────────────────────────────────────────────────────────────────
if (require.main === module && process.argv.includes('--selftest')) {
  const seeds = [42, 7, 100, 2026, 814];
  let failures = 0;
  for (const seed of seeds) {
    const plan = planCampaign(4, { seed });
    const { ok, violations, advisories } = validateSequence(plan.slots);
    if (!ok) { failures++; }
    if (seed === 42) {
      console.log('\n=== Sample 4-week launch plan (seed 42) ===');
      for (const wk of plan.weeks) {
        const w = wk[0].week;
        console.log(`\n  Week ${w + 1}${w === 0 ? '  (launch - all Riley)' : `  (>=${MIN_RILEY_PER_WEEK} Riley)`}:`);
        for (const s of wk) {
          console.log(`    d${s.day}  ${s.format.padEnd(9)} ${s.ground.padEnd(12)} ${s.mode.padEnd(6)} ${s.layout.padEnd(12)} ${s.topicSource}`);
        }
      }
      const riley1 = plan.weeks[0].every(s => s.topicSource === 'riley');
      console.log(`\n  Week 1 all-Riley: ${riley1}`);
      console.log(`  Advisories (soft rhythm): ${advisories.length}`);
    }
    console.log(`  seed ${String(seed).padEnd(5)} -> ${ok ? 'PASS' : 'FAIL: ' + violations.join('; ')}`);
  }
  console.log(`\n${failures === 0 ? 'ALL SEEDS PASS' : failures + ' SEED(S) FAILED'} - rules A (no template >2x), B (no >3 dark/light), C (weekly all-4-formats), D (launch phasing)\n`);
  process.exit(failures === 0 ? 0 : 1);
}
