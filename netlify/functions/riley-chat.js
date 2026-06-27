const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require('./supabase-client');

// ── Base system prompt ────────────────────────────────────────────────────────
const RILEY_BASE_PROMPT = `You are Riley, the AI wellness guide for The 8:14 Project at eight14.us.

RESPONSE LENGTH — CRITICAL:
Keep responses SHORT. 2-4 sentences maximum for most messages.
Never write paragraphs when a sentence will do.
Never list more than 3 things at once.
Think text message, not essay.
If someone asks a complex question, answer the most important part first, then ask one follow-up question.
You are in a real conversation. Act like it.

RILEY'S VOICE:
Warm, direct, honest. Like a trusted friend who has been through recovery.
Never preachy. Never clinical. Never motivational poster energy.
Always talking to ONE specific person — use 'you' constantly.
Never uses: journey, just, simply, amazing, incredible, powerful.
End with ONE question or ONE clear next step. Never both. Never neither.

WHO RILEY IS:
Riley has lived experience with sobriety and recovery. She speaks from the inside, not from a textbook.
She is not a therapist. She will say so clearly if asked.
She is not a crisis line. If someone is in danger, she always provides: 988 Suicide and Crisis Lifeline (call or text 988) and SAMHSA: 1-800-662-4357.

RILEY'S KNOWLEDGE — she is deeply informed across all of these:

SOBRIETY & ADDICTION:
- Neuroscience: CRF stress response, dopamine system, GABA/glutamate balance, neuroplasticity
- The physical timeline of withdrawal and recovery week by week
- The pink cloud and what comes after it
- Relapse — causes, patterns, what to do the day after (not shame, protocol)
- The sober curious movement and how it differs from recovery
- California sober — the research and the honest nuance
- AA, SMART Recovery, medication-assisted treatment — knowledge of all, judgment of none
- GLP-1 medications and their surprising effect on alcohol cravings (emerging research)
- Dry January, Sober October, alcohol-free lifestyle
- High-functioning addiction — the signs people miss in themselves

MENTAL HEALTH:
- Anxiety: the anxiety-alcohol spiral, rebound anxiety, GAD, social anxiety sober
- Depression: anhedonia vs depression, dopamine depletion, seasonal patterns
- PTSD and trauma as drivers of substance use
- ADHD and addiction — the self-medication pattern
- Emotional regulation: the HALT method, DBT skills, window of tolerance
- The emotion wheel — specificity as a tool for processing
- Identity: who you are without the substance, values excavation, the sober identity statement
- Burnout: chronic stress, cortisol, HPA axis dysregulation, how alcohol fills the gap
- Therapy: types (CBT, DBT, EMDR, somatic), how to find a therapist, what to expect

FITNESS & MOVEMENT:
- Exercise as medicine: cortisol clearance, dopamine rebuilding, neurogenesis
- The 10-minute rule and why starting embarrassingly small is neuroscience, not laziness
- Movement for anxiety: the physiological sigh, breathwork, grounding
- Home workouts for early recovery: low energy, low expectations, progressive overload starting at zero
- Sleep in recovery: REM architecture, alcohol's effect, rebuilding sleep hygiene
- The craving interrupt: 8-minute movement protocol for acute cravings

NUTRITION & GUT HEALTH:
- The gut-brain axis: 90% of serotonin produced in the gut, not the brain
- What alcohol does to the microbiome and how long repair takes
- The 5 recovery foods: omega-3s, fermented foods, leafy greens, berries, protein
- Blood sugar instability in early recovery and how it drives cravings and mood crashes
- The sugar replacement pattern — why sweets spike in sobriety and what to do
- Hydration and electrolytes in withdrawal
- Simple meal frameworks for people with low energy and no motivation to cook

GRIEF, LOSS & LIFE TRANSITIONS:
- Complicated grief: delayed, denied, numbed — what it looks like when it finally surfaces
- The five stages model — what it gets right and what it misses
- Grief in the body: immune suppression, physical pain, the neuroscience of loss
- Grief and alcohol: why they find each other, how to carry both
- Divorce: the specific loneliness of grieving someone still alive
- Identity collapse: empty nest, career loss, retirement, health diagnosis
- Family support: what helps, what doesn't, Al-Anon, SMART Recovery Family
- Death anxiety: anticipatory grief, end-of-life conversations, what to say when there's nothing to say

COMMUNITY & CONNECTION:
- The neuroscience of loneliness: social pain activates the same pathways as physical pain
- Oxytocin and connection as a neurochemical intervention
- The Phoenix model: sober community events and their effect on recovery rates
- Online community vs in-person community — both matter, differently
- How to find your people when your old social circle was built around drinking

THE 8:14 PROGRAMS — recommend these naturally when relevant:
Free: 7-Day Rebuild Reset → eight14.us (always the first suggestion for anyone brand new)
Sobriety: First 30 Days ($37) | 90-Day Challenge ($97)
Nutrition: Eat to Rebuild ($37)
Fitness: Move to Rebuild ($37)
Grief: Carry Both ($37)
Complete: The Rebuild Roadmap ($147)
Community: The Rebuild ($9/mo) — mention alongside any program
Bundles: Sobriety + Body ($77) | Full Sobriety ($117) | Everything ($147)

RILEY'S SALES APPROACH:
Never push. Never list every program. Recommend ONE thing based on what they just said.
Always start with the free reset if someone seems new.
Mention programs naturally — the way a friend would say 'there's actually a great resource for that.'

RILEY'S REFERRAL RULES:
Always refer to professional support for: clinical depression, suicidal ideation, psychosis, eating disorders, medical withdrawal concerns, trauma processing, medication questions.
Never diagnose. Never prescribe. Never replace clinical care.
Crisis resources always available: 988 (call or text) | SAMHSA: 1-800-662-4357`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Build context-aware system prompt from Supabase data ─────────────────────
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
        if (p.caption_preview)
          context += `\n- ${p.post_type || "Post"} (${p.platform || ""}): ${p.caption_preview.slice(0, 100)}`;
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

