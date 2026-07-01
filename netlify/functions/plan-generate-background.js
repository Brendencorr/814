/**
 * plan-generate.js — Workout & Nutrition plan generator (Custom Plan Logic)
 *
 * Reads the member's saved intake (wellness_profile) + live recovery signals
 * (sleep, mood, cravings, sobriety) + last week's check-in (wellness_weekly),
 * applies the spec's per-goal logic + recovery/craving overrides + adaptive
 * difficulty, and generates a structured 7-day plan. Caches to wellness_plans
 * (one active plan per type). Deterministic where it matters, LLM for the plan.
 *
 * POST { user_id, token?, plan_type }   plan_type = "workout" | "nutrition"
 * Response: { plan, difficulty, regenerated: true }
 *
 * Model: claude-sonnet-4-6 · max_tokens 4000 (Netlify Pro synchronous window)
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });

// Robust JSON extraction (Claude sometimes wraps in ```json fences).
function parseJSON(text) {
  let t = (text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}");
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  return JSON.parse(t);
}

async function gatherContext(sb, userId) {
  const today = new Date().toISOString().slice(0, 10);
  const [profRes, stateRes, ciRes, soberRes, weeklyRes] = await Promise.allSettled([
    sb.from("wellness_profile").select("*").eq("user_id", userId).maybeSingle(),
    sb.from("user_daily_state").select("crisis_flag,sleep_score,mood").eq("user_id", userId).eq("date", today).maybeSingle(),
    sb.from("daily_checkins").select("mood,sleep_hours,notes,daily_log").eq("user_id", userId).order("checkin_date", { ascending: false }).limit(1),
    sb.from("sobriety_tracker").select("start_date").eq("user_id", userId).eq("is_active", true).order("start_date", { ascending: false }).limit(1),
    sb.from("wellness_weekly").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1),
  ]);
  const val = (r) => (r.status === "fulfilled" ? r.value.data : null);
  const sober = val(soberRes) && val(soberRes)[0];
  return {
    profile: val(profRes) || null,
    state: val(stateRes) || null,
    checkin: (val(ciRes) || [])[0] || null,
    soberDays: sober && sober.start_date ? Math.max(0, Math.floor((Date.now() - new Date(sober.start_date)) / 86400000)) : null,
    lastWeekly: (val(weeklyRes) || [])[0] || null,
  };
}

// Base difficulty from level, nudged by last week's completion (§6 adaptive logic).
function computeDifficulty(profile, lastWeekly) {
  let d = profile && profile.fitness_level === "advanced" ? 4 : profile && profile.fitness_level === "intermediate" ? 3 : 2;
  if (lastWeekly && lastWeekly.completed_pct != null) {
    if (lastWeekly.completed_pct >= 80) d += 1;
    else if (lastWeekly.completed_pct < 40) d -= 1;
  }
  return Math.max(1, Math.min(5, d));
}

const SYSTEM = `You are Riley, wellness coach for The 8:14 Project — warm, grounded, never preachy, recovery-aware. You build a personalized 7-day plan and return it as STRICT JSON only (no prose, no markdown fences).

RULES YOU FOLLOW:
- One primary goal drives the plan. Personalize to the member's time, equipment, fitness level, and recovery state.
- RECOVERY & CRAVING OVERRIDE (highest priority): if sleep is poor (<6h) or stress/mood is low or cravings are elevated, drop intensity — walking, mobility, light strength, breathwork, hydration — and never push. If cravings are elevated, weave in: protein, hydration, a walk, reaching a support person, avoiding isolation, grounding, community.
- Workout goals shape the split: weight loss → ~3 strength + 2-3 cardio + daily walking; muscle gain → 4-5 strength, progressive overload, moderate cardio; strength → compound lifts, progressive overload, ample rest; stress reduction/recovery → walking, mobility, yoga, light strength, breathwork, avoid overtraining; general health/mobility/athletic → balance to fit.
- Nutrition goals shape meals: fat loss → high protein, high fiber, whole foods, calorie awareness without obsession, stable timing; muscle gain → protein every meal, slight surplus, carbs around training; reduced cravings/sobriety support → blood-sugar stability, protein every 3-5h, magnesium-rich foods, omega-3s, hydration, lower added sugar, evening routine.
- Beginners get simple routines; advanced get progressive overload. Match difficulty (1 easiest … 5 hardest) to the value provided.
- SAFETY: never diagnose, never promise rapid weight loss, no pain-based progression, no "earn your food" framing, no eating-disorder-style restriction or extreme fasting. Always include the safety_note verbatim as specified below.

WORKOUT JSON SHAPE:
{"type":"workout","goal":"<goal>","level":"<level>","summary":"one warm sentence","days":[{"day":"Monday","focus":"...","duration_min":30,"intensity":"low|moderate|high","warmup":"...","exercises":[{"name":"...","sets":3,"reps":"10","rest":"60s"}],"cooldown":"...","recovery_note":"..."}, ... exactly 7 days Monday-Sunday ...],"weekly_progression":"how next week builds on this","checkin_schedule":"when to check in","safety_note":"If pain, dizziness, chest discomfort, or unusual symptoms show up, stop and consult a medical professional."}

NUTRITION JSON SHAPE:
{"type":"nutrition","goal":"<goal>","summary":"one warm sentence","protein_target":"e.g. ~120g/day","hydration_target":"e.g. ~80 oz/day","days":[{"day":"Monday","breakfast":"...","lunch":"...","snack":"...","dinner":"...","optional":"..."}, ... exactly 7 days ...],"grocery_list":["item","item"],"snack_ideas":["..."],"craving_support":["Eat protein","Hydrate","Take a walk","Reach a support person","..."],"prep_plan":"a simple weekly prep note","safety_note":"This is general wellness guidance. For medical conditions, medications, eating-disorder history, pregnancy, diabetes, or major dietary changes, work with a qualified clinician."}

Return ONLY the JSON object.`;

function buildUserPrompt(planType, ctx, difficulty) {
  const p = ctx.profile || {};
  const lines = [];
  lines.push(`Build a 7-day ${planType} plan. Target difficulty: ${difficulty}/5.`);
  if (planType === "workout") {
    lines.push(`Goal: ${p.workout_goal || "general_health"}. Fitness level: ${p.fitness_level || "beginner"}.`);
    lines.push(`Can train ${p.days_per_week || 3} days/week, ${p.minutes_per_session || 30} min/session. Equipment: ${p.equipment || "none"}.`);
    if (p.injuries) lines.push(`Injuries/limitations (work AROUND these, never through): ${p.injuries}`);
    if (p.workout_types && p.workout_types.length) lines.push(`Enjoys: ${p.workout_types.join(", ")}.`);
    if (p.success_30d) lines.push(`What success looks like in 30 days: ${p.success_30d}`);
  } else {
    lines.push(`Goal: ${p.nutrition_goal || "general_health"}. Meals/day: ${p.meals_per_day || 3}. Cooks at home: ${p.cooks_at_home ? "yes" : "no/limited"}.`);
    if (p.dietary_restrictions) lines.push(`Allergies/restrictions (respect strictly): ${p.dietary_restrictions}`);
    if (p.foods_love) lines.push(`Loves: ${p.foods_love}`);
    if (p.foods_hate) lines.push(`Dislikes (avoid): ${p.foods_hate}`);
    if (p.craving_times) lines.push(`Cravings tend to hit: ${p.craving_times}`);
    if (p.typical_day) lines.push(`A normal day of eating now: ${p.typical_day}`);
  }
  // Recovery signals (override)
  const rec = [];
  if (ctx.checkin && ctx.checkin.sleep_hours != null) rec.push(`recent sleep: ${ctx.checkin.sleep_hours}h`);
  if (ctx.checkin && ctx.checkin.mood != null) rec.push(`recent mood: ${ctx.checkin.mood}/5`);
  if (ctx.soberDays != null) rec.push(`${ctx.soberDays} days sober`);
  const dl = (ctx.checkin && ctx.checkin.daily_log) || {};
  if (dl.water === false) rec.push("hasn't hydrated yet today");
  if (rec.length) lines.push(`Recovery signals right now (APPLY THE OVERRIDE if sleep is low, mood is low, or cravings seem elevated): ${rec.join("; ")}.`);
  if (ctx.lastWeekly) {
    const w = ctx.lastWeekly;
    lines.push(`Last week's feedback — completed ${w.completed_pct ?? "?"}%${w.too_hard ? ", too hard: " + w.too_hard : ""}${w.too_easy ? ", too easy: " + w.too_easy : ""}${w.pain ? ", pain: " + w.pain : ""}${w.energy ? ", energy: " + w.energy : ""}. Adapt accordingly.`);
  }
  return lines.join("\n");
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  const plan_type = body.plan_type === "nutrition" ? "nutrition" : "workout";
  let userId = body.user_id || null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server configuration error" });

  let sb;
  try { sb = getSupabaseClient(); } catch { return json(500, { error: "Server configuration error" }); }
  if (body.token) { try { const { data } = await sb.auth.getUser(body.token); if (data?.user?.id) userId = data.user.id; } catch (_) {} }
  if (!userId) return json(400, { error: "user_id (or a valid token) is required" });

  const ctx = await gatherContext(sb, userId);
  const doneFlag = plan_type === "workout" ? "workout_intake_done" : "nutrition_intake_done";
  if (!ctx.profile || !ctx.profile[doneFlag]) {
    return json(409, { error: "intake_needed", plan_type });
  }
  const difficulty = computeDifficulty(ctx.profile, ctx.lastWeekly);

  // Generate
  let plan;
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 4000, system: SYSTEM,
        messages: [{ role: "user", content: buildUserPrompt(plan_type, ctx, difficulty) }],
      }),
    });
    if (!resp.ok) { const e = await resp.text(); console.error("Anthropic error:", resp.status, e.slice(0, 200)); return json(502, { error: "Generation failed upstream" }); }
    const data = await resp.json();
    plan = parseJSON(data.content?.[0]?.text || "");
  } catch (e) {
    console.error("plan-generate parse/gen failed:", e.message);
    return json(500, { error: "Could not generate the plan. Try again." });
  }

  // Cache: deactivate old active plans of this type, insert new.
  try {
    await sb.from("wellness_plans").update({ is_active: false }).eq("user_id", userId).eq("plan_type", plan_type).eq("is_active", true);
    await sb.from("wellness_plans").insert({ user_id: userId, plan_type, plan, difficulty, is_active: true });
  } catch (e) { console.warn("plan cache failed (non-fatal):", e.message); }

  return json(200, { plan, difficulty, regenerated: true });
};
