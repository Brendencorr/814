/**
 * plan-adapt-cron.js — weekly adaptive workout/nutrition plans (Master Build Spec §3.3).
 *
 * Closes the Coach-tier promise gap: `plan-generate-background` only ran on demand, so plans
 * never adapted. This weekly cron reads each Coach member's completion % (fitness_logs /
 * nutrition_logs vs their active plan) and regenerates an ADAPTED plan with a plainly-stated
 * "what changed & why" line, so adaptation reads as Riley paying attention, not randomness.
 *
 * Rules: <50% completion → simplify (fewer/smaller); >85% → progress gently; skipped-food
 * patterns → swap, don't repeat. Never guilt-framed.
 *
 * Coach/mentor only (the tier that promises this) OR free_access_mode. Gated, fail-open, non-fatal
 * per member. Utility model (Haiku) via anthropic-client. Logs each regeneration to system_incidents.
 * (At scale, move the model calls to the Batch API per §8.3 — synchronous is fine at launch volume.)
 *
 * Schedule: netlify.toml [functions."plan-adapt-cron"] = "0 13 * * 1" (Mon ~13:00 UTC).
 */

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");

const crypto = require("crypto");
const hashId = (id) => { try { return crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 16); } catch (_) { return null; } };
const ok = (b) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, ...b }) });

const SYSTEM = `You ADAPT a member's existing 7-day wellness plan based on how much of last week they actually completed. You are a warm wellness coach, never a drill sergeant.
Return ONLY the adapted plan as JSON in the SAME shape you received (same keys: type, goal, summary, days[7], and the workout/nutrition-specific fields), PLUS one extra field "changes": a single plain sentence naming what you changed and why, in Riley's voice (e.g. "You crushed 3 of 3 walks — added a fourth. Skipped the salmon twice — swapped it for chicken.").
ADAPTATION RULES:
- completion < 50%: SIMPLIFY — fewer sessions, smaller asks, remove friction. Never guilt. Rebuild consistency.
- completion 50-85%: keep it, remove one point of friction.
- completion > 85%: progress GENTLY — a little more volume/variety, never a spike.
- A repeatedly skipped meal/food: SWAP it for something else they'd eat, don't repeat it.
- If recovery signals are poor (low sleep/mood), drop intensity regardless of completion.
Keep the safety_note. Keep it realistic and kind.`;

function completionPct(planType, plan, workouts7, meals7, profile) {
  try {
    if (planType === "workout") {
      const planned = Array.isArray(plan.days) ? plan.days.filter((d) => Array.isArray(d.exercises) && d.exercises.length).length : (profile.days_per_week || 3);
      if (!planned) return null;
      return Math.min(100, Math.round((workouts7 / planned) * 100));
    } else {
      const perDay = profile.meals_per_day || 3;
      const planned = 7 * perDay;
      if (!planned) return null;
      return Math.min(100, Math.round((meals7 / planned) * 100));
    }
  } catch (_) { return null; }
}

async function adaptOne(sb, plan_row, profile, ctx) {
  const planType = plan_row.plan_type;
  const pct = completionPct(planType, plan_row.plan || {}, ctx.workouts7, ctx.meals7, profile);
  if (pct == null) return { skipped: "no_baseline" };

  const userPrompt = [
    `PLAN TYPE: ${planType}`,
    `LAST WEEK COMPLETION: ${pct}%  (${planType === "workout" ? ctx.workouts7 + " workouts logged" : ctx.meals7 + " meals logged"})`,
    ctx.recentSleep != null ? `Recent sleep: ${ctx.recentSleep}h` : "",
    ctx.recentMood != null ? `Recent mood: ${ctx.recentMood}/5` : "",
    profile.foods_hate ? `Won't eat: ${profile.foods_hate}` : "",
    profile.foods_love ? `Loves: ${profile.foods_love}` : "",
    "",
    "CURRENT PLAN (adapt this, keep the same JSON shape + add \"changes\"):",
    JSON.stringify(plan_row.plan || {}, null, 1).slice(0, 6000),
  ].filter(Boolean).join("\n");

  let raw;
  try {
    const r = await callClaude({ system: SYSTEM, messages: [{ role: "user", content: userPrompt }], max_tokens: 3000, model: MODELS.synthesis, functionName: "plan-adapt-cron", supabase: sb });
    raw = r.text || "";
  } catch (_) { return { skipped: "model" }; }
  raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
  let plan; try { plan = JSON.parse(raw); } catch (_) { return { skipped: "parse" }; }
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) return { skipped: "invalid" };

  try {
    await sb.from("wellness_plans").update({ is_active: false }).eq("user_id", plan_row.user_id).eq("plan_type", planType).eq("is_active", true);
    await sb.from("wellness_plans").insert({ user_id: plan_row.user_id, plan_type: planType, plan, difficulty: plan_row.difficulty || null, is_active: true });
  } catch (_) { return { skipped: "write" }; }
  return { adapted: true, pct, changes: String(plan.changes || "").slice(0, 200) };
}

