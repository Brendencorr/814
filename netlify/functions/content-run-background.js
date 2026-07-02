/**
 * content-run-background.js — Netlify Background Function (no timeout)
 *
 * The daily content pipeline for The 8:14 Project, adapted from the n8n spec
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
 *   - Every queue insert carries a Sentinel verdict — reposts included.
 *   - Nothing publishes without a human approval click (that's a separate function).
 *   - Reposts are native shares/quotes with attribution — never re-uploaded media.
 */

const { contentDb, loadPrompt, callClaude, extractJson, notify, CORS } = require("./content-lib");
const { renderBrief } = require("./content-atlas");

const MAX_CANDIDATES = 8; // bound cost/time per run

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
      user: `Today is ${today}. Search the live web for what is trending and underserved right now across grief/loss, addiction & habit change, burnout & overwhelm, and movement/body-first wellbeing — plus which content formats are trending this week. Return your opportunities JSON.`,
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

    // Sort: reposts first, then by brand_fit_score
    const toProcess = inserted
      .filter((c) => c.recommended_action !== "ignore")
      .sort((a, b) => (b.brand_fit_score || 0) - (a.brand_fit_score || 0))
      .slice(0, MAX_CANDIDATES);

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
        await db.from("content_approval_queue").insert({
          kind: "repost",
          candidate_id: c.id,
          platforms: [c.source_platform === "web_search" ? "instagram" : c.source_platform].filter(Boolean),
          preview_caption: `Repost: ${c.topic}\nvia ${c.original_creator || "creator"} — ${c.why_it_matters || ""}`,
          original_url: c.original_url,
          original_creator: c.original_creator,
          safety_verdict: verdict.verdict,
          safety_flags: verdict.flags || [],
        });
        await db.from("content_candidates").update({ status: "fast_tracked" }).eq("id", c.id);
        stats.fast_tracked++;
        continue;
      }

      // ── REMIX / ORIGINAL → Sage brief ──────────────────────────────────────
      const briefRaw = await callClaude({
        system: sagePrompt,
        user: `CANDIDATE:\n${JSON.stringify({ topic: c.topic, why: c.why_it_matters, action: c.recommended_action, persona: c.suggested_persona, program: c.suggested_program, source: c.source_platform, url: c.original_url }, null, 2)}\n\nTODAY'S DISCOVERABILITY:\n${JSON.stringify(discRow || {}, null, 2)}\n\nAVAILABLE TEMPLATE FAMILIES:\n${templateList}\n\nWrite the brief JSON.`,
        maxTokens: 2000,
      });
      const brief = extractJson(briefRaw);
      if (!brief || brief.decision === "ignore") {
        await db.from("content_candidates").update({ status: "ignored" }).eq("id", c.id);
        continue;
      }

      const asset_types = Array.isArray(brief.asset_types) && brief.asset_types.length ? brief.asset_types : ["static"];
      const platforms = Array.isArray(brief.platforms) && brief.platforms.length ? brief.platforms : ["instagram"];
      const { data: briefRow } = await db.from("content_briefs").insert({
        candidate_id: c.id,
        decision: clean(brief.decision, ["remix", "original"], "original"),
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
        status: "designed", // Phase 1: no Atlas render; text goes straight to review
      }).select().single();

      await db.from("content_candidates").update({ status: "sent_to_sage" }).eq("id", c.id);
      stats.briefs++;

      // Phase 2: attempt automated design (gated + non-fatal). If no Canva token
      // or the template has no engine_template_id yet, this returns designed:false
      // and the brief stays a text item for review — never fakes a design.
      let assetIds = [];
      try {
        const design = await renderBrief(briefRow.id);
        if (design.designed) assetIds = design.assets.map((a) => a.id);
      } catch (e) { console.warn("atlas render failed (non-fatal):", e.message); }

      // Sentinel on the final caption/hook/cta
      const verdict = await runSentinel(sentinelPrompt, {
        kind: brief.decision,
        caption: brief.caption,
        hook: brief.headline_hook,
        cta: brief.cta,
        hashtags: brief.hashtags,
      });

      await db.from("content_approval_queue").insert({
        kind: clean(brief.decision, ["remix", "original"], "original"),
        candidate_id: c.id,
        brief_id: briefRow?.id || null,
        asset_ids: assetIds,
        platforms,
        preview_caption: brief.caption || "",
        safety_verdict: verdict.verdict,
        safety_flags: verdict.flags || [],
      });
    }

    await updateRun({
      status: "success",
      fast_tracked_count: stats.fast_tracked,
      briefs_count: stats.briefs,
      finished_at: new Date().toISOString(),
    });

    await notify(`Content run complete (${trigger}) — ${stats.candidates} candidates, ${stats.fast_tracked} reposts fast-tracked, ${stats.briefs} briefs. Review at admin.eight14.us → Social Media → Review.`);
    return { ok: true, stats };

  } catch (err) {
    console.error("[content-run] fatal:", err.message);
    await updateRun({ status: "failed", error_detail: err.message, finished_at: new Date().toISOString() });
    await notify(`⚠ Content run FAILED (${trigger}): ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Sentinel gate — always returns a verdict object {verdict, flags}
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

// ── HTTP handler (background function, manual trigger) ─────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const trigger = event.httpMethod === "POST" ? "manual" : "cron";
  const result = await runDaily(trigger);
  return {
    statusCode: result.ok ? 200 : 500,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(result),
  };
};

exports.runDaily = runDaily;
