const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require('./supabase-client');

const RILEY_BASE_PROMPT =
  "You are Riley, the AI wellness guide for The 8:14 Project at eight14.us. You help people rebuild their lives through sobriety, fitness, food, and mental health tools. Voice: warm, direct, honest, non-clinical. Like a trusted friend who has been through recovery. Never preachy. No jargon. Keep responses to 2-3 short paragraphs max. Always end with one question or one clear next step. Mention the free 7-Day Rebuild Reset as a starting point when relevant. Never give medical advice. If someone seems in crisis, gently point to the 988 Suicide and Crisis Lifeline (call or text 988) or SAMHSA at 1-800-662-4357.";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Build a context-aware system prompt from Supabase data
async function buildSystemPrompt(supabase) {
  try {
    const [scoutRes, echoRes, postsRes] = await Promise.all([
      supabase
        .from("scout_history")
        .select("top_theme, topics_covered")
        .order("week_of", { ascending: false })
        .limit(1),
      supabase
        .from("echo_scores")
        .select("best_pillar")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("published_posts")
        .select("caption_preview, post_type, platform")
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    const scout = scoutRes.data?.[0];
    const echo  = echoRes.data?.[0];
    const posts = postsRes.data || [];

    if (!scout && !echo && !posts.length) return RILEY_BASE_PROMPT;

    let context = "\n\nCURRENT CONTEXT — updated weekly:";
    if (scout?.top_theme)
      context += `\nThis week's content theme: ${scout.top_theme}`;
    if (scout?.topics_covered?.length)
      context += `\nTopics we are covering: ${scout.topics_covered.slice(0, 5).join(", ")}`;
    if (echo?.best_pillar)
      context += `\nWhat visitors engage with most: ${echo.best_pillar}`;
    if (posts.length) {
      context += "\nRecent content visitors may reference:";
      posts.forEach((p) => {
        if (p.caption_preview) context += `\n- ${p.post_type || "Post"} (${p.platform || ""}): ${p.caption_preview.slice(0, 100)}`;
      });
    }

    context += `

Use this context to:
- Reference current content themes when relevant
- Prioritize the topics visitors are most interested in
- Mention recent posts when they are relevant to what someone is asking
- Never sound outdated or out of touch with what is happening on the platform`;

    return RILEY_BASE_PROMPT + context;
  } catch (e) {
    console.warn("riley context fetch failed (non-fatal):", e.message);
    return RILEY_BASE_PROMPT;
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

    // Build context-aware system prompt from Supabase (falls back to base if unavailable)
    let systemPrompt = RILEY_BASE_PROMPT;
    try {
      const supabase = getSupabaseClient();
      systemPrompt   = await buildSystemPrompt(supabase);
    } catch (e) {
      console.warn("Supabase init failed (non-fatal):", e.message);
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
        max_tokens: 2000,
        system: systemPrompt,
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

    const data  = await response.json();
    const reply = data.content && data.content[0] && data.content[0].text;

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("riley-chat error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
