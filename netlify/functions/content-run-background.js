/**
 * content-run-background.js - Netlify Background Function (no timeout)
 *
 * The daily content pipeline for Meet Riley, adapted from the n8n spec
 * to run natively on Netlify + Supabase (everything lives in the admin dash).
 *
 * Flow (Phase 1):
 *   Scout (live web search) -> candidates
 *   -> discoverability file (Sage morning mode)
 *   -> reposts: Sentinel gate -> approval_queue (fast-track, skip Sage/Atlas)
 *   -> remix/original: Sage brief -> Sentinel gate -> approval_queue (text; Atlas design = Phase 2)
 *   -> engine_runs log + operator digest
 *
 * Triggered by:
 *   - POST from the dashboard "Run Now" button
 *   - content-daily-cron.js (scheduled 6am MT) which calls runDaily()
 *
 * HARD RULES (from BUILD_SPEC):
 *   - Every queue insert carries a Sentinel verdict - reposts included.
 *   - Nothing publishes without a human approval click (that's a separate function).
 *   - Reposts are native shares/quotes with attribution - never re-uploaded media.
 */

const { contentDb, loadPrompt, callClaude, extractJson, notify, CORS, requireOperator } = require("./content-lib");
const { renderBrief } = require("./content-design"); // grounds render engine (was Canva content-atlas)

const MAX_CANDIDATES = 8; // bound cost/time per run

// Researched best-practice posting windows (Mountain Time, on-brand :14 minute). The
// scheduler agent may steer within these; the allocator guarantees future, non-colliding slots.
const POST_WINDOWS = ["08:14", "12:14", "18:14"];

// Convert a Denver (MT) wall-clock slot `dayOffset` days from today at HH:MM into a UTC ISO
// string (DST-correct via Intl). Returns null on bad input.
function denverSlotToUtcIso(dayOffset, hhmm) {
  try {
    const [hh, mm] = String(hhmm).split(":").map((n) => parseInt(n, 10));
    if (isNaN(hh) || isNaN(mm)) return null;
    const base = new Date(Date.now() + dayOffset * 86400000);
    // the Denver calendar date on that day
    const dp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(base)
      .reduce((a, p) => { a[p.type] = p.value; return a; }, {});
    const y = +dp.year, mo = +dp.month, d = +dp.day;
    // solve for the UTC instant whose Denver wall-clock == y-mo-d hh:mm (offset can shift across DST)
    let guess = Date.UTC(y, mo - 1, d, hh, mm);
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(guess)).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
      const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour === 24 ? 0 : +parts.hour, +parts.minute);
      const offsetMs = asUTC - guess; // how far Denver wall-clock is ahead of this UTC instant
      guess = Date.UTC(y, mo - 1, d, hh, mm) - offsetMs;
    }
    return new Date(guess).toISOString();
  } catch (e) { return null; }
}

// Inline scheduler prompt (kept out of content_prompt_versions to avoid the agent-name CHECK).
const SCHEDULER_SYSTEM = `You are Riley's social scheduling strategist. Given a list of ready-to-publish posts and the best-practice posting windows, recommend WHEN each should go out to maximize reach for a recovery/wellbeing brand (calm, non-urgent). For each post return a day_offset (>=1, days from today) and a time in "HH:MM" 24h Mountain Time chosen from or near the provided windows. Spread posts out - avoid clustering, at most ~1-2 per day, respect already-booked slots. Return ONLY JSON: {"schedule":[{"i":0,"day_offset":1,"time":"08:14"}, ...]} with one entry per post in order.`;

// Map Scout's freeform program/persona strings to our enums (defensive)
const PROGRAMS = ["riley_guide", "riley_companion", "riley_coach", "riley_mentor", "reset_814", "none"];
const PERSONAS = ["griever", "drinker_user", "burnt_out", "stretched", "body_first", "universal"];
const ACTIONS  = ["repost", "remix", "original", "ignore"];
const clean = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

