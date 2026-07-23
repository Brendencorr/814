/**
 * calendar-card.js - Phase 1 calendar feed card (CALENDAR_INTEGRATION handoff §1.3).
 * Mounted on Account (settings.html) and the Calendar page. The page provides an
 * authed supabase client + member id; this renders the subscribe card:
 * Google / Apple / Copy link, the milestones toggle, and regenerate.
 *
 * RLS does the authorization - members manage only their own calendar_feeds row.
 */
(function () {
  "use strict";

  async function activeFeed(SB, UID) {
    const { data } = await SB.from("calendar_feeds")
      .select("id,token,include_milestones")
      .eq("member_id", UID).is("revoked_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
    const ins = await SB.from("calendar_feeds").insert({ member_id: UID }).select("id,token,include_milestones").single();
    return ins.data || null;
  }

  function urls(token) {
    const host = location.host || "riley.meetriley.us";
    const https = "https://" + host + "/.netlify/functions/calendar-ics?t=" + encodeURIComponent(token);
    const webcal = "webcal://" + host + "/.netlify/functions/calendar-ics?t=" + encodeURIComponent(token);
    return {
      https: https,
      webcal: webcal,
      google: "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal),
    };
  }

  const BTN = "display:inline-block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.35);color:#c9a84c;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit";

  async function mount(el, SB, UID) {
    if (!el || !SB || !UID) return;
    let feed = null;
    try { feed = await activeFeed(SB, UID); } catch (e) {}
    if (!feed || !feed.token) { el.innerHTML = ""; return; }

    function render() {
      const u = urls(feed.token);
      el.innerHTML =
        '<div style="font-family:\'DM Serif Display\',serif;font-size:19px;margin:0 0 4px">Put your 8:14 on your calendar.</div>' +
        '<div style="color:#8a8578;font-size:13px;margin-bottom:16px">A quiet daily anchor - and your session days - in the calendar you already live in. The link is private to you.</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">' +
          '<a style="' + BTN + '" href="' + u.google + '" target="_blank" rel="noopener">Add to Google Calendar</a>' +
          '<a style="' + BTN + '" href="' + u.webcal + '">Add to Apple Calendar</a>' +
          '<button style="' + BTN + '" id="calfeed-copy" type="button">Copy link</button>' +
        '</div>' +
        '<label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#f5f0e8;cursor:pointer;margin-bottom:12px">' +
          '<input type="checkbox" id="calfeed-miles" style="accent-color:#c9a84c"' + (feed.include_milestones ? " checked" : "") + "> Include milestone days" +
        "</label>" +
        '<div style="font-size:11.5px;color:#5a5450"><span id="calfeed-regen" style="cursor:pointer;text-decoration:underline;text-underline-offset:2px">Regenerate link</span> · This removes access from anyone who has the old one.</div>' +
        '<div id="calfeed-status" style="min-height:16px;margin-top:8px;font-size:12.5px;color:#e8d5a3"></div>';

      const status = function (m) { const s = el.querySelector("#calfeed-status"); if (s) s.textContent = m || ""; };

      el.querySelector("#calfeed-copy").addEventListener("click", async function () {
        try { await navigator.clipboard.writeText(u.https); status("Link copied."); }
        catch (e) { try { window.prompt("Copy your private calendar link:", u.https); } catch (e2) {} }
      });

      el.querySelector("#calfeed-miles").addEventListener("change", async function (ev) {
        const on = !!ev.target.checked;
        try {
          await SB.from("calendar_feeds").update({ include_milestones: on }).eq("id", feed.id);
          feed.include_milestones = on;
          status(on ? "Milestone days included." : "Milestone days off.");
        } catch (e) { ev.target.checked = !on; status("Could not save - try again."); }
      });

      el.querySelector("#calfeed-regen").addEventListener("click", async function () {
        if (!window.confirm("Regenerate your calendar link? Anyone using the old link loses access, and you'll need to re-subscribe in your calendar app.")) return;
        try {
          await SB.from("calendar_feeds").update({ revoked_at: new Date().toISOString() }).eq("id", feed.id);
          const ins = await SB.from("calendar_feeds")
            .insert({ member_id: UID, include_milestones: feed.include_milestones })
            .select("id,token,include_milestones").single();
          if (ins.data) { feed = ins.data; render(); }
          const s2 = el.querySelector("#calfeed-status"); if (s2) s2.textContent = "New link ready. Re-subscribe with a button above.";
        } catch (e) { status("Could not regenerate - try again."); }
      });
    }
    render();
  }

  // ── Phase 2: the Google connect card (handoff §2.3). The status endpoint 404s until
  // CALENDAR_GOOGLE_ENABLED=true post-verification, so this renders NOTHING today.
  // Declining suppresses the re-prompt for 30 days - no dark-pattern re-asks.
  async function mountGoogle(el, SB, UID) {
    if (!el || !SB || !UID) return;
    try {
      // One-time connected confirmation after the OAuth redirect.
      if (/[?&]calendar=connected/.test(location.search)) {
        el.innerHTML = '<div style="font-size:13px;color:#e8d5a3;padding:4px 0">Connected. Riley can see your day now.</div>';
      }
      const dk = "cal_g_dismiss_" + UID;
      try { const d = +localStorage.getItem(dk) || 0; if (d && Date.now() - d < 30 * 86400000) return; } catch (e) {}
      const tok = (await SB.auth.getSession()).data.session && (await SB.auth.getSession()).data.session.access_token;
      if (!tok) return;
      const r = await fetch("/.netlify/functions/calendar-connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok, action: "status" }),
      });
      if (!r.ok) return;                       // flag off (404) or error -> render nothing
      const st = await r.json();
      if (!st || !st.enabled) return;

      if (st.connected) {
        el.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0">' +
          '<div style="font-size:13px;color:#f5f0e8">Google Calendar<div style="font-size:12px;color:#8a8578">Connected. Riley can see your day.</div></div>' +
          '<button id="calg-off" style="' + BTN + '" type="button">Disconnect</button></div>' +
          '<div id="calg-status" style="min-height:16px;font-size:12.5px;color:#e8d5a3"></div>';
        el.querySelector("#calg-off").addEventListener("click", async function () {
          try {
            const t2 = (await SB.auth.getSession()).data.session.access_token;
            const rr = await fetch("/.netlify/functions/calendar-disconnect", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t2 }),
            });
            if (rr.ok) el.innerHTML = '<div style="font-size:13px;color:#e8d5a3;padding:4px 0">Disconnected. Riley no longer sees your calendar.</div>';
          } catch (e) {}
        });
        return;
      }

      el.innerHTML =
        '<div style="font-family:\'DM Serif Display\',serif;font-size:17px;margin:0 0 4px">Want Riley to see your day?</div>' +
        '<div style="color:#8a8578;font-size:13px;margin-bottom:14px">She\'ll read today\'s calendar - just enough to time things gently. Nothing stored, nothing shared, and you can disconnect in one tap.</div>' +
        '<div style="display:flex;align-items:center;gap:14px">' +
        '<a style="' + BTN + '" href="/.netlify/functions/calendar-connect?token=' + encodeURIComponent(tok) + '">Connect Google Calendar</a>' +
        '<span id="calg-notnow" style="font-size:12.5px;color:#8a8578;cursor:pointer">Not now</span></div>';
      el.querySelector("#calg-notnow").addEventListener("click", function () {
        try { localStorage.setItem(dk, String(Date.now())); } catch (e) {}
        el.innerHTML = "";
      });
    } catch (e) { /* render nothing - the card is always optional */ }
  }

  window.RileyCalendarCard = { mount: mount, mountGoogle: mountGoogle };
})();
