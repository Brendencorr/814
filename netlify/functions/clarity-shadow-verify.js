/**
 * clarity-shadow-verify.js — Clarity v2.2, Phase A.5 gate (READ-ONLY).
 *
 * Operator-only. For every active member it recomputes the v2 score from their real
 * stored signals (reusing the EXACT gather+math the live dark write uses, in dryRun so
 * NOTHING is written) and compares it to their live v1 clarity_score. Returns a
 * distribution report so we can eyeball v1-vs-v2 on real rows BEFORE building the
 * onboarding/cutover on top. Persists nothing; safe to run any time.
 *
 * GET/POST /.netlify/functions/clarity-shadow-verify  (operator key required)
 *   ?limit=200  cap members swept (default 300)
 *   ?detail=1   include the per-member rows (else summary only)
 */

'use strict';

const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { gatherSignals, _appDay } = require("./state-engine");
const { writeClarityV2Dark } = require("./clarity-v2-write");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (statusCode, data) => ({ statusCode, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) });
const isNum = (x) => typeof x === "number" && !isNaN(x);
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = (arr) => (arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10 : null);

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireOperator(event);
  if (gate) return gate;

  const qs = event.queryStringParameters || {};
  const limit = Math.min(1000, Math.max(1, parseInt(qs.limit, 10) || 300));
  const detail = qs.detail === "1" || qs.detail === "true";

  let supabase;
  try { supabase = getSupabaseClient(); } catch (e) { return json(500, { error: "Server configuration error" }); }

  // Members with a state row in the last 3 days = the active cohort worth comparing.
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 3);
  let states;
  try {
    const { data } = await supabase.from("user_daily_state")
      .select("user_id,date,clarity_score,clarity_v2")
      .gte("date", since.toISOString().slice(0, 10))
      .order("date", { ascending: false });
    states = data || [];
  } catch (e) { return json(500, { error: "state read failed: " + e.message }); }

  // Keep each member's most-recent state row.
  const byUser = {};
  for (const r of states) { if (!byUser[r.user_id]) byUser[r.user_id] = r; }
  const userIds = Object.keys(byUser).slice(0, limit);

  const rows = [];
  const errors = [];
  // Bounded concurrency so a big cohort doesn't hammer the DB.
  const CHUNK = 8;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const batch = userIds.slice(i, i + CHUNK);
    await Promise.all(batch.map(async (uid) => {
      const stateRow = byUser[uid];
      try {
        let tz = "America/Denver";
        try { const { data: p } = await supabase.from("user_profiles").select("timezone").eq("id", uid).maybeSingle(); if (p && p.timezone) tz = p.timezone; } catch (_) {}
        const today = _appDay(tz);
        const [sig, prevRes] = await Promise.all([
          gatherSignals(supabase, uid),
          supabase.from("user_daily_state").select("*").eq("user_id", uid).lte("date", today).order("date", { ascending: false }).limit(1),
        ]);
        const prev = (prevRes && prevRes.data && prevRes.data[0]) || null;
        const v2 = await writeClarityV2Dark(supabase, uid, { today, prev, sig, dryRun: true });
        if (!v2) { rows.push({ uid, v1: stateRow.clarity_score, v2: null, note: "no v2 signals" }); return; }
        rows.push({
          uid, v1: stateRow.clarity_score, v2: v2.displayed, F: v2.F, P: v2.P, D: v2.D,
          provisional: v2.provisional, frozen: v2.frozen,
          diff: (isNum(v2.displayed) && isNum(stateRow.clarity_score)) ? v2.displayed - stateRow.clarity_score : null,
          coverage: v2.breakdown && v2.breakdown.coverage,
        });
      } catch (e) { errors.push({ uid, error: e.message }); }
    }));
  }

  const scored = rows.filter((r) => isNum(r.v2));
  const diffs = scored.filter((r) => isNum(r.diff)).map((r) => r.diff);
  const absDiffs = diffs.map((d) => Math.abs(d));
  const v1s = scored.filter((r) => isNum(r.v1)).map((r) => r.v1);
  const v2s = scored.map((r) => r.v2);

  const summary = {
    cohort: userIds.length,
    v2_computed: scored.length,
    provisional: scored.filter((r) => r.provisional).length,
    frozen: scored.filter((r) => r.frozen).length,
    no_signals: rows.length - scored.length,
    errors: errors.length,
    v1: { mean: mean(v1s), p50: pct(v1s, 0.5) },
    v2: { mean: mean(v2s), p50: pct(v2s, 0.5) },
    diff_v2_minus_v1: { mean: mean(diffs), p10: pct(diffs, 0.1), p50: pct(diffs, 0.5), p90: pct(diffs, 0.9) },
    abs_diff: { mean: mean(absDiffs), p50: pct(absDiffs, 0.5), p90: pct(absDiffs, 0.9), over20: absDiffs.filter((d) => d > 20).length },
  };

  return json(200, detail ? { summary, rows, errors } : { summary, errors: errors.slice(0, 10) });
};
