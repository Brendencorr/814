/**
 * account-delete.js — reusable "Delete account & data" flow (type-to-confirm modal).
 *
 * Drop-in for any authenticated page:
 *   <script src="/account-delete.js"></script>
 *   <button onclick="RileyDeleteAccount.open({ supabase: SB })">Delete account</button>
 *
 * open(opts):
 *   supabase   — the page's Supabase client (reads the session token + signs out).
 *                Falls back to window.SB / window.sb if omitted.
 *   redirectTo — where to send the member after deletion. Default: the marketing home.
 *
 * Talks to auth-handler.js action:'delete_account' (token-verified, service-key delete).
 * The account + all personal data + the login are erased. Crisis-support records are
 * retained DE-IDENTIFIED for a bounded window for safety — disclosed here, in plain sight.
 */
(function () {
  var CONFIRM_PHRASE = "Delete my account";
  var ENDPOINT = "/.netlify/functions/auth-handler";
  var DEFAULT_REDIRECT = "https://meetriley.us";

  function el(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function open(opts) {
    opts = opts || {};
    var sb = opts.supabase || window.SB || window.sb;
    var redirectTo = opts.redirectTo || DEFAULT_REDIRECT;
    if (!sb) { alert("Couldn't reach your session. Please refresh and try again."); return; }
    if (document.getElementById("riley-del-acct")) return; // already open

    var overlay = el("div", "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;" +
      "justify-content:center;padding:20px;background:rgba(4,3,2,0.72);backdrop-filter:blur(4px);" +
      "font-family:'DM Sans',system-ui,sans-serif");
    overlay.id = "riley-del-acct";

    var card = el("div", "position:relative;width:100%;max-width:440px;background:#100e0c;" +
      "border:1px solid rgba(255,255,255,0.09);border-radius:18px;padding:30px 28px 26px;" +
      "box-shadow:0 30px 80px rgba(0,0,0,0.6);color:#f5f0e8;text-align:center");

    card.innerHTML =
      '<button id="rda-x" aria-label="Close" style="position:absolute;top:14px;right:16px;background:none;' +
        'border:none;color:#8a8578;font-size:22px;line-height:1;cursor:pointer">&times;</button>' +
      '<div style="font-family:\'DM Serif Display\',Georgia,serif;font-size:27px;margin:2px 0 12px">Delete account</div>' +
      '<div style="font-size:14px;color:#b8b2a6;line-height:1.6">Are you sure? This permanently deletes your account and ' +
        'everything Riley keeps for you — your profile, check-ins, reflections, conversations, and progress. ' +
        'If you have an active subscription, it’s canceled immediately. <strong style="color:#e8d5a3">This can’t be undone.</strong></div>' +
      '<div style="font-size:12.5px;color:#8a8578;line-height:1.55;margin:14px 0 18px;padding:11px 13px;' +
        'background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.16);border-radius:10px;text-align:left">' +
        '🔒 For your safety, crisis-support records are kept in <strong>de-identified</strong> form ' +
        '(no longer tied to your name or email) for up to 12 months, then permanently removed. Everything else is erased now.</div>' +
      '<div style="font-size:13.5px;color:#b8b2a6;margin-bottom:9px">Type <strong style="color:#f5f0e8">' + CONFIRM_PHRASE + '</strong> to confirm.</div>' +
      '<input id="rda-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
        'placeholder="' + CONFIRM_PHRASE + '" style="width:100%;background:rgba(8,7,6,0.7);border:1px solid rgba(255,255,255,0.12);' +
        'border-radius:10px;color:#f5f0e8;font-family:inherit;font-size:15px;padding:12px 14px;text-align:center;outline:none">' +
      '<button id="rda-go" disabled style="width:100%;margin-top:16px;background:#3a1414;color:#e9b7b0;border:1px solid rgba(192,96,74,0.4);' +
        'border-radius:11px;font-family:inherit;font-size:15px;font-weight:700;padding:13px;cursor:not-allowed;opacity:0.6;transition:all .15s">Delete forever</button>' +
      '<button id="rda-cancel" style="width:100%;margin-top:9px;background:none;border:none;color:#8a8578;font-family:inherit;font-size:13.5px;cursor:pointer;padding:8px">Cancel</button>' +
      '<div id="rda-status" style="min-height:16px;margin-top:8px;font-size:13px;color:#c0604a"></div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    var input = card.querySelector("#rda-input");
    var go = card.querySelector("#rda-go");
    var status = card.querySelector("#rda-status");
    var busy = false;

    function close() { if (!busy && overlay.parentNode) overlay.parentNode.removeChild(overlay); }

    input.addEventListener("input", function () {
      var ok = input.value.trim() === CONFIRM_PHRASE;
      go.disabled = !ok;
      go.style.cursor = ok ? "pointer" : "not-allowed";
      go.style.opacity = ok ? "1" : "0.6";
      go.style.background = ok ? "#7a2e2e" : "#3a1414";
      go.style.color = ok ? "#f5e8e8" : "#e9b7b0";
    });
    input.focus();

    card.querySelector("#rda-x").addEventListener("click", close);
    card.querySelector("#rda-cancel").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });

    go.addEventListener("click", async function () {
      if (go.disabled || busy) return;
      busy = true;
      go.disabled = true; go.textContent = "Deleting…"; go.style.cursor = "wait";
      status.style.color = "#c0604a"; status.textContent = "";
      try {
        var s = await sb.auth.getSession();
        var token = s && s.data && s.data.session && s.data.session.access_token;
        if (!token) throw new Error("Your session expired. Please sign in again.");
        var res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete_account", token: token, confirm: true }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error(data.error || "Deletion failed. Please try again.");

        card.innerHTML = '<div style="padding:14px 0"><div style="font-size:30px;margin-bottom:12px">🕊️</div>' +
          '<div style="font-family:\'DM Serif Display\',Georgia,serif;font-size:22px;line-height:1.4">Your account has been deleted.</div>' +
          '<div style="font-size:14px;color:#8a8578;margin-top:10px;line-height:1.6">Thank you for trusting Riley with your story. Take good care.</div></div>';
        try { await sb.auth.signOut(); } catch (e) {}
        setTimeout(function () { window.location.href = redirectTo; }, 2600);
      } catch (err) {
        busy = false;
        go.disabled = false; go.textContent = "Delete forever"; go.style.cursor = "pointer";
        status.textContent = (err && err.message) || "Something went wrong. Please try again.";
      }
    });
  }

  window.RileyDeleteAccount = { open: open };
})();
