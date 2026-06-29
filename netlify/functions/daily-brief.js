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
    const systemPrompt = `You are Riley, the wellness guide for The 8:14 Project. Generate a personalized morning brief.

The entire brief must be readable in under 60 seconds. Short. Warm. Honest.
Never preachy. Never corporate. Never generic. No motivational poster energy.
Always hopeful. Specific to this person. Reference their actual data.

Return ONLY valid JSON with exactly these 4 keys — no other text:
{
  "mood_note": "One sentence acknowledging where they are based on their data. Warm. Real.",
  "encouragement": "One sentence of genuine encouragement tied to something specific about their journey.",
  "focus": "One short phrase — today's single focus area. (e.g. 'Keep the streak going', 'Rest and nourish', 'One step forward')",
  "action": "One specific small action they can do in the next hour. 15 words max. Concrete."
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
        max_tokens: 400,
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
        mood_note:     "A new day. That takes something.",
        encouragement: soberDays !== null
          ? `${soberDays} days is real. You built that one choice at a time.`
          : "You showed up today. That's the whole thing.",
        focus:  "One step forward",
        action: "Drink a glass of water and take three slow breaths.",
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
