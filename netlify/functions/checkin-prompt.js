/**
 * checkin-prompt.js — composes today's check-in render (docs/07 §2c + docs/08 §3b/§4).
 * Fixed spine, personal skin: framings + up to TWO dynamic items from the template bank only
 * (no free generation in v1). Persists checkin_prompts with checkin_context so every rendered
 * check-in is reproducible. Any failure returns the static canonical copy - the check-in never
 * blocks on composition. Dynamic answers are context/memory only - NEVER scored (07 acc #33).
 *
 * POST { token, tier? }  → { framing:{field:text}, dynamic:[{id,text,source,thread_id}],
 *                            sequence: 'standard'|'return'|'micro', aftermath: bool, fallback: bool }
 * POST { token, answer:{...} } → records dynamic-slot answers; closes/advances threads.
 */
const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");
const T = require("./checkin-templates");
const { returnTier } = require("./rhythm-utils");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });
const appDay = (d) => new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);

function staticPayload() {
  const framing = {};
  for (const [field, id] of Object.entries(T.STATIC_FALLBACK)) framing[field] = T.FRAMINGS[field][id];
  return { framing, dynamic: [], sequence: "standard", aftermath: false, fallback: true };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}
  const sb = getSupabaseClient();
  const userId = await getUserIdFromToken(sb, body.token);
  if (!userId) return json(401, { error: "Unauthorized" });
  const today = appDay(new Date());

  // ── answer path: record dynamic-slot answers; close/advance threads; NEVER touches scoring ──
  if (body.answer) {
    try {
      const a = body.answer || {};
      await sb.from("checkin_prompts").update({ answered: a.items || {} }).eq("user_id", userId).eq("app_day", today);
      for (const it of Object.values(a.items || {})) {
        if (it && it.thread_id) {
          if (it.skipped) emitEvent(sb, userId, "dynamic_item_skipped", { source: "thread" });
          else { await sb.from("member_threads").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", it.thread_id).eq("user_id", userId); emitEvent(sb, userId, "thread_closed", {}); }
        }
        if (it && !it.skipped) emitEvent(sb, userId, "dynamic_item_answered", { source: it.source || "unknown" });
      }
      if (a.gap_summary) {
        await sb.from("gap_summaries").update({ summary: a.gap_summary, note: a.gap_note || null }).eq("user_id", userId).eq("returned_on", today);
        emitEvent(sb, userId, "gap_summary_logged", { summary: a.gap_summary });
      }
      if (a.goal_fork) emitEvent(sb, userId, "goals_forked", { choice: a.goal_fork });
    } catch (e) { console.warn("checkin-prompt answer failed:", e.message); }
    return json(200, { ok: true });
  }

  // ── compose path ──
  try {
    const [profQ, thQ, hdQ, prevQ, cfgQ] = await Promise.allSettled([
      sb.from("user_profiles").select("last_active_at,location_opt_in,location_city").eq("id", userId).maybeSingle(),
      sb.from("member_threads").select("id,kind,text,salience,surface_after,surfaced_count").eq("user_id", userId).eq("status", "open").lte("surface_after", today).order("salience", { ascending: false }).limit(6),
      sb.from("hard_dates").select("date,label").eq("user_id", userId).gte("date", today).lte("date", new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10)),
      sb.from("daily_checkins").select("checkin_date,hard_day").eq("user_id", userId).order("checkin_date", { ascending: false }).limit(2),
      sb.from("user_clarity_config").select("config").eq("user_id", userId).maybeSingle(),
    ]);
    const prof = profQ.status === "fulfilled" ? profQ.value.data : null;
    const threads = (thQ.status === "fulfilled" && thQ.value.data) || [];
    const hard = (hdQ.status === "fulfilled" && hdQ.value.data) || [];
    const prevCk = (prevQ.status === "fulfilled" && prevQ.value.data) || [];
    const cfg = (cfgQ.status === "fulfilled" && cfgQ.value.data && cfgQ.value.data.config) || {};

    const lastDay = prof && prof.last_active_at ? appDay(new Date(prof.last_active_at)) : null;
    const gap = lastDay == null ? 0 : Math.round((Date.parse(today) - Date.parse(lastDay)) / 86400000);
    const tier = body.tier || returnTier(gap);

    // sequence + spine length by tier (08 §4.3): R0/R1 full · R2/R3 return sequence + shortened · R4 micro
    const sequence = tier === "R4" ? "micro" : (tier === "R2" || tier === "R3") ? "return" : "standard";

    // hard-day aftermath opening (08 §4.4): yesterday flagged hard → open with acknowledgment
    const yd = prevCk.find((c) => c.checkin_date < today);
    const aftermath = !!(yd && yd.hard_day === true && sequence === "standard");

    // framing skin: deterministic per member+day; spine semantics untouched
    const seed = `${userId}:${today}`;
    const framing = {}, framingIds = {};
    for (const field of Object.keys(T.FRAMINGS)) {
      const id = T.pickFraming(field, seed) || T.STATIC_FALLBACK[field];
      framingIds[field] = id;
      framing[field] = T.FRAMINGS[field][id];
    }

    // dynamic items: up to 2, priority threads → hard-date → context color (08 §3b).
    // fuel_opt_out members never receive food-flavored items (bank has none, enforced by test).
    const dynamic = [], ctxItems = [];
    for (const th of threads) {
      if (dynamic.length >= 2) break;
      if (th.surfaced_count >= 2) continue;                      // skipped once → resurfaces once, then rests
      const tid = `thread_${th.kind}`;
      const text = T.fill(T.DYNAMIC[tid] || T.DYNAMIC.thread_commitment, { thread: th.text });
      dynamic.push({ id: tid, text, source: "thread", thread_id: th.id });
      ctxItems.push({ template: tid, slots: { thread: th.text }, thread_id: th.id });
    }
    if (dynamic.length < 2 && hard.length) {
      const h = hard[0];
      dynamic.push({ id: "harddate_before", text: T.fill(T.DYNAMIC.harddate_before, { label: h.label || "A hard date" }), source: "harddate" });
      ctxItems.push({ template: "harddate_before", slots: { label: h.label || "A hard date" } });
    }
    if (dynamic.length < 2 && prof && prof.location_opt_in === true && prof.location_city) {
      dynamic.push({ id: "context_color", text: T.DYNAMIC.context_color, source: "context" });
      ctxItems.push({ template: "context_color", slots: {} });
    }

    // persist the reproduction record + bump surfaced_count on shown threads
    const row = {
      user_id: userId, app_day: today, return_tier: tier,
      framing: framingIds, dynamic_items: dynamic, answered: null,
      checkin_context: { seed, framing: framingIds, items: ctxItems, sequence, aftermath },
    };
    try { await sb.from("checkin_prompts").upsert(row, { onConflict: "user_id,app_day" }); } catch (_) {}
    for (const d of dynamic) {
      emitEvent(sb, userId, "dynamic_item_shown", { source: d.source });
      if (d.thread_id) { try { await sb.from("member_threads").update({ surfaced_count: (threads.find((t) => t.id === d.thread_id).surfaced_count || 0) + 1 }).eq("id", d.thread_id); emitEvent(sb, userId, "thread_surfaced", {}); } catch (_) {} }
    }

    return json(200, {
      framing, dynamic, sequence, aftermath: aftermath ? T.AFTERMATH : false, fallback: false,
      return_seq: sequence !== "standard" ? T.RETURN_SEQ : null,
    });
  } catch (e) {
    console.warn("checkin-prompt compose failed - static fallback:", e.message);
    return json(200, staticPayload());
  }
};
