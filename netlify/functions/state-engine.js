/**
 * state-engine.js - Dashboard State Engine v1.0, Section 6 (the core mechanism)
 *
 * Every Tier 1 (state-changing) event fires this exact sequence:
 *   Step 0 - Crisis Check (ALWAYS first; inherits Trust & Crisis Architecture)
 *   Step 1 - Save Event
 *   Step 2 - Update user_daily_state
 *   Step 3 - Recalculate Clarity Score (+ "why did this change" explainer)
 *   Steps 4-7 (module re-rank, Riley message, recommendations, brief) READ the
 *     state this engine persists - they live in riley-brain.js / daily-brief.js
 *     and are layered on in the next phase.
 *
 * If Step 0 detects a Level 2/3 trigger, clarity/recommendation/re-rank are
 * SUSPENDED for this cycle (suspended:true) and the response routes the client
 * to the Crisis Support Workflow instead of content - exactly as §5.1 specifies.
 *
 * Tier 2 (engagement) events are logged and return immediately - no recompute.
 * That split is the 5,000-user scaling fix (§2).
 *
 * Request (POST JSON): { user_id, token?, event_type, event_data?, text? }
 * Response (JSON): { tier, recompute, crisis, suspended, state, clarity_delta, explainer }
 */

const { getSupabaseClient, soberDaysForMember } = require("./supabase-client");
const { detectCrisis } = require("./crisis-detection");
const { sendOperatorAlert } = require("./safety-alert");
const { isTier1, computeDimensions, computeClarity, explainChange } = require("./clarity");
const { writeClarityV2Dark } = require("./clarity-v2-write");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (statusCode, data) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) });
const todayUTC = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
// "App day" = the member's LOCAL date with a 4am rollover - matches the client so user_daily_state
// lines up with the dashboard's clarity read (was UTC, which drifted a day for evening users).
const appDay = (tz) => { const s = new Date(Date.now() - 4 * 3600 * 1000); try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Denver" }).format(s); } catch (e) { return s.toISOString().slice(0, 10); } };

// Restricted safety write (mirrors riley-chat / checkin-scan). Non-fatal.
async function logCrisis(supabase, userId, level, matches, snippet, via) {
  try {
    await supabase.from("crisis_log").insert({
      user_id: userId, session_id: via, level,
      matched_rules: Array.isArray(matches) ? matches.slice(0, 8) : [],
      message_excerpt: typeof snippet === "string" ? snippet.slice(0, 500) : null,
      followup_stage: 0, resolved: false,
    });
    supabase.from("user_profiles")
      .update({ last_crisis_at: new Date().toISOString(), last_crisis_level: level })
      .eq("id", userId).then(() => {}, () => {});
  } catch (e) { console.warn("state-engine logCrisis failed (non-fatal):", e.message); }
}

// Gather the raw signals the clarity dimensions are derived from. Runs only on
// Tier 1 events, so the query fan-out is bounded by the scaling principle.
async function gatherSignals(supabase, userId) {
  const week = daysAgoISO(7), ten = daysAgoISO(10);
  const [ci, fit, nut, habits, habitComp, sober, prog] = await Promise.allSettled([
    supabase.from("daily_checkins").select("mood,sleep_hours,notes,checkin_date").eq("user_id", userId).gte("checkin_date", ten).order("checkin_date", { ascending: false }),
    supabase.from("fitness_logs").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("logged_date", week),
    supabase.from("nutrition_logs").select("*", { count: "exact", head: true }).eq("user_id", userId).gte("logged_date", week),
    supabase.from("habits").select("id,counts_toward_clarity").eq("user_id", userId).eq("is_active", true),
    supabase.from("habit_completions").select("habit_id").eq("user_id", userId).gte("completed_date", week),
    supabase.from("sobriety_tracker").select("start_date").eq("user_id", userId).eq("is_active", true).order("start_date", { ascending: false }).limit(1),
    supabase.from("user_program_progress").select("program_name,programs(title)").eq("user_id", userId).eq("status", "active").limit(1),
  ]);

  const checkins = (ci.status === "fulfilled" && ci.value.data) || [];
  const recentMoods = checkins.filter(c => c.mood != null).map(c => c.mood);
  const latestMood = recentMoods.length ? recentMoods[0] : null;
  const latestSleep = (checkins.find(c => c.sleep_hours != null) || {}).sleep_hours ?? null;
  const reflectionsThisWeek = checkins.filter(c => c.checkin_date >= week && c.notes && String(c.notes).trim()).length;
  const checkinDays7 = new Set(checkins.filter(c => c.checkin_date >= week).map(c => c.checkin_date)).size;

  // v2.3 B.2: the Habits dim scores over ONLY habits that count toward Clarity (default true).
  // Both the completions (numerator) and the active-habit denominator use the included set. Zero
  // included -> habitRate null, so the dim renormalizes away (never scores an empty set as failure).
  const habitListAll = (habits.status === "fulfilled" && habits.value.data) || [];
  const habitList = habitListAll.filter((h) => h.counts_toward_clarity !== false);
  const countIds = new Set(habitList.map((h) => h.id));
  const compsAll = (habitComp.status === "fulfilled" && habitComp.value.data) || [];
  const comps = compsAll.filter((c) => countIds.has(c.habit_id));
  const habitRate = habitList.length ? Math.min(100, (comps.length / (habitList.length * 7)) * 100) : null;

  const soberRow = (sober.status === "fulfilled" && sober.value.data && sober.value.data[0]) || null;
  const soberDays = soberRow && soberRow.start_date ? soberDaysForMember(soberRow.start_date) : null;

  const progRow = (prog.status === "fulfilled" && prog.value.data && prog.value.data[0]) || null;
  const activeJourney = progRow ? ((progRow.programs && progRow.programs.title) || progRow.program_name || null) : null;

  return {
    mood: latestMood,
    sleepHours: latestSleep,
    workoutsThisWeek: fit.status === "fulfilled" ? (fit.value.count || 0) : null,
    mealsThisWeek: nut.status === "fulfilled" ? (nut.value.count || 0) : null,
    reflectionsThisWeek,
    habitRate,
    checkinDays7,
    soberDays,
    soberStart: soberRow && soberRow.start_date ? soberRow.start_date : null,
    activeJourney,
    recentMoods,
  };
}

// Reconstruct the dimension object from a stored state row (raw mood → 0-100).
function dimsFromRow(r) {
  if (!r) return {};
  return {
    mood_score: r.mood != null ? Math.round((r.mood / 5) * 100) : null,
    sleep_score: r.sleep_score, movement_score: r.movement_score,
    nourishment_score: r.nourishment_score, reflection_score: r.reflection_score,
    goal_score: r.goal_score, community_score: r.community_score, recovery_score: r.recovery_score,
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { event_type, event_data, text } = body;
  if (!event_type) return json(400, { error: "event_type is required" });

  let supabase;
  try { supabase = getSupabaseClient(); } catch (e) { return json(500, { error: "Server configuration error" }); }

  // SECURITY: identity comes ONLY from the verified token - never a client-supplied user_id. The
  // service key bypasses RLS, so trusting body.user_id would let anyone forge another user's state/crisis.
  let userId = null;
  try { const { data } = await supabase.auth.getUser(body.token); userId = data?.user?.id || null; } catch (_) {}
  if (!userId) return json(401, { error: "Unauthorized" });

  const tier = isTier1(event_type) ? 1 : 2;

  // Step 1 - Save Event (always logged, tier tagged).
  try {
    await supabase.from("engagement_events").insert({ user_id: userId, event_type, event_data: { ...(event_data || {}), tier } });
  } catch (e) { console.warn("state-engine save event failed (non-fatal):", e.message); }

  // Tier 2 - log only, no recompute. This is the scaling fix.
  if (tier === 2) return json(200, { tier: 2, recompute: false });

  let _tz = "America/Denver", _signupAt = null;
  try { const { data: _p } = await supabase.from("user_profiles").select("timezone, created_at").eq("id", userId).maybeSingle(); if (_p) { if (_p.timezone) _tz = _p.timezone; if (_p.created_at) _signupAt = new Date(_p.created_at); } } catch (e) {}

  // Feather keepsake: showing up for the day's check-in (founder rule 2026-07-23 -
  // moments, never logins/streaks). One per member-day (ref = appDay); fire-and-forget.
  if (event_type === "mood_checked_in") {
    try { require("./feathers").awardFeather(supabase, userId, "showed_up", appDay(_tz), "Showed up for your check-in").catch(() => {}); } catch (e) {}
  }
  const today = appDay(_tz);   // member-local 4am app-day (was UTC)
  const [sig, prevRes] = await Promise.all([
    gatherSignals(supabase, userId),
    supabase.from("user_daily_state").select("*").eq("user_id", userId).lte("date", today).order("date", { ascending: false }).limit(1),
  ]);
  const prev = (prevRes && prevRes.data && prevRes.data[0]) || null;

  // Personal-scope milestone feathers (founder rules, 2026-07-23/24): the milestone
  // set derives from what THIS member tracks, and Riley only marks milestones SHE
  // WAS THERE FOR - a milestone date before signup never earns a feather. Day
  // milestones early, calendar-correct year anniversaries after. NO recency window
  // (founder, 2026-07-24): a milestone crossed while the member was away is waiting
  // in their bucket when they return - Riley kept track. The gap itself is never
  // named (Never-Say law); idempotency makes catch-up awards safe.
  try {
    if (sig && sig.soberStart) {
      const dayMs = 86400000;
      const start = new Date(sig.soberStart + "T12:00:00Z");
      const nowD = new Date();
      const cands = [];
      [1, 7, 14, 30, 60, 90, 120, 180, 270].forEach((d) => cands.push({
        ref: "sober-" + d,
        label: d === 1 ? "Day 1 sober - the bravest one" : d + " days sober - a milestone worth keeping",
        date: new Date(start.getTime() + d * dayMs),
      }));
      for (let y = 1; y <= 60; y++) {
        const dt = new Date(start); dt.setUTCFullYear(dt.getUTCFullYear() + y);
        cands.push({ ref: "sober-" + y + "y", label: y + " year" + (y > 1 ? "s" : "") + " sober - a milestone worth keeping", date: dt });
      }
      const { awardFeather } = require("./feathers");
      cands.filter((c) => c.date <= nowD && (!_signupAt || c.date >= _signupAt))
        .forEach((c) => awardFeather(supabase, userId, "milestone", c.ref, c.label).catch(() => {}));
    }
  } catch (e) {}

  // Habit + goal feathers (founder, 2026-07-24): today's kept habits, and any goal
  // that reached its target this period. Bounded reads, idempotent refs, fire-and-forget.
  try {
    const { awardFeather } = require("./feathers");
    // Last 14 days, not just today (founder, 2026-07-24: always catch up on return).
    supabase.from("habit_completions").select("habit_id, completed_date, habits(title)")
      .eq("user_id", userId).gte("completed_date", daysAgoISO(14))
      .then(({ data }) => (data || []).forEach((h) => {
        const t = h.habits && h.habits.title ? ": " + h.habits.title : "";
        awardFeather(supabase, userId, "habit", h.habit_id + ":" + h.completed_date, "Kept a habit" + t).catch(() => {});
      }), () => {});
    supabase.from("user_goals").select("id, title, target_value, current_value, period_start")
      .eq("user_id", userId).eq("is_active", true)
      .then(({ data }) => (data || []).forEach((g) => {
        if (g.target_value != null && g.current_value != null && Number(g.target_value) > 0 && Number(g.current_value) >= Number(g.target_value)) {
          awardFeather(supabase, userId, "goal", g.id + ":" + (g.period_start || "all"), "Reached your goal" + (g.title ? ": " + g.title : "")).catch(() => {});
        }
      }), () => {});
  } catch (e) {}
  const flaggedToday = !!(prev && prev.date === today && prev.crisis_flag);

  // ── Step 0 - Crisis Check (always first) ──────────────────────────────────
  let crisis = { flag: false, level: 0, source: null, matches: null };
  if (text) {
    let c = { level: 0, matches: [] };
    try { c = detectCrisis(text); } catch (_) {}
    if (c.level >= 2) crisis = { flag: true, level: c.level, source: "text", matches: c.matches };
  }
  // Repeated lowest-mood selection routes here too (§5.1). Lowest = mood 1.
  if (!crisis.flag && event_type === "mood_checked_in") {
    const currentMood = (event_data && event_data.mood != null) ? event_data.mood : sig.mood;
    const lowestInLast5 = sig.recentMoods.slice(0, 5).filter(m => m === 1).length;
    if (currentMood === 1 && lowestInLast5 >= 3) crisis = { flag: true, level: 2, source: "mood-pattern", matches: ["repeated-lowest-mood"] };
  }
  // Handle a fresh crisis - log + alert the operator, deduped to once per day.
  if (crisis.flag && !flaggedToday) {
    await logCrisis(supabase, userId, crisis.level, crisis.matches, text || "Repeated lowest-mood selection", "state-engine");
    if (supabase && userId) {
      await sendOperatorAlert(supabase, {
        userId, level: crisis.level, matches: crisis.matches,
        excerpt: text || "Repeated lowest-mood selection (no text)", source: "state-engine:" + event_type,
      });
    }
  }

  // ── Step 2 - Update user_daily_state ──────────────────────────────────────
  const dims = computeDimensions(sig);

  // ── Step 3 - Recalculate Clarity (+ explainer, unless suspended by crisis) ─
  const clarity = computeClarity(dims);
  const prevClarity = prev ? prev.clarity_score : null;
  const explainer = crisis.flag ? null : explainChange(dimsFromRow(prev), dims, prevClarity, clarity, { checkpoint: !!body.checkpoint });

  const crisisFlag = crisis.flag || flaggedToday;
  const row = {
    user_id: userId, date: today,
    mood: sig.mood, sleep_score: dims.sleep_score ?? null, movement_score: dims.movement_score ?? null,
    nourishment_score: dims.nourishment_score ?? null, reflection_score: dims.reflection_score ?? null,
    goal_score: dims.goal_score ?? null, community_score: dims.community_score ?? null,
    recovery_score: dims.recovery_score ?? null, clarity_score: clarity,
    clarity_note: explainer || null,
    active_journey: sig.activeJourney || null, crisis_flag: crisisFlag,
    last_updated: new Date().toISOString(),
  };
  try { await supabase.from("user_daily_state").upsert(row, { onConflict: "user_id,date" }); }
  catch (e) { console.warn("state-engine upsert failed (non-fatal):", e.message); }

  // ── Clarity v2.2 DARK shadow write (never displayed; flag still 'v1') ──────
  // Runs AFTER the v1 upsert committed, fully swallowed — a v2 error can't touch v1.
  // Skipped on a crisis cycle (clarity narration is suspended per §5.1).
  if (!crisis.flag) {
    try { await writeClarityV2Dark(supabase, userId, { today, prev, sig }); }
    catch (e) { console.warn("clarity-v2 dark write failed (non-fatal):", e.message); }
  }

  return json(200, {
    tier: 1,
    recompute: true,
    crisis: { flag: crisis.flag, level: crisis.level, source: crisis.source },
    suspended: crisis.flag,                 // §5.1 - content/clarity narration suspended this cycle
    state: { clarity_score: clarity, crisis_flag: crisisFlag, ...dims },
    clarity_delta: (clarity != null && prevClarity != null) ? clarity - prevClarity : null,
    explainer,
  });
};

// Exported for the Clarity v2.2 shadow-verify tool (Phase A.5) so it reconstructs the
// SAME v1 signal bundle the live engine sees. `appDay` too, for the member-local date.
exports.gatherSignals = gatherSignals;
exports._appDay = appDay;
