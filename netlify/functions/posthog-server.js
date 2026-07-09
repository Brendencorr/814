/**
 * posthog-server.js - shared PostHog server-side capture helper.
 *
 * ONE JOB: reliably mirror business-conversion events into PostHog from the
 * backend, so the attribution funnel (utm → signup → reset_completed → upgrade)
 * doesn't depend on a browser being open or client JS succeeding. Supabase stays
 * canonical; PostHog is the analytics lens.
 *
 * Every export is NON-FATAL and NON-BLOCKING: if POSTHOG_PROJECT_KEY is unset or
 * the network call fails, it resolves quietly - callers should never await-block a
 * user response on it (fire-and-forget, or await inside a try/catch).
 *
 * Uses the public project ingest key (POSTHOG_PROJECT_KEY, phc_…) posted to the
 * /capture endpoint - the same key the browser uses, so events from the same
 * distinct_id stitch together across client + server.
 *
 * Usage:
 *   const { phCapture } = require("./posthog-server");
 *   phCapture({ distinctId: user.id, event: "signup_guide", properties: { ...utm } });
 */

const KEY  = process.env.POSTHOG_PROJECT_KEY || "";
const HOST = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");

/**
 * Capture one event server-side.
 * @param {object}  o
 * @param {string}  o.distinctId  stable id for the person (use the Supabase user id
 *                                so it matches the browser's identify() call).
 * @param {string}  o.event       event name, e.g. "signup_guide".
 * @param {object} [o.properties] event props (utm_source, plan, etc.).
 * @returns {Promise<boolean>} true if PostHog accepted it, false otherwise (never throws).
 */
async function phCapture({ distinctId, event, properties } = {}) {
  if (!KEY) return false;                 // not configured → silent no-op
  if (!distinctId || !event) return false;
  try {
    const res = await fetch(`${HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: String(distinctId),
        properties: {
          $lib: "riley-server",
          ...(properties && typeof properties === "object" ? properties : {}),
        },
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn(`posthog-server: capture "${event}" failed (non-fatal):`, e.message);
    return false;
  }
}

/**
 * Attach/update person properties (e.g. plan tier, sobriety_date) via a $set event.
 */
async function phIdentify({ distinctId, set } = {}) {
  if (!KEY || !distinctId) return false;
  return phCapture({
    distinctId,
    event: "$identify",
    properties: { $set: set && typeof set === "object" ? set : {} },
  });
}

/**
 * Pull first-touch UTM/attribution props off an inbound request body.
 * The client forwards these from posthog-js (or the raw query string) so the
 * server event carries the same campaign context as the browser events.
 */
function utmFrom(body) {
  const src = (body && (body.attribution || body.utm)) || {};
  const out = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer"].forEach((k) => {
    const v = src[k] || (body && body[k]);
    if (v) out[k] = String(v).slice(0, 200);
  });
  return out;
}

module.exports = { phCapture, phIdentify, utmFrom };
