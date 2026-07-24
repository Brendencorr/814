/* Riley PWA - service worker + mobile nav + install affordances.
 * Loaded on every app page. Handles: (1) SW registration, (2) a mobile
 * hamburger + slide-in drawer for the sidebar (which is hidden on phones),
 * (3) an "Install Riley App" pill, (4) a download popup at login on phones. */
(function () {
  // Inside the embedded chat popup (iframe /chat?embed=1) we want a bare chat -
  // no hamburger, no pills, no account menu. Skip all of pwa.js there.
  if (/[?&]embed=1/.test(location.search)) return;

  // ── Post-purchase entitlement refresh (audit 2026-07-24) ──────────────────────
  // Stripe checkout returns to /dashboard?checkout=success. Entitlements are cached in
  // sessionStorage ('ent_'+uid) by every page's gating script, and nothing else ever
  // invalidates that cache mid-session - so without this, a member who JUST PAID keeps
  // seeing locked walls and their old plan name until they close the tab. Runs before
  // the page's gating script reads the cache (pwa.js is loaded in <head>-adjacent order
  // on member pages; the gating scripts read entitlements inside their async boot).
  if (/[?&]checkout=success\b/.test(location.search)) {
    try {
      var _entKeys = [];
      for (var _i = 0; _i < sessionStorage.length; _i++) {
        var _k = sessionStorage.key(_i);
        if (_k && _k.indexOf('ent_') === 0) _entKeys.push(_k);
      }
      _entKeys.forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {}
  }

  var ua = navigator.userAgent || '';
  var isMobile = /iphone|ipad|ipod|android/i.test(ua);
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isSafari = /safari/i.test(ua) && !/crios|fxios|chrome|android/i.test(ua);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
  // On the full chat page (/chat) the member IS already chatting - never show the floating
  // "Chat with Riley" pill or hijack /chat links there. (The embed iframe already returns above.)
  var onChatPage = /(^|\/)chat(\.html)?\/?$/.test(location.pathname.toLowerCase());
  var deferredPrompt = null;
  // "Download the Riley app" is only offered AFTER a member finishes onboarding in the chat. The flag
  // is set at onboarding completion (and whenever we confirm onboarding_completed) in riley-auth/dashboard.
  function isOnboarded() { try { return localStorage.getItem('riley_onboarded') === '1'; } catch (e) { return false; } }

  // ── 1) Register the governed service worker + update flow (App Spec 6.3) ──
  // A deploy installs a new worker in the background while the member keeps
  // using the current version. When it's waiting we show ONE quiet parchment
  // toast; tap -> SKIP_WAITING -> reload. Ignored -> activates on next cold
  // start. Never a modal, never mid-check-in. Maximum staleness: one session.
  var _updateAccepted = false;
  function showUpdateToast(worker) {
    if (document.getElementById('riley-update-toast')) return;
    if (_checkinLock) { setTimeout(function () { showUpdateToast(worker); }, 20000); return; }
    styleOnce('riley-upd-css', '@keyframes rlUpdIn{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}');
    var t = document.createElement('div'); t.id = 'riley-update-toast';
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:10004;display:flex;align-items:center;gap:12px;background:#f5f0e8;color:#0a0908;border:1px solid rgba(201,168,76,0.55);padding:12px 16px;border-radius:12px;font-family:"DM Sans",sans-serif;font-size:13.5px;box-shadow:0 10px 36px rgba(0,0,0,0.5);cursor:pointer;animation:rlUpdIn .35s cubic-bezier(.2,.7,.2,1);max-width:calc(100vw - 32px)';
    t.innerHTML = '<span style="width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#e8d5a3,#c9a84c 55%,#a8842f);flex-shrink:0"></span>'
      + '<span>Riley has something new - tap to refresh.</span>'
      + '<span id="riley-upd-x" role="button" aria-label="Not now" style="color:#8a8578;font-size:18px;line-height:1;padding:0 2px">&times;</span>';
    t.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'riley-upd-x') { t.remove(); return; }  // ignored -> next cold start
      _updateAccepted = true;
      try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (err) {}
      t.remove();
    });
    document.body.appendChild(t);
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        // Deploy landed while this tab was closed: the new worker is already waiting.
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var w = reg.installing; if (!w) return;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(w);
          });
        });
      }).catch(function () {});
      // Only an ACCEPTED update reloads (guard against the first-install claim()).
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!_updateAccepted || reloaded) return; reloaded = true; location.reload();
      });
    });
  }

  // ── Capture the install prompt early (shared by pill + login popup) ───────
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', function () {
    try { localStorage.setItem('riley_install_dismissed', '1'); } catch (e) {}
    var p = document.getElementById('riley-install-btn'); if (p) p.remove();
  });

  function styleOnce(id, css) {
    if (document.getElementById(id)) return;
    var st = document.createElement('style'); st.id = id; st.textContent = css; document.head.appendChild(st);
  }

  // ── 2) Mobile sidebar nav - hamburger + slide-in drawer ──────────────────
  function mobileNav() {
    var sb = document.querySelector('.sidebar');
    if (!sb) return;                                  // only pages with a sidebar
    if (document.getElementById('riley-hamburger')) return;
    styleOnce('riley-mnav-css', [
      '#riley-hamburger{display:none;position:fixed;top:12px;left:12px;z-index:9999;width:44px;height:44px;border-radius:11px;background:rgba(20,18,16,0.92);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(201,168,76,0.28);align-items:center;justify-content:center;cursor:pointer}',
      '#riley-hamburger span,#riley-hamburger span::before,#riley-hamburger span::after{content:"";display:block;width:20px;height:2px;background:#e8d5a3;border-radius:2px;position:absolute}',
      '#riley-hamburger span{position:relative}#riley-hamburger span::before{top:-6px}#riley-hamburger span::after{top:6px}',
      '#riley-nav-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9997;opacity:0;pointer-events:none;transition:opacity .28s}',
      '#riley-nav-backdrop.on{opacity:1;pointer-events:auto}',
      '@media(max-width:700px){',
        '#riley-hamburger{display:flex}',
        '.sidebar{display:flex !important;position:fixed !important;top:0;left:0;bottom:0;height:100vh;width:272px;max-width:84vw;z-index:9998;transform:translateX(-104%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:0 0 44px rgba(0,0,0,0.6);overflow-y:auto}',
        '.sidebar.riley-mobile-open{transform:translateX(0)}',
        // Topbar clears the hamburger AND keeps its heading on ONE line - shrink + truncate so the greeting
        // never wraps or collides with the right-side actions (the real cause of the "overlap" on mobile).
        '.topbar,.dash-topbar{padding-left:64px !important;padding-right:14px !important}',
        '.topbar>div:first-child,.dash-topbar>div:first-child{min-width:0;overflow:hidden}',
        '.greeting,.tb-title,.topbar-greeting{font-size:16px !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tb-date,.tb-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.tb-actions{flex-shrink:0}',
      '}'
    ].join(''));
    var burger = document.createElement('div');
    burger.id = 'riley-hamburger'; burger.setAttribute('aria-label', 'Menu'); burger.innerHTML = '<span></span>';
    var backdrop = document.createElement('div'); backdrop.id = 'riley-nav-backdrop';
    document.body.appendChild(burger); document.body.appendChild(backdrop);
    function toggle(force) {
      var open = (typeof force === 'boolean') ? force : !sb.classList.contains('riley-mobile-open');
      sb.classList.toggle('riley-mobile-open', open);
      backdrop.classList.toggle('on', open);
    }
    burger.addEventListener('click', function () { toggle(); });
    backdrop.addEventListener('click', function () { toggle(false); });
    // nav links render dynamically → delegate; close drawer on any link tap
    sb.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) toggle(false); });
  }
  if (document.readyState !== 'loading') mobileNav();
  else document.addEventListener('DOMContentLoaded', mobileNav);

  // No early return on standalone: the "Chat with Riley" pill shows even in the
  // installed app; only install-specific UI self-guards on `standalone` below.

  function triggerInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    } else if (isIOS && isSafari) {
      iosSheet();
    } else {
      iosSheet(); // fallback instructions
    }
  }
  function iosSheet() {
    if (document.getElementById('riley-ios-hint')) return;
    var t = document.createElement('div'); t.id = 'riley-ios-hint';
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10001;max-width:320px;width:88%;background:#141210;border:1px solid rgba(201,168,76,0.3);color:#f5f0e8;padding:16px 18px;border-radius:14px;font-family:"DM Sans",sans-serif;font-size:13px;line-height:1.6;box-shadow:0 12px 40px rgba(0,0,0,0.6)';
    t.innerHTML = '<div style="font-family:\'DM Serif Display\',serif;color:#c9a84c;font-size:15px;margin-bottom:5px">Add Riley to your Home Screen</div>Tap the <b>Share</b> button (the square with an up-arrow), then choose <b>&ldquo;Add to Home Screen.&rdquo;</b><div style="text-align:right;margin-top:10px"><span id="riley-ios-ok" style="color:#8a8578;cursor:pointer;font-size:12px;font-family:\'DM Mono\',monospace;letter-spacing:0.04em">GOT IT</span></div>';
    document.body.appendChild(t);
    t.querySelector('#riley-ios-ok').addEventListener('click', function () { t.remove(); });
  }

  // ── 4) Login page: download popup for phone users ────────────────────────
  var onLogin = location.pathname.replace(/\/+$/, '').toLowerCase().indexOf('login') >= 0;
  function loginPopup() {
    try { if (sessionStorage.getItem('riley_login_install_shown') === '1') return; } catch (e) {}
    try { sessionStorage.setItem('riley_login_install_shown', '1'); } catch (e) {}
    if (document.getElementById('riley-login-install')) return;
    var ov = document.createElement('div'); ov.id = 'riley-login-install';
    styleOnce('riley-lp-css', '@keyframes rlUp{from{transform:translateY(30px);opacity:0}to{transform:none;opacity:1}}@keyframes rlFade{from{opacity:0}to{opacity:1}}');
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-end;justify-content:center;background:rgba(8,7,6,0.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:rlFade .3s ease';
    ov.innerHTML = '<div style="background:linear-gradient(160deg,#16130f,#0f0d0b);border:1px solid rgba(201,168,76,0.25);border-radius:20px 20px 0 0;padding:28px 24px 32px;max-width:440px;width:100%;text-align:center;box-shadow:0 -12px 44px rgba(0,0,0,0.55);animation:rlUp .4s cubic-bezier(.2,.7,.2,1)">'
      + '<div style="width:66px;height:66px;margin:0 auto 14px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#e8d5a3,#c9a84c 55%,#a8842f);box-shadow:0 0 44px rgba(201,168,76,0.45)"></div>'
      + '<div style="font-family:\'DM Serif Display\',serif;font-size:23px;color:#f5f0e8;margin-bottom:8px">Get the Riley app</div>'
      + '<div style="font-size:14px;color:#8a8578;line-height:1.65;margin-bottom:22px">Add Riley to your home screen for one-tap access - always with you, like a real app.</div>'
      + '<button id="rli-go" style="width:100%;background:linear-gradient(135deg,#e8d5a3,#c9a84c 55%,#a8842f);color:#0a0908;border:none;padding:15px;font-size:15px;font-weight:600;border-radius:9px;cursor:pointer;margin-bottom:10px">Install Riley App<span style="color:#fff">.</span></button>'
      + '<button id="rli-skip" style="background:none;border:none;color:#8a8578;font-size:13px;cursor:pointer;padding:4px">Maybe later</button>'
      + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.getElementById('rli-skip').addEventListener('click', function () { ov.remove(); });
    document.getElementById('rli-go').addEventListener('click', function () { ov.remove(); triggerInstall(); });
  }

  // ── Floating "Chat with Riley" pill (always on) + embedded chat popup ─────
  var _cov, _cfr, _cpanel, _miniBtn, _xBtn, _checkinLock = false, _pendingSay = null, _layerReady = false;
  // Mandatory daily check-in: while the chat (iframe) reports a check-in in progress,
  // the popup can't be minimized/closed. Crisis + fail-open always unlock (the iframe
  // posts 'exempt'). Toggled by postMessage from /chat (same-origin).
  function setCheckinLock(on){
    _checkinLock = !!on;
    [_miniBtn, _xBtn].forEach(function (b) {
      if (!b) return;
      b.style.opacity = on ? '0.35' : '';
      b.style.cursor  = on ? 'not-allowed' : 'pointer';
      b.title = on ? 'Finish your check-in first' : '';
    });
  }
  function flashLockHint(){
    if (!_cov || document.getElementById('riley-lock-hint')) return;
    var t = document.createElement('div'); t.id = 'riley-lock-hint';
    t.textContent = "Let's finish your check-in first - it only takes a moment.";
    t.style.cssText = 'position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:5;max-width:280px;background:#141210;border:1px solid rgba(201,168,76,0.3);color:#f5f0e8;padding:10px 14px;border-radius:10px;font-family:"DM Sans",sans-serif;font-size:12.5px;line-height:1.5;box-shadow:0 8px 30px rgba(0,0,0,0.5);text-align:center';
    var panel = _cfr && _cfr.parentNode;
    (panel || _cov).appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function buildChat() {
    _cov = document.createElement('div'); _cov.id = 'riley-chat-overlay';
    // Docked, NON-blocking widget: no dimming backdrop, clicks pass through to the page
    // so members can scroll/click the dashboard with Riley open or minimized.
    // P1.10: the conversation LAYER - a full-height panel sliding over the page from the right
    // (~46vw desktop, one-tap expand to full screen; full-screen sheet on mobile). Non-blocking, so
    // the member can read/scroll the page beneath while Riley stays open.
    // While the layer is open the PAGE SHRINKS to fit beside it (founder, 2026-07-23) - the panel
    // must not cover content. body gets a right margin matching the panel width; mobile keeps the
    // full-screen sheet (no room to share), and expanded covers everything anyway.
    styleOnce('riley-layer-css', '#riley-chat-overlay{align-items:stretch !important;justify-content:flex-end;padding:0 !important}.riley-layer-panel{width:min(46vw,560px);height:100vh;overflow:hidden;box-shadow:-18px 0 60px rgba(0,0,0,0.45);border-left:1px solid rgba(0,0,0,0.10);transition:width .28s cubic-bezier(.4,0,.2,1)}.riley-layer-panel.expanded{width:100vw}@media(max-width:760px){.riley-layer-panel{width:100vw !important}}body{transition:margin-right .28s cubic-bezier(.4,0,.2,1)}html.riley-layer-open body{margin-right:min(46vw,560px)}@media(max-width:760px){html.riley-layer-open body{margin-right:0}}@media(prefers-reduced-motion:reduce){.riley-layer-panel{transition:none}body{transition:none}}');
    _cov.style.cssText = 'position:fixed;inset:0;z-index:10005;display:none;align-items:stretch;justify-content:flex-end;pointer-events:none';
    var panel = document.createElement('div'); panel.className = 'riley-layer-panel'; _cpanel = panel;
    panel.style.cssText = 'position:relative;pointer-events:auto;background:#fff';
    var bar = document.createElement('div'); bar.style.cssText = 'position:absolute;top:0;right:0;z-index:2;display:flex;gap:5px;padding:8px 10px';
    var exp = document.createElement('button'); exp.setAttribute('aria-label', 'Expand to full screen'); exp.innerHTML = '&#8622;'; exp.title = 'Expand';
    exp.style.cssText = 'width:30px;height:30px;border:none;border-radius:50%;background:rgba(0,0,0,0.34);color:#fff;font-size:14px;line-height:1;cursor:pointer';
    exp.onclick = function () { setLayerExpanded(!panel.classList.contains('expanded')); };
    var mini = document.createElement('button'); mini.setAttribute('aria-label', 'Minimize'); mini.innerHTML = '&minus;';
    mini.style.cssText = 'width:30px;height:30px;border:none;border-radius:50%;background:rgba(0,0,0,0.34);color:#fff;font-size:19px;line-height:1;cursor:pointer';
    mini.onclick = closeChat;
    var x = document.createElement('button'); x.setAttribute('aria-label', 'Close'); x.innerHTML = '&times;';
    x.style.cssText = 'width:30px;height:30px;border:none;border-radius:50%;background:rgba(0,0,0,0.34);color:#fff;font-size:21px;line-height:1;cursor:pointer';
    x.onclick = closeChat;
    bar.appendChild(exp); bar.appendChild(mini); bar.appendChild(x); _miniBtn = mini; _xBtn = x;
    _cfr = document.createElement('iframe'); _cfr.title = 'Talk to Riley';
    _cfr.style.cssText = 'width:100%;height:100%;border:0;display:block';
    panel.appendChild(bar); panel.appendChild(_cfr); _cov.appendChild(panel);
    _cov.addEventListener('click', function (e) { if (e.target === _cov) closeChat(); });
    document.body.appendChild(_cov);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _cov.style.display === 'flex') closeChat(); });
    // The chat (iframe) drives the mandatory-check-in lock, the crisis full-screen breakout, and the
    // "send this message" handoff - all via same-origin postMessage.
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !_cfr || e.source !== _cfr.contentWindow) return;
      var d = e.data || {};
      if (d.type === 'riley-checkin') setCheckinLock(d.status === 'pending');
      else if (d.type === 'riley-ready') { _layerReady = true; flushSay(); }
      else if (d.type === 'riley-crisis') { setLayerExpanded(true); }   // P1.10.4: a lifeline never renders inside a panel
    });
  }
  function setLayerExpanded(on) { if (_cpanel) _cpanel.classList.toggle('expanded', !!on); }
  function flushSay() { if (_pendingSay && _layerReady && _cfr && _cfr.contentWindow) { try { _cfr.contentWindow.postMessage({ type: 'riley-say', text: _pendingSay }, location.origin); } catch (e) {} _pendingSay = null; } }
  function openChat() { if (!_cov) buildChat(); if (!_cfr.src) _cfr.src = '/chat?embed=1'; _cov.style.display = 'flex'; document.documentElement.classList.add('riley-layer-open'); var p = document.getElementById('riley-chat-btn'); if (p) p.style.display = 'none'; }
  // P1.9/P1.10: the ONE entry point. The dashboard composer, nav "Talk to Riley", and "Ask Riley about this"
  // all call this - it opens the layer over the current page and optionally sends a message / expands.
  window.openRileyLayer = function (opts) {
    opts = opts || {};
    openChat();
    if (opts.message) { _pendingSay = String(opts.message); flushSay(); }
    if (opts.expand) setLayerExpanded(true);
  };
  // Minimize/close = hide the panel + bring back the pill. The iframe stays mounted, so
  // re-opening resumes the SAME conversation. Never locks the page - dashboard stays usable.
  function closeChat() {
    if (_checkinLock) { flashLockHint(); return; }   // mandatory check-in in progress → can't dismiss
    if (_cov) _cov.style.display = 'none'; document.documentElement.classList.remove('riley-layer-open'); document.body.style.overflow = ''; var p = document.getElementById('riley-chat-btn'); if (p) p.style.display = 'flex';
  }
  // Once per LOCAL day, on the app home, auto-open the chat so Riley greets with the
  // day-aware daily check-in. Strictly one auto-open per day - non-naggy by design.
  function autoOpenDaily() {
    try {
      var p = location.pathname.replace(/\/+$/, '').toLowerCase();
      if (p.indexOf('/dashboard') !== 0) return;           // only the authed home / PWA start_url
      var today = new Date(Date.now()-4*3600*1000).toLocaleDateString('en-CA');   // "app day": 4am-local rollover (matches the check-in)
      if (localStorage.getItem('riley_autochat') === today) return;
      localStorage.setItem('riley_autochat', today);
      setTimeout(openChat, 1000);                           // let the page settle first
    } catch (e) {}
  }
  function chatPill() {
    if (document.getElementById('riley-chat-btn')) return;
    styleOnce('riley-pill-css', '@keyframes rilePop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}#riley-chat-btn:hover,#riley-install-btn:hover{transform:translateY(-2px)}');
    var b = document.createElement('div'); b.id = 'riley-chat-btn';
    b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9990;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#4a7c59,#375c44);color:#fff;padding:12px 18px;border-radius:30px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(74,124,89,0.42);cursor:pointer;transition:transform .2s;animation:rilePop .5s ease';
    b.innerHTML = '<span style="font-size:15px">&#128172;</span><span>Chat with Riley</span>';
    b.addEventListener('click', openChat);
    document.body.appendChild(b);
  }
  // Any existing "/chat" link opens the popup instead of navigating - except on the chat page itself.
  if (!onChatPage) document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (a && /^\/chat(\?|$)/.test(a.getAttribute('href') || '')) { e.preventDefault(); openChat(); }
  });

  // ── Install offer - FIRST LOGIN ONLY (afterwards it lives in Settings) ────
  function showInstallNote() {
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;right:18px;bottom:76px;z-index:9991;max-width:250px;background:#141210;border:1px solid rgba(201,168,76,0.3);color:#e8e4de;padding:12px 14px;border-radius:12px;font-family:"DM Sans",sans-serif;font-size:12.5px;line-height:1.55;box-shadow:0 8px 30px rgba(0,0,0,0.5)';
    t.textContent = 'No problem - you can install Riley anytime from Settings.';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 500); }, 4500);
  }
  function installFirstLogin() {
    if (standalone) return;
    try { if (localStorage.getItem('riley_install_offered') === '1') return; } catch (e) { return; }
    if (!deferredPrompt && !(isIOS && isSafari)) return;    // can't actually install here → skip silently
    try { localStorage.setItem('riley_install_offered', '1'); } catch (e) {}
    if (document.getElementById('riley-install-btn')) return;
    var b = document.createElement('div'); b.id = 'riley-install-btn';
    b.style.cssText = 'position:fixed;right:18px;bottom:76px;z-index:9989;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#e8d5a3,#c9a84c 55%,#a8842f);color:#0a0908;padding:11px 16px;border-radius:30px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(201,168,76,0.35);cursor:pointer;animation:rilePop .5s ease';
    b.innerHTML = '<span>Install Riley App<span style="color:#fff">.</span></span><span id="riley-inst-x" style="opacity:0.55;font-size:17px;line-height:1">&times;</span>';
    b.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'riley-inst-x') { b.remove(); showInstallNote(); return; }
      b.remove(); triggerInstall();
    });
    document.body.appendChild(b);
  }

  // Let the Settings page trigger install on demand.
  window.rileyTriggerInstall = triggerInstall;

  // ── 5) 2nd-session privacy reminder (non-blocking, one-time soft toast) ─────
  // Show once, to returning members, after their first session - never blocks the app,
  // never interrupts a check-in. Uses a session counter in localStorage: first visit = 1,
  // second visit = 2, that is when we show it (and mark it shown forever).
  function maybePrivacyReminder() {
    try {
      // Never nag: skip if already shown, or if not onboarded yet, or on embed/login
      if (localStorage.getItem('riley_privacy_reminder_shown') === '1') return;
      if (!isOnboarded()) return;
      if (/[?&]embed=1/.test(location.search)) return;
      if (onLogin) return;

      // Increment session counter once per browser session
      var counted = sessionStorage.getItem('riley_session_counted');
      if (!counted) {
        var prev = parseInt(localStorage.getItem('riley_session_count') || '0', 10);
        var next = prev + 1;
        localStorage.setItem('riley_session_count', String(next));
        sessionStorage.setItem('riley_session_counted', '1');
      }
      var count = parseInt(localStorage.getItem('riley_session_count') || '0', 10);
      // Show on 2nd session only (count === 2)
      if (count !== 2) return;

      // Don't show if a check-in is active (the lock signal may not have arrived yet,
      // so delay enough to let pwa.js receive the postMessage if it comes).
      setTimeout(function () {
        if (_checkinLock) return;  // check-in in progress - skip silently (we won't re-show on lock release)
        localStorage.setItem('riley_privacy_reminder_shown', '1');

        var toast = document.createElement('div'); toast.id = 'riley-privacy-toast';
        styleOnce('riley-priv-toast-css', [
          '#riley-privacy-toast{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:10003;',
          'max-width:440px;width:calc(100vw - 32px);background:#161310;',
          'border:1px solid rgba(201,168,76,0.3);border-radius:14px;',
          'padding:13px 16px 13px 18px;box-shadow:0 10px 40px rgba(0,0,0,0.55);',
          'font-family:"DM Sans",sans-serif;font-size:13.5px;color:#e8e4de;line-height:1.55;',
          'display:flex;align-items:flex-start;gap:10px;',
          'animation:privToastIn .35s cubic-bezier(.2,.7,.2,1)}',
          '@keyframes privToastIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
          '@keyframes privToastOut{to{opacity:0;transform:translateX(-50%) translateY(-10px)}}'
        ].join(''));
        toast.innerHTML =
          '<span style="font-size:15px;flex-shrink:0;margin-top:1px">&#128274;</span>'
          + '<span style="flex:1">A quiet reminder - everything here is yours. Private, exportable, and deletable anytime.'
          + ' <a href="/settings" style="color:#c9a84c;text-decoration:underline;text-underline-offset:2px">Your data controls</a>.</span>'
          + '<button aria-label="Dismiss" id="riley-priv-toast-x" style="background:none;border:none;color:#8a8578;font-size:20px;line-height:1;cursor:pointer;flex-shrink:0;padding:0 2px;margin-left:4px">&times;</button>';
        document.body.appendChild(toast);

        function dismiss() {
          toast.style.animation = 'privToastOut .25s ease forwards';
          setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 280);
        }
        document.getElementById('riley-priv-toast-x').addEventListener('click', dismiss);
        // Auto-dismiss after 12 s so it never sits forever
        setTimeout(dismiss, 12000);
      }, 1800);  // wait 1.8s - gives check-in lock postMessage time to arrive
    } catch (e) {}
  }

  // P2.8: mobile bottom tab bar (PWA / mobile, member app only). Talk to Riley IS the center - the breathing
  // sun mark is the brand mark and the primary action, one object. Clarity + Life Map flank it.
  function mobileBottomBar() {
    if (document.getElementById('riley-bottombar')) return;
    styleOnce('riley-bottombar-css', '#riley-bottombar{display:none}@media(max-width:760px){#riley-bottombar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:9980;background:rgba(10,9,8,0.94);backdrop-filter:blur(14px);border-top:1px solid rgba(255,255,255,0.07);align-items:center;justify-content:space-around;padding:6px 8px calc(6px + env(safe-area-inset-bottom,0))}body{padding-bottom:72px}}.rbb-item{display:flex;flex-direction:column;align-items:center;gap:3px;color:#8a8578;font-family:"DM Sans",sans-serif;font-size:9px;text-decoration:none;flex:1;text-align:center;background:none;border:none;cursor:pointer;padding:4px 0}.rbb-item.active{color:#c9a84c}.rbb-ico{font-size:19px;line-height:1}.rbb-sun{width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#e8d5a3,#c9a84c 55%,#a8842f);box-shadow:0 0 16px rgba(201,168,76,0.5);animation:rbbBreathe 5s ease-in-out infinite;margin-top:-16px;border:3px solid rgba(10,9,8,0.94)}#riley-bottombar.thinking .rbb-sun{animation-duration:1.3s}@keyframes rbbBreathe{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.07);opacity:1}}@media(prefers-reduced-motion:reduce){.rbb-sun{animation:none}}');
    var path = location.pathname.replace(/\/+$/, '');
    var bar = document.createElement('nav'); bar.id = 'riley-bottombar'; bar.setAttribute('aria-label', 'Primary');
    bar.innerHTML =
      '<a class="rbb-item' + (path === '/dashboard' ? ' active' : '') + '" href="/dashboard"><span class="rbb-ico">✨</span>Clarity</a>' +
      '<button class="rbb-item" id="rbb-talk" type="button" aria-label="Talk to Riley"><span class="rbb-sun"></span></button>' +
      '<a class="rbb-item' + (path === '/lifemap' ? ' active' : '') + '" href="/lifemap"><span class="rbb-ico">🗺️</span>Life Map</a>';
    document.body.appendChild(bar);
    var t = document.getElementById('rbb-talk');
    if (t) t.onclick = function () { if (window.openRileyLayer) window.openRileyLayer({}); else location.href = '/chat'; };
  }

  // ── Riley's Community - porch lights in the SIDEBAR (founder call 2026-07-24, replaces the
  // dashboard card). One injection here covers every member page. Shows the TRUE count of
  // members seen in the rolling day; lane breakdowns (min-count 12) stay server-gated for any
  // future surface. Post-launch upgrade path: live "online now" verbiage. View-only - L2-5 absent.
  function porchSidebar() {
    try {
      var sb = document.querySelector('.sidebar');
      if (!sb || document.getElementById('porch-nav')) return;
      var raw = localStorage.getItem('sb-tglljvjixlolaguycvbb-auth-token'); if (!raw) return;
      var tok = null; try { tok = (JSON.parse(raw) || {}).access_token; } catch (e) {}
      if (!tok) return;
      // Presence heartbeat, throttled locally to 1/10min (server throttles + honors opt-out too).
      try {
        var last = parseInt(localStorage.getItem('porch_hb') || '0', 10);
        if (Date.now() - last > 600000) {
          localStorage.setItem('porch_hb', String(Date.now()));
          fetch('/.netlify/functions/porch-presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, action: 'heartbeat' }) }).catch(function () {});
        }
      } catch (e) {}
      fetch('/.netlify/functions/porch-presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, action: 'counts' }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.light || document.getElementById('porch-nav')) return;
          var n = (typeof d.total === 'number' && d.total > 0) ? d.total : null;
          var line = n ? (n + ' porch light' + (n === 1 ? ' is' : 's are') + ' on today') : 'The porch light is on today';
          var wrap = document.createElement('div');
          wrap.id = 'porch-nav';
          wrap.innerHTML = '<div style="font-size:9px;font-family:\'DM Mono\',monospace;color:#8f897c;letter-spacing:0.16em;text-transform:uppercase;padding:14px 20px 6px">Riley\'s Community</div>'
            + '<div style="display:flex;align-items:center;gap:8px;padding:2px 20px 10px;font-size:12px;color:#8a8578;line-height:1.5"><span style="width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#e8d5a3,#c9a84c 60%);box-shadow:0 0 8px rgba(201,168,76,0.6);flex-shrink:0" aria-hidden="true"></span><span></span></div>';
          wrap.querySelectorAll('span')[1].textContent = line;
          var spacer = sb.querySelector('.sb-spacer');
          if (spacer) sb.insertBefore(wrap, spacer); else sb.appendChild(wrap);
        }).catch(function () {});
    } catch (e) {}
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      // P1.10.7: the floating "Chat with Riley" pill is RETIRED inside the member app (it duplicated the
      // nav + recast Riley as a support widget). It stays on the logged-out marketing site, where it's the
      // conversion path and there's no member nav. Member app pages carry the #sb-tiers nav mount; marketing does not.
      if (!onChatPage && !document.getElementById('sb-tiers')) chatPill();
      if (!onChatPage && document.getElementById('sb-tiers')) mobileBottomBar();   // P2.8: mobile bottom bar (member app)
      porchSidebar();                                      // Riley's Community - porch lights in the nav
      autoOpenDaily();                                     // once/day → Riley's day-aware check-in
      if (!isOnboarded()) return;                          // app-install is offered only AFTER onboarding
      if (onLogin && isMobile) { loginPopup(); return; }   // phone login → app popup (once/session)
      installFirstLogin();                                 // first-ever login → offer install
      maybePrivacyReminder();                              // 2nd-session one-time privacy reminder
    }, onLogin ? 900 : 500);
  });
})();