async function runDaily(trigger = "cron") {
  const db = contentDb();
  const today = new Date().toISOString().slice(0, 10);

  // Create run record
  let runId = null;
  try {
    const { data } = await db.from("content_engine_runs")
      .insert({ workflow: "daily_pipeline", status: "running" })
      .select().single();
    runId = data?.id;
  } catch (e) { console.warn("engine_runs insert failed:", e.message); }

  const stats = { signals: 0, candidates: 0, fast_tracked: 0, briefs: 0 };
  const updateRun = async (fields) => {
    if (!runId) return;
    try { await db.from("content_engine_runs").update(fields).eq("id", runId); } catch {}
  };

  try {
    // ── 1. SCOUT (live web search) ──────────────────────────────────────────
    const scoutPrompt = await loadPrompt("scout");
    const scoutRaw = await callClaude({
      system: scoutPrompt,
      user: `Today is ${today}. Search the live web for what is trending and underserved right now across grief/loss, addiction & habit change, burnout & overwhelm, and movement/body-first wellbeing - plus which content formats are trending this week. Return your opportunities JSON.`,
      maxTokens: 4000,
      webSearch: true,
    });
    const scout = extractJson(scoutRaw) || { opportunities: [] };
    const opportunities = Array.isArray(scout.opportunities) ? scout.opportunities : [];

    // Store one signal capturing the raw Scout web-search output (provenance)
    try {
      await db.from("content_signals").insert({
        source: "web_search",
        raw_payload: { scout_output: scout, trigger },
        topic: "daily scout run",
        trend_type: "topic",
      });
      stats.signals = 1;
    } catch (e) { console.warn("signal insert failed:", e.message); }

    // ── 2. Insert candidates (idempotent via unique index) ──────────────────
    const inserted = [];
    for (const o of opportunities.slice(0, 20)) {
      const row = {
        run_date: today,
        source_platform: clean(o.source_platform, ["tiktok","instagram","linkedin","reddit","youtube","x","google_trends","perplexity","web_search"], "web_search"),
        original_url: o.original_url || null,
        original_creator: o.original_creator || null,
        topic: (o.topic || "untitled").slice(0, 200),
        trend_type: clean(o.trend_type, ["audio","format","hook","question","meme","news","search_query","topic"], "topic"),
        engagement_signal: clean(o.engagement_signal, ["high","medium","low"], "medium"),
        brand_fit_score: Math.max(1, Math.min(100, parseInt(o.brand_fit_score, 10) || 50)),
        repost_safe: o.repost_safe === true,
        recommended_action: clean(o.recommended_action, ACTIONS, "ignore"),
        why_it_matters: o.why_it_matters || null,
        suggested_program: clean(o.suggested_program, PROGRAMS, "none"),
        suggested_persona: clean(o.suggested_persona, PERSONAS, "universal"),
        status: "new",
      };
      // upsert on the dedupe key; ignore duplicates from same day
      const { data, error } = await db.from("content_candidates")
        .upsert(row, { onConflict: "run_date,topic", ignoreDuplicates: true })
        .select();
      if (!error && data && data[0]) inserted.push(data[0]);
    }
    stats.candidates = inserted.length;
    await updateRun({ signals_count: stats.signals, candidates_count: stats.candidates });

    // ── 3. Discoverability file (Sage morning mode) ─────────────────────────
    try {
      const morningPrompt = await loadPrompt("sage_morning");
      const summary = opportunities.map((o) => `- ${o.topic} (${o.trend_type}, ${o.engagement_signal})`).join("\n");
      const discRaw = await callClaude({
        system: morningPrompt,
        user: `Today is ${today}. Today's Scout signals:\n${summary}\n\nGenerate today's discoverability file JSON.`,
        maxTokens: 1500,
      });
      const disc = extractJson(discRaw);
      if (disc) {
        await db.from("content_daily_discoverability").upsert({
          run_date: today,
          primary_keywords: disc.primary_keywords_today || [],
          secondary_keywords: disc.secondary_keywords || [],
          platform_hashtags: disc.platform_hashtags || {},
          caption_hooks: disc.caption_hooks || [],
          trends_validated: disc.trends_validated === true,
        }, { onConflict: "run_date" });
      }
    } catch (e) { console.warn("discoverability failed (non-fatal):", e.message); }

    // ── 4. Process candidates ────────────────────────────────────────────────
    const sentinelPrompt = await loadPrompt("sentinel");
    const sagePrompt = await loadPrompt("sage");

    // template families for Sage context
    const { data: templates } = await db.from("content_template_library")
      .select("slug, family_name, asset_type, use_case").eq("active", true);
    const templateList = (templates || []).map((t) => `${t.slug} (${t.family_name}, ${t.asset_type}): ${t.use_case}`).join("\n");
    const { data: discRow } = await db.from("content_daily_discoverability").select("*").eq("run_date", today).single();
    const { data: learnRows } = await db.from("content_learnings").select("digest").order("created_at", { ascending: false }).limit(1);
    const learnings = (learnRows && learnRows[0] && learnRows[0].digest) || "";

    // Sort: reposts first, then by brand_fit_score
    const toProcess = inserted
      .filter((c) => c.recommended_action !== "ignore")
      .sort((a, b) => (b.brand_fit_score || 0) - (a.brand_fit_score || 0))
      .slice(0, MAX_CANDIDATES);

    const ctx = { sagePrompt, sentinelPrompt, discRow, templateList, learnings };
    const builtItems = []; // {queueId, platform, topic, format, blocked} - fed to the scheduler

    for (const c of toProcess) {
      // ── REPOST fast-track ──────────────────────────────────────────────────
      if (c.recommended_action === "repost" && c.repost_safe && c.original_url) {
        const verdict = await runSentinel(sentinelPrompt, {
          kind: "repost",
          original_url: c.original_url,
          original_creator: c.original_creator,
          topic: c.topic,
          why: c.why_it_matters,
        });
        const platform = c.source_platform === "web_search" ? "instagram" : c.source_platform;
        const blocked = verdict.verdict === "block";
        const { data: q } = await db.from("content_approval_queue").insert({
          kind: "repost",
          candidate_id: c.id,
          platforms: [platform].filter(Boolean),
          preview_caption: `Repost: ${c.topic}\nvia ${c.original_creator || "creator"} - ${c.why_it_matters || ""}`,
          original_url: c.original_url,
          original_creator: c.original_creator,
          safety_verdict: verdict.verdict,
          safety_flags: verdict.flags || [],
          status: blocked ? "pending" : "designed", // reposts also land in the daily Review
        }).select().single();
        await db.from("content_candidates").update({ status: "fast_tracked" }).eq("id", c.id);
        stats.fast_tracked++;
        if (q && !blocked) builtItems.push({ queueId: q.id, platform: platform || "instagram", topic: c.topic, format: "post", blocked: false });
        continue;
      }

      // ── REMIX / ORIGINAL → fully build the post (Sage brief → design → queue) ──
      const built = await buildPostFromCandidate(db, c, ctx);
      if (built) { stats.briefs++; builtItems.push(built); }
    }

    // ── Assign agent-researched, non-colliding future schedule times ──────────
    await assignSchedules(db, builtItems.filter((b) => b && !b.blocked));

    await updateRun({
      status: "success",
      fast_tracked_count: stats.fast_tracked,
      briefs_count: stats.briefs,
      finished_at: new Date().toISOString(),
    });

    await notify(`Content run complete (${trigger}) - ${stats.candidates} candidates, ${stats.fast_tracked} reposts fast-tracked, ${stats.briefs} briefs. Review at admin.meetriley.us → Social Media → Review.`);
    return { ok: true, stats };

  } catch (err) {
    console.error("[content-run] fatal:", err.message);
    await updateRun({ status: "failed", error_detail: err.message, finished_at: new Date().toISOString() });
    await notify(`⚠ Content run FAILED (${trigger}): ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Sentinel gate - always returns a verdict object {verdict, flags}
async function runSentinel(sentinelPrompt, payload) {
  try {
    const raw = await callClaude({
      system: sentinelPrompt,
      user: `Review this content unit for the queue:\n${JSON.stringify(payload, null, 2)}\n\nReturn your verdict JSON.`,
      maxTokens: 1000,
    });
    const v = extractJson(raw);
    if (v && ["pass", "flag", "block"].includes(v.verdict)) {
      return { verdict: v.verdict, flags: Array.isArray(v.flags) ? v.flags : [] };
    }
  } catch (e) { console.warn("Sentinel failed, defaulting to flag:", e.message); }
  // Fail safe: if Sentinel errors, FLAG for human review (never silently pass)
  return { verdict: "flag", flags: [{ rule: "sentinel_error", severity: "flag", evidence: "Sentinel could not evaluate", suggested_fix: "Manual review required" }] };
}

// Build ONE complete post from a candidate: Sage brief → design (grounds) → Sentinel →
// approval_queue row (status 'designed' unless Sentinel blocks). Shared by the daily run
// AND the regenerate action. Returns {queueId, platform, topic, format, blocked} or null.
async function buildPostFromCandidate(db, c, ctx) {
  const briefRaw = await callClaude({
    system: ctx.sagePrompt,
    user: `CANDIDATE:\n${JSON.stringify({ topic: c.topic, why: c.why_it_matters, action: c.recommended_action, persona: c.suggested_persona, program: c.suggested_program, source: c.source_platform, url: c.original_url }, null, 2)}\n\nTODAY'S DISCOVERABILITY:\n${JSON.stringify(ctx.discRow || {}, null, 2)}\n\nAVAILABLE TEMPLATE FAMILIES:\n${ctx.templateList}\n\n${ctx.learnings ? "RECENT PERFORMANCE LEARNINGS (weight toward what has worked):\n" + ctx.learnings + "\n\n" : ""}Write the brief JSON.`,
    maxTokens: 2000,
  });
  const brief = extractJson(briefRaw);
  if (!brief || brief.decision === "ignore") {
    await db.from("content_candidates").update({ status: "ignored" }).eq("id", c.id);
    return null;
  }
  const asset_types = Array.isArray(brief.asset_types) && brief.asset_types.length ? brief.asset_types : ["static"];
  const platforms = Array.isArray(brief.platforms) && brief.platforms.length ? brief.platforms : ["instagram"];
  const kind = clean(brief.decision, ["remix", "original"], "original");
  const { data: briefRow } = await db.from("content_briefs").insert({
    candidate_id: c.id,
    decision: kind,
    headline_hook: brief.headline_hook || c.topic,
    caption: brief.caption || "",
    cta: brief.cta || null,
    program_tie: clean(brief.program_tie, PROGRAMS, "none"),
    persona: clean(brief.persona, PERSONAS, "universal"),
    seo_keywords: brief.seo_keywords || [],
    hashtags: brief.hashtags || {},
    template_family: brief.template_family || null,
    asset_types,
    platforms,
    design_notes: brief.design_notes || null,
    sage_score: brief.sage_score || null,
    safety_prefilter: brief.safety_prefilter || [],
    status: "ready_for_atlas",
  }).select().single();
  await db.from("content_candidates").update({ status: "sent_to_sage" }).eq("id", c.id);

  // Design the post now (grounds engine, non-fatal - a failure just leaves it text-only for Review)
  let assetIds = [];
  try {
    const design = await renderBrief(briefRow.id);
    if (design.designed) assetIds = design.assets.map((a) => a.id);
  } catch (e) { console.warn("design render failed (non-fatal):", e.message); }

  const verdict = await runSentinel(ctx.sentinelPrompt, {
    kind: brief.decision, caption: brief.caption, hook: brief.headline_hook, cta: brief.cta, hashtags: brief.hashtags,
  });
  const blocked = verdict.verdict === "block";
  const { data: q } = await db.from("content_approval_queue").insert({
    kind,
    candidate_id: c.id,
    brief_id: briefRow?.id || null,
    asset_ids: assetIds,
    platforms,
    preview_caption: brief.caption || "",
    safety_verdict: verdict.verdict,
    safety_flags: verdict.flags || [],
    status: blocked ? "pending" : "designed", // pass/flag → daily Review; block → needs attention
  }).select().single();
  if (!q) return null;
  return { queueId: q.id, platform: platforms[0] || "instagram", topic: c.topic, format: asset_types.includes("story") ? "story" : "post", blocked };
}

