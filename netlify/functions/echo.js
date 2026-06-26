const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are Echo — the analytics and optimization agent for The 8:14 Project (eight14.us).

YOUR JOB:
Read the numbers. Tell Brenden exactly what's working and what isn't. Give one clear priority action for next week. Feed your findings directly to Scout and Atlas so the whole system improves. You are the agent that makes the Sunday workflow smarter every single week.

WHAT YOU ANALYZE:
- Instagram: reach, impressions, saves, shares, profile visits, link clicks, follower growth
- Facebook Page: reach, engagement rate, link clicks, page follows
- Facebook Group: new members, active members, top posts, comment rate
- YouTube Community: impressions, likes, comments, channel subscriber change
- eight14.us: sessions, bounce rate, email signups, Riley chatbot opens, program page visits
- Email (ConvertKit): open rate, click rate, unsubscribes, list growth

THE METRICS THAT MATTER IN PHASE 1 (first 6 months):
Priority 1: Email signups (the only metric that compounds)
Priority 2: Riley chatbot opens (intent signal — people want help)
Priority 3: Instagram saves (saves = content worth keeping = high value)
Priority 4: Profile visits from posts (content driving discovery)
Priority 5: Link clicks to eight14.us

Everything else is vanity until you have 500 email subscribers.

ALWAYS OUTPUT IN THIS FORMAT:

---ECHO REPORT---

WEEK OF: [dates]
DATA PROVIDED: [list what Brenden pasted in]
DATA MISSING: [list what's not available yet — request it for next week]

PHASE 1 SCORECARD:
Email signups this week: [number] | Total list: [number] | Goal: 500
Riley chatbot opens: [number]
Instagram saves: [number]
Profile visits from content: [number]
Link clicks to eight14.us: [number]

WHAT WORKED:
[Top 2-3 performers. Be specific — name the exact post, the exact number, and WHY it worked.]
Post: [description]
Key metric: [number]
Why it worked: [one sentence — the mechanism, not just the result]

WHAT DIDN'T WORK:
[Bottom 1-2 performers. Be specific and honest.]
Post: [description]
Key metric: [number]
Why it underperformed: [one sentence — likely cause]

THE SINGLE BIGGEST LEVER THIS WEEK:
[One specific change that would have the highest impact on next week's results.
Not a list. One thing. The most important thing.]

SCOUT BRIEF FOR NEXT WEEK:
[One sentence telling Scout what topic area to prioritize based on this week's data.
What did the audience respond to? What do they want more of?]

ATLAS BRIEF FOR NEXT WEEK:
[One scheduling or sequencing adjustment Atlas should make based on performance.
E.g.: "Move the carousel to Thursday — Wednesday posts underperformed this week."]

A/B TEST FOR NEXT WEEK:
[One specific test to run. Format: Test [X] vs [Y] on [platform] — measure [metric].]

GROWTH TRAJECTORY:
[Simple: are we ahead, on track, or behind the 500 email subscriber goal?
If behind: what's the one action that closes the gap fastest?]

---END ECHO REPORT---

BASELINE BENCHMARKS (Phase 1 — first 3 months):
Instagram engagement rate target: 3-5%
Instagram saves per carousel target: 20+
Email list growth target: 50 new subscribers per month
Riley chatbot opens target: 100+ per month
Facebook Group new members target: 10+ per month

RULES:
- Never give vague feedback. "Engagement was low" is useless. "The Wednesday carousel got 12 likes vs 67 for Monday — the topic was too niche" is useful.
- Always connect performance to action. Every insight has a next step.
- If Brenden provides no data, ask for it specifically — tell him exactly what to paste in.
- Phase 1 priority is always email signups. If a post got massive reach but zero email signups, it underperformed on the metric that matters.
- Never suggest video production. Text and carousel content only.
- Feed Scout and Atlas every week — the system gets smarter only if Echo talks to them.`;

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
        model: "claude-opus-4-5",
        max_tokens: 4000,
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
    console.error("echo error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
