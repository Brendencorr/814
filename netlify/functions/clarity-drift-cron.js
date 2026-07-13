/**
 * clarity-drift-cron.js — Clarity v2.2, Phase D monitoring (scheduled).
 *
 * Monthly. Reads the last 90 days of v2 scores across the member base and records a
 * distribution snapshot + validation signals to clarity_monitoring:
 *   • distribution: n, mean, p10/50/90, provisional/frozen rates, mean F/P/D
 *   • WHO-5 convergent validity: Pearson r between same-day WHO-5 and clarity_v2
 *   • perceived-direction: agreement between the weekly "lighter/same/heavier" and Direction
 *   • drift flags: month-over-month mean shift or provisional spike
 * Correlations return null until there's enough paired data (pre-launch = mostly nulls,
 * by design). READ-heavy, writes one row. Gated + fail-open; never touches member state.
 *
 * GET/POST /.netlify/functions/clarity-drift-cron  (Netlify scheduler or operator key)
 */
'use strict';

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Content-Type": "application/json" };
const json = (statusCode, data) => ({ statusCode, headers: CORS, body: JSON.stringify(data) });
const isNum = (x) => typeof x === "number" && !isNaN(x);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function pearson(xs, ys) {
  const n = xs.length; if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const d = Math.sqrt(sxx * syy); return d ? Math.round((sxy / d) * 100) / 100 : null;
}
const dateOf = (ts) => (typeof ts === "string" ? ts.slice(0, 10) : null);

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireScheduledOrOperator(event);
  if (gate) return gate;

  let sb;
  try { sb = getSupabaseClient(); } catch (e) { return json(500, { error: "Server configuration error" }); }

  const WINDOW = 90;
  const since = new Date(); since.setUTCDate(since.getUTCDate() - WINDOW);
  const sinceISO = since.toISOString().slice(0, 10);
  const runOn = new Date().toISOString().slice(0, 10);

  try {
    // ── v2 distribution over the window ──
    const { data: rows } = await sb.from("user_daily_state")
      .select("user_id,date,clarity_v2,f_score,p_score,d_score,provisional,frozen")
      .not("clarity_v2", "is", null).gte("date", sinceISO);
    const R = rows || [];
    const scores = R.filter((r) => isNum(r.clarity_v2)).map((r) => r.clarity_v2);
    const dist = {
      n: R.length,
      mean: round1(mean(scores)), p10: pct(scores, 0.1), p50: pct(scores, 0.5), p90: pct(scores, 0.9),
      provisional_rate: R.length ? Math.round(R.filter((r) => r.provisional).length / R.length * 100) / 100 : null,
      frozen_rate: R.length ? Math.round(R.filter((r) => r.frozen).length / R.length * 100) / 100 : null,
      f_mean: round1(mean(R.filter((r) => isNum(r.f_score)).map((r) => r.f_score))),
      p_mean: round1(mean(R.filter((r) => isNum(r.p_score)).map((r) => r.p_score))),
      d_mean: round1(mean(R.filter((r) => isNum(r.d_score)).map((r) => r.d_score))),
    };
    // Index v2 by user|date for joins.
    const v2By = {}; R.forEach((r) => { if (isNum(r.clarity_v2)) v2By[r.user_id + "|" + r.date] = r; });

    // ── WHO-5 convergent validity (same-day) ──
    let who5_r = null, who5_n = 0;
    try {
      const { data: who } = await sb.from("who5_scores").select("user_id,score,taken_at").gte("taken_at", sinceISO);
      const xs = [], ys = [];
      (who || []).forEach((w) => { const k = w.user_id + "|" + dateOf(w.taken_at); const s = v2By[k]; if (s && isNum(w.score)) { xs.push(w.score); ys.push(s.clarity_v2); } });
      who5_n = xs.length; if (who5_n >= 20) who5_r = pearson(xs, ys);
    } catch (e) {}

    // ── perceived-direction agreement (weekly self-report vs Direction) ──
    let perceived_agreement = null, perceived_n = 0;
    try {
      const { data: wk } = await sb.from("clarity_weekly").select("user_id,week_of,perceived").gte("week_of", sinceISO);
      let match = 0, tot = 0;
      (wk || []).forEach((w) => {
        const s = v2By[w.user_id + "|" + w.week_of]; if (!s || !isNum(s.d_score) || !w.perceived) return;
        const self = w.perceived === "lighter" ? 1 : w.perceived === "heavier" ? -1 : 0;
        const dir = s.d_score > 55 ? 1 : s.d_score < 45 ? -1 : 0;
        tot++; if (self === dir) match++;
      });
      perceived_n = tot; if (tot >= 20) perceived_agreement = Math.round(match / tot * 100) / 100;
    } catch (e) {}

    // ── drift flags vs the previous run ──
    const drift_flags = [];
    try {
      const { data: prevRun } = await sb.from("clarity_monitoring").select("metrics").order("run_on", { ascending: false }).limit(1);
      const prev = prevRun && prevRun[0] && prevRun[0].metrics;
      if (prev && prev.dist) {
        if (isNum(prev.dist.mean) && isNum(dist.mean) && Math.abs(dist.mean - prev.dist.mean) >= 8) drift_flags.push("mean_shift:" + (dist.mean - prev.dist.mean).toFixed(1));
        if (isNum(prev.dist.provisional_rate) && isNum(dist.provisional_rate) && (dist.provisional_rate - prev.dist.provisional_rate) >= 0.15) drift_flags.push("provisional_spike");
      }
    } catch (e) {}

    const metrics = { dist, validity: { who5_r, who5_n, perceived_agreement, perceived_n }, drift_flags };

    try { await sb.from("clarity_monitoring").insert({ run_on: runOn, window_days: WINDOW, metrics }); }
    catch (e) { console.warn("clarity-drift insert failed (non-fatal):", e.message); }

    return json(200, { ok: true, run_on: runOn, metrics });
  } catch (e) {
    console.warn("clarity-drift-cron failed (non-fatal):", e.message);
    return json(200, { ok: false, error: e.message });
  }
};
