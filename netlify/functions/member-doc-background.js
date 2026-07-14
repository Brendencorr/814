/**
 * member-doc-background.js - generates Riley-authored documents about a member.
 *
 * BACKGROUND function (generation is slow → -background = up to 15 min). The
 * client fires it and polls member_docs for the result.
 *
 *   doc_type "manual" → the Personal Operating Manual ("My User Manual") - the
 *     doc the member never wrote: I work best when… I get overwhelmed when… my
 *     warning signs… recharge by… encourage me by… don't…
 *   doc_type "story"  → the annual Story ("This is who you became").
 *
 * Both are written from the Life Map, Human OS, wins, and recent patterns.
 * POST { user_id, token?, doc_type, period? }
 * Model: claude-sonnet-4-6.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient, soberDaysForMember } = require("./supabase-client");

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (s, d) => ({ statusCode: s, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(d) });
function parseJSON(t) { let x = (t || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim(); const a = x.indexOf("{"), b = x.lastIndexOf("}"); if (a >= 0 && b > a) x = x.slice(a, b + 1); return JSON.parse(x); }

async function gather(sb, userId) {
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const [profR, mapR, ciR, soberR, lifeR] = await Promise.allSettled([
    sb.from("user_profiles").select("preferred_name,full_name,why_here,one_year_vision,human_os,communication_style,preferred_encouragement").eq("id", userId).maybeSingle(),
    sb.from("life_map").select("facet,content").eq("user_id", userId).eq("is_active", true).order("created_at", { ascending: false }).limit(120),
    sb.from("daily_checkins").select("mood,sleep_hours,checkin_date").eq("user_id", userId).gte("checkin_date", yearAgo).order("checkin_date", { ascending: false }).limit(120),
    sb.from("sobriety_tracker").select("start_date").eq("user_id", userId).eq("is_active", true).order("start_date", { ascending: false }).limit(1),
    sb.from("life_events").select("event_type,notes,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
  ]);
  const v = r => r.status === "fulfilled" ? r.value.data : null;
  const s = (v(soberR) || [])[0];
  return {
    profile: v(profR) || {},
    map: v(mapR) || [],
    checkins: v(ciR) || [],
    soberDays: s && s.start_date ? soberDaysForMember(s.start_date) : null,
    lifeEvents: v(lifeR) || [],
  };
}

function contextBlock(ctx) {
  const p = ctx.profile || {};
  const by = {};
  ctx.map.forEach(e => { (by[e.facet] = by[e.facet] || []).push(e.content); });
  const L = [];
  if (p.why_here) L.push(`Why they're here: ${p.why_here}`);
  if (p.one_year_vision) L.push(`One-year vision: ${p.one_year_vision}`);
  if (p.human_os) { try { L.push(`Human OS: ${JSON.stringify(p.human_os)}`); } catch (_) {} }
  if (p.communication_style) L.push(`Prefers communication: ${p.communication_style}`);
  if (p.preferred_encouragement) L.push(`Likes encouragement: ${p.preferred_encouragement}`);
  ["why", "vision", "recovery_dna", "win", "fear", "joy", "relationship", "value", "strength", "energy"].forEach(f => {
    if (by[f] && by[f].length) L.push(`${f}: ${by[f].slice(0, 12).join("; ")}`);
  });
  if (ctx.soberDays != null) {
    const yrs = Math.floor(ctx.soberDays / 365);
    const coarse = yrs >= 1 ? `${yrs}+ years into sobriety (for TONE only - do NOT write this number)` : "early months of sobriety (for TONE only)";
    L.push(`Sobriety: ${coarse}. When you reference how long they have been sober, write the EXACT literal token {{sober_days}} - never an actual number or date; it is filled in live at read time.`);
  }
  if (ctx.lifeEvents.length) L.push(`Life events: ${ctx.lifeEvents.map(e => e.event_type + (e.notes ? " (" + String(e.notes).slice(0, 60) + ")" : "")).join("; ")}`);
  const moods = ctx.checkins.filter(c => c.mood != null).map(c => c.mood);
  if (moods.length) L.push(`Recent moods (newest first, 1-5): ${moods.slice(0, 20).join(",")}`);
  return L.join("\n");
}

const MANUAL_SYS = `You are Riley, writing a "Personal Operating Manual" FOR a member of Meet Riley - the document they've never written about themselves, in a warm, affirming second-person voice ("You…"). Never assume the member's gender or pronouns; address them as "you", use singular "they" for any third-person reference, and use their stated pronouns only if given in the context. Always use a plain hyphen (-) for dashes, never em-dashes or en-dashes. Ground EVERY line in what you actually know about them below; never invent. If you lack signal for a section, OMIT that section entirely (do not include it) - NEVER write filler, placeholders, or invitations inside the prose (no "share more", "add more here", "tell me more", "we'd love to know", "know them by name"). You are Riley: write as "I" and "she", NEVER "we"/"us"/"our". When you reference how long they have been sober, write the exact literal token {{sober_days}} - never a number or a date.
Return ONLY JSON: {"summary":"2-3 warm sentences on who they are at their best","sections":[{"title":"You work best when","items":["…"]},{"title":"You get overwhelmed when","items":[…]},{"title":"Your warning signs","items":[…]},{"title":"You recharge by","items":[…]},{"title":"When you're low, you tend to","items":[…]},{"title":"Encourage you by","items":[…]},{"title":"Please don't","items":[…]},{"title":"Your coping strategies that work","items":[…]},{"title":"The people who matter","items":[…]}]}. Keep items short and specific. No preamble, JSON only.`;

const STORY_SYS = `You are Riley, writing a member of Meet Riley their personal Story - "This is who you became." Warm, honest, second-person ("You…"), never saccharine. Never assume the member's gender or pronouns; address them as "you", use singular "they" for any third-person reference, and use their stated pronouns only if given in the context. Always use a plain hyphen (-) for dashes, never em-dashes or en-dashes. Ground it ONLY in what you know below (wins, changes, events, moods over time, their why and vision). It's a chapter of a life, not only recovery. If there's little to go on yet, write a short, hopeful "beginning of the story" instead of inventing. You are Riley: write as "I" and "she", NEVER "we"/"us"/"our". Never write filler or invitations to add more. When you reference how long they have been sober, write the exact literal token {{sober_days}} - never a number or a date.
Return ONLY JSON: {"title":"a title for this chapter of their story","sections":[{"heading":"short heading","body":"a paragraph"}, … 3-6 sections covering what they overcame, how they changed, their wins, relationships, and who they're becoming]}. JSON only.`;

// ── Output hygiene lint (P0.2): scrub generation scaffolding, first-person-plural, and em-dashes;
// tokenize any baked day-count so stored prose can never go stale (the token fills live at render). ──
function scrubText(t) {
  if (!t || typeof t !== "string") return t;
  return t
    .replace(/[—–]/g, "-")                                  // em/en dash -> hyphen
    .replace(/\bwe'd\b/gi, "I'd").replace(/\bwe would\b/gi, "I would")
    .replace(/\bwe've\b/gi, "I've").replace(/\bwe're\b/gi, "I'm").replace(/\bwe'll\b/gi, "I'll")
    .replace(/\btell us\b/gi, "tell me").replace(/\blet us\b/gi, "let me")
    .replace(/\bwe'd love to know\b/gi, "").replace(/\bwe would love to\b/gi, "I'd love to")
    .replace(/\b\d{1,3}(?:,\d{3})*\+?\s+days\s+sober\b/gi, "{{sober_days}} days sober")
    .replace(/\bsober\s+(?:for\s+)?\d{1,3}(?:,\d{3})*\s+days\b/gi, "sober {{sober_days}} days")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
function isScaffold(s) {
  return /share more|add more|tell (?:me|us) more|we'?d love|more here|doing this long enough|know them by name|add one below|nothing here yet/i.test(String(s || ""));
}
function lintDoc(doc) {
  if (!doc || typeof doc !== "object") return doc;
  if (doc.summary) doc.summary = scrubText(doc.summary);
  if (doc.title) doc.title = scrubText(doc.title);
  if (Array.isArray(doc.sections)) {
    doc.sections = doc.sections.map(function (sec) {
      const out = Object.assign({}, sec);
      if (out.title) out.title = scrubText(out.title);
      if (out.heading) out.heading = scrubText(out.heading);
      if (out.body) out.body = scrubText(out.body);
      if (Array.isArray(out.items)) out.items = out.items.map(scrubText).filter(function (x) { return x && !isScaffold(x); });
      return out;
    }).filter(function (sec) { return Array.isArray(sec.items) ? sec.items.length > 0 : (sec.body || sec.heading || sec.title); });
  }
  doc._v = 2; // tokenized + linted
  return doc;
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const docType = body.doc_type === "story" ? "story" : "manual";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server configuration error" });
  let sb; try { sb = getSupabaseClient(); } catch { return json(500, { error: "Server configuration error" }); }
  // SECURITY: identity from the verified token only - never body.user_id (this reads a member's
  // deepest personal data + overwrites their doc; a forged user_id would expose/clobber anyone's).
  let userId = null;
  try { const { data } = await sb.auth.getUser(body.token); userId = data?.user?.id || null; } catch (_) {}
  if (!userId) return json(401, { error: "Unauthorized" });

  const ctx = await gather(sb, userId);
  const nm = (ctx.profile.preferred_name || ctx.profile.full_name || "").split(" ")[0] || "friend";
  const sys = docType === "story" ? STORY_SYS : MANUAL_SYS;
  const period = docType === "story" ? (body.period || String(new Date().getUTCFullYear())) : null;
  const userMsg = `Member first name: ${nm}${period ? `\nStory period: ${period}` : ""}\n\nWhat you know about them:\n${contextBlock(ctx) || "(very little yet - write a warm beginning)"}`;

  let doc;
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2500, system: sys, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!resp.ok) { console.error("Anthropic error", resp.status); return json(502, { error: "upstream" }); }
    const d = await resp.json();
    doc = lintDoc(parseJSON(d.content?.[0]?.text || ""));
  } catch (e) { console.error("member-doc gen failed:", e.message); return json(500, { error: "generation failed" }); }

  try {
    await sb.from("member_docs").update({ is_active: false }).eq("user_id", userId).eq("doc_type", docType).eq("is_active", true);
    await sb.from("member_docs").insert({ user_id: userId, doc_type: docType, period, body: doc, is_active: true });
  } catch (e) { console.warn("member-doc cache failed:", e.message); }

  return json(200, { ok: true, doc_type: docType });
};