// Assign each post an agent-researched, future, non-colliding scheduled_for (Mountain Time
// windows). The LLM only recommends; a deterministic allocator guarantees a valid open slot.
async function assignSchedules(db, items) {
  if (!items || !items.length) return;
  const nowMs = Date.now();
  const booked = new Set();
  try {
    const nowIso = new Date(nowMs).toISOString();
    const q = await db.from("content_approval_queue").select("scheduled_for").not("scheduled_for", "is", null).gte("scheduled_for", nowIso);
    (q.data || []).forEach((r) => booked.add(new Date(r.scheduled_for).toISOString().slice(0, 16)));
    const j = await db.from("content_publishing_jobs").select("scheduled_for").not("scheduled_for", "is", null).gte("scheduled_for", nowIso);
    (j.data || []).forEach((r) => booked.add(new Date(r.scheduled_for).toISOString().slice(0, 16)));
  } catch (e) { console.warn("booked-times fetch failed:", e.message); }

  let recs = [];
  try {
    const raw = await callClaude({
      system: SCHEDULER_SYSTEM,
      user: `Today: ${new Date().toISOString().slice(0, 10)}. Best-practice windows (MT): ${POST_WINDOWS.join(", ")}. Posts to schedule (in order):\n${items.map((it, i) => `${i}. ${it.format} on ${it.platform}: ${it.topic}`).join("\n")}\n\nReturn the schedule JSON.`,
      maxTokens: 800,
    });
    const parsed = extractJson(raw);
    if (parsed && Array.isArray(parsed.schedule)) recs = parsed.schedule;
  } catch (e) { console.warn("scheduler agent failed, using default windows:", e.message); }

  for (let i = 0; i < items.length; i++) {
    const rec = recs.find((r) => r && r.i === i) || recs[i] || {};
    const preferTime = /^\d{1,2}:\d{2}$/.test(rec.time || "") ? rec.time : null;
    const startDay = Math.max(1, parseInt(rec.day_offset, 10) || 1);
    let slot = null;
    for (let d = startDay; d <= 45 && !slot; d++) {
      const windows = preferTime ? [preferTime, ...POST_WINDOWS] : POST_WINDOWS;
      for (const w of windows) {
        const iso = denverSlotToUtcIso(d, w);
        if (!iso) continue;
        const key = iso.slice(0, 16);
        if (!booked.has(key) && new Date(iso).getTime() > nowMs + 3600000) { slot = iso; booked.add(key); break; }
      }
    }
    if (slot) { try { await db.from("content_approval_queue").update({ scheduled_for: slot }).eq("id", items[i].queueId); } catch {} }
  }
}

