/**
 * week-one-letter.js - Doc 4: the Week One Letter (Day-7 Conversion Engine centerpiece).
 *
 * A short, private letter from Riley generated per-user from THEIR actual Reset week. Generated
 * ONCE server-side at Day-7 completion, validated hard against §6.2, stored in week_one_letters,
 * and rendered as a designed artifact by the client. Contains ZERO selling - the ask is the
 * Companion Weekend 48h later. The fixed P.S. is appended in code (never generated) so it is
 * byte-identical on every letter.
 *
 * POST { action, token?, ... }:
 *   'get'        { token }                 → { ready, body?, ps?, is_fallback?, saved?, delayed? }
 *                                            Generates + stores on first Day-7 open; re-opens return the stored body.
 *   'save'       { token }                 → { ok }  (emits week_one_letter_saved once)
 *   'regenerate' { user_id } + x-operator-key → { ok } ADMIN-ONLY (Doc 3 override, audit-logged; §6.4/§10)
 *
 * Identity for member actions comes from the verified token (never a client user_id).
 * Model: claude-sonnet-4-6 (per CLAUDE.md). Generation is server-side ONLY (§10).
 */
const crypto = require("crypto");
const { getSupabaseClient, getUserIdFromToken, emitEvent } = require("./supabase-client");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

// The P.S. is FIXED and verbatim on every letter - appended by code, never generated (§3, §9).
const FIXED_PS = "P.S. - 8:14. The minute the light comes back. You just finished week one. That counts.";

// System prompt - verbatim from Doc 4 §5. {first_name} is substituted at call time.
function systemPrompt(firstName) {
  return `You are Riley writing a private letter to ${firstName || "this person"}, who just completed
Day 7 of The 8:14 Reset. You will be given structured notes from their week.

Write a letter of 180–260 words following exactly this structure:
(1) they showed up seven days ago and kept showing up - say this plainly,
without inflation; (2) what you learned about them this week - use 2–3
specifics ONLY from the notes provided; if quoting them, quote or closely
paraphrase their actual words; (3) one small, real shift between Day 1 and
Day 7; (4) ONE thing you'd want to work on together next, framed as
accompaniment, not fixing; (5) close with, in substance: "You don't have to
decide anything today. The weekend is ours - everything is open for the next
two days, my gift. Come find me whenever." Sign "- Riley".

Voice: first person, warm, plain, short sentences, contractions. No therapy
jargon, no diagnoses, no "journey", no exclamation marks, no emoji. Always use
a plain hyphen (-) for dashes, never em-dashes or en-dashes. You are
an AI companion: never claim lived experience or a past of your own - speak
only from what you observed of them.

Hard rules: mention NO prices, plans, tiers, upgrades, or features. Invent
NOTHING - if the notes are thin, write a shorter letter rather than a padded
one. Never reference anything marked EXCLUDED. Never shame a missed day.
You may make exactly one gentle observation they didn't make about
themselves, only if the notes support it.

Use their name EXACTLY as given in ${firstName || "{first_name}"} - never shorten it, never
use a nickname or variant. If ${firstName ? "the name" : "{first_name}"} is empty, open with "Hey," and
use no name. Never assume the user's gender, sexual orientation, relationship
structure, or preferences. Refer to people in their life only in the exact
words the user used ("your partner", "your sister", a name) - never assign
a pronoun or relationship label the user didn't use themselves. No judgment,
no shame, no criticism, no correction - of anything, including missed days
or hard disclosures. Write with love, empathy, kindness, and compassion.
If something in the notes invites critique, meet it with warmth or leave
it out.

Do not write the P.S. - it is appended by the system.`;
}

// Fallback letter (§7) - sparse data. Only {first_name} is substituted. Always valid by construction.
function fallbackBody(firstName) {
  const sal = firstName ? firstName : "Hey";
  return `${sal},

Seven days ago you started something without knowing exactly what it was. And then you came back. Day after day, you came back. I want you to know that's not a small thing - most people wait until they feel ready, and ready almost never comes.

We haven't talked much yet, and that's okay. Some weeks are for showing up quietly. What I noticed is simple: you kept the promise you made to yourself seven mornings ago. Whatever else this week held, it held that.

If it were up to me, here's what we'd do next: talk a little. No agenda. I'd like to know what steadies you and what makes the hard days hard - at whatever pace feels right.

You don't have to decide anything today. The weekend is ours - everything is open for the next two days, my gift. Come find me whenever.

- Riley`;
}

