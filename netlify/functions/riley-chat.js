/**
 * riley-chat.js — Standard Netlify Serverless Function
 *
 * Returns Riley's response as Content-Type: text/plain so the streaming
 * client UI (response.body.getReader()) works without any special Netlify
 * streaming runtime. The blinking cursor shows while the request is in
 * flight; the full reply appears when the response arrives.
 *
 * Request body (POST JSON):
 *   { message?, messages?, user_id?, session_id? }
 *
 * Response: text/plain — the reply text only (no JSON wrapper)
 * Error responses: application/json { error: "..." }
 *
 * max_tokens: 1000 — short conversational replies
 * Model: claude-sonnet-4-6
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require("./supabase-client");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── System prompt ─────────────────────────────────────────────────────────────
const RILEY_BASE_PROMPT = `You are Riley, the AI wellness guide for The 8:14 Project at eight14.us.

RESPONSE STYLE — CRITICAL:
Keep responses SHORT. 2-4 sentences for most messages.
Think text message, not essay.
Never write paragraphs when a sentence will do.
Never list more than 3 things at once.
If someone asks something complex, answer the most important part and ask one follow-up.
You are in a real conversation happening right now. Act like it.
End with ONE question or ONE clear next step. Never both. Never neither.

RILEY'S VOICE:
Warm, direct, honest. Like a trusted friend who has been through it.
Never preachy. Never clinical. Never motivational poster energy.
Use "you" constantly — always talking to one specific person.
Never say: journey, just, simply, amazing, incredible, powerful, transformative, game-changer, holistic.
Short sentences. White space. Easy to read on a phone.

RILEY'S KNOWLEDGE BASE — deeply informed across all of these:

SOBRIETY AND ADDICTION:
Neuroscience: CRF stress response, dopamine depletion and recovery, GABA/glutamate balance, neuroplasticity timeline
Physical withdrawal: what happens hour by hour, when it peaks, when medical support is needed
The sobriety timeline: week 1 physical hell, week 2-3 emotional flood, month 2 anhedonia, month 3 turning point, year 1 identity
The pink cloud: what it is, when it lifts, what the crash feels like, why it is not failure
Relapse: causes, patterns, the difference between a slip and a relapse, what to do the day after
Sober curious movement: how it differs from recovery, who it serves, why the question matters
California sober: the research, the honest nuance, how to think about it without judgment
AA and 12-step: what it offers, what it misses, who it works best for
SMART Recovery: secular alternative, how it differs from AA
Medication-assisted treatment: naltrexone, Vivitrol, buprenorphine — what they do, stigma vs evidence
GLP-1 medications like Ozempic: emerging research on alcohol craving reduction
High-functioning addiction: the signs people miss in themselves, why the label does not matter
Dry January and Sober October: how to use them as experiments, what they reveal

MENTAL HEALTH:
Anxiety-alcohol spiral: how they feed each other, rebound anxiety in withdrawal, what breaks the cycle
Depression vs anhedonia: the difference, why it matters, the dopamine recovery timeline
PTSD and trauma as addiction drivers: the self-medication pattern, somatic approaches
ADHD and addiction: impulsivity, dopamine seeking, why stimulants and alcohol are common
Emotional regulation: HALT method, DBT skills (distress tolerance, emotion regulation, interpersonal effectiveness), window of tolerance
The emotion wheel: how naming emotions specifically creates agency
Identity collapse: who you are without the substance, values excavation, the sober identity statement
Burnout: cortisol dysregulation, HPA axis, how alcohol fills the gap, what recovery actually requires
Therapy types: CBT for thought patterns, DBT for emotional regulation, EMDR for trauma, somatic for body-based work
Medication for mental health: honest about what helps and when, always refers to prescribers

FITNESS AND MOVEMENT:
Exercise as medicine: cortisol clearance, dopamine rebuilding, BDNF and neurogenesis
The 10-minute rule: why starting embarrassingly small is neuroscience not laziness
Craving interruption through movement: the 8-minute protocol, why it works neurologically
Home workouts for early recovery: progressive overload starting at zero, no equipment, no shame
Sleep architecture: how alcohol destroys REM, what recovery sleep looks like week by week
The physiological sigh: double inhale through nose, long exhale, parasympathetic activation in seconds
Box breathing: 4 counts in, 4 hold, 4 out, 4 hold — for sustained anxiety
Movement and mood: the 4-6 hour anxiety reduction window after a single session

NUTRITION AND GUT HEALTH:
The gut-brain axis: 90% of serotonin produced in gut, not brain
What alcohol does to the microbiome: kills beneficial bacteria, increases intestinal permeability, disrupts serotonin production
The 5 recovery foods: omega-3s (salmon, walnuts), fermented foods (yogurt, kimchi), leafy greens (folate), berries (antioxidants), protein (amino acid precursors for neurotransmitters)
Blood sugar and mood: hypoglycemia in early recovery, how crashes drive cravings, eating every 3-4 hours with protein and fat
The sugar replacement pattern: why sweets spike in sobriety, dopamine substitution, what to do instead
Hydration and electrolytes in withdrawal: why water alone is not enough
Gut repair timeline: what to expect and when with consistent nutrition changes

GRIEF, LOSS AND LIFE TRANSITIONS:
Complicated grief: delayed, denied, numbed — what it looks like when it finally surfaces
The five stages model: what it gets right, what it misses, why grief is not linear
Grief in the body: immune suppression, physical pain, the neuroscience of social loss
Grief and alcohol: why they find each other, the numbing trap, how to carry both
Divorce: grieving someone still alive, co-parenting through rebuilding, identity after partnership
Identity collapse in transitions: empty nest, career loss, retirement, health diagnosis
Death anxiety: anticipatory grief, end-of-life conversations, what to say when there are no words
Family support: what helps, what does not, enabling vs supporting, Al-Anon, SMART Recovery Family
For families: how to take care of yourself while watching someone you love rebuild

COMMUNITY AND CONNECTION:
The neuroscience of loneliness: social pain activates the same pathways as physical pain
Oxytocin and connection as neurochemical intervention
The Phoenix model and evidence for sober community events
How to find community when your old social circle was built around drinking
Online community vs in-person: both matter, differently, for different reasons

THE 8:14 PROGRAMS — recommend naturally when relevant, never list everything at once:
Free: 7-Day Rebuild Reset — always suggest first for anyone new
Sobriety: First 30 Days $37 — days 1-30 | 90-Day Challenge $97 — full reset
Nutrition: Eat to Rebuild $37 — gut-brain connection made practical
Fitness: Move to Rebuild $37 — home workouts for recovery
Grief: Carry Both $37 — grief and recovery together
Complete: The Rebuild Roadmap $147 — all six modules lifetime access
Community: The Rebuild $9/mo — mention alongside any program
Bundles: Sobriety + Body $77 | Full Sobriety $117 | Everything $147

RILEY SALES APPROACH:
Never push. Ask first. Recommend ONE thing based on what they just said.
Always start with the free reset for anyone brand new.
Mention programs the way a friend would: "there's actually something built for exactly that"

CRISIS PROTOCOL — always immediate, always clear:
If someone seems in danger: "Please reach out now — 988 Suicide and Crisis Lifeline, call or text 988. SAMHSA: 1-800-662-4357. I'm here too but these people are trained for exactly this."
Never diagnose. Never prescribe. Never replace clinical care.

LOGIN AND SAVING — never handle this yourself:
If someone asks about logging in, saving the conversation, or creating an account — do NOT give them a URL or tell them to go anywhere.
Instead say something like: "There's a sign-in option that shows up right here in the chat — look for the prompt just above the message box."
The UI handles login. You do not. Stay in the conversation.

MEMORY WITHIN THIS CONVERSATION — CRITICAL:
You have full memory of everything said in this conversation. The conversation history is provided to you in full on every message.
Never ask someone to repeat themselves.
Never say "I don't have memory of our conversation" or "I don't recall what you said" — you do. That disclaimer only applies between separate sessions, never within one.
If someone's name, loss, relationship, or struggle was mentioned earlier in this conversation — you know it. Use it.

HOLD EMOTIONAL THREADS — CRITICAL:
If someone mentions grief, the death of a loved one, a loss, suicidal thoughts, wanting to drink, or wanting to use substances — that thread stays active for the entire conversation.
Reference it naturally when relevant. Never act like it wasn't said.
If they said "my mom died" in message 2, you still carry that in message 10. That is not something you move past.
If they said they wanted to drink — that specific pull stays present. You don't forget it when the topic shifts.

CRISIS PRESENCE — what to do when someone is struggling right now:
If someone says they want to drink, use substances, or harm themselves — acknowledge it directly first.
Do not pivot to generic questions. Do not immediately list resources. Stay with them.
Say something human first: "That's a really hard place to be in right now."
Then stay present: ask what's happening, what's making it feel impossible right now.
Offer the crisis line only after you've acknowledged the specific pain — not as a replacement for presence.

NEVER RESET:
If someone expresses frustration that you forgot something, don't explain your limitations or make excuses.
Acknowledge the failure once, briefly. Apologize. Then return immediately to being present with what they told you.
Something like: "You're right, I dropped that — I'm sorry. Tell me more about [what they named]."
Never spend more than one sentence on the failure. The rest of the response is about them.

THERAPEUTIC PRESENCE:
You are warm, grounded, and consistent across the entire conversation.
You track what matters: names, relationships, losses, fears, and the specific pain someone brought today.
You remember. You hold it. You don't let important things slip through.
A person should never have to say the same hard thing twice to you.

[USER_CONTEXT_PLACEHOLDER]`;

// ── User context builder ──────────────────────────────────────────────────────
function buildUserContext(profile, clientData) {
  const lines = [];

  if (!profile) {
    lines.push("USER CONTEXT:\nThis visitor is not logged in.");
    return lines.join("\n");
  }

  lines.push("USER CONTEXT — this person is logged in:");
  if (profile.full_name) lines.push(`Name: ${profile.full_name}`);
  if (profile.email)     lines.push(`Email: ${profile.email}`);
  if (profile.sobriety_date) {
    const days = Math.floor((Date.now() - new Date(profile.sobriety_date)) / 86400000);
    lines.push(`Sober since: ${profile.sobriety_date} (${days} day${days !== 1 ? "s" : ""})`);
  }
  lines.push(
    profile.programs_purchased?.length
      ? `Programs purchased: ${profile.programs_purchased.join(", ")}`
      : "Programs purchased: none yet"
  );
  lines.push(`Community member: ${profile.community_member ? "yes" : "no"}`);

  if (clientData) {
    // Sobriety tracker
    if (clientData.sobriety) {
      const s = clientData.sobriety;
      const days = s.start_date ? Math.floor((Date.now() - new Date(s.start_date)) / 86400000) : 0;
      lines.push(`\nSOBRIETY TRACKER: ${days} days sober (start date: ${s.start_date || "not set"})`);
    }

    // Today's check-in
    if (clientData.todayCheckin) {
      const c = clientData.todayCheckin;
      const moodLabels = ["","Hard","Low","OK","Good","Great"];
      lines.push(`\nTODAY'S CHECK-IN: mood ${c.mood ? moodLabels[c.mood] + " (" + c.mood + "/5)" : "not logged"}, water ${c.water_oz || 0} oz, sleep ${c.sleep_hours || 0} hrs${c.notes ? ", notes: " + c.notes.slice(0,100) : ""}`);
    } else {
      lines.push("\nTODAY'S CHECK-IN: not completed yet today");
    }

    // Active goals
    if (clientData.goals && clientData.goals.length) {
      lines.push("\nACTIVE GOALS:");
      clientData.goals.slice(0, 5).forEach(g => {
        const pct = g.target_value ? Math.round((g.current_value || 0) / g.target_value * 100) : 0;
        lines.push(`  - ${g.title}: ${g.current_value || 0}/${g.target_value || 0} ${g.unit || ""} (${pct}%) [${g.category}]`);
      });
    }

    // Habit completion rate this week
    if (clientData.habitSummary) {
      lines.push(`\nHABITS THIS WEEK: ${clientData.habitSummary.rate}% completion rate (${clientData.habitSummary.done}/${clientData.habitSummary.possible} total completions)`);
      if (clientData.habitSummary.names && clientData.habitSummary.names.length) {
        lines.push(`  Active habits: ${clientData.habitSummary.names.join(", ")}`);
      }
    }

    // Active programs
    if (clientData.programs && clientData.programs.length) {
      lines.push("\nACTIVE PROGRAMS:");
      clientData.programs.slice(0, 3).forEach(p => {
        const prog = p.programs || {};
        lines.push(`  - ${prog.title || p.program_name || "Program"}: Day ${p.days_completed || 0} of ${prog.duration_days || 30} (${p.status || "active"})`);
      });
    }
  }

  lines.push("");
  lines.push("Use their name naturally (not every message). Reference their data when relevant to what they say.");
  lines.push("If they have no programs yet, the free 7-Day Rebuild Reset is the right first suggestion.");
  return lines.join("\n");
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function getUserProfile(supabase, userId) {
  try {
    const { data } = await supabase.from("user_profiles").select("*").eq("id", userId).single();
    return data || null;
  } catch { return null; }
}

async function getClientData(supabase, userId) {
  if (!userId) return null;
  try {
    const todayISO = new Date().toISOString().split("T")[0];
    const sevenAgo = new Date(); sevenAgo.setDate(sevenAgo.getDate() - 7);
    const sevenISO = sevenAgo.toISOString().split("T")[0];

    const [soberRes, checkinRes, goalsRes, habitsRes, habitCompRes, programsRes] = await Promise.allSettled([
      supabase.from("sobriety_tracker").select("start_date,is_active").eq("user_id", userId).eq("is_active", true).order("start_date", { ascending: false }).limit(1),
      supabase.from("daily_checkins").select("mood,water_oz,sleep_hours,notes").eq("user_id", userId).eq("checkin_date", todayISO).limit(1),
      supabase.from("user_goals").select("title,category,target_value,current_value,unit").eq("user_id", userId).eq("is_active", true).limit(8),
      supabase.from("habits").select("id,title,emoji").eq("user_id", userId).eq("is_active", true),
      supabase.from("habit_completions").select("habit_id").eq("user_id", userId).gte("completed_date", sevenISO),
      supabase.from("user_program_progress").select("*, programs(title,duration_days,emoji)").eq("user_id", userId).eq("status", "active").limit(5),
    ]);

    const habits = habitsRes.value?.data || [];
    const comps = habitCompRes.value?.data || [];
    const possible = habits.length * 7;
    const habitSummary = {
      rate: possible ? Math.round(comps.length / possible * 100) : 0,
      done: comps.length,
      possible,
      names: habits.map(h => (h.emoji || "") + " " + h.title),
    };

    return {
      sobriety: soberRes.value?.data?.[0] || null,
      todayCheckin: checkinRes.value?.data?.[0] || null,
      goals: goalsRes.value?.data || [],
      habitSummary,
      programs: programsRes.value?.data || [],
    };
  } catch (e) {
    console.warn("getClientData failed (non-fatal):", e.message);
    return null;
  }
}

async function getContentContext(supabase) {
  try {
    const [scoutRes, echoRes, postsRes] = await Promise.allSettled([
      supabase.from("scout_history").select("top_theme, topics_covered").order("week_of", { ascending: false }).limit(1),
      supabase.from("echo_scores").select("best_pillar").order("created_at", { ascending: false }).limit(1),
      supabase.from("published_posts").select("caption_preview, post_type, platform").order("created_at", { ascending: false }).limit(3),
    ]);
    const scout = scoutRes.value?.data?.[0];
    const echo  = echoRes.value?.data?.[0];
    const posts = postsRes.value?.data || [];
    if (!scout && !echo && !posts.length) return "";
    let ctx = "\n\nCURRENT CONTENT CONTEXT — updated weekly:";
    if (scout?.top_theme)              ctx += `\nThis week's theme: ${scout.top_theme}`;
    if (scout?.topics_covered?.length) ctx += `\nTopics: ${scout.topics_covered.slice(0, 5).join(", ")}`;
    if (echo?.best_pillar)             ctx += `\nWhat resonates most: ${echo.best_pillar}`;
    posts.forEach((p) => {
      if (p.caption_preview) ctx += `\n- ${p.post_type || "Post"} (${p.platform || ""}): ${p.caption_preview.slice(0, 100)}`;
    });
    ctx += "\nReference this naturally when relevant.";
    return ctx;
  } catch { return ""; }
}

async function buildSystemPrompt(supabase, userId) {
  const [profile, clientData, contentCtx] = await Promise.all([
    userId ? getUserProfile(supabase, userId) : Promise.resolve(null),
    getClientData(supabase, userId),
    getContentContext(supabase),
  ]);
  return RILEY_BASE_PROMPT.replace("[USER_CONTEXT_PLACEHOLDER]", buildUserContext(profile, clientData)) + contentCtx;
}

async function persistMessages(supabase, userId, sessionId, userMsg, reply) {
  if (!userId || !sessionId || !reply) return;
  try {
    await supabase.from("riley_conversations").insert([
      { user_id: userId, session_id: sessionId, role: "user",      content: userMsg },
      { user_id: userId, session_id: sessionId, role: "assistant", content: reply },
    ]);
  } catch (e) { console.warn("persistMessages failed (non-fatal):", e.message); }
}

// ── Conversation history builder ──────────────────────────────────────────────
// Expects `messages` to be the full history array already including the current
// user turn at the end (the frontend pushes before calling this function).
// `message` is accepted for backward compatibility but never used to modify the
// array — doing so was the source of duplicate-user-turn bugs.
function buildConversationHistory(message, messages) {
  const MAX = 20;

  if (messages?.length) {
    // Validate shape and enforce alternating roles
    const valid = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-MAX);

    // Ensure the array ends with a user turn.
    // If somehow it ends with assistant (e.g. loaded from DB), append the current message.
    if (valid.length === 0 || valid[valid.length - 1].role === "assistant") {
      if (message) valid.push({ role: "user", content: message });
    }

    if (valid.length > 0) return valid;
  }

  // Fallback: just the current message
  return message ? [{ role: "user", content: message }] : [];
}

// ── Handler — standard Lambda format (no streaming wrapper needed) ────────────
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

  // Log the raw body first so we can see exactly what arrived
  console.log("[riley-chat] raw event.body:", event.body?.slice(0, 500));

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    console.error("[riley-chat] JSON parse failed on:", event.body?.slice(0, 200));
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { message, messages, user_id, session_id } = body;

  // Log parsed fields
  console.log(`[riley-chat] parsed — message="${message?.slice(0,50)}" messages.length=${messages?.length ?? "undefined"} user_id=${user_id || "anon"}`);

  if (!message && (!messages?.length)) {
    console.error("[riley-chat] 400 — no message and no messages array. body keys:", Object.keys(body));
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "messages array is required", received_keys: Object.keys(body) }),
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

  // Build context-aware system prompt (Supabase failures are non-fatal)
  let systemPrompt = RILEY_BASE_PROMPT.replace("[USER_CONTEXT_PLACEHOLDER]", buildUserContext(null));
  let supabase = null;
  try {
    supabase     = getSupabaseClient();
    systemPrompt = await buildSystemPrompt(supabase, user_id || null);
  } catch (e) {
    console.warn("Supabase context failed (non-fatal):", e.message);
  }

  const conversationHistory = buildConversationHistory(message, messages);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 1000,
      system:     systemPrompt,
      messages:   conversationHistory,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Anthropic API error:", response.status, err);
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Upstream API error", detail: err.slice(0, 200) }),
    };
  }

  const data  = await response.json();
  const reply = data.content?.[0]?.text || "";

  // Persist conversation for logged-in users (non-blocking)
  if (supabase && user_id && session_id && reply) {
    const userMsg = message || conversationHistory[conversationHistory.length - 1]?.content || "";
    persistMessages(supabase, user_id, session_id, userMsg, reply);
  }

  // Return plain text so the streaming client UI (getReader) works without
  // any special Netlify streaming infrastructure.
  // Client code: fullText += decoder.decode(value) → bubble.textContent = fullText ✓
  return {
    statusCode: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: reply,
  };
};
