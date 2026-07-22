/**
 * clarity-v2-write.js — Clarity Score v2.2, the DARK shadow write (Phase B pt2).
 *
 * Called by state-engine.js AFTER the v1 upsert, inside a try/catch. This gathers the
 * richer 28-day signals the v2 engine needs, computes the v2 score via the pure
 * clarity-engine.js, ratchets each Practice dim's personal baseline, and writes the
 * SEPARATE v2 columns on the same user_daily_state row (+ user_dim_baselines).
 *
 * SAFETY: 100% dark + non-fatal. Nothing here is displayed (the cutover flag is still
 * 'v1'). Every failure is swallowed — a v2 exception can NEVER corrupt the v1 write,
 * which already committed before this runs. Spec: docs/CLARITY_SCORE_v2.2.md.
 */

'use strict';

const engine = require("./clarity-engine");
const { effectiveConfig } = require("./clarity-config-util");
const { emitEvent } = require("./supabase-client");
const { rhythmEnabled, relightDisplay } = require("./rhythm");

const dayISO = (d) => d.toISOString().slice(0, 10);
const daysAgoISO = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return dayISO(d); };
const isNum = (x) => typeof x === "number" && !isNaN(x);
const num = (x) => (x == null || x === "" ? null : (isNum(Number(x)) ? Number(x) : null));
// whole-day gap between two YYYY-MM-DD strings (>=0)
const gapDays = (fromISO, toISO) => {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(fromISO + "T00:00:00Z"), b = Date.parse(toISO + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
};

/**
 * Compute + persist the v2 shadow for `userId` on `today`. `sig` is state-engine's
 * already-gathered v1 signal bundle (reused so we don't re-query counts). Returns the
 * engine result (for logging/shadow-verify) or null if it couldn't run.
 */
async function writeClarityV2Dark(supabase, userId, opts) {
  opts = opts || {};
  const today = opts.today;
  const prev = opts.prev || null;      // most recent user_daily_state row (<= today)
  const sig = opts.sig || {};
  if (!supabase || !userId || !today) return null;

  const win28 = daysAgoISO(28), win7 = daysAgoISO(7);

  // ── gather the v2-specific signals in parallel (bounded fan-out; Tier-1 only) ──
  const [ciRes, baseRes, cfgRes, histRes, hardRes, profRes, fitRes, leRes] = await Promise.allSettled([
    supabase.from("daily_checkins")
      .select("checkin_date,mood,energy,sleep_hours,sleep_quality,heaviness,outside,connection,hard_day,craving,notes")
      .eq("user_id", userId).gte("checkin_date", win28).order("checkin_date", { ascending: true }),
    supabase.from("user_dim_baselines").select("dim,baseline,sample_days").eq("user_id", userId),
    supabase.from("user_clarity_config").select("config,config_version,pending_config,pending_apply_on").eq("user_id", userId).maybeSingle(),
    supabase.from("user_daily_state").select("date,clarity_core,clarity_v2,frozen,frozen_until,frozen_snapshot")
      .eq("user_id", userId).gte("date", win28).lte("date", today).order("date", { ascending: true }),
    supabase.from("hard_dates").select("date").eq("user_id", userId).eq("date", today),
    supabase.from("user_profiles").select("created_at").eq("id", userId).maybeSingle(),
    supabase.from("fitness_logs").select("logged_date").eq("user_id", userId).gte("logged_date", win7),
    supabase.from("clarity_life_events").select("occurred_on,window_days,recalibrate").eq("user_id", userId).eq("recalibrate", true).gte("occurred_on", daysAgoISO(60)),
  ]);

  const checkins = (ciRes.status === "fulfilled" && ciRes.value.data) || [];
  if (!checkins.length) return null;                       // no v2 data at all → skip cleanly
  const baselines = (baseRes.status === "fulfilled" && baseRes.value.data) || [];
  // Honor a staged config change once its app-day arrives (§10 next-app-day apply).
  const cfgRow = (cfgRes.status === "fulfilled" && cfgRes.value.data) || null;
  const eff = effectiveConfig(cfgRow, today);
  const cfg = eff.config || {};
  const cfgVersion = eff.version || 1;
  const hist = (histRes.status === "fulfilled" && histRes.value.data) || [];
  const hardToday = (hardRes.status === "fulfilled" && hardRes.value.data && hardRes.value.data.length > 0) || false;
  const prof = (profRes.status === "fulfilled" && profRes.value.data) || null;

  // v2.3 TIER SPLIT: free/Guide members score in FOUNDATION mode (Foundation + Direction only - "the
  // universal score"); any active paid membership (Companion) scores in FULL mode (v2.2 formula, with
  // personal bands + focus lanes - "the personal score"). Derived server-side so a foundation member's
  // Practice/lane values are never computed into the stored row (which IS the API response).
  let scoreMode = 'foundation';
  try {
    const { data: _msubs } = await supabase.from("subscriptions").select("plan_id,expires_at")
      .eq("user_id", userId).eq("status", "active")
      .in("plan_id", ["companion", "coach", "mentor", "concierge"]);
    const _mnow = Date.now();
    if ((_msubs || []).some((s) => !s.expires_at || new Date(s.expires_at).getTime() > _mnow)) scoreMode = 'full';
  } catch (_) {}

  const baseMap = {};
  baselines.forEach((b) => { baseMap[b.dim] = b; });
  const last7 = checkins.filter((c) => c.checkin_date >= win7);
  const todayRow = checkins.filter((c) => c.checkin_date === today).slice(-1)[0] || null;
  const lastCheckinDate = checkins.length ? checkins[checkins.length - 1].checkin_date : null;
  const ckGap = gapDays(lastCheckinDate, today);           // freshness for Foundation/Practice
  const hardToday2 = !!(hardToday || (todayRow && todayRow.hard_day === true));

  // membership day (§9 First Light: days 1-14 → rise-only + tiny practice thresholds)
  let membershipDays = null;
  if (prof && prof.created_at) { const g = gapDays(dayISO(new Date(prof.created_at)), today); if (g != null) membershipDays = g + 1; }
  const firstLight = isNum(membershipDays) && membershipDays <= 14;

  // §2 life-event recalibration: if the member flagged a big change and we're still inside its
  // window (occurred_on .. +window_days), widen the Practice bands so Clarity meets them where
  // they are now instead of cratering. Never lowers — same one-directional care as a hard day.
  const lifeEvents = (leRes.status === "fulfilled" && leRes.value.data) || [];
  const recalibrating = lifeEvents.some((e) => {
    if (!e.occurred_on) return false;
    const end = gapDays(e.occurred_on, today);
    return end != null && end >= 0 && end <= (isNum(e.window_days) ? e.window_days : 14);
  });

  // ── Foundation series (oldest→newest; engine slices last 7 non-null) ──
  const series = (k) => checkins.map((c) => num(c[k]));
  const foundationInp = {
    mood7: series("mood"),
    energy7: series("energy"),
    // §9: hard days are excluded from the σ7 volatility (calm) signal — a hard day never adds
    // to "how volatile you've been." We drop heaviness from days the member flagged hard.
    heaviness7: checkins.filter((c) => c.hard_day !== true).map((c) => num(c.heaviness)),
    sleepHours7: series("sleep_hours"),
    sleepQuality7: series("sleep_quality"),
    meals7d: isNum(sig.mealsThisWeek) ? sig.mealsThisWeek : 0,
    fuelOptOut: !!cfg.fuel_opt_out,
  };

  // §7 movement plausibility: cap 2 sessions/day toward v (a 5-workout Saturday isn't 5 days
  // of movement). Sum the per-day capped counts over the trailing 7 days.
  const fitRows = (fitRes.status === "fulfilled" && fitRes.value.data) || [];
  const perDay = {};
  fitRows.forEach((r) => { const d = r.logged_date; if (d) perDay[d] = (perDay[d] || 0) + 1; });
  const movementCapped = Object.keys(perDay).reduce((s, d) => s + Math.min(2, perDay[d]), 0);

  // ── Practice values = each member's own trailing-7d activity (unit-agnostic; bands
  // are relative to the personal baseline, so counts and rates both work) ──
  const countTrue = (rows, k) => rows.filter((r) => r[k] === true).length;
  const dimV = {
    movement: fitRows.length ? movementCapped : (isNum(sig.workoutsThisWeek) ? Math.min(sig.workoutsThisWeek, 14) : null),
    reflection: isNum(sig.reflectionsThisWeek) ? Math.min(sig.reflectionsThisWeek, 14) : null, // §7 ≤2/day over 7d
    habits: isNum(sig.habitRate) ? sig.habitRate : null,
    outside: countTrue(last7, "outside"),
    connection: countTrue(last7, "connection"),
    program: sig.activeJourney ? 1 : 0,
    // §5 grief lane presence: 1 if the member showed up (any check-in in the last 7 days).
    grief: last7.length > 0 ? 1 : 0,
  };
  let enabled = (Array.isArray(cfg.enabled_practice) && cfg.enabled_practice.length)
    ? cfg.enabled_practice.slice()
    : ["movement", "habits", "reflection"];
  // §5 grief lane: opt-in only (config.lanes.grief === true). Presence-based, never scored.
  if (cfg.lanes && cfg.lanes.grief === true && enabled.indexOf("grief") === -1) enabled.push("grief");

  const practice = {};
  enabled.forEach((dim) => {
    const b = baseMap[dim];
    const sampleDays = (b && isNum(b.sample_days)) ? b.sample_days : 0;
    practice[dim] = {
      v: dimV[dim],
      baseline: b && isNum(b.baseline) ? b.baseline : null,
      firstLight: firstLight || sampleDays < 14,   // dim in its own first-light window
    };
  });

  // ── Direction: history of daily core (oldest→newest) ──
  const coreHistory = hist.map((h) => num(h.clarity_core)).filter(isNum);

  // ── prev displayed (rise-only) + freeze (§5 lapse-repair hold) ──
  const prevDisplayed = (prev && isNum(num(prev.clarity_v2))) ? num(prev.clarity_v2) : null;
  const nowMs = Date.now();
  const prevFrozenUntil = (prev && prev.frozen_until) ? Date.parse(prev.frozen_until) : NaN;
  const wasFrozen = !!(prev && prev.frozen && !isNaN(prevFrozenUntil) && prevFrozenUntil > nowMs);
  const unfrozeNow = !!(prev && prev.frozen && (isNaN(prevFrozenUntil) || prevFrozenUntil <= nowMs)); // just expired
  // §5 slip detection: an ESTABLISHED member's sobriety streak just reset → freeze during
  // lapse-repair. Never for a new member (membershipDays>14 required); never shames a slip.
  const hasTracker = isNum(sig.soberDays);
  const slipDetected = hasTracker && sig.soberDays <= 1 && prevDisplayed != null && isNum(membershipDays) && membershipDays > 14 && !wasFrozen;

  let freeze = null, frozenUntilISO = null, frozenSnapshot = null, frozeNow = false;
  if (wasFrozen) {
    frozenSnapshot = prev.frozen_snapshot || { displayed: prevDisplayed };
    frozenUntilISO = prev.frozen_until;
    freeze = { active: true, snapshot: frozenSnapshot };
  } else if (slipDetected) {
    frozenSnapshot = { displayed: prevDisplayed };
    frozenUntilISO = new Date(nowMs + 72 * 3600 * 1000).toISOString(); // hold ≤72h (§5)
    freeze = { active: true, snapshot: frozenSnapshot };
    frozeNow = true;
  }

  // ── sobriety lane (§5): OPT-IN. Auto-offered to members who track sobriety, but honored
  //    as opt-out when config.lanes.sobriety === false. Never forced; never Foundation. ──
  const laneOptOut = cfg.lanes && cfg.lanes.sobriety === false;
  const laneEnabled = hasTracker && !laneOptOut;
  const lane = laneEnabled
    ? { sobriety: { enabled: true, soberDays30: Math.min(30, Math.max(0, sig.soberDays)) } }
    : {};

  // ── Re-Light (docs/07 §2b · docs/08 §5): ON by default (rhythmEnabled); RHYTHM_ENABLED=false turns it off. During the window
  //    the shown number is rise-only; an R4 return additionally re-enters First-Light-lite
  //    (tiny thresholds via the engine's firstLight path). Window closes itself here. ──
  let relightActive = false, relightLite = false;
  if (rhythmEnabled()) {
    try {
      const { data: rl } = await supabase.from("user_profiles")
        .select("relight_until,relight_tier").eq("id", userId).maybeSingle();
      if (rl && rl.relight_until) {
        if (today <= rl.relight_until) {
          relightActive = true;
          relightLite = rl.relight_tier === "R4";
        } else {
          await supabase.from("user_profiles").update({ relight_until: null, relight_tier: null }).eq("id", userId);
          emitEvent(supabase, userId, "relight_ended", {});
        }
      }
    } catch (_) {}
  }

  const raw = Object.assign({}, foundationInp, {
    score_mode: scoreMode,
    enabledPractice: enabled,
    practice,
    lane,
    coreHistory,
    hardDayToday: hardToday2,
    recalibrating,
    firstLight: firstLight || relightLite,   // R4 re-entry = First-Light-lite (rise-only + tiny thresholds)
    prevDisplayed,
    freeze,
    gaps: {
      steadiness: ckGap, rest: ckGap, fuel: isNum(sig.mealsThisWeek) && sig.mealsThisWeek > 0 ? ckGap : (ckGap == null ? null : ckGap + 4),
      movement: ckGap, habits: ckGap, reflection: ckGap, outside: ckGap, connection: ckGap, program: ckGap, grief: ckGap,
    },
  });

  const result = engine.computeClarityV2(raw);

  // Dry-run (Phase A.5 shadow-verify): compute + return, persist NOTHING. Same gather+math
  // as the live dark write, so the verifier reports exactly what production would store.
  if (opts.dryRun) return result;

  // Re-Light rise-only display: inside the window, never store a shown value lower than the
  // previous shown value ("returning members are never greeted by a lower number", 08 §5).
  const displayedOut = relightActive ? relightDisplay(result.displayed, prevDisplayed, true) : result.displayed;

  // ── persist: v2 columns on today's user_daily_state row (v1 already wrote it) ──
  try {
    await supabase.from("user_daily_state").update({
      clarity_v2: displayedOut,
      provisional: result.provisional,
      clarity_core: result.core,
      f_score: result.F,
      p_score: result.P,
      d_score: result.D,
      v2_breakdown: Object.assign({}, result.breakdown, { mode: result.mode }),
      config_version: cfgVersion,
      frozen: !!result.frozen,
      frozen_until: result.frozen ? frozenUntilISO : null,   // cleared on unfreeze
      frozen_snapshot: result.frozen ? frozenSnapshot : null,
    }).eq("user_id", userId).eq("date", today);
  } catch (e) { console.warn("clarity-v2 state write failed (non-fatal):", e.message); }

  // ── §12 canonical events (fire-and-forget; never block the write) ──
  try {
    emitEvent(supabase, userId, "clarity_recomputed", { displayed: displayedOut, provisional: result.provisional, frozen: !!result.frozen, config_version: cfgVersion });
    if (result.provisional) emitEvent(supabase, userId, "clarity_provisional", { coverage: result.breakdown && result.breakdown.coverage });
    if (hardToday2) emitEvent(supabase, userId, "hard_day_flagged", { date: today });
    if (frozeNow) emitEvent(supabase, userId, "clarity_frozen", { until: frozenUntilISO, held_at: prevDisplayed });
    if (unfrozeNow) emitEvent(supabase, userId, "clarity_unfrozen", {});
    if (membershipDays === 1) emitEvent(supabase, userId, "first_light_started", {});
    if (membershipDays === 15) emitEvent(supabase, userId, "first_light_ended", {});
  } catch (e) {}

  // ── ratchet each scored Practice dim's baseline toward today's value (for NEXT time).
  // Scoring above used the PRE-update baseline ("distance traveled"); the bar then moves. ──
  // v2.3: FULL mode only. Foundation (free) members don't maintain Practice baselines; on upgrade the
  // first full-mode write seeds each dim's baseline from current activity (an instant personal baseline).
  if (scoreMode !== 'full') return result;
  try {
    const nowISO = new Date().toISOString();
    const ups = enabled
      .filter((dim) => dim !== "grief" && isNum(dimV[dim]))   // grief is presence-only — no baseline
      .map((dim) => {
        const b = baseMap[dim];
        const prevB = b && isNum(b.baseline) ? b.baseline : null;
        const newB = engine.updateBaseline(prevB, dimV[dim]);
        const sampleDays = ((b && isNum(b.sample_days)) ? b.sample_days : 0) + 1;
        return {
          user_id: userId, dim, baseline: newB, sample_days: sampleDays,
          first_light_started_on: (b && b.first_light_started_on) || today, updated_at: nowISO,
        };
      });
    if (ups.length) await supabase.from("user_dim_baselines").upsert(ups, { onConflict: "user_id,dim" });
  } catch (e) { console.warn("clarity-v2 baseline ratchet failed (non-fatal):", e.message); }

  return result;
}

module.exports = { writeClarityV2Dark };
