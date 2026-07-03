/**
 * reset-day.js — THE 8:14 RESET: daily content + two-touch progress + persona voice.
 *
 * POST { action, token?, ... }:
 *   'day'      { day }            → day content (+ persona variant + progress + Day-1 sentence if authed)
 *   'enroll'   { day1_sentence }  → classify the Day-1 persona(s), store reset_enrollment
 *   'complete' { day, touch }     → record morning/evening completion (two-touch)
 *
 * Identity is derived from the verified access token (never a client user_id).
 * reset_days / reset_day_variants are public content; progress + enrollment are owner-scoped.
 * Model: claude-sonnet-4-6
 */
const { getSupabaseClient, getUserIdFromToken } = require("./supabase-client");
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
Many people are two or three at once — include all that clearly fit. Return ONLY a JSON array of the matching keys, e.g. ["burnt_out","stretched"]. If nothing is clear, return [].`;
    const r = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 60, system: sys, messages: [{ role: "user", content: text }] }),
    });
    if (!r.ok) return [];
    const d = await r.json();
    let raw = (d.content?.[0]?.text || "[]").replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = raw.indexOf("["), e = raw.lastIndexOf("]");
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((k) => PERSONAS.includes(k)) : [];
  } catch (e) { return []; }
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
      const personas = sentence ? await classifyPersona(sentence) : [];
      await supabase.from("reset_enrollment").upsert(
        { user_id: userId, persona_keys: personas.length ? personas : null, day1_sentence: sentence || null },
        { onConflict: "user_id" }
      );
      return json(200, { personas });
    }

    // ── Two-touch completion (action completes the day; evening is bonus) ──
    if (action === "complete") {
      if (!userId) return json(401, { error: "Unauthorized" });
      const stamp = new Date().toISOString();
      const row = { user_id: userId, day_number: dayNum, updated_at: stamp };
      row[body.touch === "evening" ? "evening_done_at" : "morning_done_at"] = stamp;
      await supabase.from("reset_progress").upsert(row, { onConflict: "user_id,day_number" });
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

    return json(200, { day: content, variants, progress, personas, day1_sentence });
  } catch (e) {
    console.error("reset-day:", e.message);
    return json(500, { error: e.message });
  }
};