// Load the shared build context (prompts + today's discoverability/templates/learnings).
async function loadCtx(db) {
  const today = new Date().toISOString().slice(0, 10);
  const [sagePrompt, sentinelPrompt] = await Promise.all([loadPrompt("sage"), loadPrompt("sentinel")]);
  const { data: templates } = await db.from("content_template_library").select("slug, family_name, asset_type, use_case").eq("active", true);
  const templateList = (templates || []).map((t) => `${t.slug} (${t.family_name}, ${t.asset_type}): ${t.use_case}`).join("\n");
  const { data: discRow } = await db.from("content_daily_discoverability").select("*").eq("run_date", today).single();
  const { data: learnRows } = await db.from("content_learnings").select("digest").order("created_at", { ascending: false }).limit(1);
  const learnings = (learnRows && learnRows[0] && learnRows[0].digest) || "";
  return { sagePrompt, sentinelPrompt, discRow, templateList, learnings };
}

// Regenerate one Review item from its candidate (Send back to editing): build a fresh
// post (new copy + design + schedule) and retire the old queue row.
async function regenerateItem(db, item) {
  const { data: c } = await db.from("content_candidates").select("*").eq("id", item.candidate_id).single();
  if (!c) return { ok: false, reason: "candidate not found" };
  const ctx = await loadCtx(db);
  const built = await buildPostFromCandidate(db, c, ctx);
  if (!built) return { ok: false, reason: "regeneration produced no post (Sage ignored it)" };
  if (!built.blocked) await assignSchedules(db, [built]);
  await db.from("content_approval_queue").update({ status: "revise", reviewer_note: "regenerated", reviewed_at: new Date().toISOString() }).eq("id", item.id);
  return { ok: true, newQueueId: built.queueId };
}

