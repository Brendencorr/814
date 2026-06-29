/**
 * riley-brain.js — The Decision Engine
 *
 * The central rules + intelligence layer. Evaluates every signal about a user
 * and returns the assembled Home experience for today: tone, priority state,
 * which modules to show/suppress, a Riley message, and matched content.
 *
 * This is RULES-BASED, not LLM-based. No Claude call. That keeps it fast and
 * cheap at 5,000-user scale — a Home load shouldn't cost an API round-trip.
 * (The brief's prose generation stays in daily-brief.js.)
 *
 * POST { user_id }
 * Returns {
 *   daily_tone, priority_state, season, emotional_date,
 *   recommended_modules: [{module_key, title, ...}],
 *   suppressed_modules: [keys],
 *   riley_message, recommended_content: [{...}], life_event
 * }
 *
 * No model. No max_tokens. Pure logic.
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Mood label → state vocabulary the module registry matches on ──
const MOOD_TO_STATE = { 1: "struggling", 2: "sad", 3: "okay", 4: "good", 5: "great" };

// ── Riley message templates by priority state ──
const MESSAGES = {
  emotional_support: [
    "I'm really glad you checked in today. This has been a heavier stretch — want to talk, or should we keep today simple?",
    "Thank you for showing up. You don't have to carry today alone. I'm here whenever you're ready.",
  ],
  grief_support: [
    "I'm here. There's nothing to fix today — just be, and let me sit with you in it.",
    "Grief doesn't follow a schedule. However today lands, you don't have to hold it by yourself.",
  ],
  restoration: [
    "Your body's asking for rest, and that's worth listening to. Let's keep today gentle.",
    "Tired is information, not failure. Today we restore. Everything else can wait.",
  ],
  growth: [
    "You've got real momentum right now. Let's use it — today's a good day to push a little.",
    "You're in a strong stretch. Let's build on it while the energy's here.",
  ],
  steady: [
    "Another day, and you're here for it. Let's take the next right step together.",
    "Steady is underrated. Show up as you are today — that's always enough.",
  ],
  emotional_date: [
    "Today might carry some weight. However it feels, I'm here. No pressure to be anything but honest.",
  ],
};

function pickMessage(state, seed) {
  const arr = MESSAGES[state] || MESSAGES.steady;
  return arr[seed % arr.length];
}

function getSeason() {
  const m = new Date().getUTCMonth();
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "fall" : "winter";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const { user_id } = JSON.parse(event.body || "{}");
    if (!user_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "user_id required" }) };

    const supabase = getSupabaseClient();
    const today    = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const month    = today.getUTCMonth() + 1;
    const day      = today.getUTCDate();
    const fourteenAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const sevenAgo    = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // ── Pull every signal in parallel — all non-fatal ──
    const [
      profileR, checkinsR, soberR, programsR, memoryR,
      lifeEventsR, importantDatesR, emotionalCalR, modulesR, recentRecsR,
    ] = await Promise.allSettled([
      supabase.from("user_profiles").select("full_name,preferred_name,subscription_tier,do_not_recommend,risk_flags,communication_style,current_focus").eq("id", user_id).maybeSingle(),
      supabase.from("daily_checkins").select("checkin_date,mood,sleep_hours").eq("user_id", user_id).gte("checkin_date", fourteenAgo).order("checkin_date", { ascending: false }),
      supabase.from("sobriety_tracker").select("start_date").eq("user_id", user_id).eq("is_active", true).maybeSingle(),
      supabase.from("user_program_progress").select("*,programs(title,emoji,duration_days)").eq("user_id", user_id).eq("status", "active").limit(3),
      supabase.from("riley_memory").select("memory_type,content,confidence").eq("user_id", user_id).eq("is_active", true).order("last_confirmed_at", { ascending: false }).limit(20),
      supabase.from("life_events").select("event_type,emotional_weight,riley_strategy,notes").eq("user_id", user_id).eq("active_support_needed", true).order("created_at", { ascending: false }).limit(3),
      supabase.from("important_dates").select("label,date_type,is_sensitive,emotional_weight,riley_strategy,event_year").eq("user_id", user_id).eq("event_month", month).eq("event_day", day),
      supabase.from("emotional_calendar").select("label,is_sensitive,riley_strategy").eq("event_month", month).eq("event_day", day),
      supabase.from("module_registry").select("*").eq("is_active", true),
      supabase.from("recommendation_history").select("content_id,reaction").eq("user_id", user_id).gte("recommended_on", fourteenAgo),
    ]);

    const get = r => r.status === "fulfilled" ? r.value?.data : null;
    const profile        = get(profileR) || {};
    const checkins       = get(checkinsR) || [];
    const sober          = get(soberR);
    const programs       = get(programsR) || [];
    const memory         = get(memoryR) || [];
    const lifeEvents     = get(lifeEventsR) || [];
    const importantDates = get(importantDatesR) || [];
    const emotionalCal   = get(emotionalCalR) || [];
    const modules        = get(modulesR) || [];
    const recentRecs     = get(recentRecsR) || [];

    const firstName = (profile.preferred_name || profile.full_name || "").split(" ")[0] || "there";
    const season    = getSeason();
    const seed      = day; // stable per-day rotation seed

    // ── Compute mood signals ──
    const todayCheckin = checkins.find(c => c.checkin_date === todayISO);
    const latestMood   = todayCheckin?.mood || checkins.find(c => c.mood)?.mood || null;
    const lowMoodCount = checkins.filter(c => c.mood && c.mood <= 2).length;
    const highMoodCount= checkins.filter(c => c.mood && c.mood >= 4).length;
    const recentSleep  = checkins.find(c => c.sleep_hours)?.sleep_hours || null;
    const moodState    = latestMood ? MOOD_TO_STATE[latestMood] : "okay";

    // ── Risk & grief signals ──
    const griefActive = lifeEvents.some(e => ["loss", "divorce", "breakup"].includes(e.event_type))
                      || (profile.risk_flags || []).includes("grief_active");
    const crisisFlag  = (profile.risk_flags || []).includes("recent_crisis");

    // ── Emotional date check ──
    const sensitiveDate = [...importantDates, ...emotionalCal].find(d => d.is_sensitive);
    const personalDate  = importantDates[0] || null;

    // ── Determine priority state (the core decision) ──
    let priorityState, dailyTone;
    if (griefActive || crisisFlag) {
      priorityState = "grief_support";   dailyTone = "tender";
    } else if (latestMood === 1 || lowMoodCount >= 5) {
      priorityState = "emotional_support"; dailyTone = "gentle";
    } else if (recentSleep && recentSleep < 6) {
      priorityState = "restoration";     dailyTone = "calm";
    } else if (latestMood >= 4 && highMoodCount >= 4) {
      priorityState = "growth";          dailyTone = "energizing";
    } else {
      priorityState = "steady";          dailyTone = "warm";
    }
    // Sensitive date overrides toward support unless already in support mode
    if (sensitiveDate && !["grief_support", "emotional_support"].includes(priorityState)) {
      dailyTone = "gentle";
    }

    // ── Assemble modules from the registry ──
    // A module shows if: its state_match includes our state (or is empty/universal)
    // AND our state isn't in its suppress list AND the user is entitled.
    const tier = profile.subscription_tier || "free";
    const entitled = (m) => {
      if (!m.entitlement_required) return true;
      // companion/concierge unlock adaptive features; free users see free modules
      return tier === "companion" || tier === "concierge";
    };
    const stateForMatch = griefActive ? "grieving" : priorityState === "emotional_support" ? "struggling" : moodState;

    const scored = modules
      .filter(m => entitled(m))
      .filter(m => !(m.suppress_in_states || []).includes(stateForMatch))
      .map(m => {
        const matches = (m.state_match || []).length === 0 || (m.state_match || []).includes(stateForMatch);
        // Universal modules (empty state_match) always eligible; state-matched get a priority boost
        const stateBoost = (m.state_match || []).includes(stateForMatch) ? -2 : 0;
        return { ...m, _eligible: matches, _score: (m.default_priority || 5) + stateBoost };
      })
      .filter(m => m._eligible)
      .sort((a, b) => a._score - b._score);

    const recommended_modules = scored.slice(0, 12).map(m => ({
      module_key: m.module_key, title: m.title, type: m.module_type,
      cta: m.cta, icon: m.icon, duration_minutes: m.duration_minutes,
    }));
    const suppressed_modules = modules
      .filter(m => (m.suppress_in_states || []).includes(stateForMatch))
      .map(m => m.module_key);

    // ── Content recommendations: match mood, exclude recently-seen (unless loved) ──
    const lovedIds   = new Set(recentRecs.filter(r => r.reaction === "loved").map(r => r.content_id));
    const recentIds  = new Set(recentRecs.filter(r => r.reaction !== "loved").map(r => r.content_id));
    const doNotRec   = new Set(profile.do_not_recommend || []);

    let recommended_content = [];
    try {
      // Pull content matching the current mood state, light query
      const { data: contentPool } = await supabase
        .from("content_library")
        .select("id,title,creator,content_type,topic,description,duration_minutes,content_url")
        .eq("is_active", true).eq("approval_status", "approved")
        .overlaps("mood", [stateForMatch, moodState])
        .limit(40);

      recommended_content = (contentPool || [])
        .filter(c => !recentIds.has(c.id) || lovedIds.has(c.id))     // novelty unless loved
        .filter(c => !doNotRec.has(c.content_type) && !doNotRec.has(c.topic))  // respect preferences
        .slice(0, 4)
        .map(c => ({
          id: c.id, title: c.title, creator: c.creator, type: c.content_type,
          topic: c.topic, description: c.description, duration_minutes: c.duration_minutes,
          loved: lovedIds.has(c.id),
        }));
    } catch (e) { /* content pool optional */ }

    // ── Riley message ──
    let messageState = priorityState;
    if (sensitiveDate && priorityState === "steady") messageState = "emotional_date";
    let riley_message = pickMessage(messageState, seed);
    if (personalDate?.riley_strategy) {
      riley_message = `Today is ${personalDate.label}. ${riley_message}`;
    }
    // Front-load the name occasionally, like a friend would
    if (firstName !== "there" && seed % 2 === 0) {
      riley_message = `${firstName} — ${riley_message.charAt(0).toLowerCase()}${riley_message.slice(1)}`;
    }

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        daily_tone: dailyTone,
        priority_state: priorityState,
        season,
        state_for_match: stateForMatch,
        emotional_date: sensitiveDate ? { label: sensitiveDate.label, strategy: sensitiveDate.riley_strategy } : null,
        personal_date: personalDate ? { label: personalDate.label, type: personalDate.date_type } : null,
        life_event: lifeEvents[0] ? { type: lifeEvents[0].event_type, strategy: lifeEvents[0].riley_strategy } : null,
        recommended_modules,
        suppressed_modules,
        recommended_content,
        riley_message,
        signals: { latest_mood: latestMood, low_mood_14d: lowMoodCount, recent_sleep: recentSleep, sober: !!sober },
      }),
    };

  } catch (e) {
    console.error("riley-brain:", e.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
};
