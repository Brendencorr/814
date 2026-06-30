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

    const briefMonth = new Date().getUTCMonth() + 1;
    const briefDay   = new Date().getUTCDate();

    // Gather user context in parallel — all non-fatal
    const [profileRes, checkinRes, soberRes, habitsRes, habitsCompRes, goalsRes, programsRes, lifeEventsRes, importantRes, calRes, memoryRes] = await Promise.allSettled([
      supabase.from("user_profiles").select("full_name,preferred_name,why_here,one_year_vision,human_os,primary_goals,communication_style,preferred_encouragement").eq("id", user_id).single(),
      supabase.from("daily_checkins").select("checkin_date,mood,sleep_hours,notes,water_oz").eq("user_id", user_id)
        .gte("checkin_date", sevenAgo).order("checkin_date", { ascending: false }).limit(7),
      supabase.from("sobriety_tracker").select("start_date").eq("user_id", user_id).eq("is_active", true).maybeSingle(),
      supabase.from("habits").select("id,title").eq("user_id", user_id).eq("is_active", true),
      supabase.from("habit_completions").select("habit_id").eq("user_id", user_id).eq("completed_date", today),
      supabase.from("user_goals").select("title,current_value,target_value,unit").eq("user_id", user_id).eq("is_active", true).limit(5),
      supabase.from("user_program_progress").select("*,programs(title,duration_days)").eq("user_id", user_id).eq("status", "active").limit(3),
      supabase.from("life_events").select("event_type,notes,riley_strategy").eq("user_id", user_id).eq("active_support_needed", true).order("created_at", { ascending: false }).limit(2),
      supabase.from("important_dates").select("label,riley_strategy,is_sensitive").eq("user_id", user_id).eq("event_month", briefMonth).eq("event_day", briefDay),
      supabase.from("emotional_calendar").select("label,riley_strategy").eq("event_month", briefMonth).eq("event_day", briefDay),
      supabase.from("riley_memory").select("memory_type,content").eq("user_id", user_id).eq("is_active", true).order("last_confirmed_at", { ascending: false }).limit(12),
    ]);

    const get   = r => r.status === "fulfilled" ? r.value?.data : null;
    const profile   = get(profileRes);
    const checkins  = get(checkinRes)  || [];
    const sober     = get(soberRes);
    const habits    = get(habitsRes)   || [];
    const doneToday = get(habitsCompRes) || [];
    const goals     = get(goalsRes)    || [];
    const programs  = get(programsRes) || [];
    const lifeEvents = get(lifeEventsRes) || [];
    const todaysDates = [...(get(importantRes) || []).filter(d => d.is_sensitive !== false), ...(get(calRes) || [])];
    const memory = get(memoryRes) || [];

    const firstName = (profile?.preferred_name || profile?.full_name || "").split(" ")[0] || "there";
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

    // Season detection
    const mo = new Date().getMonth();
    const season = mo>=2&&mo<=4?'Spring':mo>=5&&mo<=7?'Summer':mo>=8&&mo<=10?'Fall':'Winter';
    const seasonTheme = {Spring:'Build — new starts, momentum, growth.',Summer:'Explore — energy, adventure, expand.',Fall:'Reflect — slow down, harvest, deepen.',Winter:'Restore — rest, quiet, renew.'};

    // Mood pattern check
    const recentLowMoods = checkins.filter(c => c.mood && c.mood <= 2).length;
    const moodTrend = recentLowMoods >= 5 ? 'struggling (5+ low mood days recently)'
                    : recentLowMoods >= 3 ? 'uneven (some difficult days recently)'
                    : checkins.filter(c => c.mood && c.mood >= 4).length >= 4 ? 'strong (many good days recently)'
                    : 'mixed';

    // Onboarding context — who this person told us they are (Phase 1)
    const hos = profile?.human_os || {};
    const ctx = [
      `Name: ${firstName}`,
      profile?.why_here        ? `Why they came to 8:14: ${profile.why_here}` : "",
      profile?.one_year_vision ? `Their one-year vision (use this — it's what they're reaching for): ${profile.one_year_vision}` : "",
      (profile?.primary_goals && profile.primary_goals.length) ? `Focus areas they chose: ${profile.primary_goals.join(", ")}` : "",
      hos.energy  ? `What gives them energy: ${hos.energy}` : "",
      hos.drains  ? `What drains them: ${hos.drains}` : "",
      hos.proud   ? `What they're most proud of: ${hos.proud}` : "",
      hos.change  ? `What they want to change: ${hos.change}` : "",
      hos.dream   ? `A dream they've never given up on: ${hos.dream}` : "",
      profile?.preferred_encouragement ? `How they like to be encouraged: ${profile.preferred_encouragement} — match this tone` : "",
      memory.length ? `What Riley remembers about them: ${memory.slice(0, 8).map(m => m.content).join(" | ")}` : "",
      soberDays !== null ? `Sobriety: ${soberDays} days sober` : "",
      prevCheckin?.mood        ? `Recent mood: ${moodLabels[prevCheckin.mood]}` : "",
      prevCheckin?.sleep_hours ? `Last recorded sleep: ${prevCheckin.sleep_hours}h` : "",
      avgSleep                 ? `7-day sleep average: ${avgSleep}h` : "",
      prevCheckin?.notes       ? `What they wrote: "${prevCheckin.notes.slice(0, 120)}"` : "",
      habitTotal               ? `Habits today: ${habitsCompletedToday}/${habitTotal} done` : "",
      goals.length             ? `Goals: ${goals.slice(0, 3).map(g => `${g.title} — ${g.current_value}/${g.target_value} ${g.unit || ""}`).join("; ")}` : "",
      programs.length          ? `Active programs: ${programs.map(p => `${p.programs?.title || "Program"} (day ${p.days_completed})`).join(", ")}` : "",
      `Season: ${season} — theme: ${seasonTheme[season]}`,
      `Recent mood trend: ${moodTrend}`,
      lifeEvents.length ? `ACTIVE LIFE EVENT — hold with care: ${lifeEvents.map(e => `${e.event_type}${e.riley_strategy ? " (" + e.riley_strategy + ")" : ""}`).join("; ")}` : "",
      todaysDates.length ? `TODAY CARRIES WEIGHT: ${todaysDates.map(d => `${d.label}${d.riley_strategy ? " — " + d.riley_strategy : ""}`).join("; ")}. Soften celebratory language. Lead with presence.` : "",
    ].filter(Boolean).join("\n");

    // Generate brief with Claude
    const systemPrompt = `You are Riley, the wellness guide for The 8:14 Project. Generate a full personalized morning brief.

The entire brief must be readable in under 45 seconds. Every field: short, warm, honest, specific.
Never preachy. Never corporate. Never generic. No motivational poster energy.
Always hopeful. Reference their actual data — sobriety days, sleep, mood, habits, programs.
Numbers support. Stories inspire.

Return ONLY valid JSON with exactly these 11 keys — no other text:
{
  "riley_note": "Riley's specific observation from their data. Start with 'I noticed...' or 'You've...' — something concrete. 1 sentence.",
  "mood_note": "One sentence acknowledging where they are right now. Warm. Real. Informed by their mood trend.",
  "encouragement": "One sentence of genuine encouragement tied to something specific. Not generic. Not preachy.",
  "focus": "Today's single focus area — shaped by their season and mood trend. One short phrase.",
  "quote": "One short quote under 15 words — true for their journey right now. No attribution needed.",
  "challenge": "One small challenge. Specific. Doable in the next few hours. Calibrated to their mood — gentle if struggling, ambitious if thriving. Under 15 words.",
  "reflection_prompt": "One question to sit with. Invites quiet thought. Never pressuring. Informed by recent mood and season. Under 15 words.",
  "nutrition_tip": "One practical nutrition note for recovery. 1 short sentence. Relevant to time of day and season.",
  "action": "The single most important action today. Concrete. Calibrated to their mood — if struggling, make it tiny. Under 15 words.",
  "book_rec": "One book title and a single-sentence reason it fits them right now. Format: 'Title — reason.'",
  "music_mood": "One music mood or playlist type for today. 4 words max. (e.g. 'Gentle acoustic for quiet mornings', 'Upbeat for building momentum')"
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
        max_tokens: 900,
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
        book_rec:          "The Body Keeps the Score — a clear-eyed look at how recovery lives in the body.",
        music_mood:        "Quiet instrumental for a focused morning",
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
