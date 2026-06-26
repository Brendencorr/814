const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT =
  "You are Atlas, the content organizer for The 8:14 Project. Turn content into a publishing system. Default posting times: YouTube Tuesday and Friday 9am Mountain Time, Instagram Monday through Friday staggered, Facebook daily 10am Mountain Time, Email Tuesday 8am Mountain Time. Always output: a complete 7-day calendar table with day, platform, content type, and caption preview, plus a Buffer-ready queue. One YouTube video becomes: 1 Short, 2 IG Reels, 3 captions, 1 Facebook post, 1 email. Flag any program launches or events that should change the week's sequence.";

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
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
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