exports.buildPostFromCandidate = buildPostFromCandidate;
exports.assignSchedules = assignSchedules;
exports.regenerateItem = regenerateItem;

// ══════════════════════════════════════════════════════════════════════════════
// LAUNCH CAMPAIGN - a curated 2-week, all-Riley sequence (28 posts, 2/day). Seeded
// on demand into the Review queue, fully designed + pre-scheduled. This replaces the
// randomized web pipeline during launch (pause the daily cron for the 2 weeks).
// hook = on-image headline (gold period lands if it ends in "."); caption = post text
// (hyphens only, no em-dashes); ground = the chosen template background.
// ══════════════════════════════════════════════════════════════════════════════
const LAUNCH = [
  { slug: "meet-riley", hook: "I'm Riley.", ground: "dawn", persona: "universal", caption: "No appointments. No judgment. No starting over. I'm Riley - a companion for the messy middle of rebuilding a life. Meet me, free. meetriley.us" },
  { slug: "start-where-you-are", hook: "Start where you are.", ground: "first-light", persona: "universal", caption: "You don't need a rock bottom or a diagnosis to begin. Start where you are - Riley will meet you there. Free, forever. meetriley.us" },
  { slug: "why-814", hook: "Why 8:14?", ground: "dawn", persona: "universal", program_tie: "reset_814", caption: "It started with a little boy and his watch. 8:14 is the minute the light comes back - and it lives in everything we make. Ask Riley about it sometime." },
  { slug: "the-minute", hook: "8:14 - the minute the light comes back.", ground: "dawn", persona: "universal", program_tie: "reset_814", caption: "Some stories are better discovered. This one is ours. meetriley.us" },
  { slug: "no-label", hook: "Not sure if you have a problem? Good.", ground: "first-light", persona: "drinker_user", caption: "That's exactly who this is for. No labels required. No rock bottom either. The door doesn't check. meetriley.us" },
  { slug: "no-appointments", hook: "No appointments. No judgment.", ground: "veil", persona: "universal", caption: "Talk to Riley at 2pm or 2am. No waiting rooms, no forms, no judgment - just a companion who is already there. meetriley.us" },
  { slug: "riley-remembers", hook: "Riley remembers.", ground: "first-light", persona: "universal", caption: "Not your data. Your story - the way a friend would. No starting over every conversation. Come be known. meetriley.us" },
  { slug: "known-not-tracked", hook: "Known is different from tracked.", ground: "first-light", persona: "universal", caption: "One feels like a system. The other feels like a friend. Riley is the second one." },
  { slug: "reset-free", hook: "The 8:14 Reset is free, forever.", ground: "dawn", persona: "universal", program_tie: "reset_814", caption: "Seven days. One small light at a time. A quiet way to begin - no card, no trial clock. meetriley.us" },
  { slug: "one-small-action", hook: "One small action every morning.", ground: "first-blush", persona: "universal", program_tie: "reset_814", caption: "Not a life overhaul. One thing, done quietly, before the day gets loud. That's the whole Reset." },
  { slug: "on-grief", hook: "Grief doesn't follow a schedule.", ground: "veil", persona: "griever", caption: "Six weeks, six months, six years. It takes what it takes. Whenever you want to talk - Riley listens." },
  { slug: "doing-this-right", hook: "You don't have to be okay to be doing this right.", ground: "first-light", persona: "griever", caption: "Showing up to the day counts. Even quietly. Even barely." },
  { slug: "earn-rest", hook: "You don't have to earn rest.", ground: "first-light", persona: "burnt_out", caption: "Rest isn't a reward for finishing. It's part of how anything gets finished. Put some of it down - Riley can help you sort what's yours to carry." },
  { slug: "not-lazy", hook: "You're not lazy. You're depleted.", ground: "parchment", persona: "burnt_out", caption: "One needs judgment. The other needs rest. Be honest about which one this is." },
  { slug: "slip-moment", hook: "A slip is a moment. Not an identity.", ground: "veil", persona: "drinker_user", caption: "What matters most is the next hour - not the story you're telling yourself about the last one. No judgment here. There never was." },
  { slug: "come-back", hook: "Come back. That's the whole assignment.", ground: "dawn", persona: "drinker_user", caption: "Today can still count. It usually does." },
  { slug: "movement", hook: "Movement isn't punishment.", ground: "first-light", persona: "body_first", caption: "It's a way of being on your own side. No scale. No before-and-after. Just a body that carried you this far." },
  { slug: "eight-minutes", hook: "Eight minutes is enough to begin.", ground: "first-blush", persona: "body_first", caption: "A stretch counts. A walk counts. Showing up counts. Start where you are." },
  { slug: "rebuild", hook: "Rebuild your life. One day at a time.", ground: "dawn", persona: "drinker_user", caption: "You don't build a life all at once. You build a day you can live with. Then another." },
  { slug: "continuing", hook: "You're not starting over. You're continuing.", ground: "first-light", persona: "universal", caption: "And you don't have to do it alone. meetriley.us" },
  { slug: "riley-awake", hook: "Riley is awake.", ground: "veil", persona: "universal", caption: "For the 3am thinkers: think out loud. It takes half the weight away. Riley is already there." },
  { slug: "2am-lies", hook: "At 2am, everything lies.", ground: "first-light", persona: "griever", caption: "Wait for morning. Then decide. And if you don't want to wait alone - Riley is awake too." },
  { slug: "testimonial-casey", hook: "“It felt like talking to someone who understood.”", ground: "parchment", persona: "universal", caption: "“Within 10 minutes it shifted my perspective and calmed my stress... It felt like talking to someone who genuinely understood. I walked away lighter, calmer, and grounded.” - Casey K." },
  { slug: "come-be-known", hook: "Come be known.", ground: "dawn", persona: "universal", caption: "Free, forever. No appointments. No judgment. Just a companion who remembers. meetriley.us" },
  { slug: "days-add-up", hook: "Days add up quietly.", ground: "dawn", persona: "universal", caption: "You don't build a life all at once. Counted one morning at a time - through hard days too." },
  { slug: "today-counts", hook: "Today counts.", ground: "first-light", persona: "universal", caption: "That's the whole math. Riley keeps count with you - never over you." },
  { slug: "speak-kindly", hook: "Speak to yourself like someone worth rebuilding.", ground: "framed", persona: "universal", caption: "Language is how you treat yourself in sentences. Choose the kind ones. Riley always will." },
  { slug: "meet-riley-free", hook: "Meet Riley, free.", ground: "dawn", persona: "universal", caption: "Start where you are. Riley will meet you there. Free, forever. meetriley.us" },
];

