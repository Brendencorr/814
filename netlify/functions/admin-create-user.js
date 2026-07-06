/**
 * admin-create-user.js — operator manual member creation. OPERATOR_KEY gated.
 *
 * Creates the Supabase auth user (email_confirm:true — so they can sign in with
 * Google using the same email; Supabase links by confirmed email), seeds their
 * user_profiles row, and — for Companion/Coach — comps the tier by inserting a
 * `subscriptions` row (the single-source entitlement, same mechanism as admin-comp,
 * so the client app unlocks within one refresh). Writes an append-only admin_audit row.
 *
 * The "email the member on signup" toggle is wired end-to-end EXCEPT the send: when
 * send_email is true we call sendWelcomeEmail(), which no-ops (reason
 * 'resend_not_configured') until RESEND_API_KEY is set. Drop the key in → it sends.
 *
 * POST { email, name, tier:'guide'|'companion'|'coach', sobriety_date?, send_email? }
 *   header x-operator-key
 * → { ok:true, user_id, tier, emailed:{sent, reason?} }  |  { error } (400/401/409/500)
 *
 * NEVER touches conversation content. Fail-closed on auth; validates input.
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { sendWelcomeEmail } = require("./email-welcome");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

// Conservative email shape check — the real gate is Supabase; this just catches typos early.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIERS = ["guide", "companion", "coach"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const gate = requireOperator(event);
  if (gate) return gate; // fail-closed 401/503

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }

  const email = (body.email || "").toString().trim().toLowerCase();
  const name = (body.name || "").toString().trim().slice(0, 120);
  const tier = TIERS.includes(body.tier) ? body.tier : "guide";
  const sobriety_date = (body.sobriety_date || "").toString().trim() || null; // 'YYYY-MM-DD' or null
  const send_email = !!body.send_email;

  if (!name) return json(400, { error: "Name is required." });
  if (!EMAIL_RE.test(email)) return json(400, { error: "A valid email is required." });
  if (sobriety_date && !/^\d{4}-\d{2}-\d{2}$/.test(sobriety_date)) return json(400, { error: "Date must be YYYY-MM-DD." });

  const sb = getSupabaseClient();
  const now = new Date().toISOString();

  try {
    // 1. Already a member? (profile email is the app-level identity)
    const { data: existing } = await sb.from("user_profiles").select("id").ilike("email", email).maybeSingle();
    if (existing) return json(409, { error: "That email is already a member." });

    // 2. Create the auth user (email confirmed → no verification friction; Google links by email).
    let uid;
    try {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name, added_by_operator: true },
      });
      if (error) throw error;
      uid = data && data.user && data.user.id;
      if (!uid) throw new Error("No user id returned");
    } catch (e) {
      const msg = (e && e.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
        return json(409, { error: "That email already has an account." });
      }
      console.error("admin-create-user auth:", e.message);
      return json(500, { error: "Could not create the account.", detail: e.message });
    }

    // 3. Seed the profile (auth.uid() = id, matching every RLS-owner table).
    const first = name.split(" ")[0];
    const profile = {
      id: uid,
      email,
      full_name: name,
      preferred_name: first,
      onboarding_completed: false,    // they still see Riley's onboarding on first sign-in
    };
    // Tier is NOT stored on the profile — it's derived from the subscriptions/entitlements
    // resolution (tier-utils.currentTier). The dead subscription_tier column was dropped in
    // migration 055. The comp row below is the actual entitlement.
    try {
      await sb.from("user_profiles").upsert(profile, { onConflict: "id" });
    } catch (e) {
      console.error("admin-create-user profile:", e.message);
      // Profile is important but the auth user exists; surface a soft warning, don't 500.
    }

    // Sobriety date → the CANONICAL sobriety_tracker (migration 055). A DB trigger mirrors
    // it onto user_profiles.sobriety_date, so admin/operator reads stay correct automatically.
    if (sobriety_date) {
      try {
        await sb.from("sobriety_tracker").update({ is_active: false }).eq("user_id", uid);
        await sb.from("sobriety_tracker").insert({ user_id: uid, start_date: sobriety_date, is_active: true, milestone_days: [] });
      } catch (e) {
        console.error("admin-create-user sobriety:", e.message);
      }
    }

    // 4. Comp the tier for paid plans — a subscriptions row IS the entitlement (single source).
    if (tier !== "guide") {
      try {
        await sb.from("subscriptions").insert({
          user_id: uid, plan_id: tier, term: "comped", status: "active",
          comped: true, source: "operator_add", started_at: now, expires_at: null,
        });
      } catch (e) {
        console.error("admin-create-user comp:", e.message);
      }
    }

    // 5. Append-only audit (never blocks).
    try {
      await sb.from("admin_audit").insert({
        action: "create_user", target_user: uid,
        detail: { email, tier, sobriety_date: sobriety_date || null, send_email },
      });
    } catch (_) {}

    // 6. Optional welcome email — Resend-ready, no-ops until RESEND_API_KEY is set.
    let emailed = { sent: false, reason: "not_requested" };
    if (send_email) {
      try { emailed = await sendWelcomeEmail({ email, name, tier }); }
      catch (e) { emailed = { sent: false, reason: "error", detail: e.message }; }
    }

    return json(200, { ok: true, user_id: uid, tier, emailed });
  } catch (e) {
    console.error("admin-create-user:", e.message);
    return json(500, { error: "Could not add the member.", detail: e.message });
  }
};
