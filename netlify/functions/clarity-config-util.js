/**
 * clarity-config-util.js — Clarity v2.2 config helpers (pure; §10 customization).
 *
 * Shared by clarity-config.js (the member endpoint) and clarity-v2-write.js (the engine),
 * so validation + the "pending applies next app-day" promotion have ONE definition.
 * No Supabase, no I/O.
 */
'use strict';

// The Practice dims a member may switch on/off. Foundation (steadiness/rest/fuel) is fixed;
// fuel is toggled separately via fuel_opt_out. Mirrors clarity_dims(layer='practice').
const PRACTICE_DIMS = ["movement", "habits", "reflection", "program", "outside", "connection"];

// Normalize + validate a config payload → { enabled_practice, fuel_opt_out, lanes }.
function validateConfig(input) {
  input = input || {};
  const seen = {};
  const enabled = (Array.isArray(input.enabled_practice) ? input.enabled_practice : [])
    .filter((d) => typeof d === "string" && PRACTICE_DIMS.indexOf(d) !== -1)
    .filter((d) => (seen[d] ? false : (seen[d] = true)));
  // Focus lanes (§5) are opt-in. `sobriety` is the member's explicit choice; we auto-offer the
  // lane ON to members who track sobriety, but they can opt out (stored as false).
  const inLanes = input.lanes && typeof input.lanes === "object" ? input.lanes : {};
  const lanes = {};
  if (typeof inLanes.sobriety === "boolean") lanes.sobriety = inLanes.sobriety;
  if (typeof inLanes.grief === "boolean") lanes.grief = inLanes.grief;   // §5 grief lane (presence-only)
  return { enabled_practice: enabled, fuel_opt_out: !!input.fuel_opt_out, lanes };
}

// The config in force right now. A staged change applies on/after its app-day (4am rollover);
// until then the current config stays live. Returns { config, version, promotePending }.
function effectiveConfig(row, today) {
  if (!row) return { config: { enabled_practice: [], fuel_opt_out: false }, version: 1, promotePending: false };
  const cur = row.config || {};
  if (row.pending_config && row.pending_apply_on && today && row.pending_apply_on <= today) {
    return { config: row.pending_config, version: (row.config_version || 1) + 1, promotePending: true };
  }
  return { config: cur, version: row.config_version || 1, promotePending: false };
}

// Member-local next app-day (YYYY-MM-DD) for a staged change, given the member's local "today".
function nextAppDay(todayISO) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(todayISO || "") ? todayISO : new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { PRACTICE_DIMS, validateConfig, effectiveConfig, nextAppDay };
