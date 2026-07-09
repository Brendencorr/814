/**
 * anthropic-client.js - one wrapper for every Claude call (Spec §8.1 / 8.4 / 9.1).
 *
 *  • Prompt caching - pass { cachedSystem, dynamicSystem }; the static persona gets
 *    cache_control:ephemeral so repeat turns read it at ~10% cost. Cache the STABLE
 *    prefix only; never interleave dynamic content into it.
 *  • Cost observability - writes api_cost_log non-blocking on every call (tokens,
 *    cached tokens, computed cost, hashed user id - never content).
 *  • Reliability - on 5xx / 429 / network, one backoff retry on the primary model;
 *    then (allowFallback) a Haiku attempt with a brevity directive; logs fallbacks to
 *    system_incidents. On total failure it THROWS - the caller returns its own
 *    graceful line. Crisis Level 3 never reaches here (it's deterministic).
 *
 * Returns { text, usage, model, fellBack, cacheReadTokens }.
 */

const crypto = require("crypto");
const { MODELS } = require("./model-router");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Approximate per-MTok pricing for observability only (not billing). USD.
const PRICING = {
  "claude-sonnet-4-6":          { in: 3.0, out: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001":  { in: 1.0, out:  5.0, cacheRead: 0.10, cacheWrite: 1.25 },
  default:                      { in: 3.0, out: 15.0, cacheRead: 0.30, cacheWrite: 3.75 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashId = (id) => { try { return crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 16); } catch (_) { return null; } };

function buildSystem({ cachedSystem, dynamicSystem, system }) {
  if (cachedSystem != null) {
    const blocks = [{ type: "text", text: cachedSystem, cache_control: { type: "ephemeral" } }];
    if (dynamicSystem) blocks.push({ type: "text", text: dynamicSystem });
    return blocks;
  }
  return system; // plain string (uncached) or a caller-built array
}

function withBrevity(system) {
  const note = "NOTE FOR THIS REPLY ONLY: a backup model is answering due to a brief technical issue. Keep it short, warm, and safe; don't mention the switch unless asked.";
  if (Array.isArray(system)) return [{ type: "text", text: note }, ...system];
  return note + "\n\n----\n\n" + (system || "");
}

// Single HTTP attempt. Never throws on an HTTP error - returns {ok,status,data}.
async function rawCall(model, system, messages, max_tokens, temperature, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, max_tokens, system, messages, ...(temperature != null ? { temperature } : {}) }),
    });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message }; // network / timeout / abort
  } finally {
    clearTimeout(timer);
  }
}

function logCost(supabase, { functionName, model, usage, userId, fellBack }) {
  if (!supabase || !usage) return;
  try {
    const p = PRICING[model] || PRICING.default;
    const inTok = usage.input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cost = (inTok * p.in + outTok * p.out + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6;
    supabase.from("api_cost_log").insert({
      function_name: functionName,
      model,
      input_tokens: inTok + cacheWrite,
      output_tokens: outTok,
      cached_tokens: cacheRead,
      cost_usd: Number(cost.toFixed(6)),
      user_id_hash: userId ? hashId(userId) : null,
      fell_back: !!fellBack,
    }).then(() => {}, () => {});
  } catch (_) {}
}

function logIncident(supabase, kind, functionName, detail) {
  if (!supabase) return;
  try {
    supabase.from("system_incidents").insert({ kind, function_name: functionName, detail: detail || {} }).then(() => {}, () => {});
  } catch (_) {}
}

/**
 * callClaude(opts)
 *   { cachedSystem?, dynamicSystem?, system?, messages, max_tokens?, model?,
 *     functionName?, userId?, supabase?, allowFallback?, temperature?, timeoutMs? }
 */
async function callClaude(opts) {
  const {
    cachedSystem, dynamicSystem, system, messages,
    max_tokens = 1000, model, functionName = "unknown",
    userId = null, supabase = null, allowFallback = false, temperature, timeoutMs,
  } = opts;

  const primary = model || MODELS.chat;
  const sys = buildSystem({ cachedSystem, dynamicSystem, system });

  // Attempt 1 + one retry on transient failure.
  let res = await rawCall(primary, sys, messages, max_tokens, temperature, timeoutMs);
  if (!res.ok && (res.status >= 500 || res.status === 429 || res.status === 0)) {
    await sleep(400);
    res = await rawCall(primary, sys, messages, max_tokens, temperature, timeoutMs);
  }

  let usedModel = primary, fellBack = false;

  // Haiku fallback (opt-in) - keep it brief + warm.
  if (!res.ok && allowFallback) {
    const alt = await rawCall(MODELS.fallback, withBrevity(sys), messages, Math.min(max_tokens, 600), temperature, timeoutMs);
    logIncident(supabase, "model_fallback", functionName, { from: primary, to: MODELS.fallback, status: res.status });
    if (alt.ok) { res = alt; usedModel = MODELS.fallback; fellBack = true; }
  }

  if (!res.ok) {
    logIncident(supabase, "api_failure", functionName, { model: primary, status: res.status, error: res.error || null });
    const err = new Error("anthropic_upstream_error");
    err.status = res.status;
    err.detail = res.data ? JSON.stringify(res.data).slice(0, 200) : res.error || null;
    throw err;
  }

  const data = res.data || {};
  const text = (data.content && data.content[0] && data.content[0].text) || "";
  const usage = data.usage || {};
  logCost(supabase, { functionName, model: usedModel, usage, userId, fellBack });

  return { text, usage, model: usedModel, fellBack, cacheReadTokens: usage.cache_read_input_tokens || 0 };
}

module.exports = { callClaude, PRICING };
