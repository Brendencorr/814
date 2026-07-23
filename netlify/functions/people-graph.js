/**
 * people-graph.js - the structured people layer behind "People Who Matter" (upgrade #3).
 *
 * member_people rows (name / role / sentiment / mention recency) let Riley ask about a
 * member's people BY NAME at the right cadence - "How's Ava settling in?" - which is the
 * most human-feeling recall there is. Fed two ways, both from the existing memory-extraction
 * cadence (no extra Haiku calls):
 *   • upsertPerson: when extraction identifies a specific person (facet 'relationship').
 *   • bumpMentions: cheap regex scan of the member's recent messages against KNOWN names,
 *     so recency stays honest even when nothing new is extracted.
 *
 * All fail-open; the life_map relationship chips (member-facing UI) are untouched.
 */
'use strict';

const SENTIMENTS = ["warm", "strained", "complicated"];

function cleanName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  // A real personal name, not a pronoun/role word that slipped through.
  if (!n || n.length < 2 || !/^[A-Za-z][A-Za-z .'-]*$/.test(n)) return null;
  if (/^(mom|dad|mother|father|wife|husband|partner|sponsor|therapist|boss|friend|brother|sister|son|daughter|he|she|they)$/i.test(n)) return null;
  return n;
}

async function upsertPerson(supabase, userId, p) {
  try {
    const name = cleanName(p && p.name);
    if (!supabase || !userId || !name) return;
    const role = p.role ? String(p.role).slice(0, 80) : null;
    const sentiment = SENTIMENTS.includes(p.sentiment) ? p.sentiment : null;
    const nowISO = new Date().toISOString();
    const { data: existing } = await supabase.from("member_people").select("id,mention_count,role,sentiment")
      .eq("user_id", userId).ilike("name", name).limit(1);
    if (existing && existing.length) {
      const e = existing[0];
      await supabase.from("member_people").update({
        mention_count: (e.mention_count || 0) + 1, last_mentioned_at: nowISO, is_active: true,
        role: role || e.role, sentiment: sentiment || e.sentiment,
      }).eq("id", e.id);
    } else {
      await supabase.from("member_people").insert({ user_id: userId, name, role, sentiment, last_mentioned_at: nowISO });
    }
  } catch (e) { console.warn("people-graph upsert failed (non-fatal):", e.message); }
}

// Bump last_mentioned_at for KNOWN people named in the member's recent messages.
async function bumpMentions(supabase, userId, conversation) {
  try {
    if (!supabase || !userId || !Array.isArray(conversation)) return;
    const text = conversation.filter((m) => m.role === "user").slice(-10)
      .map((m) => String(m.content || "")).join("\n");
    if (!text) return;
    const { data: people } = await supabase.from("member_people").select("id,name,mention_count")
      .eq("user_id", userId).eq("is_active", true).limit(30);
    if (!people || !people.length) return;
    const nowISO = new Date().toISOString();
    for (const p of people) {
      const esc = String(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${esc}\\b`, "i").test(text)) {
        await supabase.from("member_people").update({ last_mentioned_at: nowISO, mention_count: (p.mention_count || 0) + 1 }).eq("id", p.id);
      }
    }
  } catch (e) { console.warn("people-graph bump failed (non-fatal):", e.message); }
}

module.exports = { upsertPerson, bumpMentions, cleanName };
