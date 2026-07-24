#!/usr/bin/env node
/**
 * check-messaging.js - the messaging cohesion gate (Messaging House v2.1).
 *
 * Runs as the Netlify build command, so EVERY production deploy fails if any
 * member-facing surface drifts from canon: retired strings, em-dashes, missing
 * canonical lines, or stale tier naming - including the DB-stored names/taglines
 * (products / plans) that the app and internal dashboards render for clients.
 *
 * Run locally before any push to main: node scripts/check-messaging.js
 * Exit 0 = cohesive. Exit 1 = drift found (deploy blocked).
 *
 * DB checks run only when SUPABASE_URL + SUPABASE_SERVICE_KEY are present
 * (they are, in Netlify builds). A NETWORK failure only warns - a confirmed
 * MISMATCH fails the build.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let failures = [];
const fail = (msg) => failures.push(msg);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
// entity/typography-normalized text for verbatim matching
const norm = (s) =>
  s.replace(/&rsquo;|’/g, "'").replace(/&amp;/g, "&").replace(/&middot;|·/g, "·");

const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const clientJs = ["marketing-pill.js", "clarity-view.js", "site-cms.js", "pwa.js", "track.js"].filter((f) =>
  fs.existsSync(path.join(ROOT, f))
);
const memberFacing = [...htmlFiles.filter((f) => f !== "operator.html"), ...clientJs, "manifest.json"];

// ── 1. Retired strings: zero hits on every served surface (operator included) ──
const RETIRED = [
  "Always there. Already knows.",
  "already knows your whole story",
  "HEALTH. WELLNESS.",
  "Four Pillars",
  "Riley Guide",
  "Let's Rebuild Together",
  "she's been through it", // Riley claiming lived experience - always "built by someone who's..."
  // CTA canon change 2026-07-24 (pre-launch punch list item 0): the free CTA is
  // "Come meet Riley" everywhere. These button strings are retired.
  "Meet Riley, free",
  "Meet Riley - free",
  ">Start free<",
  ">Get started free<",
];
for (const f of [...htmlFiles, ...clientJs, "manifest.json"]) {
  const t = norm(read(f));
  for (const r of RETIRED) if (t.includes(r)) fail(`${f}: retired string "${r}"`);
}
const fnDir = path.join(ROOT, "netlify/functions");
for (const f of fs.readdirSync(fnDir).filter((x) => x.endsWith(".js"))) {
  const t = norm(fs.readFileSync(path.join(fnDir, f), "utf8"));
  for (const r of ["Always there. Already knows.", "already knows your whole story", "she's been through it"])
    if (t.includes(r)) fail(`netlify/functions/${f}: retired string "${r}"`);
}

// ── 2. Em-dashes: none in member-facing files (brand law 5) ──
for (const f of memberFacing) if (read(f).includes("—")) fail(`${f}: contains an em-dash (U+2014)`);

// ── 3. Canonical lines, verbatim where they live (Messaging House v2.1) ──
if (!fs.existsSync(path.join(ROOT, "RILEY_MESSAGING_HOUSE.md"))) fail("RILEY_MESSAGING_HOUSE.md missing from repo root");
const MUST = {
  "home.html": [
    "Start where you are.</span><span>Riley will meet you there.",
    "Not every change needs to be a reinvention.",
    "BUILT BY SOMEONE WHO'S BEEN THROUGH IT",
    "Riley is a companion for life's hard chapters - grief, burnout, habits, sobriety, starting over.",
    "Riley is not a therapist and not here to replace professional care. She is here to help you feel less alone.",
    "Never explain yourself twice.",
    "Riley is free to start. $8.14 gets you a program. $19 a month gets you all of Riley.",
    "Whatever you're carrying, start there.",
    "The light's on. Come say hi.",
    "8:14 - the minute the light comes back.",
  ],
  "about.html": ["Riley is an AI.", "That's where 8:14 comes from.", "For someone so great - gone too soon."],
};
for (const [f, lines] of Object.entries(MUST)) {
  const t = norm(read(f));
  for (const l of lines) if (!t.includes(norm(l))) fail(`${f}: canonical line missing/altered: "${l}"`);
}
// Tier taglines pinned to the right cards on the homepage
const home = norm(read("home.html"));
if (!/data-plan="guide"[\s\S]{0,600}Riley shows you where you stand\./.test(home))
  fail("home.html: free tier card must lead with \"Riley shows you where you stand.\"");
if (!/data-plan="companion"[\s\S]{0,800}Riley walks with you\./.test(home))
  fail("home.html: Coach card must lead with \"Riley walks with you.\"");
if (home.includes("Riley Mentor")) fail("home.html: Mentor must never appear on marketing (dashboard-only)");

// ── 4. DB naming (products/plans) - what the app + internal dashboards show clients ──
async function checkDb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.log("(i) DB check skipped - no Supabase env in this shell"); return; }
  const get = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`${q}: HTTP ${r.status}`);
    return r.json();
  };
  try {
    const prods = await get("products?select=product_key,display_name,visible_on_menu&product_key=in.(reset_free,companion,coach)");
    const P = Object.fromEntries(prods.map((p) => [p.product_key, p]));
    if (P.reset_free?.display_name !== "Riley Companion") fail(`DB products.reset_free display_name is "${P.reset_free?.display_name}" (want "Riley Companion")`);
    if (P.companion?.display_name !== "Riley Coach") fail(`DB products.companion display_name is "${P.companion?.display_name}" (want "Riley Coach")`);
    if (P.coach && (P.coach.display_name !== "Riley Mentor" || P.coach.visible_on_menu !== false))
      fail("DB products.coach must be display_name 'Riley Mentor' and hidden from the menu (grandfathered only)");
    const plans = await get("plans?select=id,name,tagline&id=in.(guide,companion)");
    const L = Object.fromEntries(plans.map((p) => [p.id, p]));
    if (L.guide && (L.guide.name !== "Riley Companion" || L.guide.tagline !== "Riley shows you where you stand."))
      fail("DB plans.guide must be name 'Riley Companion' / tagline 'Riley shows you where you stand.'");
    if (L.companion && (L.companion.name !== "Riley Coach" || L.companion.tagline !== "Riley walks with you."))
      fail("DB plans.companion must be name 'Riley Coach' / tagline 'Riley walks with you.'");
  } catch (e) {
    console.warn(`(!) DB check could not run (${e.message}) - not failing the build on a network error`);
  }
}

checkDb().then(() => {
  if (failures.length) {
    console.error(`\nMESSAGING GATE FAILED - ${failures.length} problem(s):`);
    failures.forEach((f) => console.error("  ✗ " + f));
    console.error("\nCanon: RILEY_MESSAGING_HOUSE.md (v2.1). Fix the drift or update canon first.\n");
    process.exit(1);
  }
  console.log(`Messaging gate passed - ${htmlFiles.length} pages + client JS + DB naming cohesive with canon.`);
});
