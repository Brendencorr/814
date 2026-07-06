/**
 * curation.test.js — unit tests for the pure content-library modules.
 * Run: node test/curation.test.js   (no deps; asserts the QA gates from the v2 plan)
 */
const assert = require("assert");
const { normalizeItem, validateItem } = require("../netlify/functions/content-curation");
const { matchContent } = require("../netlify/functions/match-content");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error("FAIL - " + name + "\n   " + (e && e.message)); }
}

// ───────── validateItem / normalizeItem ─────────
const registry = new Set(["sleep", "recovery", "grief_specific", "quick_win", "mental health", "movement"]);
const vctx = () => ({ registry, existing: new Set(), batch: new Set() });

test("valid item passes", () => {
  const it = normalizeItem({ title: "Calm Sleep", content_type: "meditation", content_url: "https://open.spotify.com/x", personas: ["universal"], tone: "grounded", tier_access: "companion", tags: ["sleep"] });
  assert.deepStrictEqual(validateItem(it, vctx()), []);
});
test("freeform tag rejected", () => {
  const it = normalizeItem({ title: "X", content_type: "meditation", content_url: "https://a.com", tags: ["not_a_real_tag"] });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("unregistered")));
});
test("invalid content_type rejected", () => {
  const it = normalizeItem({ title: "X", content_type: "tiktok", content_url: "https://a.com" });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("content_type")));
});
test("malformed URL rejected", () => {
  const it = normalizeItem({ title: "X", content_type: "video", content_url: "notaurl" });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("URL")));
});
test("missing title rejected", () => {
  const it = normalizeItem({ content_type: "video", content_url: "https://a.com" });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("title")));
});
test("manifestation + griever rejected (guardrail)", () => {
  const it = normalizeItem({ title: "Abundance", content_type: "podcast", content_url: "https://a.com", tone: "manifestation", personas: ["griever"] });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("manifestation")));
});
test("manifestation + drinker rejected (guardrail)", () => {
  const it = normalizeItem({ title: "Vibes", content_type: "podcast", content_url: "https://a.com", tone: "manifestation", personas: ["drinker"] });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("manifestation")));
});
test("manifestation + universal allowed", () => {
  const it = normalizeItem({ title: "Abundance2", content_type: "podcast", content_url: "https://a.com", tone: "manifestation", personas: ["universal"] });
  assert.deepStrictEqual(validateItem(it, vctx()), []);
});
test("dupe existing rejected", () => {
  const c = vctx(); c.existing.add("calm sleep");
  const it = normalizeItem({ title: "Calm Sleep", content_type: "meditation", content_url: "https://a.com" });
  assert.ok(validateItem(it, c).some((p) => p.includes("existing")));
});
test("dupe within batch rejected", () => {
  const c = vctx(); c.batch.add("calm sleep");
  const it = normalizeItem({ title: "Calm Sleep", content_type: "meditation", content_url: "https://a.com" });
  assert.ok(validateItem(it, c).some((p) => p.includes("batch")));
});
test("invalid persona rejected (plan's drinker_user is not real)", () => {
  const it = normalizeItem({ title: "Y", content_type: "video", content_url: "https://a.com", personas: ["drinker_user"] });
  assert.ok(validateItem(it, vctx()).some((p) => p.includes("persona")));
});
test("normalizeItem lowercases tags + defaults personas + type", () => {
  const it = normalizeItem({ title: "Z", content_type: "VIDEO", content_url: "https://a.com", tags: ["Sleep", " Recovery "] });
  assert.deepStrictEqual(it.tags, ["sleep", "recovery"]);
  assert.deepStrictEqual(it.personas, ["universal"]);
  assert.strictEqual(it.content_type, "video");
});

