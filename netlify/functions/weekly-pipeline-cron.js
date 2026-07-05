/**
 * weekly-pipeline-background.js — Netlify Background Function
 *
 * Runs automatically every Sunday at 6am Mountain Time (12:00 UTC).
 * Background functions have no response timeout — runs until complete.
 * All status is logged to Supabase pipeline_runs table.
 *
 * Schedule: netlify.toml [functions."weekly-pipeline-background"] schedule = "0 12 * * 0"
 *
 * Sequence:
 *   1. Read Echo performance data from Supabase
 *   2. Scout — research trending topics (informed by Echo data)
 *   3. Sage — write 3 posts (informed by Scout + Echo)
 *   4. Atlas — build publishing schedule
 *   5. Buffer — schedule each post
 *   6. Log completion to pipeline_runs
 *
 * Error recovery: each step is individually fault-tolerant.
 * If Scout produces partial output, Sage still runs.
 * If Sage fails, Atlas still attempts to build from whatever exists.
 * Full status logged at each step so failures are visible in the dashboard.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require("./supabase-client");

// ── Claude API call (non-streaming) ──────────────────────────────────────────
async function callClaude(apiKey, systemPrompt, userMessage, maxTokens = 2000) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ── Concise pipeline system prompts ──────────────────────────────────────────
const SCOUT_PROMPT = `You are Scout — content research agent for Meet Riley (meetriley.us).
Find 5 trending topics in sobriety, recovery, mental health, fitness, nutrition.
Focus on the best_pillar. Avoid any topics listed as recently covered.
Output exactly:
TOP THEME: [one sentence]
TRENDING NOW:
Topic: [name]
Pillar: [pillar name]
(repeat 5 times)
HIGH-VALUE SEARCH TERMS:
[10 search phrases, one per line]`;

const SAGE_PROMPT = `You are Sage — content writer for Meet Riley (meetriley.us).
Write 3 complete publish-ready posts from Scout's research. Riley's voice: warm, direct, honest, short sentences.
For each post output:
POST [N] — [TYPE]
Platform: [platform]
Day/Time: [day and time MT]
CAPTION:
[full caption]
HASHTAGS:
[hashtags]
---
Produce exactly 3 posts. No placeholders.`;

const ATLAS_PROMPT = `You are Atlas — publishing agent for Meet Riley (meetriley.us).
Take Sage's posts and output a Buffer-ready schedule for the coming week.
For each post output exactly:
POST: [number]
PLATFORM: [platform]
SCHEDULED_TIME: [ISO 8601]
CAPTION: [full caption]
---`;

// ── Parse helpers ─────────────────────────────────────────────────────────────
function parseScoutTopics(reply) {
  const topics  = [...reply.matchAll(/^Topic:\s*(.+)$/gm)].map((m) => m[1].trim());
  const pillars = [...reply.matchAll(/^Pillar:\s*(.+)$/gm)].map((m) => m[1].trim());
  const themeM  = reply.match(/^TOP THEME:\s*(.+)$/m);
  return { topics, pillars: [...new Set(pillars)], topTheme: themeM?.[1]?.trim() || null };
}

function parseSagePosts(reply) {
  const posts  = [];
  const blocks = reply.split(/\n(?=POST \d+\s*[—-])/);
  blocks.forEach((block, i) => {
    if (!block.trim()) return;
    const platM    = block.match(/^Platform:\s*(.+)$/m);
    const captionM = block.match(/CAPTION:\s*\n([\s\S]*?)(?=\nHASHTAGS:|\n---|\nPOST \d|$)/);
    const hashM    = block.match(/HASHTAGS:\s*\n?([\s\S]*?)(?=\n---|\nPOST \d|$)/);
    const titleM   = block.match(/^POST (\d+)\s*[—-]+\s*(.+)/m);
    posts.push({
      num:      titleM?.[1] || String(i + 1),
      type:     titleM?.[2]?.trim() || "Post",
      platform: platM?.[1]?.trim()  || "Instagram",
      caption:  captionM?.[1]?.trim() || "",
      hashtags: hashM?.[1]?.trim()    || "",
    });
  });
  return posts.filter((p) => p.caption);
}

function getScheduledTime(daysFromNow, hourMT) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setUTCHours(hourMT + 6, 0, 0, 0);
  return d.toISOString();
}

// ── FeedHive publish call ────────────────────────────────────────────────────────
async function publishToFeedHive(siteUrl, post, scheduledAt) {
  if (!siteUrl) return null;
  try {
    const text = post.caption + (post.hashtags ? "\n\n" + post.hashtags : "");
    const res  = await fetch(`${siteUrl}/.netlify/functions/feedhive-publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-operator-key": process.env.OPERATOR_KEY || "" },
      body: JSON.stringify({ text, scheduled_at: scheduledAt }),
    });
    const data = await res.json();
    return data.update_id || null;
  } catch (e) {
    console.warn("[pipeline-bg] FeedHive publish failed (non-fatal):", e.message);
    return null;
  }
}

// ── Main handler (background function — no response needed) ───────────────────
exports.handler = async function (event) {
  const startTime = Date.now();
  console.log("[pipeline-bg] Starting Sunday pipeline run");

  const apiKey    = process.env.ANTHROPIC_API_KEY;
  const siteUrl   = process.env.URL || "";
  const bufferIds = (process.env.FEEDHIVE_ACCOUNT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!apiKey) {
    console.error("[pipeline-bg] ANTHROPIC_API_KEY not set — aborting");
    return { statusCode: 500, body: "" };
  }

  // ── Init Supabase ─────────────────────────────────────────────────────────
  let supabase = null;
  let runId    = null;
  const weekOf = new Date().toISOString().slice(0, 10);

  try {
    supabase = getSupabaseClient();
    const { data } = await supabase
      .from("pipeline_runs")
      .insert({ run_date: weekOf, status: "running", scout_topics_count: 0, sage_posts_count: 0, buffer_posts_scheduled: 0 })
      .select()
      .single();
    runId = data?.id;
    console.log("[pipeline-bg] Run record created:", runId);
  } catch (e) {
    console.warn("[pipeline-bg] Supabase init failed (non-fatal):", e.message);
  }

  async function logStep(fields) {
    if (!supabase || !runId) return;
    try { await supabase.from("pipeline_runs").update(fields).eq("id", runId); } catch { /* non-fatal */ }
  }

  // ── STEP 1: Echo data ─────────────────────────────────────────────────────
  let echoBrief = { best_pillar: null, format_winner: null, worst_pillar: null, insight: "" };
  try {
    const { data } = await supabase
      .from("echo_scores")
      .select("best_pillar, format_winner, worst_pillar, biggest_lever")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (data) {
      echoBrief = { best_pillar: data.best_pillar, format_winner: data.format_winner, worst_pillar: data.worst_pillar, insight: data.biggest_lever || "" };
      await logStep({ echo_top_pillar: data.best_pillar, echo_format_winner: data.format_winner });
    }
    console.log("[pipeline-bg] Echo data:", echoBrief);
  } catch (e) {
    console.warn("[pipeline-bg] Echo data fetch failed (non-fatal):", e.message);
  }

  // ── STEP 2: Scout ─────────────────────────────────────────────────────────
  let scoutReply   = "";
  let scoutTopics  = [];
  try {
    let historyContext = "";
    try {
      const { data } = await supabase
        .from("scout_history")
        .select("topics_covered, pillars_covered, top_theme")
        .order("week_of", { ascending: false })
        .limit(4);
      if (data?.length) {
        const topics  = data.flatMap((r) => r.topics_covered || []);
        const pillars = data.flatMap((r) => r.pillars_covered || []);
        const themes  = data.map((r) => r.top_theme).filter(Boolean);
        historyContext =
          "\n\nRECENT TOPICS — DO NOT REPEAT:\n" + topics.map((t) => `- ${t}`).join("\n") +
          (pillars.length ? "\n\nRECENT PILLARS (rotate):\n" + [...new Set(pillars)].map((p) => `- ${p}`).join("\n") : "") +
          (themes.length  ? "\n\nRECENT THEMES:\n" + themes.map((t) => `- ${t}`).join("\n") : "");
      }
    } catch (e) { console.warn("[pipeline-bg] Scout history fetch failed:", e.message); }

    const scoutMessage =
      `Find trending sobriety and wellness topics for this week.` +
      (echoBrief.best_pillar   ? `\nPrioritize: ${echoBrief.best_pillar}` : "") +
      (echoBrief.worst_pillar  ? `\nReduce: ${echoBrief.worst_pillar}` : "") +
      historyContext;

    scoutReply  = await callClaude(apiKey, SCOUT_PROMPT, scoutMessage);
    const parsed = parseScoutTopics(scoutReply);
    scoutTopics  = parsed.topics;
    console.log(`[pipeline-bg] Scout complete — ${scoutTopics.length} topics`);

    await logStep({ scout_topics_count: scoutTopics.length });

    try {
      await supabase.from("scout_history").insert({
        week_of:         weekOf,
        pillars_covered: parsed.pillars.length ? parsed.pillars : ["unknown"],
        topics_covered:  scoutTopics.length    ? scoutTopics   : ["unknown"],
        top_theme:       parsed.topTheme,
      });
    } catch (e) { console.warn("[pipeline-bg] scout_history save failed:", e.message); }

  } catch (e) {
    const msg = "Scout step failed: " + e.message;
    console.error("[pipeline-bg]", msg);
    await logStep({ status: "partial", error_message: msg });
    // Continue with empty scoutReply — Sage will do its best
  }

  // ── STEP 3: Sage ──────────────────────────────────────────────────────────
  let sageReply = "";
  let sagePosts = [];
  try {
    const sageMessage =
      (scoutReply ? `Here is Scout's research:\n\n${scoutReply}` : "Write 3 posts about trending sobriety and wellness topics.") +
      (echoBrief.format_winner ? `\n\nFORMAT WINNER: ${echoBrief.format_winner} — produce more of this type.` : "") +
      (echoBrief.best_pillar   ? `\nPILLAR FOCUS: ${echoBrief.best_pillar}` : "") +
      (echoBrief.worst_pillar  ? `\nPILLAR TO REDUCE: ${echoBrief.worst_pillar}` : "");

    sageReply = await callClaude(apiKey, SAGE_PROMPT, sageMessage);
    sagePosts = parseSagePosts(sageReply);
    console.log(`[pipeline-bg] Sage complete — ${sagePosts.length} posts`);
    await logStep({ sage_posts_count: sagePosts.length });
  } catch (e) {
    const msg = "Sage step failed: " + e.message;
    console.error("[pipeline-bg]", msg);
    await logStep({ status: "partial", error_message: msg });
    // Continue with empty sagePosts — Atlas and Buffer will be skipped gracefully
  }

  // ── STEP 4: Atlas ─────────────────────────────────────────────────────────
  try {
    if (sageReply) {
      const atlasMessage = `Schedule these posts for the coming week:\n\n${sageReply}`;
      await callClaude(apiKey, ATLAS_PROMPT, atlasMessage);
      console.log("[pipeline-bg] Atlas complete");
    } else {
      console.warn("[pipeline-bg] Atlas skipped — no Sage output");
    }
  } catch (e) {
    console.warn("[pipeline-bg] Atlas step failed (non-fatal):", e.message);
  }

  // ── STEP 5: FeedHive publish ─────────────────────────────────────────────────
  let bufferedCount = 0;
  for (let i = 0; i < sagePosts.length; i++) {
    const post        = sagePosts[i];
    const scheduledAt = getScheduledTime(i + 1, 8);
    const updateId    = await publishToFeedHive(siteUrl, post, scheduledAt);
    if (updateId) bufferedCount++;

    try {
      await supabase.from("published_posts").insert({
        week_of:          weekOf,
        post_number:      parseInt(post.num, 10) || (i + 1),
        platform:         post.platform,
        post_type:        post.type,
        caption_preview:  post.caption.slice(0, 200),
        buffer_update_id: updateId,
      });
    } catch (e) { console.warn("[pipeline-bg] published_posts insert failed:", e.message); }
  }
  console.log(`[pipeline-bg] Buffer scheduled: ${bufferedCount} posts`);

  // ── STEP 6: Mark complete ─────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  await logStep({
    status:                  sagePosts.length > 0 ? "success" : "partial",
    sage_posts_count:        sagePosts.length,
    buffer_posts_scheduled:  bufferedCount,
    error_message:           sagePosts.length === 0 ? "Scout ran but Sage produced no posts" : null,
  });

  console.log(`[pipeline-bg] Complete in ${elapsed}s — posts: ${sagePosts.length}, buffered: ${bufferedCount}`);

  // Background functions: return value is ignored by Netlify
  return { statusCode: 200, body: "" };
};