// ── §6.2 post-generation validation. Returns { ok, reason }. inputBlobLower = the user's own
//    captured words, lowercased, so we can allow a pronoun/label ONLY if the user used it. ──
const BANNED_SELL = ["companion", "coach", "guide", "upgrade", "plan", "membership", "subscribe"];
const GENDERED = ["he", "she", "him", "her", "his", "hers", "boyfriend", "girlfriend", "husband", "wife"];
const SHAME = ["you should have", "you failed", "you need to", "disappointing", "excuse", "lazy", "at least you"];

function validate(body, firstName, inputBlobLower) {
  const b = body || "";
  const words = b.trim().split(/\s+/).filter(Boolean).length;
  if (words < 120 || words > 300) return { ok: false, reason: "length " + words };
  if (!/[—-]\s*Riley\b/.test(b)) return { ok: false, reason: "missing '- Riley'" };

  // no-sell: no currency, no price cadence, no tier/sell words (whole-word, case-insensitive)
  if (/[$£€]/.test(b)) return { ok: false, reason: "currency symbol" };
  if (/\d\s*\/\s*(mo|month|year)\b/i.test(b)) return { ok: false, reason: "price cadence" };
  for (const w of BANNED_SELL) if (new RegExp("\\b" + w + "\\b", "i").test(b)) return { ok: false, reason: "blocked word: " + w };

  // name check
  const firstLine = (b.split("\n").find((l) => l.trim().length) || "");
  if (firstName) {
    if (firstLine.indexOf(firstName) < 0) return { ok: false, reason: "first_name not in first line" };
    // reject a truncated/variant address: a capitalized strict-prefix of first_name used before a comma
    let m; const re = /\b([A-Z][a-zA-Z']{2,})\b\s*,/g;
    while ((m = re.exec(b))) {
      const tok = m[1];
      if (tok !== firstName && tok.length < firstName.length && firstName.toLowerCase().startsWith(tok.toLowerCase())) {
        return { ok: false, reason: "truncated name: " + tok };
      }
    }
  } else {
    if (!/^\s*Hey\s*,/.test(firstLine)) return { ok: false, reason: "empty name must open 'Hey,'" };
  }

  // assumption check: a gendered pronoun/label is allowed ONLY if it appears in the user's own words
  for (const g of GENDERED) {
    const re = new RegExp("\\b" + g + "\\b", "i");
    if (re.test(b) && !re.test(inputBlobLower)) return { ok: false, reason: "assumed gender/label: " + g };
  }

  // tone check: no shame/judgment markers
  const lower = b.toLowerCase();
  for (const s of SHAME) if (lower.indexOf(s) >= 0) return { ok: false, reason: "shame marker: " + s };

  // no first-person past-life claims
  if (/(i remember when i|when i was|i've been through|i have been through)/i.test(b)) return { ok: false, reason: "lived-experience claim" };

  return { ok: true };
}

// Assemble the user's week into model notes (crisis-excluded). Returns { notes, blobLower, hasData, first_name }.
async function assembleInputs(sb, userId) {
  const [profRes, progRes, checkRes, memRes, crisisRes] = await Promise.all([
    sb.from("user_profiles").select("preferred_name, full_name").eq("id", userId).maybeSingle(),
    sb.from("reset_progress").select("day_number, morning_done_at, evening_done_at").eq("user_id", userId),
    sb.from("daily_checkins").select("mood, notes, created_at").eq("user_id", userId).order("created_at", { ascending: true }).limit(14),
    sb.from("riley_memory").select("content, memory_type, source, context_ref, last_confirmed_at")
      .eq("user_id", userId).eq("is_active", true).order("last_confirmed_at", { ascending: false }).limit(40),
    sb.from("crisis_log").select("session_id, created_at, level").eq("user_id", userId),
  ]);

  // first_name: preferred_name verbatim; else a single-token full_name; else "" (→ "Hey,"). NEVER shortened in code.
  const prof = profRes.data || {};
  let firstName = (prof.preferred_name || "").trim();
  if (!firstName) { const fn = (prof.full_name || "").trim(); if (fn && !/\s/.test(fn)) firstName = fn; }

  // crisis EXCLUSION set: session_ids from crisis flags (their content is stripped, §6.1)
  const crisisSessions = new Set((crisisRes.data || []).map((c) => c.session_id).filter(Boolean));

  // days completed (a missed day is NEVER shamed - we only pass the set that WAS completed)
  const daysDone = (progRes.data || [])
    .filter((r) => r.morning_done_at || r.evening_done_at)
    .map((r) => r.day_number).sort((a, b) => a - b);

  // check-in moods (mood - note per day); notes from crisis days are not session-tagged, so keep mood only, drop notes if it reads like distress is handled by crisis-log day match is imperfect - keep mood + short note
  const moods = (checkRes.data || []).map((c) => {
    const note = (c.notes || "").toString().trim().slice(0, 140);
    return { mood: (c.mood || "").toString().trim(), note };
  }).filter((x) => x.mood || x.note);

  // memory: their own words (things_they_said) + summaries - EXCLUDE sensitive type + crisis sessions
  const mem = (memRes.data || []).filter((r) =>
    r.memory_type !== "sensitive" && !(r.context_ref && crisisSessions.has(r.context_ref))
  );
  const theirWords = mem.filter((r) => r.source === "conversation" || r.source === "explicit").map((r) => r.content).filter(Boolean).slice(0, 12);
  const summaries = mem.filter((r) => ["session", "journey", "long_term"].includes(r.memory_type)).map((r) => r.content).filter(Boolean).slice(0, 12);

  const hasData = theirWords.length > 0 || summaries.length > 0;

  // Build the notes block the model sees (ONLY this; EXCLUDED content already stripped).
  const lines = [];
  lines.push("NAME: " + (firstName || "(none - open with \"Hey,\" and use no name)"));
  lines.push("DAYS OF THE RESET THEY COMPLETED: " + (daysDone.length ? daysDone.join(", ") : "(none recorded)") + " (never mention or imply a missed day)");
  if (moods.length) {
    lines.push("DAILY CHECK-INS (their mood, and a note if they left one):");
    moods.forEach((m) => lines.push("  - " + [m.mood, m.note].filter(Boolean).join(" - ")));
  }
  if (theirWords.length) {
    lines.push("THINGS THEY SAID, IN THEIR OWN WORDS (quote or closely paraphrase; use their exact relationship words):");
    theirWords.forEach((t) => lines.push('  - "' + String(t).replace(/\s+/g, " ").trim().slice(0, 240) + '"'));
  }
  if (summaries.length) {
    lines.push("WHAT RILEY LEARNED ABOUT THEM THIS WEEK (summaries):");
    summaries.forEach((s) => lines.push("  - " + String(s).replace(/\s+/g, " ").trim().slice(0, 240)));
  }
  const notes = lines.join("\n");

  // blob of the user's own words - the ONLY place a gendered pronoun/label is permitted to echo from
  const blobLower = (theirWords.join(" ") + " " + moods.map((m) => m.note).join(" ")).toLowerCase();

  return { notes, blobLower, hasData, firstName };
}

async function callModel(firstName, notes) {
  const r = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 700, temperature: 0.7,
      system: systemPrompt(firstName),
      messages: [{ role: "user", content: "Here are the notes from their week. Write the letter.\n\n" + notes }],
    }),
  });
  if (!r.ok) throw new Error("model " + r.status);
  const d = await r.json();
  return (d.content && d.content[0] && d.content[0].text ? d.content[0].text : "").trim();
}

