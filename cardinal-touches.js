/* cardinal-touches.js - the animated cardinal micro-interactions (founder mocks, 2026-07-24).
 *
 * One clean bird (814-cardinal-clean.png) + animated overlays, extracted from the
 * founder's five animation boards: idle breathe, success hop + heart burst,
 * gentle-reminder tilt + "!" bubble, new-message look-up + floating heart, and
 * the walking hop with a dashed trail (loaders).
 *
 * Usage (any app page):
 *   <script src="/cardinal-touches.js"></script>
 *   RileyCardinal.mount(el, 'success', { width: 120 })   -> replaces el's content
 *   RileyCardinal.html('reminder', { width: 90 })        -> returns HTML string
 * Modes: idle | success | reminder | notify | walk
 * prefers-reduced-motion: all motion stops; the clean bird still shows. */
(function () {
  var BIRD = '/assets/cardinal/png/814-cardinal-clean.png';
  var HEART_A = '/assets/cardinal/png/814-heart-a.png';
  var HEART_B = '/assets/cardinal/png/814-heart-b.png';

  function styleOnce() {
    if (document.getElementById('riley-cardinal-css')) return;
    var st = document.createElement('style');
    st.id = 'riley-cardinal-css';
    st.textContent = [
      '.rc-stage{position:relative;display:inline-block}',
      '.rc-shadow{position:absolute;bottom:-2px;left:50%;transform:translateX(-46%);width:64%;height:9%;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,0,0,.30) 0%,rgba(0,0,0,0) 68%)}',
      '.rc-bird{position:absolute;bottom:0;left:50%;margin-left:-50%;width:100%;transform-origin:58% 92%}',
      '.rc-idle .rc-bird{animation:rcBreathe 3.2s ease-in-out infinite}',
      '@keyframes rcBreathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.008,1.022)}}',
      /* success: natural double-squash hop + heart burst (founder board) */
      '.rc-success .rc-bird{animation:rcHop 2.8s cubic-bezier(.42,0,.58,1) infinite}',
      '.rc-success .rc-shadow{animation:rcHopShad 2.8s cubic-bezier(.42,0,.58,1) infinite}',
      '.rc-heartA{position:absolute;top:6%;left:60%;width:28%;animation:rcHeartburst 2.8s ease-out infinite}',
      '.rc-heartB{position:absolute;top:22%;left:26%;width:15%;animation:rcHeartburst 2.8s ease-out infinite;animation-delay:.25s}',
      '@keyframes rcHop{0%,16%{transform:translateY(0) scale(1,1)}22%{transform:translateY(0) scale(1.07,.9)}27%{transform:translateY(-4%) scale(.96,1.07)}38%{transform:translateY(-12%) scale(1,1) rotate(-2deg)}49%{transform:translateY(-1%) scale(1,1)}53%{transform:translateY(0) scale(1.09,.88)}59%{transform:translateY(0) scale(.985,1.02)}65%,100%{transform:translateY(0) scale(1,1)}}',
      '@keyframes rcHopShad{0%,22%,53%,100%{transform:translateX(-46%) scale(1);opacity:.85}38%{transform:translateX(-46%) scale(.72);opacity:.45}}',
      '@keyframes rcHeartburst{0%,18%{opacity:0;transform:translateY(4px) scale(.3)}26%{opacity:1;transform:translateY(0) scale(1.12)}40%{opacity:1;transform:translateY(-4px) scale(1)}66%{opacity:0;transform:translateY(-14px) scale(1.05)}100%{opacity:0;transform:translateY(-14px) scale(1.05)}}',
      /* gentle reminder: attentive tilt + "!" speech bubble sway */
      '.rc-reminder .rc-bird{animation:rcTilt 5s ease-in-out infinite}',
      '.rc-bub{position:absolute;top:-14%;left:60%;width:34%;aspect-ratio:1;background:#fffdf9;border:2px solid #cbc2ae;border-radius:50% 50% 50% 6px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#ab9166;font-size:130%;font-family:"DM Sans",sans-serif;animation:rcSway 2.8s ease-in-out infinite;transform-origin:50% 110%;box-sizing:border-box}',
      '@keyframes rcTilt{0%,58%,100%{transform:rotate(0deg)}66%{transform:rotate(-2.5deg)}80%{transform:rotate(-2.5deg)}88%{transform:rotate(0deg)}}',
      '@keyframes rcSway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}',
      /* new message: look up + one heart floats away */
      '.rc-notify .rc-bird{animation:rcLookup 4s ease-in-out infinite}',
      '.rc-heartN{position:absolute;top:2%;left:62%;width:20%;animation:rcFloat 4s ease-in-out infinite}',
      '@keyframes rcLookup{0%,20%{transform:rotate(0deg)}28%{transform:rotate(-5deg)}55%{transform:rotate(-5deg)}64%{transform:rotate(0deg)}100%{transform:rotate(0deg)}}',
      '@keyframes rcFloat{0%,24%{opacity:0;transform:translateY(8px) scale(.55)}32%{opacity:1;transform:translateY(0) scale(1.05)}38%{transform:translateY(-2px) scale(1)}60%{opacity:.9;transform:translateY(-14px) scale(1)}78%,100%{opacity:0;transform:translateY(-26px) scale(1)}}',
      /* walk: double hop + dashed trail behind (loaders) */
      '.rc-walk .rc-bird{animation:rcHopDuo 4.6s cubic-bezier(.42,0,.58,1) infinite}',
      '.rc-walk .rc-shadow{animation:rcHopDuoShad 4.6s ease-in-out infinite}',
      '.rc-dash{position:absolute;width:6%;height:2px;border-radius:2px;background:#8a8578;opacity:0}',
      '@keyframes rcHopDuo{0%,10%{transform:translateY(0) scale(1,1)}14%{transform:scale(1.06,.92)}19%{transform:translateY(-6%) scale(.97,1.05)}26%{transform:translateY(0) scale(1.07,.9)}30%{transform:scale(.99,1.01)}34%{transform:scale(1.05,.93)}39%{transform:translateY(-5%) scale(.98,1.04)}46%{transform:translateY(0) scale(1.06,.91)}51%,100%{transform:scale(1,1)}}',
      '@keyframes rcHopDuoShad{0%,14%,26%,46%,100%{transform:translateX(-46%) scale(1);opacity:.8}19%{transform:translateX(-46%) scale(.82);opacity:.55}39%{transform:translateX(-46%) scale(.85);opacity:.6}}',
      '@keyframes rcTrail{0%,8%{opacity:0}14%{opacity:.6}55%{opacity:.6}66%,100%{opacity:0}}',
      /* accessibility: motion off -> still bird, overlays hidden except the bubble */
      '@media(prefers-reduced-motion:reduce){.rc-stage *{animation:none !important}.rc-heartA,.rc-heartB,.rc-heartN,.rc-dash{display:none}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function html(mode, opts) {
    opts = opts || {};
    var w = opts.width || 108;
    // stage is a bit taller than the bird to give overlays headroom
    var h = Math.round(w * (147 / 171) * 1.34);
    var inner = '<div class="rc-shadow"></div><img class="rc-bird" src="' + BIRD + '" alt="' + (opts.alt || '') + '">';
    if (mode === 'success') inner += '<img class="rc-heartA" src="' + HEART_A + '" alt=""><img class="rc-heartB" src="' + HEART_B + '" alt="">';
    if (mode === 'reminder') inner += '<div class="rc-bub">!</div>';
    if (mode === 'notify') inner += '<img class="rc-heartN" src="' + HEART_A + '" alt="">';
    if (mode === 'walk') inner +=
      '<div class="rc-dash" style="left:-42%;top:52%"></div>' +
      '<div class="rc-dash" style="left:-30%;top:44%;transform:rotate(-16deg);animation:rcTrail 4.6s linear infinite"></div>' +
      '<div class="rc-dash" style="left:-18%;top:38%;transform:rotate(-10deg);animation:rcTrail 4.6s linear infinite;animation-delay:.35s"></div>' +
      '<div class="rc-dash" style="left:-7%;top:34%;transform:rotate(4deg);animation:rcTrail 4.6s linear infinite;animation-delay:.7s"></div>';
    return '<div class="rc-stage rc-' + mode + '" style="width:' + w + 'px;height:' + h + 'px">' + inner + '</div>';
  }

  function mount(el, mode, opts) {
    if (!el) return;
    styleOnce();
    el.innerHTML = html(mode, opts);
  }

  window.RileyCardinal = { mount: mount, html: function (m, o) { styleOnce(); return html(m, o); } };
  if (document.readyState !== 'loading') styleOnce();
  else document.addEventListener('DOMContentLoaded', styleOnce);
})();
