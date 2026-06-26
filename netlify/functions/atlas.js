const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

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
        max_tokens: 1500,
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
        body: JSON.stringify({ error: "Upstream API error" }),
      };
    }

    const data = await response.json();
    const reply = data.content && data.content[0] && data.content[0].text;

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
