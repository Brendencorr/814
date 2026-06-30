/**
 * journey-step.js — Journey daily content (generate + cache)
 *
 * Returns the step for (program_slug, day_number). If it's hand-written in
 * journey_steps (e.g. the 7-Day Reset), returns that. Otherwise generates it
 * from the journey's emotional arc via Claude — ONCE — and caches it into
 * journey_steps so it's shared and consistent for every client thereafter.
 *
 * This is how the paid journeys (90/30/30 days) deliver real daily content
 * without hand-authoring 150 steps: intentional arcs + on-demand generation,
 * cached at the journey level (not per-user) for scale and consistency.
 *
 * POST { program_slug, day_number }
 * Model: claude-sonnet-4-6
 */

const { getSupabaseClient } = require("./supabase-client");
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Emotional arcs for the paid journeys ─────────────────────────────────────
const ARCS = {
  "recovery-journey": {
    title: "Recovery Journey", tagline: "One Day at a Time", duration: 90,
    phases: [
      { days: [1, 14],  theme: "Stabilize",              focus: "Getting through the early days. Physical recovery, basic safety, one hour at a time. The goal is simply to make it through and stay." },
      { days: [15, 30], theme: "Rebuild the Foundation", focus: "Sleep, food, movement, routine. The quiet scaffolding of a steady life. Small consistent habits that hold a person up." },
      { days: [31, 60], theme: "The Emotional Work",      focus: "Feelings returning after the numbness. Triggers, shame, identity without the substance. The deeper, harder layer — held gently." },
      { days: [61, 90], theme: "Becoming",               focus: "Who they are now. Integration, forward motion, relationships, purpose — building the life that makes staying worth it." },
    ],
  },
  "move-and-nourish": {
    title: "Move & Nourish", tagline: "Move & Nourish", duration: 30,
    phases: [
      { days: [1, 7],   theme: "Begin Gently",       focus: "The first movements and meals. Not performance — just showing up for the body. Ten minutes, one good meal, no shame." },
      { days: [8, 15],  theme: "Build Consistency",  focus: "Turning single actions into a rhythm. Movement most days, protein and greens, hydration. Momentum over intensity." },
      { days: [16, 23], theme: "Strength & Gut",     focus: "Progressive strength from zero. The gut-brain connection deepening — how food steadies mood. Feeling the difference." },
      { days: [24, 30], theme: "Make It a Life",     focus: "Moving from a program to a way of living. What they keep, how they keep it, the body as an ally not a project." },
    ],
  },
  "carry-both": {
    title: "Carry Both", tagline: "Carry Both", duration: 30,
    phases: [
      { days: [1, 7],   theme: "Name the Grief",        focus: "Letting the loss be real. Naming it, feeling it, not rushing past it. Grief and recovery sitting in the same room." },
      { days: [8, 15],  theme: "Carry Both Together",   focus: "Holding grief and rebuilding at once — without using one to escape the other. How to grieve sober. How to stay while it hurts." },
      { days: [16, 23], theme: "Honor What Was Lost",   focus: "Ritual, memory, meaning. Letting the person or the life that was lost be honored rather than buried. Love that continues." },
      { days: [24, 30], theme: "Live Forward, Holding", focus: "Carrying the loss into a life still worth living. Not moving on — moving forward, with them still part of you." },
    ],
  },
};

function phaseFor(arc, day) {
  return arc.phases.find(p => day >= p.days[0] && day <= p.days[1]) || arc.phases[arc.phases.length - 1];
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { program_slug, day_number } = JSON.parse(event.body || "{}");
    if (!program_slug || !day_number) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "program_slug and day_number required" }) };

    const supabase = getSupabaseClient();

    // 1. Already have it (hand-written or previously generated)?
    const { data: existing } = await supabase
      .from("journey_steps").select("*")
      .eq("program_slug", program_slug).eq("day_number", day_number).maybeSingle();
    if (existing) {
      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ step: existing, generated: false }) };
    }

    // 2. Generate from the arc
    const arc = ARCS[program_slug];
    if (!arc) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "No arc defined for this journey" }) };
    const phase = phaseFor(arc, day_number);
    const isMilestone = [7, 30, 60, 90].includes(day_number) || day_number === arc.duration;

    const sys = `You are Riley, the wellness guide for The 8:14 Project. Write Day ${day_number} of ${arc.duration} of the "${arc.title}" journey.

CURRENT PHASE: ${phase.theme} — ${phase.focus}
${isMilestone ? "This is a MILESTONE day — mark it with quiet weight, acknowledge how far they've come. No fireworks; presence." : ""}

VOICE: Warm, direct, honest. Never preachy, never clinical, never motivational-poster. Short sentences. Hope is quiet. This is recovery/grief/rebuilding — hold it with care. Never shame.

Each day has ONE small action (doable today), a reflection prompt, a short lesson, and a personal message from Riley.

Return ONLY valid JSON, no other text:
{
  "title": "2-3 word title for the day",
  "lesson": "2-4 sentences. The teaching for today, grounded in this phase. Real, specific, never generic.",
  "action": "One small concrete thing to do today. 20 words max.",
  "journal_prompt": "One question to sit with today. Invites honesty, never pressure.",
  "riley_message": "1-2 sentences from Riley directly to them for this specific day. Warm. Reference the day number or phase naturally.",
  "recommended_content_types": ["pick 1-3 from: breathwork, journal_prompt, music, walk, workout, meditation, recipe, podcast, community_prompt, celebration"]
}`;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 600, system: sys, messages: [{ role: "user", content: `Write Day ${day_number}.` }] }),
    });
    if (!resp.ok) throw new Error(`Claude ${resp.status}`);
    const data = await resp.json();
    // Robust parse: strip markdown fences + extract the JSON object
    let raw = (data.content?.[0]?.text || "{}").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const s = raw.indexOf("{"), e2 = raw.lastIndexOf("}");
    if (s >= 0 && e2 > s) raw = raw.slice(s, e2 + 1);
    let step;
    try { step = JSON.parse(raw); }
    catch {
      // Graceful fallback so a day never hard-fails
      step = {
        title: `Day ${day_number}`,
        lesson: `${phase.theme}. ${phase.focus}`,
        action: "Take one small step today. Then rest.",
        journal_prompt: "What is one true thing about where you are right now?",
        riley_message: `Day ${day_number}. You're still here, and that's what matters. I'm with you.`,
        recommended_content_types: ["breathwork", "journal_prompt"],
      };
    }

    const row = {
      program_slug, day_number,
      title: step.title || `Day ${day_number}`,
      lesson: step.lesson || "",
      action: step.action || "",
      journal_prompt: step.journal_prompt || "",
      riley_message: step.riley_message || "",
      recommended_content_types: Array.isArray(step.recommended_content_types) ? step.recommended_content_types : [],
      completion_trigger: "manual",
    };

    // 3. Cache it (shared for all future clients). Ignore conflict if another
    //    request generated it concurrently.
    await supabase.from("journey_steps").upsert(row, { onConflict: "program_slug,day_number" });

    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ step: row, generated: true }) };

  } catch (e) {
    console.error("journey-step:", e.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};
