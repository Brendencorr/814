/**
 * member-doc-background.js — generates Riley-authored documents about a member.
 *
 * BACKGROUND function (generation is slow → -background = up to 15 min). The
 * client fires it and polls member_docs for the result.
 *
 *   doc_type "manual" → the Personal Operating Manual ("My User Manual") — the
 *     doc the member never wrote: I work best when… I get overwhelmed when… my
 *     warning signs… recharge by… encourage me by… don't…
 *   doc_type "story"  → the annual Story ("This is who you became").
 *
 * Both are written from the Life Map, Human OS, wins, and recent patterns.
 * POST { user_id, token?, doc_type, period? }
 * Model: claude-sonnet-4-6.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const { getSupabaseClient } = require("./supabase-client");

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
    soberDays: s && s.start_date ? Math.max(0, Math.floor((Date.now() - new Date(s.start_date)) / 86400000)) : null,
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
  if (ctx.soberDays != null) L.push(`${ctx.soberDays} days sober`);
  if (ctx.lifeEvents.length) L.push(`Life events: ${ctx.lifeEvents.map(e => e.event_type + (e.notes ? " (" + String(e.notes).slice(0, 60) + ")" : "")).join("; ")}`);
  const moods = ctx.checkins.filter(c => c.mood != null).map(c => c.mood);
  if (moods.length) L.push(`Recent moods (newest first, 1-5): ${moods.slice(0, 20).join(",")}`);
  return L.join("\n");
}

const MANUAL_SYS = `You are Riley, writing a "Personal Operating Manual" FOR a member of The 8:14 Project — the document they've never written about themselves, in a warm, affirming second-person voice ("You…"). Ground EVERY line in what you actually know about them below; never invent. If you lack signal for a section, give one gentle, honest placeholder line inviting them to tell you.
Return ONLY JSON: {"summary":"2-3 warm sentences on who they are at their best","sections":[{"title":"You work best when","items":["…"]},{"title":"You get overwhelmed when","items":[…]},{"title":"Your warning signs","items":[…]},{"title":"You recharge by","items":[…]},{"title":"When you're low, you tend to","items":[…]},{"title":"Encourage you by","items":[…]},{"title":"Please don't","items":[…]},{"title":"Your coping strategies that work","items":[…]},{"title":"The people who matter","items":[…]}]}. Keep items short and specific. No preamble, JSON only.`;

const STORY_SYS = `You are Riley, writing a member of The 8:14 Project their personal Story — "This is who you became." Warm, honest, second-person ("You…"), never saccharine. Ground it ONLY in what you know below (wins, changes, events, moods over time, their why and vision). It's a chapter of a life, not only recovery. If there's little to go on yet, write a short, hopeful "beginning of the story" instead of inventing.
Return ONLY JSON: {"title":"a title for this chapter of their story","sections":[{"heading":"short heading","body":"a paragraph"}, … 3-6 sections covering what they overcame, how they changed, their wins, relationships, and who they're becoming]}. JSON only.`;

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const docType = body.doc_type === "story" ? "story" : "manual";
  let userId = body.user_id || null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(500, { error: "Server configuration error" });
  let sb; try { sb = getSupabaseClient(); } catch { return json(500, { error: "Server configuration error" }); }
  if (body.token) { try { const { data } = await sb.auth.getUser(body.token); if (data?.user?.id) userId = data.user.id; } catch (_) {} }
  if (!userId) return json(400, { error: "user_id required" });

  const ctx = await gather(sb, userId);
  const nm = (ctx.profile.preferred_name || ctx.profile.full_name || "").split(" ")[0] || "friend";
  const sys = docType === "story" ? STORY_SYS : MANUAL_SYS;
  const period = docType === "story" ? (body.period || String(new Date().getUTCFullYear())) : null;
  const userMsg = `Member first name: ${nm}${period ? `\nStory period: ${period}` : ""}\n\nWhat you know about them:\n${contextBlock(ctx) || "(very little yet — write a warm beginning)"}`;

  let doc;
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2500, system: sys, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!resp.ok) { console.error("Anthropic error", resp.status); return json(502, { error: "upstream" }); }
    const d = await resp.json();
    doc = parseJSON(d.content?.[0]?.text || "");
  } catch (e) { console.error("member-doc gen failed:", e.message); return json(500, { error: "generation failed" }); }

  try {
    await sb.from("member_docs").update({ is_active: false }).eq("user_id", userId).eq("doc_type", docType).eq("is_active", true);
    await sb.from("member_docs").insert({ user_id: userId, doc_type: docType, period, body: doc, is_active: true });
  } catch (e) { console.warn("member-doc cache failed:", e.message); }

  return json(200, { ok: true, doc_type: docType });
};
