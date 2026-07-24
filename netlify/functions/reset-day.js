/**
 * reset-day.js - THE 8:14 RESET: daily content + two-touch progress + persona voice.
 *
 * POST { action, token?, ... }:
 *   'day'      { day }            → day content (+ persona variant + progress + Day-1 sentence if authed)
 *   'enroll'   { day1_sentence }  → classify the Day-1 persona(s), store reset_enrollment
 *   'complete' { day, touch }     → record morning/evening completion (two-touch)
 *
 * Identity is derived from the verified access token (never a client user_id).
 * reset_days / reset_day_variants are public content; progress + enrollment are owner-scoped.
 * Models: utility generations (persona classify, memory opener) → MODELS.utility (Haiku) via anthropic-client.
 */
const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");
// Safety backstop for the Day-1 free-text disclosure (mirrors the chat crisis path).
const { detectCrisis, LEVEL3_RESPONSE } = require("./crisis-detection");
const { sendOperatorAlert } = require("./safety-alert");
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PERSONAS = ["griever", "drinker", "burnt_out", "stretched", "body_first"];
const json = (code, obj) => ({ statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(obj) });

// Day-1 sorting: multi-label classification into the five personas (whole-person default).
async function classifyPersona(text) {
  try {
    const sys = `Classify what this person is carrying into one or more of EXACTLY these five keys:
griever (loss, death, grief), drinker (alcohol, drugs, sobriety, recovery), burnt_out (work, exhaustion, burnout), stretched (family, caregiving, marriage, overwhelmed by obligations), body_first (health, weight, energy, not recognizing their body).
Many people are two or three at once - include all that clearly fit. Return ONLY a JSON array of the matching keys, e.g. ["burnt_out","stretched"]. If nothing is clear, return [].`;
    // Small utility classification → Haiku (MODELS.utility) per the house model-routing rule.
    const r = await callClaude({
      system: sys,
      messages: [{ role: "user", content: text }],
      max_tokens: 60,
      model: MODELS.utility,
      functionName: "reset-day",
    });
    let raw = (r.text || "[]").replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = raw.indexOf("["), e = raw.lastIndexOf("]");
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k) => PERSONAS.includes(k)) : [];
  } catch (e) { return []; }
}

