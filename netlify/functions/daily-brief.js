/**
 * daily-brief.js — Netlify Serverless Function
 *
 * Generates a personalized 60-second morning brief using Claude.
 * Reads user's check-in history, sobriety streak, habits, goals, and programs.
 * Saves to daily_briefs table and returns the brief.
 *
 * POST body: { user_id }
 * Response: { brief: {...}, cached: bool }
 *
 * Model: claude-sonnet-4-6
 * max_tokens: 400 — brief is short by design
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { user_id } = JSON.parse(event.body || "{}");
    if (!user_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "user_id required" }) };

    const supabase = getSupabaseClient();
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sevenAgo  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Return cached brief if it exists and has content
    const { data: existing } = await supabase
      .from("daily_briefs")
      .select("*")
      .eq("user_id", user_id)
      .eq("brief_date", today)
      .maybeSingle();

    if (existing?.modules && Object.keys(existing.modules).length > 0) {
      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ brief: existing, cached: true }) };
    }

    // Gather user context in parallel — all non-fatal
    const [profileRes, checkinRes, soberRes, habitsRes, habitsCompRes, goalsRes, programsRes] = await Promise.allSettled([
      supabase.from("user_profiles").select("full_name").eq("id", user_id).single(),
      supabase.from("daily_checkins").select("checkin_date,mood,sleep_hours,notes,water_oz").eq("user_id", user_id)
        .gte("checkin_date", sevenAgo).order("checkin_date", { ascending: false }).limit(7),
      supabase.from("sobriety_tracker").select("start_date").eq("user_id", user_id).eq("is_active", true).maybeSingle(),
      supabase.from("habits").select("id,title").eq("user_id", user_id).eq("is_active", true),
      supabase.from("habit_completions").select("habit_id").eq("user_id", user_id).eq("completed_date", today),
      supabase.from("user_goals").select("title,current_value,target_value,unit").eq("user_id", user_id).eq("is_active", true).limit(5),
      supabase.from("user_program_progress").select("*,programs(title,duration_days)").eq("user_id", user_id).eq("status", "active").limit(3),
    ]);

    const get   = r => r.status === "fulfilled" ? r.value?.data : null;
    const profile   = get(profileRes);
    const checkins  = get(checkinRes)  || [];
    const sober     = get(soberRes);
    const habits    = get(habitsRes)   || [];
    const doneToday = get(habitsCompRes) || [];
    const goals     = get(goalsRes)    || [];
    const programs  = get(programsRes) || [];

    const firstName = profile?.full_name?.split(" ")[0] || "there";
    const prevCheckin = checkins.find(c => c.checkin_date === yesterday) || checkins[0];
    const soberDays   = sober?.start_date
      ? Math.max(0, Math.floor((Date.now() - new Date(sober.start_date)) / 86400000))
      : null;
    const moodLabels = ["", "Hard", "Low", "Okay", "Good", "Great"];
    const sleptHours = checkins.filter(c => c.sleep_hours);
    const avgSleep   = sleptHours.length
      ? Math.round(sleptHours.reduce((s, c) => s + c.sleep_hours, 0) / sleptHours.length * 10) / 10
      : null;
    const habitsCompletedToday = doneToday.length;
    const habitTotal = habits.length;

    const ctx = [
      `Name: ${firstName}`,
      soberDays !== null ? `Sobriety: ${soberDays} days sober` : "",
      prevCheckin?.mood        ? `Recent mood: ${moodLabels[prevCheckin.mood]}` : "",
      prevCheckin?.sleep_hours ? `Last recorded sleep: ${prevCheckin.sleep_hours}h` : "",
      avgSleep                 ? `7-day sleep average: ${avgSleep}h` : "",
      prevCheckin?.notes       ? `What they wrote: "${prevCheckin.notes.slice(0, 120)}"` : "",
      habitTotal               ? `Habits today: ${habitsCompletedToday}/${habitTotal} done` : "",
      goals.length             ? `Goals: ${goals.slice(0, 3).map(g => `${g.title} — ${g.current_value}/${g.target_value} ${g.unit || ""}`).join("; ")}` : "",
      programs.length          ? `Active programs: ${programs.map(p => `${p.programs?.title || "Program"} (day ${p.days_completed})`).join(", ")}` : "",
    ].filter(Boolean).join("\n");

    // Generate brief with Claude
    const systemPrompt = `You are Riley, the wellness guide for The 8:14 Project. Generate a full personalized morning brief.

The entire brief must be readable in under 45 seconds. Every field: short, warm, honest, specific.
Never preachy. Never corporate. Never generic. No motivational poster energy.
Always hopeful. Reference their actual data — sobriety days, sleep, mood, habits, programs.
Numbers support. Stories inspire.

Return ONLY valid JSON with exactly these 9 keys — no other text:
{
  "riley_note": "Riley's specific observation from their data. Start with 'I noticed...' or 'You've...' — something concrete from what you know. 1 sentence.",
  "mood_note": "One sentence acknowledging where they are right now based on their data. Warm. Real.",
  "encouragement": "One sentence of genuine encouragement tied to something specific about their journey. Not generic.",
  "focus": "Today's single focus area. One short phrase. (e.g. 'Keep the streak going', 'Rest and rebuild', 'Move and nourish')",
  "quote": "One short quote — under 15 words. Something that feels true for their journey right now. No attribution needed.",
  "challenge": "One small challenge for today. Specific. Doable in the next few hours. Under 15 words.",
  "reflection_prompt": "One question to sit with today. Something that invites quiet thought, not pressure. Under 15 words.",
  "nutrition_tip": "One practical nutrition note relevant to recovery or their current state. 1 short sentence.",
  "action": "The single most important action they can take today. Concrete. Under 15 words."
}`;

    const apiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key":          process.env.ANTHROPIC_API_KEY,
        "anthropic-version":  "2023-06-01",
        "Content-Type":       "application/json",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 700,
        system:     systemPrompt,
        messages:   [{ role: "user", content: `USER CONTEXT:\n${ctx}\n\nGenerate the morning brief.` }],
      }),
    });

    if (!apiResp.ok) throw new Error(`Claude API ${apiResp.status}`);
    const apiData = await apiResp.json();
    const rawText = apiData.content?.[0]?.text || "{}";

    let modules;
    try {
      modules = JSON.parse(rawText);
    } catch {
      modules = {
        riley_note:        soberDays !== null ? `You have ${soberDays} days. That took real work.` : "You came back today. That matters.",
        mood_note:         "A new day. That takes something.",
        encouragement:     soberDays !== null ? `${soberDays} days is real. You built that one choice at a time.` : "You showed up today. That's the whole thing.",
        focus:             "One step forward",
        quote:             "Progress is not linear. It is persistent.",
        challenge:         "Text one person who matters to you today.",
        reflection_prompt: "What would make today feel worth it?",
        nutrition_tip:     "Eat something with protein in the first hour of your morning.",
        action:            "Drink a glass of water and take three slow breaths.",
      };
    }

    const briefData = {
      user_id,
      brief_date:        today,
      modules,
      completion:        {},
      total_modules:     Object.keys(modules).length,
      completed_modules: 0,
      delivered_at:      new Date().toISOString(),
    };

    const { data: saved } = await supabase
      .from("daily_briefs")
      .upsert(briefData, { onConflict: "user_id,brief_date" })
      .select()
      .single();

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ brief: saved || briefData, cached: false }),
    };

  } catch (e) {
    console.error("daily-brief:", e.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};