// ───────── matchContent ─────────
function item(over) {
  return Object.assign({
    id: "id" + Math.random().toString(36).slice(2), title: "t",
    approval_status: "approved", is_active: true, link_status: "ok",
    guide_starter: false, tier_access: "companion", tone: "grounded",
    personas: ["universal"], tags: [], pillars: [], time_of_day: ["any"], duration_minutes: 10,
  }, over);
}
test("crisisActive returns empty", () => {
  assert.deepStrictEqual(matchContent([item({})], { tier: "companion" }, { crisisActive: true }), []);
});
test("guide curated sees ONLY the starter set", () => {
  const starter = item({ id: "s", title: "Starter", guide_starter: true, tier_access: "guide" });
  const paid = item({ id: "p", title: "Paid", tier_access: "companion" });
  assert.deepStrictEqual(matchContent([starter, paid], { tier: "guide" }, { mode: "curated" }).map((x) => x.id), ["s"]);
});
test("guide manual search STILL cannot cross tier", () => {
  const starter = item({ id: "s", title: "Starter", guide_starter: true });
  const paid = item({ id: "p", title: "Paid Affirm", tier_access: "companion", tone: "manifestation" });
  const out = matchContent([starter, paid], { tier: "guide" }, { mode: "search", query: "affirm" });
  assert.ok(!out.find((x) => x.id === "p"), "guide must not reach paid content via search");
});
test("griever CURATED never gets manifestation (even explore)", () => {
  const man = item({ id: "m", title: "Manifest", tone: "manifestation" });
  assert.deepStrictEqual(matchContent([man], { tier: "companion", personas: ["griever"] }, { mode: "curated", exploreMode: true }), []);
});
test("griever SEARCH (companion) DOES find the affirmation podcast", () => {
  const man = item({ id: "m", title: "Affirmation Podcast", tone: "manifestation", content_type: "podcast", tier_access: "companion" });
  const out = matchContent([man], { tier: "companion", personas: ["griever"] }, { mode: "search", query: "affirmation" });
  assert.deepStrictEqual(out.map((x) => x.id), ["m"]);
});
test("companion cannot see a coach-tier item", () => {
  const coachItem = item({ id: "c", title: "Coach only", tier_access: "coach" });
  assert.deepStrictEqual(matchContent([coachItem], { tier: "companion" }, { mode: "search", query: "coach" }), []);
});
test("broken link is dropped", () => {
  assert.deepStrictEqual(matchContent([item({ id: "b", title: "Broken", link_status: "broken" })], { tier: "companion" }, { mode: "curated" }), []);
});
test("top-3 is deterministic (score desc, title asc), input-order-independent", () => {
  const a = item({ id: "a", title: "Bravo", tags: ["sleep"] });
  const b = item({ id: "b", title: "Alpha", tags: ["sleep"] });
  const c = item({ id: "c", title: "Charlie", tags: ["sleep"] });
  const client = { tier: "companion", personas: ["burnt_out"], onboarding_tags: ["sleep"] };
  const out1 = matchContent([a, b, c], client, { mode: "curated" }).map((x) => x.id);
  const out2 = matchContent([c, b, a], client, { mode: "curated" }).map((x) => x.id);
  assert.deepStrictEqual(out1, out2, "order must be input-independent");
  assert.deepStrictEqual(out1, ["b", "a", "c"], "Alpha, Bravo, Charlie");
});
test("requiredTag filters to the tapped tag", () => {
  const s = item({ id: "s", title: "Sleepy", tags: ["sleep"] });
  const m = item({ id: "m", title: "Movey", tags: ["movement"] });
  assert.deepStrictEqual(matchContent([s, m], { tier: "companion" }, { mode: "curated", requiredTag: "sleep" }).map((x) => x.id), ["s"]);
});
test("rotation penalty lowers recently-seen items", () => {
  const seen = item({ id: "seen", title: "AAA Seen", tags: ["sleep"] });
  const fresh = item({ id: "fresh", title: "ZZZ Fresh", tags: ["sleep"] });
  const client = { tier: "companion", onboarding_tags: ["sleep"] };
  const out = matchContent([seen, fresh], client, { mode: "curated", recentContentIds: new Set(["seen"]) }).map((x) => x.id);
  assert.deepStrictEqual(out, ["fresh", "seen"], "fresh outranks recently-seen despite title order");
});
test("universal content reaches any persona (curated, grounded)", () => {
  const u = item({ id: "u", title: "Universal", personas: ["universal"], tags: ["sleep"] });
  const out = matchContent([u], { tier: "companion", personas: ["griever"], onboarding_tags: ["sleep"] }, { mode: "curated" });
  assert.deepStrictEqual(out.map((x) => x.id), ["u"]);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