// Seed the 2-week launch campaign: 28 curated posts, designed + scheduled 2/day (08:14
// + 18:14 MT) starting tomorrow, dropped into Review (status 'designed'). Idempotent.
async function seedLaunch(db, { force = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    // Guard on the actual OUTPUT (a built launch brief), not candidates - candidates can
    // exist from a failed prior attempt while nothing downstream was created.
    const { data: existing } = await db.from("content_briefs").select("id").ilike("design_notes", "launch:%").limit(1);
    if (existing && existing.length && !force) {
      return { ok: true, skipped: true, reason: "Launch campaign already seeded. Pass force:true to re-seed." };
    }
  } catch (e) { /* proceed */ }

  let seeded = 0;
  for (let i = 0; i < LAUNCH.length; i++) {
    const p = LAUNCH[i];
    try {
      const { data: cand } = await db.from("content_candidates").upsert({
        run_date: today, source_platform: "web_search", topic: `Launch: ${p.slug}`,
        trend_type: "topic", engagement_signal: "high", brand_fit_score: 100, repost_safe: false,
        recommended_action: "original", why_it_matters: "Riley 2-week launch campaign",
        suggested_program: p.program_tie || "none", suggested_persona: p.persona || "universal", status: "fast_tracked",
      }, { onConflict: "run_date,topic" }).select().single();

      const { data: brief } = await db.from("content_briefs").insert({
        candidate_id: cand ? cand.id : null, decision: "original",
        headline_hook: p.hook, caption: p.caption, cta: null,
        program_tie: p.program_tie || "none", persona: p.persona || "universal",
        seo_keywords: [], hashtags: {}, template_family: null, asset_types: ["static"],
        platforms: ["instagram", "facebook"], design_notes: `launch:${p.slug} ground:${p.ground}`,
        sage_score: null, safety_prefilter: [], status: "ready_for_atlas",
      }).select().single();
      if (!brief) continue;

      let assetIds = [];
      try {
        const d = await renderBrief(brief.id, { override: { ground: p.ground } });
        if (d.designed) assetIds = d.assets.map((a) => a.id);
      } catch (e) { console.warn("launch render failed (non-fatal):", p.slug, e.message); }

      // 2/day: post i -> day floor(i/2)+1 (starting tomorrow), AM=08:14 / PM=18:14 MT
      const day = Math.floor(i / 2) + 1;
      const scheduledFor = denverSlotToUtcIso(day, i % 2 === 0 ? "08:14" : "18:14");

      await db.from("content_approval_queue").insert({
        kind: "original", candidate_id: cand ? cand.id : null, brief_id: brief.id,
        asset_ids: assetIds, platforms: ["instagram", "facebook"], preview_caption: p.caption,
        safety_verdict: "pass", safety_flags: [], status: "designed", scheduled_for: scheduledFor,
      });
      seeded++;
    } catch (e) { console.error("launch seed item failed:", p.slug, e.message); }
  }
  await notify(`Launch campaign seeded: ${seeded}/${LAUNCH.length} posts designed + scheduled (2/day). Review at admin.meetriley.us → Social Media → Review.`);
  return { ok: true, seeded, total: LAUNCH.length };
}

// ── HTTP handler (background function, manual trigger) ─────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const _gate = requireOperator(event); if (_gate) return _gate;
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const done = (result) => ({ statusCode: result.ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(result) });
  if (body.mode === "launch") return done(await seedLaunch(contentDb(), { force: body.force === true }));
  return done(await runDaily(event.httpMethod === "POST" ? "manual" : "cron"));
};

exports.runDaily = runDaily;
exports.seedLaunch = seedLaunch;
