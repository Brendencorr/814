/**
 * reset-nudge-cron.js — sends the AM (~8:14am) / PM (~8pm) 8:14 Reset nudges via web push.
 *
 * Scheduled every 15 min (see netlify.toml). For each active push consent it checks the
 * user's LOCAL time + once-per-local-day dedup, then sends. Consent auto-expires at
 * ends_at (7 program days + 3 grace). Payloads are generic + warm — never crisis-sensitive
 * on a lock screen (per the Reset's crisis architecture).
 * Model: n/a
 */
const { getSupabaseClient, requireScheduledOrOperator } = require("./supabase-client");
const webpush = require("web-push");

const AM_H = 8, AM_M = 14;   // 8:14am — the send time IS the brand
const PM_H = 20, PM_M = 0;   // 8:00pm
const WINDOW_MIN = 20;       // fire within 20 min after the target (cron runs every 15)

// Local hour/minute/date in a given IANA tz, using the built-in Intl (no tz dep).
function localParts(tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  return { h: parseInt(p.hour, 10) % 24, m: parseInt(p.minute, 10), date: `${p.year}-${p.month}-${p.day}` };
}
const minsSince = (h, m, th, tm) => (h * 60 + m) - (th * 60 + tm);

// The member's current Reset day + its theme (for the morning nudge).
async function currentDayTheme(supabase, userId) {
  const { data: prog } = await supabase.from("reset_progress").select("day_number, morning_done_at").eq("user_id", userId);
  const done = new Set((prog || []).filter((p) => p.morning_done_at).map((p) => p.day_number));
  let day = 7;
  for (let d = 1; d <= 7; d++) if (!done.has(d)) { day = d; break; }
  const { data: row } = await supabase.from("reset_days").select("theme").eq("day_number", day).maybeSingle();
  return row?.theme || null;
}

exports.handler = async (event) => {
  const _g = requireScheduledOrOperator(event); if (_g) return _g;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { console.warn("reset-nudge-cron: VAPID keys not set"); return { statusCode: 200, body: "no-vapid" }; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@meetriley.us", pub, priv);

  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const { data: consents } = await supabase.from("notification_consents")
    .select("*").eq("channel", "push").eq("granted", true).eq("status", "active").gt("ends_at", nowIso);

  // Honor the push-notifications preference (migration 047). Resilient: missing column → no rows → unchanged.
  const pushOff = new Set();
  const _uids = [...new Set((consents || []).map((c) => c.user_id).filter(Boolean))];
  if (_uids.length) {
    const { data: offs } = await supabase.from("user_profiles").select("id").eq("push_notifications", false).in("id", _uids);
    (offs || []).forEach((o) => pushOff.add(o.id));
  }

  let sent = 0;
  for (const c of (consents || [])) {
    if (pushOff.has(c.user_id)) continue;            // opted out of push
    try {
      const { h, m, date } = localParts(c.tz || "America/Denver");
      const amDue = minsSince(h, m, AM_H, AM_M) >= 0 && minsSince(h, m, AM_H, AM_M) < WINDOW_MIN && c.last_am_date !== date;
      const pmDue = minsSince(h, m, PM_H, PM_M) >= 0 && minsSince(h, m, PM_H, PM_M) < WINDOW_MIN && c.last_pm_date !== date;
      if (!amDue && !pmDue) continue;

      let payload, col;
      if (amDue) {
        const theme = await currentDayTheme(supabase, c.user_id);
        payload = { title: "Your 8:14 is ready", body: theme ? `Today is ${theme}. Eight minutes, fourteen seconds.` : "Eight minutes, fourteen seconds. I'm here when you are.", url: "/reset", tag: "reset-am" };
        col = "last_am_date";
      } else {
        payload = { title: "Two minutes to close the day", body: "One line to me before you sleep. I'm here.", url: "/reset", tag: "reset-pm" };
        col = "last_pm_date";
      }

      await webpush.sendNotification(c.push_subscription, JSON.stringify(payload));
      const upd = { updated_at: nowIso }; upd[col] = date;
      await supabase.from("notification_consents").update(upd).eq("user_id", c.user_id).eq("program_key", c.program_key);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription is dead → stop trying.
        await supabase.from("notification_consents")
          .update({ status: "revoked", granted: false }).eq("user_id", c.user_id).eq("program_key", c.program_key);
      } else {
        console.warn("reset-nudge-cron send failed:", err.statusCode, err.message);
      }
    }
  }
  return { statusCode: 200, body: `sent ${sent}` };
};
