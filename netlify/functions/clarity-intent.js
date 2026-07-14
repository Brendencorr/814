/**
 * clarity-intent.js - A.2 conversational Clarity config. Members change what Clarity tracks/watches
 * by telling Riley in chat. Deterministic intent detection + an apply path that goes through the SAME
 * config system as the pane (same budget: 1 change / 7 days, same next-4am-rollover apply, same
 * config_version bump, event source:'chat'). Foundation (free) members can only change TRACKING
 * choices + fuel; "watching" intents get the honest one-line Companion answer (handled by the caller).
 *
 * detectClarityConfigIntent(text) -> { op, target, targetType } | null
 * applyClarityConfigChange(supabase, userId, today, intent, isFull) -> { status, ... }  (never throws)
 */
'use strict';
const { validateConfig, effectiveConfig, nextAppDay } = require("./clarity-config-util");

const DAY_MS = 86400000;
const PRACTICE_DIMS = ["movement", "habits", "reflection", "program", "outside", "connection"];

// dim/lane/fuel keyword matchers (first match wins; order matters for specificity).
const TARGETS = [
  { key: "fuel",       type: "fuel", re: /\b(fuel|food|meals?|eating|nutrition|nourish)\b/i },
  { key: "sobriety",   type: "lane", re: /\b(sobriety|sober|drinking|drink|recovery|substance)\b/i },
  { key: "grief",      type: "lane", re: /\b(grief|grieving|loss|mourning)\b/i },
  { key: "movement",   type: "dim",  re: /\b(movement|workout|exercise|fitness|walk|walking|gym|training|activity)\b/i },
  { key: "reflection", type: "dim",  re: /\b(reflect\w*|journal\w*|meditat\w*|stillness|writing|breathwork)\b/i },
  { key: "habits",     type: "dim",  re: /\bhabits?\b/i },
  { key: "program",    type: "dim",  re: /\bprogram\b/i },
  { key: "outside",    type: "dim",  re: /\b(outside|outdoors|nature|fresh air|sunshine)\b/i },
  { key: "connection", type: "dim",  re: /\b(connection|connect|social|reaching out|other people|human contact)\b/i },
];

const QUERY_RE   = /\bwhat('?s| is| are| does)?\b[^.?!]*\bclarity\b[^.?!]*\b(watch|watching|track|tracking|count|counting|look|looking|measur)/i;
const DISABLE_RE = /\b(stop|don'?t|do not|no longer|turn off|turn it off|remove|drop|quit|take (?:out|off)|unwatch|exclude|ignore)\b/i;
const ENABLE_RE  = /\b(start|add|count|track|watch|include|turn on|turn it on|begin|put back|bring back|re-?add|re-?enable)\b/i;
// scope guard: only treat as a config intent if the message is plausibly about Clarity/tracking/fuel.
const CONFIG_CONTEXT_RE = /\b(clarity|track|tracking|count|counting|watch|watching|score|lane|dim|dimension|fuel)\b/i;

function detectClarityConfigIntent(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length > 240) return null;                 // config asks are short; skip long messages
  if (!CONFIG_CONTEXT_RE.test(t)) return null;     // must be about clarity/tracking/fuel (false-positive guard)
  // An explicit enable/disable on a known target wins. DISABLE takes precedence over ENABLE so
  // "stop counting X" (which contains both "stop" and "counting") reads as a disable, not a toggle.
  const hit = TARGETS.find((x) => x.re.test(t));
  if (hit) {
    if (DISABLE_RE.test(t)) return { op: "disable", target: hit.key, targetType: hit.type };
    if (ENABLE_RE.test(t))  return { op: "enable",  target: hit.key, targetType: hit.type };
  }
  // Otherwise, a question about what Clarity is watching.
  if (QUERY_RE.test(t)) return { op: "query", target: null, targetType: null };
  return null;
}

// Apply a detected change through the config system. Returns a status the caller injects into Riley's
// context so Riley can acknowledge naturally. Never throws.
async function applyClarityConfigChange(supabase, userId, today, intent, isFull) {
  try {
    if (!intent || intent.op === "query") {
      const cur = await loadConfig(supabase, userId, today);
      return { status: "query", config: cur };
    }
    // Foundation (free) members: only fuel is theirs to change here; watching intents defer to Companion.
    if (!isFull && intent.targetType !== "fuel") {
      return { status: "companion_only", target: intent.target, targetType: intent.targetType };
    }
    const row = await loadRow(supabase, userId);
    const eff = effectiveConfig(row, today);
    const cur = eff.config || { enabled_practice: [], fuel_opt_out: false, lanes: {} };

    // Budget: 1 change / 7 days (same as the pane). If used, offer to queue (caller phrases it warmly).
    if (row && row.last_changed_at) {
      const since = Date.now() - Date.parse(row.last_changed_at);
      if (isFinite(since) && since < 7 * DAY_MS) {
        return { status: "rate_limited", next_allowed: new Date(Date.parse(row.last_changed_at) + 7 * DAY_MS).toISOString().slice(0, 10), intent };
      }
    }

    const next = { enabled_practice: (cur.enabled_practice || []).slice(), fuel_opt_out: !!cur.fuel_opt_out, lanes: Object.assign({}, cur.lanes || {}) };
    if (intent.targetType === "fuel") {
      next.fuel_opt_out = (intent.op === "disable");                 // "turn off fuel" -> opt out
    } else if (intent.targetType === "lane") {
      next.lanes[intent.target] = (intent.op === "enable");
    } else { // practice dim
      const has = next.enabled_practice.indexOf(intent.target) >= 0;
      if (intent.op === "enable") {
        if (!has) {
          if (next.enabled_practice.length >= 5) return { status: "needs_rest", current: next.enabled_practice.slice(), adding: intent.target };
          next.enabled_practice.push(intent.target);
        }
      } else {
        next.enabled_practice = next.enabled_practice.filter((d) => d !== intent.target);
      }
    }

    const config = validateConfig(next);
    const applyOn = nextAppDay(today);
    const nowISO = new Date().toISOString();
    await supabase.from("user_clarity_config").upsert({
      user_id: userId,
      config: cur,                                  // current stays live until rollover
      config_version: (row && row.config_version) || 1,
      pending_config: config, pending_apply_on: applyOn, last_changed_at: nowISO,
      onboarding_stage: (row && row.onboarding_stage) || 0,
    }, { onConflict: "user_id" });
    try { const { emitEvent } = require("./supabase-client"); emitEvent(supabase, userId, "clarity_config_changed", { applied: applyOn, origin: "chat", source: "chat" }); } catch (_) {}

    const newlyAdded = intent.targetType === "dim" && intent.op === "enable";
    return { status: "applied", applied: applyOn, target: intent.target, targetType: intent.targetType, op: intent.op, first_light: newlyAdded, config };
  } catch (e) {
    return { status: "error", detail: (e && e.message) || String(e) };
  }
}

async function loadRow(sb, userId) {
  try { const { data } = await sb.from("user_clarity_config").select("*").eq("user_id", userId).maybeSingle(); return data || null; }
  catch (_) { return null; }
}
async function loadConfig(sb, userId, today) {
  const row = await loadRow(sb, userId);
  return (effectiveConfig(row, today).config) || { enabled_practice: [], fuel_opt_out: false, lanes: {} };
}

module.exports = { detectClarityConfigIntent, applyClarityConfigChange };