/* ── Account menu - click the sidebar user (bottom-left) to open Profile / Settings /
 * Your Data / Sign out. Injected here so every app page's sidebar gets it consistently. */
(function () {
  if (/[?&]embed=1/.test(location.search)) return;   // no account menu inside the chat popup
  function init() {
    var user = document.querySelector('.sb-user');
    if (!user || document.getElementById('riley-acct-pop')) return;
    user.style.cursor = 'pointer';
    user.setAttribute('title', 'Account');

    var st = document.createElement('style');
    st.textContent = [
      '#riley-acct-pop{position:fixed;z-index:10002;min-width:186px;background:#161310;border:1px solid rgba(201,168,76,0.25);border-radius:12px;padding:6px;box-shadow:0 14px 44px rgba(0,0,0,0.62);opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity .16s,transform .16s;font-family:"DM Sans",sans-serif}',
      '#riley-acct-pop.on{opacity:1;transform:none;pointer-events:auto}',
      '#riley-acct-pop .ai{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:8px;color:#e8e4de;font-size:13.5px;cursor:pointer;transition:background .12s;-webkit-user-select:none;user-select:none}',
      '#riley-acct-pop .ai:hover{background:rgba(255,255,255,0.05)}',
      '#riley-acct-pop .ai .ic{width:17px;text-align:center;font-size:14px;opacity:0.9}',
      '#riley-acct-pop .sep{height:1px;background:rgba(255,255,255,0.08);margin:5px 8px}',
      '#riley-acct-pop .ai.out{color:#c0604a}'
    ].join('');
    document.head.appendChild(st);

    var pop = document.createElement('div');
    pop.id = 'riley-acct-pop';
    pop.innerHTML =
        '<div class="ai" data-act="profile"><span class="ic">👤</span>Profile</div>'
      + '<div class="ai" data-act="settings"><span class="ic">⚙️</span>Settings</div>'
      + '<div class="ai" data-act="data"><span class="ic">🔒</span>Your Data</div>'
      + '<div class="sep"></div>'
      + '<div class="ai out" data-act="signout"><span class="ic">↪</span>Sign out</div>';
    document.body.appendChild(pop);

    function place() {
      var r = user.getBoundingClientRect();
      pop.style.left = Math.round(r.left + 10) + 'px';
      pop.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px';
      pop.style.width = Math.max(186, Math.round(r.width - 20)) + 'px';
    }
    function openPop() { place(); pop.classList.add('on'); }
    function closePop() { pop.classList.remove('on'); }

    user.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.sb-out')) return;  // existing sign-out button keeps working
      e.stopPropagation();
      pop.classList.contains('on') ? closePop() : openPop();
    });
    document.addEventListener('click', function (e) {
      if (!pop.contains(e.target) && !user.contains(e.target)) closePop();
    });
    window.addEventListener('resize', function () { if (pop.classList.contains('on')) place(); });

    pop.addEventListener('click', function (e) {
      var it = e.target.closest && e.target.closest('.ai');
      if (!it) return;
      var act = it.getAttribute('data-act');
      closePop();
      if (act === 'profile') location.href = '/profile';
      else if (act === 'settings') location.href = '/settings';
      else if (act === 'data') {
        if (typeof window.yourData === 'function') window.yourData();
        else location.href = '/dashboard#data';
      } else if (act === 'signout') {
        if (typeof window.doSignOut === 'function') window.doSignOut();
        else location.href = 'https://riley.meetriley.us';
      }
    });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();

/* ── Canonical member-day - ONE source of truth for "what day is it" ────────────────
 * A member's day rolls at 4am LOCAL (a 1am check-in still counts as yesterday). Every
 * check-in date-key, streak, and the sober-day count must go through these so no two
 * screens ever disagree about the day. See DATA_CONTRACT.md. */
window.RileyDay = (function () {
  function ymd(d) { return d.toLocaleDateString('en-CA'); }                 // 'YYYY-MM-DD' in local tz
  function appDay(ref) {                                                     // today's key, 4am rollover
    var t = ref ? new Date(ref) : new Date();
    return ymd(new Date(t.getTime() - 4 * 3600 * 1000));
  }
  // Elapsed calendar days from a 'YYYY-MM-DD' start to the member's current app-day.
  // Both parsed as UTC-midnight date strings ⇒ exact calendar-day difference, no
  // time-of-day / timezone drift. Start date = day 0 (today shows the elapsed count).
  function soberDays(startYmd) {
    if (!startYmd) return null;
    var start = String(startYmd).slice(0, 10);
    var diff = Math.floor((Date.parse(appDay()) - Date.parse(start)) / 86400000);
    return isNaN(diff) ? null : Math.max(0, diff);
  }
  return { ymd: ymd, appDay: appDay, soberDays: soberDays };
})();