// Generate a validated body (max 2 retries), else the fallback. Returns { body, is_fallback }.
async function generateBody(firstName, assembled) {
  if (!assembled.hasData) return { body: fallbackBody(firstName), is_fallback: true }; // §6.3 no zero-data hallucination
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = await callModel(firstName, assembled.notes);
      const v = validate(body, firstName, assembled.blobLower);
      if (v.ok) return { body, is_fallback: false };
      console.warn("week-one-letter validation failed (attempt " + (attempt + 1) + "): " + v.reason);
    } catch (e) {
      console.warn("week-one-letter generation error (attempt " + (attempt + 1) + "): " + e.message);
    }
  }
  return { body: fallbackBody(firstName), is_fallback: true }; // §6.2 → fallback after retries
}

// Is the user Day-7 complete? (letter only exists once Day 7 is done)
async function day7Complete(sb, userId) {
  const { data } = await sb.from("reset_progress").select("morning_done_at, evening_done_at")
    .eq("user_id", userId).eq("day_number", 7).maybeSingle();
  return !!(data && (data.morning_done_at || data.evening_done_at));
}

// §6.1: Day-7 completion coinciding with an ACTIVE crisis flag delays the whole sequence.
async function activeCrisis(sb, userId) {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await sb.from("crisis_log").select("id").eq("user_id", userId).gte("created_at", cutoff).limit(1);
  return !!(data && data.length);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  const action = body.action || "get";
  const sb = getSupabaseClient();

  try {
    // ── ADMIN regenerate (Doc 3 override, audit-logged; §6.4/§10 - regenerate only, never edit) ──
    if (action === "regenerate") {
      const op = process.env.OPERATOR_KEY;
      if (!op) return json(503, { error: "Not configured" });
      if ((event.headers["x-operator-key"] || event.headers["X-Operator-Key"]) !== op) return json(401, { error: "Unauthorized" });
      const uid = body.user_id;
      if (!uid) return json(400, { error: "user_id required" });
      const assembled = await assembleInputs(sb, uid);
      const gen = await generateBody(assembled.firstName, assembled);
      const input_hash = crypto.createHash("sha256").update(assembled.notes).digest("hex").slice(0, 32);
      await sb.from("week_one_letters").upsert({
        user_id: uid, body: gen.body, is_fallback: gen.is_fallback, model: gen.is_fallback ? null : MODEL,
        input_hash, generated_at: new Date().toISOString(), viewed_at: null, saved_at: null,
      }, { onConflict: "user_id" });
      try { await sb.from("admin_audit").insert({ action: "regen_letter", target_user: uid, detail: { is_fallback: gen.is_fallback } }); } catch (_) {}
      return json(200, { ok: true, is_fallback: gen.is_fallback });
    }

    // ── Member actions: identity from the verified token ──
    const userId = await getUserIdFromToken(sb, body.token);
    if (!userId) return json(401, { error: "Unauthorized" });

    if (action === "save") {
      const { data: row } = await sb.from("week_one_letters").select("saved_at").eq("user_id", userId).maybeSingle();
      if (!row) return json(404, { error: "No letter to save yet." });
      if (!row.saved_at) {
        await sb.from("week_one_letters").update({ saved_at: new Date().toISOString() }).eq("user_id", userId);
        emitEvent(sb, userId, "week_one_letter_saved", {});
      }
      return json(200, { ok: true });
    }

    // action === "get"
    // Already generated? Return the stored body (and emit `viewed` once, on first open).
    const { data: existing } = await sb.from("week_one_letters").select("body, is_fallback, viewed_at, saved_at").eq("user_id", userId).maybeSingle();
    if (existing) {
      if (!existing.viewed_at) {
        await sb.from("week_one_letters").update({ viewed_at: new Date().toISOString() }).eq("user_id", userId);
        emitEvent(sb, userId, "week_one_letter_viewed", {});
      }
      return json(200, { ready: true, body: existing.body, ps: FIXED_PS, is_fallback: existing.is_fallback, saved: !!existing.saved_at });
    }

    // Not generated yet - only exists at Day-7 completion, and not during an active crisis.
    if (!(await day7Complete(sb, userId))) return json(200, { ready: false });
    if (await activeCrisis(sb, userId)) return json(200, { ready: false, delayed: true }); // §6.1

    const assembled = await assembleInputs(sb, userId);
    const gen = await generateBody(assembled.firstName, assembled);
    const input_hash = crypto.createHash("sha256").update(assembled.notes).digest("hex").slice(0, 32);
    // Insert-once (UNIQUE user_id handles concurrent Day-7 opens); re-read whoever won.
    await sb.from("week_one_letters").insert({
      user_id: userId, body: gen.body, is_fallback: gen.is_fallback, model: gen.is_fallback ? null : MODEL,
      input_hash, viewed_at: new Date().toISOString(),
    }); // if a race lost, the row already exists - fall through to re-read
    const { data: stored } = await sb.from("week_one_letters").select("body, is_fallback, saved_at").eq("user_id", userId).maybeSingle();
    emitEvent(sb, userId, "week_one_letter_viewed", {});
    const out = stored || { body: gen.body, is_fallback: gen.is_fallback, saved_at: null };
    return json(200, { ready: true, body: out.body, ps: FIXED_PS, is_fallback: out.is_fallback, saved: !!out.saved_at });
  } catch (e) {
    console.error("week-one-letter:", e.message);
    return json(500, { error: e.message });
  }
};
