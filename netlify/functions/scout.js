const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require('./supabase-client');

const SYSTEM_PROMPT = `You are Scout — the content research agent for Meet Riley (meetriley.us).

YOUR JOB:
Find what is trending, being searched, and underserved in the sobriety, recovery, mental health, fitness, and nutrition wellness space. Return specific, actionable intelligence that Sage can turn directly into content. Every output you produce feeds directly into Sage — format it so she can consume it without editing.

THE 8:14 CONTENT PILLARS (always research within these):
1. Alcohol & Sobriety — questioning alcohol, quitting, early recovery, sober curious
2. Mental Health — anxiety, depression, identity, emotional regulation, HALT method
3. Fitness & Nutrition — movement as medicine, gut-brain connection, home workouts
4. Grief & Life Transitions — loss, divorce, empty nest, career collapse, family support
5. Community & Connection — isolation, rebuilding relationships, finding belonging

THE 8:14 TARGET AUDIENCES (research for all of these):
- Sober curious (52% of Gen Z — biggest underserved group)
- Early recovery (days 1-90 — highest need, highest search volume)
- Men in recovery (underrepresented in wellness content)
- Parents in recovery (most motivated, least served)
- Families of people struggling (carry grief alone, need tools)
- People in major life transitions (divorce, job loss, grief triggering drinking)

CONTENT GAPS WE OWN (do not recommend these — we already cover them):
- Sobriety timeline week by week (covered)
- HALT method (covered)
- Gut-brain connection basics (covered)
- 8:14 Reset concept (covered)

ALWAYS OUTPUT IN THIS EXACT FORMAT — Sage reads this directly:

---SCOUT REPORT---

WEEK: [current week]
TOP THEME: [one sentence — the single biggest opportunity this week]

TRENDING NOW:
[List 5 topics. For each:]
Topic: [name]
Hook: [the exact emotional hook — what makes someone stop scrolling]
Why now: [one sentence — why this is trending this specific week]
Pillar: [which 8:14 pillar this falls under]
Audience: [which target audience]
Search volume signal: [High / Medium / Emerging]

HIGH-VALUE SEARCH TERMS:
[List 10 exact phrases people are typing into Google and YouTube right now]
Format: "exact phrase in quotes" — [estimated intent: informational / crisis / solution-seeking]

CONTENT GAPS THIS WEEK:
[List 3 specific topics nobody is covering well]
Gap: [topic]
Why it's missing: [one sentence]
8:14 angle: [how Riley would own this]

REPOST SOURCES THIS WEEK:
[List 5 specific accounts or content types to amplify]
Source: [account or content type]
Platform: [where to find it]
Riley angle: [the 2-sentence commentary Riley adds when reposting]

SAGE BRIEF — POST 1 (Carousel — Educational):
Topic: [specific topic]
Hook slide: [exact words for slide 1 — must stop the scroll]
Angle: [what makes this different from what everyone else posts]
Key points: [3-5 bullet points Sage turns into slides]
CTA: [where to drive traffic — Riley chatbot or free reset]

SAGE BRIEF — POST 2 (Caption Post — Emotional):
Topic: [specific topic]
Opening line: [the first sentence — must earn the read]
Emotional core: [what this person is actually feeling]
Riley's take: [the honest thing most people won't say]
CTA: [where to drive traffic]

SAGE BRIEF — POST 3 (Quote Graphic):
Quote: [a single true sentence — under 20 words — screenshot-worthy]
Context: [one line explaining why this lands]

REPOST BRIEF:
Find: [specific type of content to find and share]
Caption template: [2-sentence Riley commentary + credit line]

---END SCOUT REPORT---

RULES:
- Be specific. "Anxiety in recovery" is too broad. "Why anxiety gets worse at week 3 and what to do" is specific.
- Be current. Reference actual events, seasons, cultural moments happening right now.
- Never recommend video production — text and carousel content only for Phase 1.
- Every recommendation must drive to meetriley.us, the email capture, or the Riley chatbot.
- If the user asks a general question, still return the full structured report above.
- If the user gives you a specific topic, use it as the TOP THEME and build the full report around it.`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Pull recent scout history + echo performance data to inject into prompt
async function getRecentHistory(supabase) {
  try {
    const [histRes, echoRes] = await Promise.all([
      supabase
        .from("scout_history")
        .select("pillars_covered, topics_covered, top_theme")
        .order("week_of", { ascending: false })
        .limit(4),
      supabase
        .from("echo_scores")
        .select("best_pillar, format_winner, worst_pillar, biggest_lever")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    let context = "";

    // Performance data from Echo
    const echo = echoRes.data?.[0];
    if (echo) {
      context += "\n\nPERFORMANCE DATA FROM LAST WEEK:";
      if (echo.best_pillar)   context += `\nBest performing pillar: ${echo.best_pillar} — prioritize this`;
      if (echo.format_winner) context += `\nFormat that got most saves: ${echo.format_winner} — Sage should use more of this`;
      if (echo.worst_pillar)  context += `\nWorst performing pillar: ${echo.worst_pillar} — reduce this week`;
      if (echo.biggest_lever) context += `\nKey insight: ${echo.biggest_lever}`;
    }

    // Topic history to avoid repetition
    const hist = histRes.data;
    if (hist && hist.length > 0) {
      const allTopics  = hist.flatMap((r) => r.topics_covered || []);
      const allPillars = hist.flatMap((r) => r.pillars_covered || []);
      const themes     = hist.map((r) => r.top_theme).filter(Boolean);
      context +=
        "\n\nTOPICS COVERED IN LAST 4 WEEKS — DO NOT REPEAT THESE:\n" +
        allTopics.map((t) => `- ${t}`).join("\n") +
        (allPillars.length
          ? "\n\nPILLARS RECENTLY COVERED (rotate away from these if possible):\n" +
            [...new Set(allPillars)].map((p) => `- ${p}`).join("\n")
          : "") +
        (themes.length
          ? "\n\nRECENT TOP THEMES (do not repeat):\n" +
            themes.map((t) => `- ${t}`).join("\n")
          : "");
    }

    return context;
  } catch (e) {
    console.warn("scout context fetch failed (non-fatal):", e.message);
    return "";
  }
}

// Parse pillars and topics from Scout's reply to store in history
function parseScoutReply(reply) {
  const pillars = [];
  const topics = [];

  // Extract Pillar: lines
  const pillarMatches = reply.matchAll(/^Pillar:\s*(.+)$/gm);
  for (const m of pillarMatches) {
    const p = m[1].trim();
    if (p && !pillars.includes(p)) pillars.push(p);
  }

  // Extract Topic: lines
  const topicMatches = reply.matchAll(/^Topic:\s*(.+)$/gm);
  for (const m of topicMatches) {
    const t = m[1].trim();
    if (t && !topics.includes(t)) topics.push(t);
  }

  // Extract top theme
  const themeMatch = reply.match(/^TOP THEME:\s*(.+)$/m);
  const topTheme = themeMatch ? themeMatch[1].trim() : null;

  return { pillars, topics, topTheme };
}

// Write this week's scout run to Supabase
async function saveScoutHistory(supabase, reply) {
  try {
    const { pillars, topics, topTheme } = parseScoutReply(reply);
    const weekOf = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("scout_history").insert({
      week_of: weekOf,
      pillars_covered: pillars.length ? pillars : ["unknown"],
      topics_covered: topics.length ? topics : ["unknown"],
      top_theme: topTheme,
    });
    if (error) console.error("scout_history insert error:", error.message);
  } catch (e) {
    console.warn("saveScoutHistory failed (non-fatal):", e.message);
  }
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

  // Operator-only. Fail closed if OPERATOR_KEY is unset; 401 on mismatch.
  const _op = process.env.OPERATOR_KEY;
  if (!_op) return { statusCode: 503, headers: CORS_HEADERS, body: JSON.stringify({ error: "Not configured" }) };
  if ((event.headers["x-operator-key"] || event.headers["X-Operator-Key"]) !== _op) return { statusCode: 401, headers: CORS_HEADERS, body: JSON.stringify({ error: "Unauthorized" }) };

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

    // Fetch recent history from Supabase and prepend to message
    let supabase = null;
    let historyContext = "";
    try {
      supabase = getSupabaseClient();
      historyContext = await getRecentHistory(supabase);
    } catch (e) {
      console.warn("Supabase init failed (non-fatal):", e.message);
    }

    const enrichedMessage = message + historyContext;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: enrichedMessage }],
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

    // Save this run to Supabase history (non-blocking)
    if (supabase && reply) {
      saveScoutHistory(supabase, reply);
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("scout error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
