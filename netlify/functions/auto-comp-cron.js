/**
 * auto-comp-cron.js - TEMPORARY 24-hour promo (operator-requested 2026-07-07).
 *
 * Auto-enrolls EVERY new signup to Riley Coach tier while the promo window is open.
 * A scheduled SWEEP (every 10 min), NOT a signup-path trigger - so it can never break
 * or slow down account creation. Reads the window from app_settings:
 *   auto_comp_coach_start  (ISO)  - only members who signed up AFTER this get comped
 *   auto_comp_coach_until  (ISO)  - the sweep no-ops once now() passes this
 * Comps by inserting a comped 'coach' subscriptions row (identical to admin-create-user),
 * which is the single entitlement source the app already resolves. Idempotent: skips anyone
 * who already has an active coach/mentor subscription. Writes an admin_audit row per comp so
 * every auto-comp is traceable (source:'auto_promo_24h') and easy to revoke later.
 *
 * TO STOP EARLY: delete/expire the app_settings rows above. TO REMOVE: drop the netlify.toml
 * schedule for this function (it's inert after the deadline regardless).
 * Model: n/a
 */
const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");

const json = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const gate = requireScheduledOrOperator(event); if (gate) return gate;
  const sb = getSupabaseClient();
  const now = new Date();

  try {
    // Promo window from app_settings.
    const { data: cfg } = await sb.from("app_settings").select("key,value").in("key", ["auto_comp_coach_start", "auto_comp_coach_until"]);
    const map = {}; (cfg || []).forEach((r) => { map[r.key] = r.value; });
    const start = map.auto_comp_coach_start ? new Date(map.auto_comp_coach_start) : null;
    const until = map.auto_comp_coach_until ? new Date(map.auto_comp_coach_until) : null;
    if (!start || !until || isNaN(start) || isNaN(until)) return json(200, { ok: true, skipped: "not_configured" });
    if (now > until) return json(200, { ok: true, skipped: "promo_ended", until: until.toISOString() });

    // New signups since the promo started (profile row = they're in the app).
    const { data: profs } = await sb.from("user_profiles")
      .select("id,email,created_at")
      .gte("created_at", start.toISOString())
      .limit(2000);
    if (!profs || !profs.length) return json(200, { ok: true, comped: 0, scanned: 0, window_open: true });

    // Who already holds an active coach/mentor sub? (idempotency + don't downgrade)
    const ids = profs.map((p) => p.id);
    const { data: subs } = await sb.from("subscriptions").select("user_id,plan_id,status").in("user_id", ids).eq("status", "active");
    const hasTier = new Set((subs || []).filter((s) => s.plan_id === "coach" || s.plan_id === "mentor").map((s) => s.user_id));

    let comped = 0;
    for (const p of profs) {
      if (hasTier.has(p.id)) continue;
      try {
        await sb.from("subscriptions").insert({
          user_id: p.id, plan_id: "coach", term: "comped", status: "active",
          comped: true, source: "auto_promo_24h", started_at: now.toISOString(), expires_at: null,
        });
        try { await sb.from("admin_audit").insert({ action: "auto_comp_coach", target_user: p.id, detail: { email: p.email, source: "auto_promo_24h" } }); } catch (_) {}
        comped++;
      } catch (e) { console.error("auto-comp failed for", p.id, e.message); }
    }
    console.log("auto-comp-cron:", JSON.stringify({ comped, scanned: profs.length }));
    return json(200, { ok: true, comped, scanned: profs.length, window_open: true, until: until.toISOString() });
  } catch (e) {
    console.error("auto-comp-cron fatal:", e.message);
    return json(500, { error: e.message });
  }
};