exports.handler = async function (event) {
  const gate = requireScheduledOrOperator(event); if (gate) return gate;
  let sb; try { sb = getSupabaseClient(); } catch (_) { return { statusCode: 500, body: "config" }; }

  // free_access_mode → adapt for everyone (matches pre-launch behavior); else Coach/mentor only.
  let freeAccess = false;
  try { const { data } = await sb.from("app_settings").select("value").eq("key", "free_access_mode").maybeSingle(); freeAccess = !!(data && String(data.value).toLowerCase() === "true"); } catch (_) {}

  let coach = new Set();
  if (!freeAccess) {
    try {
      const { data: subs } = await sb.from("subscriptions").select("user_id, plan_id, status, expires_at").eq("status", "active").in("plan_id", ["coach", "mentor"]);
      const now = Date.now();
      (subs || []).forEach((s) => { if (!s.expires_at || new Date(s.expires_at).getTime() > now) coach.add(s.user_id); });
    } catch (_) {}
  }

  let plans = [];
  try {
    const { data } = await sb.from("wellness_plans").select("user_id, plan_type, plan, difficulty").eq("is_active", true).limit(300);
    plans = data || [];
  } catch (_) { return ok({ adapted: 0, error: "read" }); }

  const eligible = plans.filter((p) => freeAccess || coach.has(p.user_id));
  const result = { candidates: eligible.length, adapted: 0, skipped: 0 };
  const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  for (const p of eligible) {
    try {
      const [prof, fit, nut, ci] = await Promise.allSettled([
        sb.from("wellness_profile").select("days_per_week, meals_per_day, foods_love, foods_hate").eq("user_id", p.user_id).maybeSingle(),
        sb.from("fitness_logs").select("*", { count: "exact", head: true }).eq("user_id", p.user_id).gte("logged_date", week),
        sb.from("nutrition_logs").select("*", { count: "exact", head: true }).eq("user_id", p.user_id).gte("logged_date", week),
        sb.from("daily_checkins").select("mood, sleep_hours").eq("user_id", p.user_id).order("checkin_date", { ascending: false }).limit(1),
      ]);
      const profile = (prof.status === "fulfilled" && prof.value?.data) || {};
      const ctx = {
        workouts7: fit.status === "fulfilled" ? (fit.value.count || 0) : 0,
        meals7: nut.status === "fulfilled" ? (nut.value.count || 0) : 0,
        recentMood: ci.status === "fulfilled" ? (ci.value.data?.[0]?.mood ?? null) : null,
        recentSleep: ci.status === "fulfilled" ? (ci.value.data?.[0]?.sleep_hours ?? null) : null,
      };
      const out = await adaptOne(sb, p, profile, ctx);
      if (out.adapted) {
        result.adapted++;
        try { await sb.from("system_incidents").insert({ kind: "plan_adapt", function_name: "plan-adapt-cron", detail: { user_hash: hashId(p.user_id), plan_type: p.plan_type, completion_pct: out.pct, changes: out.changes } }); } catch (_) {}
      } else { result.skipped++; }
    } catch (_) { result.skipped++; }
  }

  console.log("[plan-adapt-cron] done:", JSON.stringify(result));
  return ok(result);
};
