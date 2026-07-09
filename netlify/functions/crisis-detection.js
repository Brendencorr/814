/**
 * crisis-detection.js - Deterministic crisis + diagnosis intent detection
 *
 * Per the Trust, Limitations & Crisis Support Architecture: detection runs as
 * deterministic rules (NOT an LLM call) for speed and reliability, and has
 * OVERRIDE PRIORITY over all other Riley logic. False negatives are the highest
 * risk, so patterns lean toward catching; obvious sobriety/recovery statements
 * are excluded from relapse-risk to avoid absurd false positives.
 *
 * ⚠️  CLINICAL REVIEW REQUIRED BEFORE LAUNCH. The architecture doc names this as
 * the one section needing a clinical / crisis-response consultant to review the
 * trigger logic and recall before exposure to real, vulnerable members.
 *
 * Exports:
 *   detectCrisis(text)   → { level: 0|1|2|3, matches: [...] }   (highest wins)
 *   detectDiagnosis(text) → boolean   (asking Riley to diagnose)
 */

// ── Level 3 - Active crisis / self-harm risk (highest priority) ──────────────
// Includes the indirect phrasings the doc calls out ("what's the point anymore",
// "I don't think I want to wake up tomorrow"). These "hard" patterns ALWAYS fire
// when matched. The death-wish case ("want to die") is handled separately below
// with a code-level negation check so the reassuring "I don't want to die" is the
// only thing suppressed - "I don't want to be here / wake up / live" still fires.
// (No regex lookbehind anywhere - keeps this module load-safe across runtimes.)
const L3 = [
  /\b(kill|killing|hurt|hurting|harm|harming|cut|cutting)\s+(myself|me)\b/i,
  /\bend(ing)?\s+(it all|my life|myself|things)\b/i,
  /\b(don'?t|do not|dont|never)\s+(think i\s+|really\s+)?want(ed)?\s+to\s+(be here|wake up|live|exist|be alive|go on|keep going)\b/i,
  /\bno\s+(reason|point)\s+(to|in)?\s*(living|life|go(ing)? on|be(ing)? here|wake up|waking up|keep going|trying)\b/i,
  /\bwhat'?s the point (anymore|of (any|it)? ?(thing|living|trying)?)\b/i,
  /\b(better off|world.*better|everyone.*better|they'?d be better)\s+(without me|if i (was|were|wasn'?t|weren'?t) (gone|dead|here|around))\b/i,
  /\bno ?one would (care|miss me|notice|even notice|be sad)\b/i,
  /\b(want|wanting|just want) to disappear\b/i,
  /\bsuicid(e|al)\b/i,
  /\bself.?harm(ing)?\b/i,
  /\boverdos(e|ing)\b/i,
  /\bi'?m (not safe|going to hurt myself|in danger from myself|done with life)\b/i,
  /\b(can'?t|cannot|cant) (go on|keep going|live like this|live this way)\b/i,
  /\bgive up on life\b/i,
  /\b(wish i (was|were) dead|rather be dead|want to be dead|wish i could disappear)\b/i,
];

// Death-wish - caught only when NOT negated. "I want to die" fires; the
// life-affirming "I don't want to die" / "I won't kill myself" does not.
const DEATHWISH =
  /\b(want|wanna|going|gonna|plan(ning)?|ready|trying|thinking about)\s+to\s+(die|kill myself|end (it|this|my life|myself|everything)|take my (own )?life|not exist|disappear forever)\b/i;
const DEATHWISH_NEGATE =
  /\b(don'?t|do not|dont|never|won'?t|will not|wont|not going|not gonna|would never|no longer)\s+(really\s+|ever\s+|think i\s+|actually\s+|even\s+)?want(ed)?\s+to\s+(die|kill myself|end (it|my life|myself)|hurt myself|be dead)\b/i;

// ── Level 2 - Relapse risk ───────────────────────────────────────────────────
// "drink" excludes everyday non-alcoholic objects (water/coffee/…). "use"
// requires it NOT be followed by an everyday object (the bathroom/my phone/…),
// so "I need to use the restroom" never reads as relapse.
const L2 = [
  /\b(want|wanna|going|gonna|about|need|ready|tempted|gotta)\s+to\s+(drink(?!\s+(?:water|coffee|tea|soda|juice|smoothie|kombucha|milk|something|a smoothie|more water))|get (?:high|drunk|wasted|loaded)|smoke|shoot up|pop a pill|score|cop)\b/i,
  /\b(want|wanna|going|gonna|about|tempted|need)\s+to\s+use\b(?!\s+(?:the|my|a|an|your|this|that|it|some|more|less|public|protection))/i,
  /\bi (relapsed|used again|drank again|slipped (?:up)?|picked up(?: again)?|broke my (?:streak|sobriety))\b/i,
  /\b(scared|afraid|worried|terrified)\b.*\b(relaps|going to (?:drink|use)|gonna (?:drink|use))\b/i,
  /\bgoing to relapse\b/i,
  /\bcan'?t stop (?:thinking about|craving) (?:drink|drinking|using|getting high|alcohol|booze)\b/i,
  /\b(strong|bad|intense|huge|massive) (?:urge|craving)s?\b/i,
  /\bcravings?\b[^.!?]{0,30}\b(intense|so intense|bad|so bad|really bad|strong|so strong|overwhelming|unbearable|brutal|killing me|won'?t stop|right now)\b/i,
  /\b(intense|overwhelming|unbearable|brutal|terrible|awful)\b[^.!?]{0,20}\bcravings?\b/i,
  /\bbuy(?:ing)?\s+(?:a bottle|booze|alcohol|liquor|a drink|a six.?pack|a twelve.?pack)\b/i,
  /\bone (?:drink|hit|line|pill|beer) won'?t hurt\b/i,
  /\bjust (?:one|a) (?:drink|hit|beer|line)\b/i,
  /\bi have (?:a bottle|the pills|booze|it) (?:right )?(?:here|in front of me|with me)\b/i,
];
// Phrases that look like L2 but are actually recovery/sobriety statements - exclude.
const L2_NEGATE = [
  /\b(don'?t|do not|dont|never|no longer)\s+(want|wanna)?\s*to\s+(drink|use)\b/i,
  /\bdon'?t want to (drink|use|relapse)\b/i,
  /\bnever (want|going|gonna) to (drink|use|relapse) again\b/i,
  /\b(quit|quitting|stopping|stopped|done) (drinking|using)\b/i,
  /\bproud.*not (drink|drank|used)\b/i,
];

// ── Level 1 - Elevated stress ────────────────────────────────────────────────
const L1 = [
  /\b(overwhelm(ed|ing)?|drowning|falling apart|breaking down|can'?t cope|too much to handle)\b/i,
  /\b(panic(king|ked)?|panic attack|anxious|anxiety|stressed|so stressed|spiral(ing|ling)?|on edge)\b/i,
  /\b(really |so )?(lonely|alone|isolated)\b/i,
  /\btriggered\b/i,
  /\bhopeless\b/i,
  /\bcan'?t do this anymore\b/i,
  /\b(exhausted|burnt? out|running on empty|at my limit)\b/i,
  /\beverything (is|feels) (falling apart|too much|crashing)\b/i,
];

// ── Diagnosis questions - the hard guardrail (1.2) ──────────────────────────
const DIAGNOSIS = [
  /\bdo i have\s+(depression|anxiety|bipolar|adhd|ptsd|ocd|an? (disorder|illness|condition|addiction)|.*disorder)\b/i,
  /\bam i\s+(depressed|bipolar|an? alcoholic|an addict|manic|crazy|mentally ill|sick|broken)\b/i,
  /\bdo you think i('?m| am| have)\b.*\b(alcoholic|addict|depress|bipolar|anxiety|disorder|sick|broken)\b/i,
  /\b(is this|could this be|might this be|is it)\s+(depression|anxiety|bipolar|adhd|ptsd|ocd|.*disorder|something (worse|serious))\b/i,
  /\bwhat'?s wrong with me\b/i,
  /\bdo i have a (problem|drinking problem|disease)\b/i,
  /\bwould you (diagnose|say i have)\b/i,
];

// Resilient: a single malformed pattern can never crash detection - it's
// skipped, and we fail toward catching (safer for a crisis detector).
function anyMatch(patterns, text) {
  const hits = [];
  for (const re of patterns) {
    try { if (re.test(text)) hits.push(re.source.slice(0, 40)); } catch (_) { /* skip */ }
  }
  return hits;
}

function detectCrisis(text) {
  if (!text || typeof text !== "string") return { level: 0, matches: [] };
  const t = text.toLowerCase();

  // Level 3 - hard patterns always fire; death-wish fires unless clearly negated.
  const l3 = anyMatch(L3, t);
  let deathWish = false;
  try { deathWish = DEATHWISH.test(t) && !DEATHWISH_NEGATE.test(t); } catch (_) {}
  if (l3.length || deathWish) {
    return { level: 3, matches: deathWish ? [...l3, "death-wish"] : l3 };
  }

  // Level 2 - relapse intent AND not a sobriety/negation statement
  const l2 = anyMatch(L2, t);
  if (l2.length) {
    let negated = false;
    try { negated = L2_NEGATE.some(re => re.test(t)); } catch (_) {}
    if (!negated) return { level: 2, matches: l2 };
  }

  const l1 = anyMatch(L1, t);
  if (l1.length) return { level: 1, matches: l1 };

  return { level: 0, matches: [] };
}

function detectDiagnosis(text) {
  if (!text || typeof text !== "string") return false;
  try { return DIAGNOSIS.some(re => re.test(text.toLowerCase())); } catch (_) { return false; }
}

// ── Level 3 deterministic response ───────────────────────────────────────────
// Fully controlled wording for the highest-risk case - no LLM variability.
// Calm, direct, never clinical. No risk-assessment questions. No confidentiality
// promises. Does not debate or "fix" the feeling. 988 surfaced (US default).
const LEVEL3_RESPONSE =
`I'm really glad you told me. This matters, and you don't have to handle it alone.

Right now, the most important thing isn't solving everything - it's staying safe for the next few minutes.

Please reach out right now to someone who can help:
• Call or text 988 - the Suicide & Crisis Lifeline. Trained counselors are there any time, day or night.
• If you may be in immediate danger, call 911 or go to your nearest emergency room.
• If someone you trust is nearby, reach out and let them stay with you.

I'm here with you too, and I'm not going anywhere. But these people are trained for exactly this moment, and you deserve that kind of support right now. Can you reach out to one of them?`;

// ── Level 2 directive - relapse risk (steers the LLM; prepended w/ override) ──
const LEVEL2_DIRECTIVE =
`⚠️ SAFETY OVERRIDE - RELAPSE RISK DETECTED (Level 2). This takes priority over EVERYTHING else below - coaching, programs, selling, and whatever topic was active. Exit that flow now. The person has signaled they may be close to drinking or using.

Respond warmly and without panic. Do this:
1. Acknowledge the pull directly and without shame. Reaching out right now is strength, not failure.
2. Gently encourage them to put physical distance between themselves and the substance or access to it, right now.
3. Encourage them to contact a real person immediately - a sponsor, their coach, a trusted friend, or a meeting.
4. Offer a concrete tool right now, free to anyone regardless of tier: the Emergency Craving Protocol or the 8-Minute Reset (a movement interrupt). An urge is a wave - it rises, peaks, and passes in minutes; they can ride it without acting. Walk them into the first step live, don't just name it.
5. Make sure they know they can call or text 988 any time if it gets heavier.
Stay with them. Do NOT return to normal coaching. Do NOT sell anything - this support is always free. One caring next step - not a list.`;

// ── Level 1 directive - elevated stress ──────────────────────────────────────
const LEVEL1_DIRECTIVE =
`⚠️ SUPPORT MODE - ELEVATED STRESS DETECTED (Level 1). The person is overwhelmed, anxious, lonely, or triggered. Set coaching goals and any selling aside for this reply.

Do this:
1. Validate the feeling first - plainly and warmly.
2. Slow the moment down: one breath, one sentence.
3. Offer ONE small grounding step (the physiological sigh; naming three things they can see; stepping outside).
4. Gently ask who or what support is nearby.
Keep it short and human. Presence over advice. No lists.`;

// ── Diagnosis guardrail directive (1.2) - the hard rule ──────────────────────
const DIAGNOSIS_DIRECTIVE =
`⚠️ HARD GUARDRAIL - DIAGNOSTIC QUESTION DETECTED. The person is asking you to name, confirm, or rule out a medical or mental-health diagnosis. You must NOT diagnose, suggest, imply, or rule out any condition - ever.

Respond using exactly this pattern, in Riley's warm voice:
1. Acknowledge the question is real and worth taking seriously - without answering it diagnostically.
2. Make clear a question like this deserves a real answer from a licensed professional who can actually evaluate them - not from you.
3. Offer to help them think through what to ask that professional, if useful.
Do not name conditions. Do not speculate. Do not soften this into a "maybe."`;

module.exports = {
  detectCrisis,
  detectDiagnosis,
  LEVEL3_RESPONSE,
  LEVEL2_DIRECTIVE,
  LEVEL1_DIRECTIVE,
  DIAGNOSIS_DIRECTIVE,
};
