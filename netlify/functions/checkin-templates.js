/**
 * checkin-templates.js - the approved template bank (docs/07 §2c v1 constraint).
 * Skins and dynamic questions come from HERE, not free generation: every string below is
 * Sentinel-reviewed, plain-hyphen, Never-Say-clean (tests/rhythm asserts it). Templates carry
 * {slot} placeholders filled from member memory; the SPINE (fields, scales, semantics) never
 * changes - these are framing only. checkin_context = {template ids + slot values} reproduces
 * any rendered check-in exactly.
 */

// Framing variants per spine field. id → text. {name} available in all.
const FRAMINGS = {
  mood: {
    mood_a: "How are you feeling right now?",
    mood_b: "Where's your mood sitting this morning?",
    mood_c: "Checking in - how's your heart today?",
  },
  energy: {
    energy_a: "How's your energy?",
    energy_b: "How's the tank this morning?",
    energy_c: "How much is in reserve today?",
  },
  heaviness: {
    heavy_a: "How heavy was today?",
    heavy_b: "On the light-to-heavy scale, where did today land?",
  },
  sleep: {
    sleep_a: "How did you sleep?",
    sleep_b: "What did last night give you?",
  },
  sentence: {
    sent_a: "One honest sentence about today.",
    sent_b: "Say one true thing about today - anything counts.",
  },
  outside: {
    out_a: "Get outside today?",
    out_b: "Did you make it out under the sky today?",
  },
  connection: {
    conn_a: "Talk to a human today?",
    conn_b: "Any real contact with a person today - a call counts?",
  },
};

// Living Question / dynamic-slot templates by source (07 §2c, 08 §3b). NEVER scored.
const DYNAMIC = {
  thread_commitment: 'Last time you mentioned {thread}. Did it happen?',
  thread_event: "You had {thread} coming up. How did it go?",
  thread_worry: "You were carrying {thread}. How is that sitting now?",
  thread_goal: "{thread} - still serving you?",
  thread_joy: "You lit up about {thread}. Any more of that lately?",
  harddate_before: "{label} is coming up this week. How are you holding it?",
  goal_pulse: "Those {goal} - keep going, adjust, or start something new?",
  program_stage: "Day {day} of {program} - how did it land?",
  context_color: "How are things out your way today?",
};

// Return-sequence copy (08 §3b) - R2+ replaces a cold spine with a conversation.
const RETURN_SEQ = {
  open: "Good to see you. How have the last few days been?",
  open_options: ["rough", "mixed", "okay", "good"],
  anything: "Anything I should know?",
  goals: "Those goals from last week - keep going, adjust, or start something new?",
  goals_options: ["keep", "adjust", "fresh"],
  r3_recap_offer: "Want a quick where-we-left-off, or just start fresh?",
  r4_open: "Welcome back. Everything's where you left it.",
  r4_season: "What season are you in right now?",
};

// Hard-day aftermath opening (08 §4.4) - the morning after a flagged hard day.
const AFTERMATH = "Yesterday was heavy. Scale of 'still heavy' to 'lighter' - where's this morning?";

// Static canonical fallback (generation/composition failure must never block a check-in).
const STATIC_FALLBACK = { mood: "mood_a", energy: "energy_a", heaviness: "heavy_a", sleep: "sleep_a", sentence: "sent_a", outside: "out_a", connection: "conn_a" };

// Deterministic per-member-per-day variant pick (no Math.random - reproducible).
function pickFraming(field, seed) {
  const ids = Object.keys(FRAMINGS[field] || {});
  if (!ids.length) return null;
  let h = 0;
  const s = `${seed}:${field}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ids[h % ids.length];
}

function fill(text, slots) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (slots && slots[k] != null ? String(slots[k]) : m));
}

module.exports = { FRAMINGS, DYNAMIC, RETURN_SEQ, AFTERMATH, STATIC_FALLBACK, pickFraming, fill };