// 0.3 MEMORY MOMENTS: for Day 2-7, open by referencing what the member actually said on earlier days
// (their Day-1 sentence + saved reset reflections). Day 4-5 draws a cross-day thread; Day 7 recaps
// "what I've learned about you this week" before the tier recommendation. NEVER fabricates a memory -
// returns null if there's nothing specific to reference, and fails open (any error -> null -> no opener).
async function generateMemoryOpener(supabase, userId, dayNum, day1Sentence) {
  try {
    if (dayNum < 2 || !process.env.ANTHROPIC_API_KEY) return null;
    const { data: mem } = await supabase.from("riley_memory")
      .select("content, created_at").eq("user_id", userId).eq("source", "reset_reflection")
      .eq("is_active", true).order("created_at", { ascending: true }).limit(12);
    const bits = [];
    if (day1Sentence) bits.push("Day 1 (what they were carrying): " + day1Sentence);
    (mem || []).forEach((m) => { if (m.content) bits.push(String(m.content)); });
    if (!bits.length) return null; // nothing specific to reference -> no callback, never fabricate

    const dayGuide = dayNum >= 7
      ? "This is Day 7, the final day. Open with a short, warm 'here is what I've come to know about you this week' - name 2-3 specific things THEY said (their words, a pattern, a win), then land on quiet hope. It comes right before we suggest what's next, so make it feel like being truly seen."
      : (dayNum === 4 || dayNum === 5)
        ? "Reference something specific they said on an earlier day, and if two things connect across different days, gently draw that thread together."
        : "Reference something specific they said on a previous day, woven in naturally.";

    const sys = `You are Riley - warm, plain, honest. Write the OPENING line(s) for today's 8:14 Reset check-in. ${dayGuide}
Rules: 1-2 short sentences (Day 7 up to 3). Use THEIR actual words and themes - never invent a memory. Never say "my memory", "I retrieved", or anything system-like - just speak like a friend who remembers. No therapy-speak, no toxic positivity. Plain hyphens only, never em-dashes. If the material is too thin to reference honestly, return an empty string.`;
    const usr = "Their own words from the Reset so far:\n" + bits.join("\n") + `\n\nWrite Riley's opening for Day ${dayNum}.`;

    // Small utility generation → Haiku (MODELS.utility) per the house model-routing rule.
    const r = await callClaude({
      system: sys,
      messages: [{ role: "user", content: usr }],
      max_tokens: 170,
      model: MODELS.utility,
      functionName: "reset-day",
      userId,
      supabase,
    });
    let out = (r.text || "").trim();
    out = out.replace(/—/g, "-").replace(/–/g, "-"); // brand rule: no em/en dashes
    return out.length > 3 ? out.slice(0, 500) : null;
  } catch (_) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const action = body.action || "day";
  const supabase = getSupabaseClient();
  const userId = await getUserIdFromToken(supabase, body.token);
  const dayNum = Math.max(1, Math.min(7, parseInt(body.day, 10) || 1));

  try {
    // ── Day 1: capture their own words + classify persona(s) ──
    if (action === "enroll") {
      if (!userId) return json(401, { error: "Unauthorized" });
      const sentence = (body.day1_sentence || "").toString().trim().slice(0, 600);
      // SAFETY BACKSTOP: the Day-1 sentence is real member free-text ("the heaviest thing you're
      // carrying"). Run the deterministic crisis check so a disclosure at ONBOARDING is logged to the
      // restricted crisis_log and the operator is alerted - the same guarantee the chat path gives.
      // Level 3 additionally surfaces 988 to the member so onboarding can show it. Fully fail-open.
      let crisisLevel = 0;
      if (sentence) {
        try { crisisLevel = (detectCrisis(sentence) || {}).level || 0; } catch (_) {}
        if (crisisLevel >= 2) {
          try { await supabase.from("crisis_log").insert({ user_id: userId, level: crisisLevel, matched_rules: ["reset-day1"], message_excerpt: sentence.slice(0, 500), followup_stage: 0, resolved: false }); } catch (_) {}
          supabase.from("user_profiles").update({ last_crisis_at: new Date().toISOString(), last_crisis_level: crisisLevel }).eq("id", userId).then(() => {}, () => {});
          try { await sendOperatorAlert(supabase, { userId, level: crisisLevel, matches: ["reset-day1"], excerpt: sentence, source: "reset-day-enroll" }); } catch (_) {}
        }
      }
      const personas = sentence ? await classifyPersona(sentence) : [];
      await supabase.from("reset_enrollment").upsert(
        { user_id: userId, persona_keys: personas.length ? personas : null, day1_sentence: sentence || null },
        { onConflict: "user_id" }
      );
      return json(200, crisisLevel >= 3 ? { personas, crisis: true, crisis_message: LEVEL3_RESPONSE } : { personas });
    }

    // ── Two-touch completion (action completes the day; evening is bonus) ──
    if (action === "complete") {
      if (!userId) return json(401, { error: "Unauthorized" });
      const stamp = new Date().toISOString();
      const row = { user_id: userId, day_number: dayNum, updated_at: stamp };
      row[body.touch === "evening" ? "evening_done_at" : "morning_done_at"] = stamp;
      await supabase.from("reset_progress").upsert(row, { onConflict: "user_id,day_number" });
      // Funnel events (Doc 0 §9): the ACTION completes the day; Day-7 action = reset complete.
      if (body.touch !== "evening") {
        emitEvent(supabase, userId, "reset_day_completed", { day: dayNum });
        if (dayNum >= 7) emitEvent(supabase, userId, "reset_completed", {});
        // Feather keepsakes (founder rule 2026-07-23): the completed day is a moment.
        // Idempotent per day; fire-and-forget - never blocks the response.
        try {
          const { awardFeather } = require("./feathers");
          awardFeather(supabase, userId, "reset_day", "day-" + dayNum, "Finished Day " + dayNum + " of the 8:14 Reset").catch(() => {});
          if (dayNum >= 7) awardFeather(supabase, userId, "reset_complete", "once", "Completed the 8:14 Reset - all seven days").catch(() => {});
        } catch (e) {}
      }
      return json(200, { ok: true });
    }

    // ── Default: serve the day (+ persona voice + progress if authed) ──
    const { data: content } = await supabase.from("reset_days").select("*").eq("day_number", dayNum).maybeSingle();
    if (!content) return json(404, { error: "Day not found" });

    let progress = [], personas = [], day1_sentence = null, variants = {};
    if (userId) {
      const [enr, prog] = await Promise.all([
        supabase.from("reset_enrollment").select("persona_keys, day1_sentence").eq("user_id", userId).maybeSingle(),
        supabase.from("reset_progress").select("day_number, morning_done_at, evening_done_at").eq("user_id", userId),
      ]);
      personas = enr.data?.persona_keys || [];
      day1_sentence = enr.data?.day1_sentence || null;
      progress = prog.data || [];
      // Riley's persona voice for this day: first enrolled persona wins per segment.
      if (personas.length) {
        const { data: vs } = await supabase.from("reset_day_variants")
          .select("segment, text, persona_key").eq("day_number", dayNum).in("persona_key", personas);
        for (const p of personas) for (const v of (vs || [])) if (v.persona_key === p && !variants[v.segment]) variants[v.segment] = v.text;
      }
    }

    // 0.3: a grounded "I remember what you said" opener for Day 2+ (null if nothing to reference).
    let memory_opener = null;
    if (userId && dayNum >= 2) memory_opener = await generateMemoryOpener(supabase, userId, dayNum, day1_sentence);

    return json(200, { day: content, variants, progress, personas, day1_sentence, memory_opener });
  } catch (e) {
    console.error("reset-day:", e.message);
    return json(500, { error: e.message });
  }
};
