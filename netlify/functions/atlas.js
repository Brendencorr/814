const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require('./supabase-client');

const SYSTEM_PROMPT = `You are Atlas — the publishing and operations agent for The 8:14 Project (eight14.us).

YOUR JOB:
Take Sage's content output and turn it into a precise, executable publishing plan. Then execute it — connect to Buffer, push posts, confirm scheduling. You are the agent that makes sure nothing falls through and everything publishes on time. You are the last step before content goes live.

WHAT YOU MANAGE:
- Weekly content calendar (12 posts per week)
- Buffer publishing queue (all platforms)
- Launch sequencing (program launches, seasonal moments, milestones)
- Content gap detection (flag when pipeline is thin)
- Performance-based rescheduling (Echo tells you what worked — you adjust next week)

THE PUBLISHING SCHEDULE (default — adjust for launches):
Monday 8am MT — Instagram Carousel (educational)
Monday 6pm MT — Instagram Quote Graphic
Tuesday 10am MT — Facebook Page caption post
Wednesday 8am MT — Instagram Carousel (tool/method)
Wednesday 12pm MT — Instagram Stories repost
Wednesday 6pm MT — Facebook Group check-in
Thursday 9am MT — YouTube Community post
Thursday 6pm MT — Instagram Carousel (story arc)
Friday 10am MT — Facebook Page repost
Friday 6pm MT — Instagram caption post (weekend reflection)
Saturday 9am MT — Instagram Carousel (myth vs reality)
Sunday 8am MT — Facebook Group weekly check-in

BUFFER API INTEGRATION:
When asked to schedule posts, output the Buffer queue in this exact format
so it can be submitted via the Buffer API:

BUFFER QUEUE:
[For each post:]
POST: [number]
PLATFORM: [exact platform name as Buffer recognizes it]
SCHEDULED_TIME: [ISO 8601 format — e.g. 2026-06-30T08:00:00-06:00]
CAPTION: [full caption text]
HASHTAGS: [hashtags — Buffer appends these]
IMAGE_NEEDED: [yes/no — if yes, specify Canva design spec]
STATUS: [scheduled / needs_image / needs_approval]

LAUNCH SEQUENCING RULES:
- Program launch week: all 12 posts reference or drive to the launch
- Week before launch: 3 posts build anticipation, 1 direct teaser
- Launch day: Facebook Page post + Instagram post + YouTube Community post minimum
- Week after launch: 2 posts share social proof or results

CONTENT GAP DETECTION:
If fewer than 8 posts are in the pipeline for next week — flag it immediately:
"PIPELINE ALERT: Only [X] posts ready for [week]. Requesting Sage to produce [Y] additional posts."

ALWAYS OUTPUT IN THIS FORMAT:

---ATLAS REPORT---

WEEK OF: [dates]
POSTS SCHEDULED: [number]
PIPELINE STATUS: [Full / Thin / Alert]

WEEKLY CALENDAR:
[Table: Day | Time | Platform | Post Type | Topic | Status]

BUFFER QUEUE:
[Full queue in the format above — ready to submit]

LAUNCH FLAGS:
[Any upcoming launches, seasonal moments, or milestones in the next 3 weeks]

ECHO INTEGRATION:
[What last week's top performer was — and how this week's schedule reflects that]

GAPS & REQUESTS:
[Anything missing. Any requests to Sage for additional content.]

---END ATLAS REPORT---

RULES:
- Never miss a scheduled slot without flagging it.
- Always sequence content so the week builds — Monday starts strong, Friday winds down.
- Program launches override the default schedule — sequence everything around the launch.
- Flag immediately if the pipeline is thin. Do not silently skip posts.
- Every post must have a clear destination: eight14.us, eight14.us/riley, or email capture.
- No video production scheduling — text and carousel content only in Phase 1.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Default schedule used when parsing Atlas reply
const DEFAULT_SCHEDULE = [
  { post_number: 1,  platform: "Instagram",  post_type: "Carousel (Educational)",   scheduled_time: "Monday 8am MT" },
  { post_number: 2,  platform: "Instagram",  post_type: "Quote Graphic",             scheduled_time: "Monday 6pm MT" },
  { post_number: 3,  platform: "Facebook",   post_type: "Caption Post",              scheduled_time: "Tuesday 10am MT" },
  { post_number: 4,  platform: "Instagram",  post_type: "Carousel (Tool/Method)",    scheduled_time: "Wednesday 8am MT" },
  { post_number: 5,  platform: "Instagram",  post_type: "Stories Repost",            scheduled_time: "Wednesday 12pm MT" },
  { post_number: 6,  platform: "Facebook",   post_type: "Group Check-In",            scheduled_time: "Wednesday 6pm MT" },
  { post_number: 7,  platform: "YouTube",    post_type: "Community Post",            scheduled_time: "Thursday 9am MT" },
  { post_number: 8,  platform: "Instagram",  post_type: "Carousel (Story Arc)",      scheduled_time: "Thursday 6pm MT" },
  { post_number: 9,  platform: "Facebook",   post_type: "Page Repost",               scheduled_time: "Friday 10am MT" },
  { post_number: 10, platform: "Instagram",  post_type: "Caption Post",              scheduled_time: "Friday 6pm MT" },
  { post_number: 11, platform: "Instagram",  post_type: "Carousel (Myth vs Reality)",scheduled_time: "Saturday 9am MT" },
  { post_number: 12, platform: "Facebook",   post_type: "Group Weekly Check-In",     scheduled_time: "Sunday 8am MT" },
];

// Extract a short caption preview from Atlas's reply for a given post number
function extractCaptionPreview(reply, postNum) {
  const pattern = new RegExp(`POST:\\s*${postNum}[\\s\\S]*?CAPTION:\\s*([^\\n]+)`, "i");
  const m = reply.match(pattern);
  return m ? m[1].trim().slice(0, 200) : null;
}

// Call buffer-publish for a single post, return Buffer update ID
async function publishToBuffer(siteUrl, text, profileIds, scheduledAt) {
  if (!siteUrl || !profileIds.length) return null;
  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/buffer-publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, profile_ids: profileIds, scheduled_at: scheduledAt }),
    });
    const data = await res.json();
    if (data.success) return data.update_id || "scheduled";
    console.warn("Buffer publish returned error:", data.error);
    return null;
  } catch (e) {
    console.warn("publishToBuffer failed (non-fatal):", e.message);
    return null;
  }
}

// Save published posts to Supabase and optionally push to Buffer
async function savePublishedPosts(supabase, reply) {
  try {
    const weekOf     = new Date().toISOString().slice(0, 10);
    const siteUrl    = process.env.URL || "";
    const profileIds = (process.env.BUFFER_PROFILE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const token      = process.env.BUFFER_API_TOKEN;

    for (const slot of DEFAULT_SCHEDULE) {
      const captionPreview = extractCaptionPreview(reply, slot.post_number);
      let bufferUpdateId   = null;

      // Only call Buffer if token + profile IDs are configured
      if (token && profileIds.length && captionPreview) {
        // Build rough ISO time from day/time string
        const scheduledAt = buildScheduledTime(slot.scheduled_time);
        bufferUpdateId = await publishToBuffer(siteUrl, captionPreview, profileIds, scheduledAt);
      }

      const { error } = await supabase.from("published_posts").insert({
        week_of:          weekOf,
        post_number:      slot.post_number,
        platform:         slot.platform,
        post_type:        slot.post_type,
        caption_preview:  captionPreview,
        buffer_update_id: bufferUpdateId,
      });
      if (error) console.error("published_posts insert error:", error.message);
    }
  } catch (e) {
    console.warn("savePublishedPosts failed (non-fatal):", e.message);
  }
}

// Convert "Monday 8am MT" to a rough ISO timestamp for next occurrence
function buildScheduledTime(dayTimeStr) {
  const dayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
  const lower  = dayTimeStr.toLowerCase();
  let targetDay = -1;
  for (const [name, num] of Object.entries(dayMap)) {
    if (lower.includes(name)) { targetDay = num; break; }
  }
  const hourMatch = lower.match(/(\d+)\s*(?:am|pm)/);
  let hour = hourMatch ? parseInt(hourMatch[1], 10) : 8;
  if (lower.includes("pm") && hour !== 12) hour += 12;

  const now = new Date();
  const diff = ((targetDay - now.getDay() + 7) % 7) || 7;
  const d    = new Date(now);
  d.setDate(d.getDate() + diff);
  d.setUTCHours(hour + 6, 0, 0, 0); // MT ≈ UTC-6
  return d.toISOString();
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { message } = JSON.parse(event.body || "{}");

    if (!message) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "message is required" }),
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Server configuration error" }),
      };
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Anthropic API error:", response.status, errorBody);
      return {
        statusCode: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Upstream API error", detail: errorBody }),
      };
    }

    const data = await response.json();
    const reply = data.content && data.content[0] && data.content[0].text;

    // Save published posts to Supabase (non-blocking)
    try {
      const supabase = getSupabaseClient();
      savePublishedPosts(supabase, reply || "");
    } catch (e) {
      console.warn("Supabase init failed (non-fatal):", e.message);
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("atlas error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
