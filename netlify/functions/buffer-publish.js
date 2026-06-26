/**
 * buffer-publish.js
 * Schedule a single post to Buffer.
 *
 * POST body: { text, profile_ids, scheduled_at }
 * Returns:   { success, update_id } or { error }
 */

const BUFFER_API = "https://api.bufferapp.com/1/updates/create.json";

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
    const token = process.env.BUFFER_API_TOKEN;
    if (!token) {
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "BUFFER_API_TOKEN not configured" }),
      };
    }

    const { text, profile_ids, scheduled_at } = JSON.parse(event.body || "{}");

    if (!text || !profile_ids || !profile_ids.length) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "text and profile_ids are required" }),
      };
    }

    // Build form-encoded body for Buffer API
    const params = new URLSearchParams();
    params.append("text", text);
    profile_ids.forEach((id) => params.append("profile_ids[]", id));
    if (scheduled_at) params.append("scheduled_at", scheduled_at);
    params.append("access_token", token);

    const bufferRes = await fetch(BUFFER_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const rawText = await bufferRes.text();
    let bufferData;
    try {
      bufferData = JSON.parse(rawText);
    } catch (e) {
      throw new Error("Buffer returned non-JSON: " + rawText.slice(0, 200));
    }

    if (!bufferRes.ok) {
      return {
        statusCode: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Buffer API error",
          detail: bufferData.error || rawText,
        }),
      };
    }

    const update_id = bufferData.updates?.[0]?.id || bufferData.id || null;

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, update_id }),
    };
  } catch (err) {
    console.error("buffer-publish error:", err);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error: " + err.message }),
    };
  }
};
