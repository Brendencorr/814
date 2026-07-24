/**
 * feathers.js - award a feather keepsake for a MOMENT (founder rule, 2026-07-23).
 *
 * A feather is a kept moment, not a point: wins, program steps, Reset days,
 * showing up. NEVER award for logins, NEVER for streaks, and nothing may ever
 * subtract one - the collection only grows. Visible to the member (RLS) and
 * the operator (service key); never to other members.
 *
 * Idempotent by (user_id, kind, ref) - the DB unique constraint is the source
 * of truth, so double-fired events award exactly one feather. Fail-open and
 * non-blocking by contract: a feather must never break or slow a member
 * action. Callers fire-and-forget: awardFeather(...).catch(() => {}).
 */

async function awardFeather(supabase, userId, kind, ref, moment) {
  if (!supabase || !userId || !kind) return { awarded: false };
  try {
    const { error } = await supabase.from("feathers").insert({
      user_id: userId,
      kind: String(kind),
      ref: String(ref == null ? "" : ref).slice(0, 200),
      moment: moment ? String(moment).slice(0, 300) : null,
    });
    if (error) {
      // 23505 = unique violation: already awarded for this moment. Expected, silent.
      if (String(error.code) === "23505") return { awarded: false, duplicate: true };
      console.warn("awardFeather failed (non-fatal):", error.message);
      return { awarded: false };
    }
    return { awarded: true };
  } catch (e) {
    console.warn("awardFeather failed (non-fatal):", e && e.message);
    return { awarded: false };
  }
}

module.exports = { awardFeather };
