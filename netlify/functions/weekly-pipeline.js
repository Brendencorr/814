/**
 * weekly-pipeline.js
 * Autonomous Scout → Sage → Atlas pipeline.
 *
 * Runs automatically every Sunday at 6am Mountain Time (12:00 UTC).
 * Can also be triggered manually via POST with body { trigger: "manual" }.
 *
 * Scheduled via netlify.toml:
 *   [functions."weekly-pipeline"]
 *     schedule = "0 12 * * 0"
 *     timeout = 26
 *
 * NOTE: Netlify runs scheduled functions as background functions, which
 * have a longer timeout than synchronous functions (up to 15 min on Pro,
 * 10 min on free tier). The timeout = 26 in toml applies to HTTP calls only.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require("./supabase-client");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Shared Claude call ─────────────────────────────────────────────────────
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
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ─── System prompts (concise versions for pipeline) ─────────────────────────
const ECHO_PIPELINE_PROMPT = `You are Echo — analytics agent for The 8:14 Project.
Read last week's performance data from Supabase and produce a brief:
- Best performing pillar (most email signups)
- Format winner (carousel / quote / caption — most saves)
- Worst performing pillar (avoid this week)
- One key insight for Scout and Sage

Output as JSON: { "best_pillar": "", "format_winner": "", "worst_pillar": "", "insight": "" }`;

const SCOUT_PIPELINE_PROMPT = `You are Scout — content research agent for The 8:14 Project (meetriley.us).
Find 5 trending topics in sobriety, recovery, mental health, fitness, nutrition.
Focus on the best_pillar and avoid topics listed as recent.
Output exactly:
TOP THEME: [one sentence]
TRENDING NOW:
Topic: [name]
Pillar: [pillar name]
(repeat 5 times)
HIGH-VALUE SEARCH TERMS:
[10 search phrases, one per line]`;

const SAGE_PIPELINE_PROMPT = `You are Sage — content writer for The 8:14 Project (meetriley.us).
Write 3 complete posts from Scout's research.
For each post output:
POST [N] — [TYPE]
Platform: [platform]
Day/Time: [day and time MT]
CAPTION:
[full caption]
HASHTAGS:
[hashtags]
---
Produce exactly 3 posts. Make captions publish-ready in Riley's voice: warm, direct, honest.`;

const ATLAS_PIPELINE_PROMPT = `You are Atlas — publishing agent for The 8:14 Project (meetriley.us).
Take Sage's posts and output a Buffer-ready schedule.
For each post output exactly:
POST: [number]
PLATFORM: [platform]
SCHEDULED_TIME: [ISO 8601]
CAPTION: [full caption]
---
Use Monday-Wednesday for the 3 posts this pipeline produces.`;

// ─── Helper: get next weekday ISO time ──────────────────────────────────────
function getScheduledTime(daysFromNow, hourMT) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  // MT = UTC-6 (MDT) or UTC-7 (MST); use UTC-6 as approximation
  d.setUTCHours(hourMT + 6, 0, 0, 0);
  return d.toISOString();
}

// ─── Parse topics from Scout reply ──────────────────────────────────────────
function parseScoutTopics(reply) {
  const topics = [];
  const pillars = [];
  const topicMatches = reply.matchAll(/^Topic:\s*(.+)$/gm);
  for (const m of topicMatches) topics.push(m[1].trim());
  const pillarMatches = reply.matchAll(/^Pillar:\s*(.+)$/gm);
  for (const m of pillarMatches) pillars.push(m[1].trim());
  const themeMatch = reply.match(/^TOP THEME:\s*(.+)$/m);
  return {
    topics,
    pillars: [...new Set(pillars)],
    topTheme: themeMatch ? themeMatch[1].trim() : null,
  };
}

// ─── Parse posts from Sage reply ────────────────────────────────────────────
function parseSagePosts(reply) {
  const posts = [];
  const blocks = reply.split(/\n(?=POST \d+\s*[—-])/);
  blocks.forEach((block, i) => {
    if (!block.trim()) return;
    const platM    = block.match(/^Platform:\s*(.+)$/m);
    const captionM = block.match(/CAPTION:\s*\n([\s\S]*?)(?=\nHASHTAGS:|\n---|\nPOST \d|$)/);
    const hashM    = block.match(/HASHTAGS:\s*\n?([\s\S]*?)(?=\n---|\nPOST \d|$)/);
    const titleM   = block.match(/^POST (\d+)\s*[—-]+\s*(.+)/m);
    posts.push({
      num:          titleM ? titleM[1] : String(i + 1),
      type:         titleM ? titleM[2].trim() : "Post",
      platform:     platM ? platM[1].trim() : "Instagram",
      caption:      captionM ? captionM[1].trim() : "",
      hashtags:     hashM ? hashM[1].trim() : "",
    });
  });
  return posts.filter((p) => p.caption);
}

// ─── Call Buffer publish endpoint ───────────────────────────────────────────
async function publishToFeedHive(siteUrl, post, scheduledAt) {
  if (!siteUrl) return null;
  try {
    const text = post.caption + (post.hashtags ? "\n\n" + post.hashtags : "");
    const res = await fetch(`${siteUrl}/.netlify/functions/feedhive-publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-operator-key": process.env.OPERATOR_KEY || "" },
      body: JSON.stringify({ text, scheduled_at: scheduledAt }),
    });
    const data = await res.json();
    return data.update_id || null;
  } catch (e) {
    console.warn("FeedHive publish failed (non-fatal):", e.message);
    return null;
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  // Support OPTIONS for manual triggers from dashboard
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  // Allow GET/POST for manual trigger; scheduled invocations come with no httpMethod
  const isManual = event.httpMethod === "POST" || event.httpMethod === "GET";
  console.log(`[weekly-pipeline] Starting — ${isManual ? "manual" : "scheduled"} run`);

  const apiKey    = process.env.ANTHROPIC_API_KEY;
  const siteUrl   = process.env.URL || "";
  const bufferIds = (process.env.FEEDHIVE_ACCOUNT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
    };
  }

  let supabase = null;
  let runId    = null;
  const weekOf = new Date().toISOString().slice(0, 10);
  const runLog = {
    run_date:              weekOf,
    status:                "running",
    scout_topics_count:    0,
    sage_posts_count:      0,
    buffer_posts_scheduled: 0,
    echo_top_pillar:       null,
    echo_format_winner:    null,
    error_message:         null,
  };

  // ── Init Supabase & create run record ──────────────────────────────────────
  try {
    supabase = getSupabaseClient();
    const { data } = await supabase.from("pipeline_runs").insert(runLog).select().single();
    runId = data?.id;
    console.log("[weekly-pipeline] Run record created:", runId);
  } catch (e) {
    console.warn("[weekly-pipeline] Supabase init failed:", e.message);
  }

  async function updateRun(fields) {
    if (!supabase || !runId) return;
    try {
      await supabase.from("pipeline_runs").update(fields).eq("id", runId);
    } catch (e) {
      console.warn("[weekly-pipeline] updateRun failed:", e.message);
    }
  }

  // ── STEP 1: Pull Echo data from Supabase ──────────────────────────────────
  let echoBrief = { best_pillar: null, format_winner: null, worst_pillar: null, insight: "" };
  try {
    const { data } = await supabase
      .from("echo_scores")
      .select("best_pillar, format_winner, worst_pillar, biggest_lever")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (data) {
      echoBrief.best_pillar    = data.best_pillar;
      echoBrief.format_winner  = data.format_winner;
      echoBrief.worst_pillar   = data.worst_pillar;
      echoBrief.insight        = data.biggest_lever || "";
      runLog.echo_top_pillar   = data.best_pillar;
      runLog.echo_format_winner = data.format_winner;
      await updateRun({ echo_top_pillar: data.best_pillar, echo_format_winner: data.format_winner });
    }
    console.log("[weekly-pipeline] Echo data loaded:", echoBrief);
  } catch (e) {
    console.warn("[weekly-pipeline] Echo data fetch failed (non-fatal):", e.message);
  }

  // ── STEP 2: Scout ──────────────────────────────────────────────────────────
  let scoutReply = "";
  try {
    // Get recent topics to avoid
    let recentTopics = "";
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
        recentTopics =
          "\n\nRECENT TOPICS — DO NOT REPEAT:\n" + topics.map((t) => `- ${t}`).join("\n") +
          (pillars.length ? "\n\nRECENT PILLARS (rotate):\n" + [...new Set(pillars)].map((p) => `- ${p}`).join("\n") : "") +
          (themes.length  ? "\n\nRECENT THEMES:\n" + themes.map((t) => `- ${t}`).join("\n") : "");
      }
    } catch (e) {
      console.warn("[weekly-pipeline] scout_history fetch failed:", e.message);
    }

    const scoutMessage =
      `Find trending sobriety and wellness topics for this week.` +
      (echoBrief.best_pillar ? `\nPrioritize pillar: ${echoBrief.best_pillar}` : "") +
      (echoBrief.worst_pillar ? `\nAvoid over-indexing on: ${echoBrief.worst_pillar}` : "") +
      recentTopics;

    scoutReply = await callClaude(apiKey, SCOUT_PIPELINE_PROMPT, scoutMessage);
    console.log("[weekly-pipeline] Scout complete, length:", scoutReply.length);

    // Save to scout_history
    const { topics, pillars, topTheme } = parseScoutTopics(scoutReply);
    runLog.scout_topics_count = topics.length;
    await updateRun({ scout_topics_count: topics.length });
    if (supabase) {
      try {
        await supabase.from("scout_history").insert({
          week_of: weekOf,
          pillars_covered: pillars.length ? pillars : ["unknown"],
          topics_covered:  topics.length  ? topics  : ["unknown"],
          top_theme:       topTheme,
        });
      } catch (e) {
        console.warn("[weekly-pipeline] scout_history save failed:", e.message);
      }
    }
  } catch (e) {
    const msg = "Scout step failed: " + e.message;
    console.error("[weekly-pipeline]", msg);
    await updateRun({ status: "partial", error_message: msg });
    if (isManual) {
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: msg }),
      };
    }
    return { statusCode: 200, body: JSON.stringify({ status: "partial", error: msg }) };
  }

  // ── STEP 3: Sage ───────────────────────────────────────────────────────────
  let sagePosts = [];
  let sageReply = "";
  try {
    const sageMessage =
      `Here is Scout's research:\n\n${scoutReply}` +
      (echoBrief.format_winner ? `\n\nFORMAT WINNER LAST WEEK: ${echoBrief.format_winner} — produce more of this type.` : "") +
      (echoBrief.best_pillar   ? `\nPILLAR TO WEIGHT TOWARD: ${echoBrief.best_pillar}` : "") +
      (echoBrief.worst_pillar  ? `\nPILLAR TO REDUCE: ${echoBrief.worst_pillar}` : "") +
      (echoBrief.insight       ? `\nKEY INSIGHT FROM LAST WEEK: ${echoBrief.insight}` : "");

    sageReply = await callClaude(apiKey, SAGE_PIPELINE_PROMPT, sageMessage);
    sagePosts = parseSagePosts(sageReply);
    console.log("[weekly-pipeline] Sage complete, posts:", sagePosts.length);
    runLog.sage_posts_count = sagePosts.length;
    await updateRun({ sage_posts_count: sagePosts.length });
  } catch (e) {
    const msg = "Sage step failed: " + e.message;
    console.error("[weekly-pipeline]", msg);
    await updateRun({ status: "partial", error_message: msg });
    if (isManual) {
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: msg, scout_output: scoutReply }),
      };
    }
    return { statusCode: 200, body: JSON.stringify({ status: "partial", error: msg }) };
  }

  // ── STEP 4: Atlas + Buffer ─────────────────────────────────────────────────
  let bufferedCount = 0;
  try {
    const atlasMessage = `Schedule these posts for the coming week:\n\n${sageReply}`;
    const atlasReply   = await callClaude(apiKey, ATLAS_PIPELINE_PROMPT, atlasMessage);
    console.log("[weekly-pipeline] Atlas complete");

    // Publish each post to Buffer + save to published_posts
    for (let i = 0; i < sagePosts.length; i++) {
      const post        = sagePosts[i];
      const daysFromNow = i + 1; // Mon, Tue, Wed
      const scheduledAt = getScheduledTime(daysFromNow, 8);
      const updateId    = await publishToFeedHive(siteUrl, post, scheduledAt);
      if (updateId) bufferedCount++;

      if (supabase) {
        try {
          await supabase.from("published_posts").insert({
            week_of:          weekOf,
            post_number:      parseInt(post.num, 10) || (i + 1),
            platform:         post.platform,
            post_type:        post.type,
            caption_preview:  post.caption.slice(0, 200),
            buffer_update_id: updateId,
          });
        } catch (e) {
          console.warn("[weekly-pipeline] published_posts insert failed:", e.message);
        }
      }
    }

    await updateRun({ buffer_posts_scheduled: bufferedCount });
    console.log("[weekly-pipeline] Buffer scheduled:", bufferedCount);
  } catch (e) {
    const msg = "Atlas/Buffer step failed: " + e.message;
    console.error("[weekly-pipeline]", msg);
    await updateRun({ status: "partial", error_message: msg });
  }

  // ── STEP 5: Mark complete ──────────────────────────────────────────────────
  await updateRun({
    status:                 "success",
    scout_topics_count:     runLog.scout_topics_count,
    sage_posts_count:       sagePosts.length,
    buffer_posts_scheduled: bufferedCount,
  });
  console.log("[weekly-pipeline] Complete ✓");

  if (isManual) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        status:            "success",
        scout_topics:      runLog.scout_topics_count,
        sage_posts:        sagePosts.length,
        buffer_scheduled:  bufferedCount,
      }),
    };
  }

  // Scheduled function — Netlify ignores the return value
  return { statusCode: 200, body: "Pipeline complete" };
};
