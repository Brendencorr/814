/**
 * progress-mirror-cron.js - "distance traveled" notes, weekly (memory/recall upgrade #4).
 *
 * Riley holds months of check-ins and session summaries but never contrasts then-vs-now.
 * This cron writes AT MOST one short reflection per member per ~28 days - "a month ago,
 * evenings were white-knuckle; this week they barely came up" - into progress_mirrors.
 * riley-chat surfaces each note ONCE, and only on a calm day (no heavy dates, no low
 * recent mood); surfacing marks shown_at so it can never repeat.
 *
 * Hard guardrails (the Never-Say law is the whole point here):
 *   • Haiku may return {"skip": true} - no note beats a forced one.
 *   • Notes with ANY digits are dropped (no counts, no day-math, no scores).
 *   • violatesNeverSay() (rhythm.js) gates every note - streak/gap/guilt language dies here.
 *   • Members with a level>=2 crisis_log row in the last 14 days are skipped entirely.
 *   • Fail-open per member; a bad member never stops the run.
 *
 * Schedule: netlify.toml [functions."progress-mirror-cron"] = "0 15 * * 1" (Mon 15:00 UTC).
 */
'use strict';

const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const { callClaude } = require("./anthropic-client");
const { MODELS } = require("./model-router");
const { violatesNeverSay } = require("./rhythm");

const MAX_MEMBERS_PER_RUN = 50;
const CADENCE_DAYS = 28;

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

async function mirrorForMember(supabase, userId) {
  // At most one per CADENCE_DAYS.
  const { data: last } = await supabase.from("progress_mirrors").select("id")
    .eq("user_id", userId).gte("created_at", daysAgo(CADENCE_DAYS).toISOString()).limit(1);
  if (last && last.length) return "cadence";

  // Crisis fail-safe: a hard stretch is not the moment for retrospectives.
  const { data: crisis } = await supabase.from("crisis_log").select("id")
    .eq("user_id", userId).gte("level", 2).gte("created_at", daysAgo(14).toISOString()).limit(1);
  if (crisis && crisis.length) return "crisis_skip";

  const { data: checkins } = await supabase.from("daily_checkins")
    .select("checkin_date,mood,energy,sleep_hours,heaviness,hard_day,outside,connection")
    .eq("user_id", userId).gte("checkin_date", iso(daysAgo(42))).order("checkin_date", { ascending: true });
  const rows = checkins || [];
  const cut = iso(daysAgo(14));
  const recent = rows.filter((r) => r.checkin_date >= cut);
  const prior = rows.filter((r) => r.checkin_date < cut);
  if (recent.length < 5 || prior.length < 8) return "thin_data";

  const { data: sums } = await supabase.from("session_summaries").select("summary,emotional_tone,created_at")
    .eq("user_id", userId).gte("created_at", daysAgo(42).toISOString()).order("created_at", { ascending: true }).limit(8);

  const fmt = (r) => `${r.checkin_date}: mood ${r.mood ?? "-"}, energy ${r.energy ?? "-"}, sleep ${r.sleep_hours ?? "-"}, heaviness ${r.heaviness ?? "-"}${r.hard_day ? ", hard day" : ""}${r.outside ? ", got outside" : ""}${r.connection ? ", connected with someone" : ""}`;
  const material = [
    "EARLIER STRETCH (4-6 weeks ago):", ...prior.map(fmt),
    "RECENT STRETCH (last two weeks):", ...recent.map(fmt),
    "CONVERSATION SUMMARIES (oldest first):",
    ...(sums || []).map((s) => `${String(s.created_at).slice(0, 10)}: ${s.summary}${s.emotional_tone ? ` (tone: ${s.emotional_tone})` : ""}`),
  ].join("\n");

  const sys = `You write ONE short "distance traveled" reflection (1-2 sentences, second person, warm, specific) for a wellness companion to share with its member - a genuine then-vs-now observation drawn ONLY from the data below.
HARD RULES:
- NO numbers, counts, scores, or day-math of any kind. No "streak", no "in a row", no mention of gaps, missed days, or how often they showed up. Never guilt, never grades.
- Ground it in something REAL that changed for the better, or genuinely steadied ("evenings used to be the hard part - lately they've barely come up"; "sleep has quietly become something you can count on").
- Plain hyphens only, never em-dashes. No greeting, no sign-off - just the reflection itself.
- If nothing meaningfully improved or steadied, return {"skip": true} - an honest nothing beats a stretched something.
Return ONLY JSON: {"note": "..."} or {"skip": true}.`;

  let raw;
  try {
    const r = await callClaude({ system: sys, messages: [{ role: "user", content: material }], max_tokens: 200, model: MODELS.memory, functionName: "progress-mirror", userId, supabase });
    raw = r.text || "";
  } catch (_) { return "ai_fail"; }
  raw = String(raw).replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
  let out; try { out = JSON.parse(raw); } catch { return "parse_fail"; }
  if (!out || out.skip || !out.note) return "skipped";

  const note = String(out.note).trim().replace(/—|–/g, "-").slice(0, 320);
  if (note.length < 20) return "too_short";
  if (/\d/.test(note)) return "digits_blocked";           // no counts, ever
  if (violatesNeverSay(note)) return "neversay_blocked";  // the tripwire is a wall here

  await supabase.from("progress_mirrors").insert({
    user_id: userId, note, period_start: iso(daysAgo(42)), period_end: iso(new Date()),
  });
  return "written";
}

exports.handler = async function (event) {
  const gate = requireScheduledOrOperator(event); if (gate) return gate;

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: "config" }) }; }

  const result = { written: 0, skipped: 0, blocked: 0, considered: 0 };
  try {
    // Active members with enough history to have a "then".
    const { data: members } = await supabase.from("user_profiles").select("id")
      .eq("onboarding_completed", true)
      .gte("last_active_at", daysAgo(14).toISOString())
      .lte("created_at", daysAgo(28).toISOString())
      .order("last_active_at", { ascending: false }).limit(MAX_MEMBERS_PER_RUN);

    for (const m of members || []) {
      result.considered++;
      try {
        const outcome = await mirrorForMember(supabase, m.id);
        if (outcome === "written") result.written++;
        else if (outcome === "neversay_blocked" || outcome === "digits_blocked") result.blocked++;
        else result.skipped++;
      } catch (e) { result.skipped++; }
    }
  } catch (e) { console.warn("[progress-mirror] run failed:", e.message); }

  try { await supabase.from("system_incidents").insert({ kind: "maintenance_run", function_name: "progress-mirror-cron", detail: result }); } catch (_) {}
  console.log("[progress-mirror] done:", JSON.stringify(result));
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, ...result }) };
};
