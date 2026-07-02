/* Riley PWA — service worker + mobile nav + install affordances.
 * Loaded on every app page. Handles: (1) SW registration, (2) a mobile
 * hamburger + slide-in drawer for the sidebar (which is hidden on phones),
 * (3) an "Install Riley App" pill, (4) a download popup at login on phones. */
(function () {
  var ua = navigator.userAgent || '';
  var isMobile = /iphone|ipad|ipod|android/i.test(ua);
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isSafari = /safari/i.test(ua) && !/crios|fxios|chrome|android/i.test(ua);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
  var deferredPrompt = null;

  // ── 1) Register the network-first service worker ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
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

  // ── 2) Mobile sidebar nav — hamburger + slide-in drawer ──────────────────
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
        '.topbar{padding-left:66px !important}',
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

  if (standalone) return;                                        // installed → no install UI
  try { if (localStorage.getItem('riley_install_dismissed') === '1') { /* pill off, popup still ok */ } } catch (e) {}

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
      + '<div style="font-size:14px;color:#8a8578;line-height:1.65;margin-bottom:22px">Add Riley to your home screen for one-tap access — always with you, like a real app.</div>'
      + '<button id="rli-go" style="width:100%;background:linear-gradient(135deg,#c9a84c,#d4942a);color:#fff;border:none;padding:15px;font-size:15px;font-weight:600;border-radius:9px;cursor:pointer;margin-bottom:10px">Install Riley App<span style="color:#0a0908">.</span></button>'
      + '<button id="rli-skip" style="background:none;border:none;color:#8a8578;font-size:13px;cursor:pointer;padding:4px">Maybe later</button>'
      + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    document.getElementById('rli-skip').addEventListener('click', function () { ov.remove(); });
    document.getElementById('rli-go').addEventListener('click', function () { ov.remove(); triggerInstall(); });
  }

  // ── 3) Corner install pill (non-login pages) ─────────────────────────────
  function installPill() {
    try { if (localStorage.getItem('riley_install_dismissed') === '1') return; } catch (e) {}
    if (document.getElementById('riley-install-btn')) return;
    styleOnce('riley-pill-css', '@keyframes rilePop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}#riley-install-btn:hover{transform:translateY(-2px)}');
    var b = document.createElement('div'); b.id = 'riley-install-btn';
    b.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:9990;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#c9a84c,#d4942a);color:#fff;padding:12px 18px;border-radius:30px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(201,168,76,0.35);cursor:pointer;transition:transform .2s;animation:rilePop .5s ease';
    b.innerHTML = '<span>Install Riley App<span style="color:#0a0908">.</span></span><span id="riley-inst-x" style="opacity:0.6;font-size:17px;line-height:1">&times;</span>';
    b.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'riley-inst-x') { b.remove(); try { localStorage.setItem('riley_install_dismissed', '1'); } catch (er) {} return; }
      triggerInstall();
    });
    document.body.appendChild(b);
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (onLogin && isMobile) { loginPopup(); return; }   // login on phone → popup
      if (deferredPrompt || (isIOS && isSafari)) installPill();
    }, onLogin ? 900 : 400);
  });
})();
