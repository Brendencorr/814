/**
 * marketing-pill.js - Floating "Chat with Riley" pill for the marketing site
 *
 * Adds a docked, non-blocking chat widget (bottom-right) to all marketing pages
 * (meetriley.us home/about/pillars/resources/blog/safety/help/data). Opens an
 * anonymous chat popup that calls riley-chat.js directly - no login required.
 *
 * DOES NOT affect the app pages (riley.meetriley.us) which use pwa.js and open
 * the authenticated /chat?embed=1 surface instead.
 *
 * Design: matches app pill UX - docked bottom-right, non-blocking, resumes on
 * re-open (iframe stays mounted), mobile-friendly.
 *
 * Crisis safety: riley-chat.js handles ALL crisis detection server-side.
 * chat-anon.html calls /.netlify/functions/riley-chat - no bypass, no alternate path.
 */
(function () {
  'use strict';

  // Don't run inside an iframe (e.g. if someone embeds the marketing page)
  if (window.self !== window.top) return;

  var _cov, _cfr, _built = false;
  var CHAT_SRC = '/chat-anon.html';

  function styleOnce(id, css) {
    if (document.getElementById(id)) return;
    var st = document.createElement('style');
    st.id = id;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildChat() {
    if (_built) return;
    _built = true;

    styleOnce('mktg-pill-anim',
      '@keyframes mktgPillPop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'
      + '#mktg-chat-btn:hover{transform:translateY(-2px)}'
    );

    // Overlay container (no backdrop - non-blocking, clicks pass through)
    _cov = document.createElement('div');
    _cov.id = 'mktg-chat-overlay';
    _cov.style.cssText = [
      'position:fixed;inset:0;z-index:10005;',
      'display:none;align-items:flex-end;justify-content:flex-end;',
      'padding:16px;pointer-events:none'
    ].join('');

    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative;pointer-events:auto;',
      'width:min(384px,calc(100vw - 32px));',
      'height:min(580px,calc(100vh - 100px));',
      'background:#0a0908;',
      'border-radius:16px;overflow:hidden;',
      'box-shadow:0 18px 60px rgba(0,0,0,0.7);',
      'border:1px solid rgba(201,168,76,0.28)'
    ].join('');

    // Close buttons bar
    var bar = document.createElement('div');
    bar.style.cssText = 'position:absolute;top:0;right:0;z-index:2;display:flex;gap:5px;padding:8px 10px';

    var mini = document.createElement('button');
    mini.setAttribute('aria-label', 'Minimize');
    mini.innerHTML = '&minus;';
    mini.style.cssText = 'width:30px;height:30px;border:none;border-radius:50%;background:rgba(0,0,0,0.45);color:#e8d5a3;font-size:20px;line-height:1;cursor:pointer';
    mini.onclick = closeChat;

    var xBtn = document.createElement('button');
    xBtn.setAttribute('aria-label', 'Close');
    xBtn.innerHTML = '&times;';
    xBtn.style.cssText = 'width:30px;height:30px;border:none;border-radius:50%;background:rgba(0,0,0,0.45);color:#e8d5a3;font-size:22px;line-height:1;cursor:pointer';
    xBtn.onclick = closeChat;

    bar.appendChild(mini);
    bar.appendChild(xBtn);

    // Iframe
    _cfr = document.createElement('iframe');
    _cfr.title = 'Chat with Riley';
    _cfr.style.cssText = 'width:100%;height:100%;border:0;display:block';

    panel.appendChild(bar);
    panel.appendChild(_cfr);
    _cov.appendChild(panel);
    document.body.appendChild(_cov);

    // ESC closes
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _cov.style.display === 'flex') closeChat();
    });

    // Handle sign-in request postMessage from chat-anon.html
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
      var d = e.data || {};
      if (d.type !== 'riley_anon_signin') return;
      // Stash history so login page can pick it up
      try {
        if (d.history) sessionStorage.setItem('riley_pre_auth_history', JSON.stringify(d.history));
        sessionStorage.setItem('riley_pre_auth_msg_count', String(d.count || 0));
      } catch (err) {}
      // Navigate TOP window to login (OAuth can't run inside iframe)
      window.location.href = 'https://riley.meetriley.us/login';
    });
  }

  function openChat() {
    buildChat();
    if (!_cfr.src) _cfr.src = CHAT_SRC;
    _cov.style.display = 'flex';
    var pill = document.getElementById('mktg-chat-btn');
    if (pill) pill.style.display = 'none';
  }

  function closeChat() {
    if (_cov) _cov.style.display = 'none';
    var pill = document.getElementById('mktg-chat-btn');
    if (pill) pill.style.display = 'flex';
  }

  function createPill() {
    if (document.getElementById('mktg-chat-btn')) return;

    styleOnce('mktg-pill-anim',
      '@keyframes mktgPillPop{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'
      + '#mktg-chat-btn:hover{transform:translateY(-2px)}'
    );

    var pill = document.createElement('div');
    pill.id = 'mktg-chat-btn';
    pill.setAttribute('role', 'button');
    pill.setAttribute('aria-label', 'Chat with Riley');
    pill.style.cssText = [
      'position:fixed;right:18px;bottom:18px;z-index:9990;',
      'display:flex;align-items:center;gap:8px;',
      'background:linear-gradient(135deg,#4a7c59,#375c44);',
      'color:#fff;padding:12px 18px;border-radius:30px;',
      'font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;',
      'box-shadow:0 6px 24px rgba(74,124,89,0.45);',
      'cursor:pointer;transition:transform .2s;',
      'animation:mktgPillPop .5s ease'
    ].join('');
    pill.innerHTML = '<span style="font-size:15px">&#128172;</span><span>Chat with Riley</span>';
    pill.addEventListener('click', openChat);
    document.body.appendChild(pill);
  }

  // Intercept existing "Talk to Riley" / /talk links so they open the popup
  // instead of navigating (the inline scripts on each page do this too, but
  // this handles any link added by cms-overrides or future pages).
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/\/talk(\?|#|$)/.test(href) || /\/chat-anon(\?|#|$)/.test(href)) {
      e.preventDefault();
      openChat();
    }
  });

  // Show pill after a short delay so the page settles first
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(createPill, 600);
    });
  } else {
    setTimeout(createPill, 600);
  }
})();
