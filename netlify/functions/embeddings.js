/**
 * embeddings.js - provider-swappable text embedding (Spec §1.2).
 *
 * Returns a 1024-dim vector, or NULL on ANY error / missing key. It NEVER throws
 * into the chat path. Ships DARK: with no key configured, every caller falls back
 * to recency and behavior is byte-identical to today.
 *
 * Provider resolution (first match wins):
 *   EMBEDDINGS_PROVIDER=openai|voyage  + EMBEDDINGS_API_KEY
 *   OPENAI_API_KEY   → openai (text-embedding-3-small @ 1024 dims)
 *   VOYAGE_API_KEY   → voyage (voyage-3 @ 1024 dims)
 * Standardized to 1024 dims so either provider drops into vector(1024).
 */

const DIM = 1024;
const TIMEOUT_MS = 2000;

function resolveProvider() {
  const explicit = (process.env.EMBEDDINGS_PROVIDER || "").toLowerCase();
  const key = process.env.EMBEDDINGS_API_KEY;
  if (key && explicit === "voyage") return { provider: "voyage", key };
  if (key && (explicit === "openai" || !explicit)) return { provider: "openai", key };
  if (process.env.OPENAI_API_KEY) return { provider: "openai", key: process.env.OPENAI_API_KEY };
  // OPENAI_SEMANTIC: the name the operator chose for the embeddings key in Netlify
  // (2026-07-24) - honored as a first-class alias so the env never needs renaming.
  if (process.env.OPENAI_SEMANTIC) return { provider: "openai", key: process.env.OPENAI_SEMANTIC };
  if (process.env.VOYAGE_API_KEY) return { provider: "voyage", key: process.env.VOYAGE_API_KEY };
  return null; // dark
}

async function embed(text) {
  const cfg = resolveProvider();
  if (!cfg || !text || !String(text).trim()) return null;
  const input = String(text).replace(/\s+/g, " ").trim().slice(0, 8000);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let url, body, headers;
    if (cfg.provider === "openai") {
      url = "https://api.openai.com/v1/embeddings";
      headers = { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" };
      body = JSON.stringify({ model: "text-embedding-3-small", input, dimensions: DIM });
    } else {
      url = "https://api.voyageai.com/v1/embeddings";
      headers = { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" };
      body = JSON.stringify({ model: "voyage-3", input, output_dimension: DIM });
    }
    const r = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    if (!r.ok) return null;
    const d = await r.json();
    const v = d && d.data && d.data[0] && d.data[0].embedding;
    return Array.isArray(v) && v.length === DIM ? v : null;
  } catch (_) {
    return null; // timeout / network / abort → recency fallback
  } finally {
    clearTimeout(timer);
  }
}

/** pgvector accepts a bracketed string literal for a vector param. */
function toVectorLiteral(v) {
  return Array.isArray(v) && v.length ? `[${v.join(",")}]` : null;
}

/** True when an embedding provider is configured (semantic layer is live). */
function embeddingsEnabled() {
  return !!resolveProvider();
}

module.exports = { embed, toVectorLiteral, embeddingsEnabled, DIM };