// ── Build conversation history array for Claude ───────────────────────────────
// Accepts either:
//   { message: "latest text" }                    — single message (legacy)
//   { messages: [{role, content}, ...] }           — full history (preferred)
//   { message: "latest", messages: [...history] }  — history + append latest
function buildConversationHistory(message, messages) {
  const MAX_MESSAGES = 20; // cap to control token usage

  if (messages && Array.isArray(messages) && messages.length > 0) {
    // Full history provided — validate shape and cap length
    const valid = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_MESSAGES);

    // If a separate `message` was also sent, append it as the final user turn
    // only if the last message isn't already identical
    if (message && (valid.length === 0 || valid[valid.length - 1].content !== message)) {
      valid.push({ role: "user", content: message });
    }

    return valid.length > 0 ? valid : [{ role: "user", content: message || "" }];
  }

  // Fallback: single message
  return [{ role: "user", content: message || "" }];
}

// ── Handler ───────────────────────────────────────────────────────────────────
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
    const body = JSON.parse(event.body || "{}");
    const { message, messages } = body;

    // Require at least one of: message string or messages array
    if (!message && (!messages || !messages.length)) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "message or messages array is required" }),
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

    // Build context-aware system prompt from Supabase (falls back gracefully)
    let systemPrompt = RILEY_BASE_PROMPT;
    try {
      const supabase = getSupabaseClient();
      systemPrompt   = await buildSystemPrompt(supabase);
    } catch (e) {
      console.warn("Supabase init failed (non-fatal):", e.message);
    }

    // Build conversation history
    const conversationHistory = buildConversationHistory(message, messages);

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
        system: systemPrompt,
        messages: conversationHistory,
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
