/**
 * lapse-detection.js - deterministic detection of a DISCLOSED slip (already happened), for the
 * Staying Free lapse-repair state (doc 05 §5). This is distinct from crisis-detection's Level 2
 * (relapse RISK / about-to-use): here the person is telling you it already happened.
 *
 * Priority in riley-chat: Level 3 self-harm ALWAYS wins first (it short-circuits before this).
 * A disclosed slip then takes priority over the generic Level 1/2 directives, because the correct
 * response is the founder canon line + Fast Re-entry, not "put distance between you and the substance."
 *
 * Precision matters more than recall here: a false positive (treating "I didn't drink" as a slip)
 * would be jarring, and crisis-detection's Level 2 still catches the obvious disclosures as a floor.
 * So patterns are tight and negations are guarded.
 *
 * Exports:
 *   detectSlipDisclosure(text) → { isSlip: boolean, matches: [...] }
 *   lapseRepairDirective(canonLine) → string   (prepended to the system prompt, override priority)
 */

// Clear first-person, past-tense disclosures of a slip/use. Kept tight on purpose.
const SLIP = [
  /\bi (?:relapsed|used again|drank again|slipped(?: up)?|picked (?:it |back )?up(?: again)?|broke my (?:streak|sobriety)|fell off(?: the wagon)?|caved|gave in|lost my streak)\b/i,
  // "used" must NOT fire on the habitual idiom "I used to <verb>" (2026-07-24 false positive:
  // "I used to only audible when I traveled" -> RELAPSE RISK) or everyday objects ("I used my phone").
  /\bi (?:drank|got (?:drunk|high|wasted|loaded|blackout)|used(?!\s+to\b)(?!\s+(?:my|the|a|an|it|this|that|them|some))|smoked|shot up|got loaded)\b(?!\s+(?:water|coffee|tea|soda|juice|a smoothie|kombucha|milk|nothing|way too much water))/i,
  /\bi had (?:a drink|a few(?: drinks)?|some drinks|a beer|a glass of wine|a relapse|a slip|a bottle)\b/i,
  /\bi (?:ended up|wound up) (?:drinking|using|drunk|high|getting drunk|getting high)\b/i,
  /\bi(?:'ve| have) been (?:drinking|using|drunk|high) (?:again|lately|the last (?:few|couple))/i,
  /\b(?:last night|yesterday|this (?:weekend|morning)|tonight|earlier|a few days ago) i (?:drank|used|slipped|relapsed|got (?:drunk|high))\b/i,
  /\bi couldn'?t stop (?:myself )?(?:and )?(?:i )?(?:drank|used|drinking|using)\b/i,
  /\bi messed up (?:and|,)? ?(?:i )?(?:drank|used|drinking|using)\b/i,
];

// Statements that LOOK like a slip but are the opposite - did NOT slip, almost but didn't, or a
// non-alcohol object. These suppress a match entirely.
const SLIP_NEGATE = [
  /\bi (?:didn'?t|did not|never|haven'?t|have not) (?:drink|use|slip|relapse|drank|used|slipped|relapsed|pick(?:ed)? up|cave)\b/i,
  /\bi (?:almost|nearly|came close to|was (?:going|about) to but(?: i)?(?:'?ve)? didn'?t|wanted to but didn'?t)\b/i,
  /\b(?:didn'?t|did not) (?:end up|actually) (?:drinking|using|drink|use)\b/i,
  /\bi (?:drank|had) (?:water|coffee|tea|soda|juice|a smoothie|kombucha|milk)\b/i,
  /\bproud (?:that )?i (?:didn'?t|did not|haven'?t)\b/i,
  /\bso close to (?:drinking|using|a slip|relapse) but\b/i,
];

function anyMatch(patterns, text) {
  const hits = [];
  for (const re of patterns) {
    try { if (re.test(text)) hits.push(re.source.slice(0, 40)); } catch (_) { /* skip a malformed pattern */ }
  }
  return hits;
}

function detectSlipDisclosure(text) {
  if (!text || typeof text !== "string") return { isSlip: false, matches: [] };
  const t = text.toLowerCase();
  let negated = false;
  try { negated = SLIP_NEGATE.some((re) => re.test(t)); } catch (_) {}
  if (negated) return { isSlip: false, matches: [] };
  const hits = anyMatch(SLIP, t);
  return { isSlip: hits.length > 0, matches: hits };
}

// The lapse-repair directive. The canon line is served VERBATIM as Riley's first words (founder-
// authored; interim until Brenden replaces it). Includes the safety net so a still-at-risk moment
// still routes correctly.
function lapseRepairDirective(canonLine) {
  return `⚠️ SAFETY OVERRIDE - SLIP DISCLOSED (lapse-repair). This takes priority over EVERYTHING below - coaching, programs, selling, and whatever topic was active. The person has just told you they slipped, drank, or used. This is a moment of real trust and courage; treat it as sacred.

Your FIRST words must be exactly this, verbatim - it is founder-authored canon. Do not paraphrase it, do not add anything before it, do not soften or shorten it:
"${canonLine}"

After that, only if the conversation continues:
- No shame, ever. Never "I'm sorry to hear that." Never reset a streak or count. A slip is a data point that shows a gap in the plan - not a deletion of everything they built.
- Tonight has one job: water, something to eat, sleep. Nothing gets solved tonight.
- Resume, never restart. Tomorrow, in daylight, you'll look at what happened together - no inventory tonight.
- Do NOT sell or upsell ANYTHING. This is care, not conversion.
- If they signal they're still about to use more right now, or any thought of self-harm, drop this and follow the crisis rules - surface 988.
Stay with them. One warm next step, never a list.`;
}

module.exports = { detectSlipDisclosure, lapseRepairDirective };
