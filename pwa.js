/* Riley PWA — service-worker registration + "Install Riley App" affordance.
 * Loaded on every app page. The button appears only when the app is installable
 * and not already installed/dismissed. iOS Safari (which has no install event)
 * gets a gentle Share-sheet hint instead. */
(function () {
  // 1) Register the network-first service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  // 2) Install affordance — skip if already installed or previously dismissed
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
  if (standalone) return;
  try { if (localStorage.getItem('riley_install_dismissed') === '1') return; } catch (e) {}

  var deferred = null;

  function styleOnce() {
    if (document.getElementById('riley-inst-style')) return;
    var st = document.createElement('style');
    st.id = 'riley-inst-style';
    st.textContent = '@keyframes rileyInstIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}#riley-install-btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(201,168,76,0.45)}';
    document.head.appendChild(st);
  }

  function showBtn(onClick) {
    if (document.getElementById('riley-install-btn')) return;
    styleOnce();
    var b = document.createElement('div');
    b.id = 'riley-install-btn';
    b.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:9999;display:flex;align-items:center;gap:9px;background:linear-gradient(135deg,#c9a84c,#d4942a);color:#0a0908;padding:11px 16px;border-radius:30px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(201,168,76,0.35);cursor:pointer;transition:transform .2s,box-shadow .2s;animation:rileyInstIn .5s ease';
    b.innerHTML = '<span style="font-size:15px">🌅</span><span>Install Riley App</span><span id="riley-inst-x" style="opacity:0.55;font-size:17px;line-height:1;padding-left:4px">&times;</span>';
    b.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'riley-inst-x') {
        b.remove();
        try { localStorage.setItem('riley_install_dismissed', '1'); } catch (er) {}
        return;
      }
      onClick();
    });
    document.body.appendChild(b);
  }

  function iosHint() {
    if (document.getElementById('riley-ios-hint')) return;
    var t = document.createElement('div');
    t.id = 'riley-ios-hint';
    t.style.cssText = 'position:fixed;left:18px;bottom:74px;z-index:9999;max-width:290px;background:#141210;border:1px solid rgba(201,168,76,0.3);color:#f5f0e8;padding:15px 17px;border-radius:12px;font-family:"DM Sans",sans-serif;font-size:13px;line-height:1.6;box-shadow:0 10px 34px rgba(0,0,0,0.55);animation:rileyInstIn .4s ease';
    t.innerHTML = '<div style="font-family:\'DM Serif Display\',serif;color:#c9a84c;font-size:15px;margin-bottom:5px">Add Riley to your Home Screen</div>Tap the <b>Share</b> button (the square with an up-arrow) at the bottom of Safari, then choose <b>&ldquo;Add to Home Screen.&rdquo;</b><div style="text-align:right;margin-top:10px"><span id="riley-ios-ok" style="color:#8a8578;cursor:pointer;font-size:12px;font-family:\'DM Mono\',monospace;letter-spacing:0.04em">GOT IT</span></div>';
    document.body.appendChild(t);
    t.querySelector('#riley-ios-ok').addEventListener('click', function () { t.remove(); });
  }

  // Chrome / Edge / Android — capture the native prompt
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    showBtn(function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.finally(function () {
        var el = document.getElementById('riley-install-btn');
        if (el) el.remove();
        deferred = null;
      });
    });
  });

  window.addEventListener('appinstalled', function () {
    var el = document.getElementById('riley-install-btn');
    if (el) el.remove();
    try { localStorage.setItem('riley_install_dismissed', '1'); } catch (e) {}
  });

  // iOS Safari — no beforeinstallprompt; offer the Share-sheet hint
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isSafari = /safari/i.test(ua) && !/crios|fxios|chrome|android/i.test(ua);
  if (isIOS && isSafari) {
    window.addEventListener('load', function () { showBtn(iosHint); });
  }
})();
