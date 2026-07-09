/* site-cms.js - runtime overrides for the marketing site + the in-page live editor.
 *
 * TWO MODES:
 *  1) Apply (always): fetch /.netlify/functions/site-content?page=<page> and apply overrides on top of
 *     the page's hardcoded defaults - text, images, section state (hidden/order/colors), a per-element
 *     universal style (color / bold / italic), AND per-element RESPONSIVE layout: desktop layout only
 *     >768px and mobile only ≤768px, injected as a media-queried <style>. So unless the operator edits
 *     mobile, phones keep the page's original responsive design.
 *  2) Edit (?cms=edit, only inside the operator "Customize Website" iframe): click text to edit it, click
 *     a logo to swap it, use each section's toolbar (hide·reorder·colors), and the "⛶ Layout" handle on
 *     ANY element to move it (DRAG the handle, or nudge/size/space via its panel) + recolor/bold/italic
 *     text. When previewing at phone width the layout edits the MOBILE bucket; at full width, DESKTOP.
 *     The editor NEVER writes to Supabase - it posts each change to window.parent (which saves).
 *
 * Override props by kind (all may carry `css`=desktop layout, `cssMobile`=≤768px layout, `cssBase`=universal):
 *   text    → {text, css, cssMobile, cssBase}
 *   image   → {src, alt, hidden, css, cssMobile, cssBase}
 *   section → {hidden, sort, bg, color, accent, css, cssMobile, cssBase}
 */
(function () {
  "use strict";

  var PAGE =
    (document.body && document.body.getAttribute("data-cms-page")) ||
    (location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "home").replace(/\.html?$/, "") ||
    "home";
  var EDIT = /[?&]cms=edit\b/.test(location.search);
  var MOBILE_BP = 768;
  var _editVp = "d";                            // which layout bucket the editor edits (driven by the operator's Desktop/Mobile toggle)
  var OVERRIDES = {};
  var SECTION_STATE = {};                       // key -> {hidden, sort, bg, color, accent}
  var STYLE_STATE = {};                         // key -> { d:{}, m:{}, base:{} }  (desktop / mobile layout + universal)

  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function attrEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function elFor(key) {
    return q('[data-cms-text="' + attrEsc(key) + '"]') ||
           q('[data-cms-img="' + attrEsc(key) + '"]') ||
           q('[data-cms-section="' + attrEsc(key) + '"]');
  }
  function attrOf(el) { return el.hasAttribute("data-cms-text") ? "data-cms-text" : el.hasAttribute("data-cms-img") ? "data-cms-img" : "data-cms-section"; }
  function kindOf(el) { return el.hasAttribute("data-cms-text") ? "text" : el.hasAttribute("data-cms-img") ? "image" : "section"; }
  function styleOf(key) { var s = STYLE_STATE[key]; if (!s) { s = STYLE_STATE[key] = { d: {}, m: {}, base: {} }; } if (!s.base) s.base = {}; return s; }
  function nonEmpty(map) { return map && Object.keys(map).some(function (k) { return map[k] !== "" && map[k] != null; }); }

  // ── Responsive override stylesheet (universal base + desktop / mobile media queries) ──
  function selFor(key) { var el = elFor(key); if (!el) return null; return "[" + attrOf(el) + '="' + attrEsc(key) + '"]'; }
  function cssDecl(map) {
    return Object.keys(map).filter(function (k) { return map[k] !== "" && map[k] != null; })
      .map(function (k) { return k + ":" + map[k] + " !important;"; }).join("");
  }
  function rebuildStyleSheet() {
    var base = "", d = "", m = "", act = "";
    Object.keys(STYLE_STATE).forEach(function (key) {
      var st = STYLE_STATE[key]; if (!st) return;
      var sel = selFor(key); if (!sel) return;
      if (nonEmpty(st.base)) { var bb = cssDecl(st.base); if (bb) base += sel + "{" + bb + "}"; }
      if (nonEmpty(st.d)) { var dd = cssDecl(st.d); if (dd) d += sel + "{" + dd + "}"; }
      if (nonEmpty(st.m)) { var mm = cssDecl(st.m); if (mm) m += sel + "{" + mm + "}"; }
      if (EDIT) { var bk = st[_editVp] || {}; if (nonEmpty(bk)) { var aa = cssDecl(bk); if (aa) act += sel + "{" + aa + "}"; } }
    });
    // In the editor, render the SELECTED viewport's layout UNCONDITIONALLY (so the operator's
    // desktop edits are visible even when the preview iframe is narrower than the breakpoint -
    // the edit bucket follows the Desktop/Mobile toggle, not the iframe width). The PUBLIC site
    // uses real media queries so each visitor gets the right one by their actual screen width.
    var css = EDIT
      ? base + act
      : base +
        (d ? "@media(min-width:" + (MOBILE_BP + 1) + "px){" + d + "}" : "") +
        (m ? "@media(max-width:" + MOBILE_BP + "px){" + m + "}" : "");
    var tag = document.getElementById("cms-overrides");
    if (!tag) { tag = document.createElement("style"); tag.id = "cms-overrides"; document.head.appendChild(tag); }
    tag.textContent = css;
  }

  // ─────────────────────────────── APPLY ───────────────────────────────
  function stashCss(key, props) {
    var st = styleOf(key);
    if (props.css) st.d = Object.assign({}, props.css);
    if (props.cssMobile) st.m = Object.assign({}, props.cssMobile);
    if (props.cssBase) st.base = Object.assign({}, props.cssBase);
  }
  function applyText(key, props) {
    var el = q('[data-cms-text="' + attrEsc(key) + '"]');
    if (!el || !props) return;
    if (typeof props.text === "string") el.textContent = props.text;
    stashCss(key, props);
  }
  function applyImage(key, props) {
    var el = q('[data-cms-img="' + attrEsc(key) + '"]');
    if (!el || !props) return;
    if (props.src) el.src = props.src;
    if (typeof props.alt === "string") el.alt = props.alt;
    el.style.display = props.hidden ? "none" : "";
    stashCss(key, props);
  }
  function applySectionStyle(key, props) {
    var el = q('[data-cms-section="' + attrEsc(key) + '"]');
    if (!el) return;
    el.style.display = props.hidden ? "none" : "";
    el.style.backgroundColor = props.bg || "";
    if (props.color) el.style.color = props.color; else el.style.color = "";
    if (props.accent) el.style.setProperty("--cms-accent", props.accent);
    stashCss(key, props);
  }
  function applyOrder() {
    var groups = new Map();
    qa("[data-cms-section]").forEach(function (s) {
      var st = SECTION_STATE[s.getAttribute("data-cms-section")] || {};
      s.__sort = (typeof st.sort === "number") ? st.sort : null;
      var par = s.parentNode;
      if (!groups.has(par)) groups.set(par, []);
      groups.get(par).push(s);
    });
    groups.forEach(function (list, par) {
      if (!list.some(function (s) { return s.__sort != null; })) return;
      list.forEach(function (s, i) { if (s.__sort == null) s.__sort = i; });
      list.slice().sort(function (a, b) { return a.__sort - b.__sort; }).forEach(function (s) { par.appendChild(s); });
    });
  }
  function apply() {
    Object.keys(OVERRIDES).forEach(function (key) {
      var o = OVERRIDES[key]; if (!o) return;
      if (o.kind === "text") applyText(key, o.props || {});
      else if (o.kind === "image") applyImage(key, o.props || {});
      else if (o.kind === "section") { SECTION_STATE[key] = Object.assign({}, o.props || {}); applySectionStyle(key, SECTION_STATE[key]); }
    });
    applyOrder();
    rebuildStyleSheet();
  }

  function load() {
    var url = "/.netlify/functions/site-content?page=" + encodeURIComponent(PAGE) + (EDIT ? "&_=" + Date.now() : "");
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      OVERRIDES = (d && d.overrides) || {};
      apply();
      if (EDIT) initEditor();
    }).catch(function () { if (EDIT) initEditor(); });
  }

  // ─────────────────────────────── EDIT MODE ───────────────────────────────
  function post(type, extra) {
    try { parent.postMessage(Object.assign({ type: type, page: PAGE }, extra || {}), location.origin); } catch (e) {}
  }
  function postChange(key, kind, props, label) {
    post("cms-change", { change: { page: PAGE, key: key, kind: kind, props: props, label: label || key } });
  }
  function sectionOf(key) { return SECTION_STATE[key] || (SECTION_STATE[key] = {}); }
  function labelOf(el, key) { return (el && el.getAttribute("data-cms-label")) || key; }

  function pushElement(key) {
    var el = elFor(key); if (!el) return;
    var kind = kindOf(el), st = styleOf(key), props;
    var layout = { css: st.d || {}, cssMobile: st.m || {}, cssBase: st.base || {} };
    if (kind === "text") props = Object.assign({ text: el.textContent }, layout);
    else if (kind === "image") props = Object.assign({ src: el.getAttribute("src") || "", alt: el.alt || "", hidden: el.style.display === "none" }, layout);
    else { var s = SECTION_STATE[key] || {}; props = Object.assign({ hidden: !!s.hidden, sort: s.sort, bg: s.bg || "", color: s.color || "", accent: s.accent || "" }, layout); }
    postChange(key, kind, props, labelOf(el, key));
  }

  function injectEditorStyles() {
    var css = [
      '[data-cms-text],[data-cms-img]{transition:outline .1s}',
      '.cmsEdit [data-cms-text]:hover,.cmsEdit [data-cms-img]:hover{outline:1px dashed #c9a84c;outline-offset:3px;cursor:pointer}',
      '.cmsEdit [data-cms-text][contenteditable="true"]{outline:2px solid #c9a84c;background:rgba(201,168,76,.10);cursor:text}',
      '.cmsEdit [data-cms-section]{position:relative}',
      '.cmsEdit [data-cms-section]:hover{outline:1px dashed rgba(201,168,76,.5);outline-offset:-1px}',
      '.cmsDragging,.cmsDragging *{cursor:grabbing !important;user-select:none !important}',
      '.cms-tools{position:absolute;top:6px;right:6px;z-index:2147483000;display:flex;gap:4px;align-items:center;background:rgba(10,9,8,.92);border:1px solid rgba(201,168,76,.4);border-radius:8px;padding:4px 6px;opacity:0;pointer-events:none;transition:opacity .12s;font-family:system-ui,sans-serif}',
      '.cmsEdit [data-cms-section]:hover > .cms-tools,.cms-tools:hover{opacity:1;pointer-events:auto}',
      '.cms-tools button{background:rgba(255,255,255,.08);border:none;color:#f5f0e8;font-size:12px;line-height:1;padding:5px 7px;border-radius:5px;cursor:pointer}',
      '.cms-tools button:hover{background:rgba(201,168,76,.35)}',
      '.cms-tools input[type=color]{width:22px;height:22px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:4px;background:none;cursor:pointer}',
      '.cms-tools .cms-lbl{color:#c9a84c;font-size:9px;letter-spacing:.08em;text-transform:uppercase;margin-right:2px}',
      '.cms-hiddenmark{outline:2px dashed rgba(201,168,76,.6) !important;opacity:.45}',
      '.cms-lh{position:fixed;z-index:2147483600;display:none;width:24px;height:24px;border:none;border-radius:6px;background:#c9a84c;color:#0a0908;font-size:13px;line-height:1;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.45);font-family:system-ui,sans-serif}',
      '.cms-lpanel{position:fixed;z-index:2147483601;width:214px;background:rgba(12,11,9,.98);border:1px solid rgba(201,168,76,.5);border-radius:10px;padding:11px;font-family:system-ui,sans-serif;box-shadow:0 12px 44px rgba(0,0,0,.6);color:#f5f0e8}',
      '.cms-lpanel .lp-h{display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#c9a84c;margin-bottom:4px}',
      '.cms-lpanel .lp-vp{font-size:10px;color:#8a8578;margin-bottom:9px}',
      '.cms-lpanel .lp-vp b{color:#e8d5a3}',
      '.cms-lpanel button{background:rgba(255,255,255,.08);border:none;color:#f5f0e8;border-radius:5px;cursor:pointer;font-size:12px;line-height:1;padding:6px 8px}',
      '.cms-lpanel button:hover{background:rgba(201,168,76,.35)}',
      '.cms-lpanel button.on{background:#c9a84c;color:#0a0908}',
      '.cms-lpanel .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:112px;margin:0 auto 10px}',
      '.cms-lpanel .pad button{padding:7px 0}',
      '.cms-lpanel .pad .sp{visibility:hidden}',
      '.cms-lpanel .row{display:flex;align-items:center;gap:5px;margin:6px 0;font-size:11px}',
      '.cms-lpanel .row label{width:52px;color:#8a8578}',
      '.cms-lpanel .row .val{min-width:40px;text-align:center;font-family:ui-monospace,monospace;color:#e8d5a3}',
      '.cms-lpanel .row.al button,.cms-lpanel .row.st button{flex:1}',
      '.cms-lpanel .row input[type=color]{width:26px;height:24px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:4px;background:none;cursor:pointer}',
      '.cms-lpanel .lp-foot{display:flex;justify-content:space-between;margin-top:9px;border-top:1px solid rgba(255,255,255,.08);padding-top:9px}',
      '.cms-lpanel .lp-foot button.reset{color:#c0a05a}',
      '.cms-draghint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:2147483602;background:rgba(10,9,8,.95);border:1px solid rgba(201,168,76,.5);color:#e8d5a3;font-family:system-ui,sans-serif;font-size:11px;padding:6px 12px;border-radius:20px;pointer-events:none}'
    ].join("");
    var st = document.createElement("style"); st.id = "cms-editor-css"; st.textContent = css;
    document.head.appendChild(st);
  }

  // ── Floating layout handle (click = panel · drag = move) ──
  var _lh = null, _lhKey = null, _lhHideT = null, _drag = null;
  function ensureHandle() {
    if (_lh) return _lh;
    _lh = document.createElement("button");
    _lh.className = "cms-lh"; _lh.textContent = "⛶"; _lh.title = "Drag to move · click for spacing";
    _lh.addEventListener("mouseenter", function () { clearTimeout(_lhHideT); });
    _lh.addEventListener("mouseleave", scheduleHideHandle);
    _lh.addEventListener("mousedown", startDrag);
    document.body.appendChild(_lh);
    return _lh;
  }
  function showHandleFor(el, key) {
    ensureHandle(); _lhKey = key;
    var r = el.getBoundingClientRect();
    _lh.style.left = Math.min(window.innerWidth - 28, Math.max(4, r.right - 26)) + "px";
    _lh.style.top = Math.max(4, r.top + 4) + "px";
    _lh.style.display = "block";
    clearTimeout(_lhHideT);
  }
  function scheduleHideHandle() { if (_drag) return; clearTimeout(_lhHideT); _lhHideT = setTimeout(function () { if (_lh && !_drag) _lh.style.display = "none"; }, 350); }

  function pxOf(map, k, fallback) { var v = map[k]; if (v == null || v === "") return fallback; var n = parseFloat(v); return isNaN(n) ? fallback : n; }
  function computedPx(el, prop, fb) { try { var n = parseFloat(getComputedStyle(el)[prop]); return isNaN(n) ? fb : Math.round(n); } catch (e) { return fb; } }
  function curVp() { return EDIT ? _editVp : (window.innerWidth <= MOBILE_BP ? "m" : "d"); }

  function startDrag(e) {
    e.preventDefault(); e.stopPropagation();
    var key = _lhKey; if (!key) return;
    var el = elFor(key); if (!el) return;
    var st = styleOf(key), vp = curVp(), css = st[vp];
    _drag = { key: key, css: css, x: e.clientX, y: e.clientY, ml: pxOf(css, "margin-left", 0), mt: pxOf(css, "margin-top", 0), moved: false };
    document.documentElement.classList.add("cmsDragging");
    var h = document.createElement("div"); h.className = "cms-draghint"; h.id = "cms-draghint"; h.textContent = "Drag to move · release to drop"; document.body.appendChild(h);
  }
  document.addEventListener("mousemove", function (e) {
    if (!_drag) return;
    var dx = e.clientX - _drag.x, dy = e.clientY - _drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) _drag.moved = true;
    _drag.css["margin-left"] = (_drag.ml + dx) + "px";
    _drag.css["margin-top"] = (_drag.mt + dy) + "px";
    rebuildStyleSheet();
  });
  document.addEventListener("mouseup", function () {
    if (!_drag) return;
    var d = _drag; _drag = null;
    document.documentElement.classList.remove("cmsDragging");
    var hint = document.getElementById("cms-draghint"); if (hint) hint.remove();
    if (d.moved) pushElement(d.key);
    else openLayout(d.key);      // it was a click, not a drag
    scheduleHideHandle();
  });

  function initEditor() {
    if (document.documentElement.classList.contains("cmsEdit")) return;
    document.documentElement.classList.add("cmsEdit");
    injectEditorStyles();

    document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("a"); if (a) e.preventDefault(); }, true);

    qa("[data-cms-text]").forEach(function (el) {
      el.addEventListener("mouseenter", function () { showHandleFor(el, el.getAttribute("data-cms-text")); });
      el.addEventListener("mouseleave", scheduleHideHandle);
      el.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (el.getAttribute("contenteditable") === "true") return;
        var before = el.textContent;
        el.setAttribute("contenteditable", "true"); el.focus();
        var onBlur = function () {
          el.removeAttribute("contenteditable"); el.removeEventListener("blur", onBlur);
          if (el.textContent !== before) pushElement(el.getAttribute("data-cms-text"));
        };
        el.addEventListener("blur", onBlur);
        el.addEventListener("keydown", function (k) {
          if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); el.blur(); }
          if (k.key === "Escape") { el.textContent = before; el.blur(); }
        });
      });
    });

    qa("[data-cms-img]").forEach(function (el) {
      el.addEventListener("mouseenter", function () { showHandleFor(el, el.getAttribute("data-cms-img")); });
      el.addEventListener("mouseleave", scheduleHideHandle);
      el.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        post("cms-pick-image", { key: el.getAttribute("data-cms-img"), label: labelOf(el, el.getAttribute("data-cms-img")) });
      });
    });

    qa("[data-cms-section]").forEach(function (sec) {
      var key = sec.getAttribute("data-cms-section");
      var state = sectionOf(key);
      var bar = document.createElement("div"); bar.className = "cms-tools";
      bar.innerHTML =
        '<span class="cms-lbl">' + labelOf(sec, key) + '</span>' +
        '<button data-a="hide" title="Show / hide">' + (state.hidden ? "🚫" : "👁") + '</button>' +
        '<button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button>' +
        '<span class="cms-lbl">bg</span><input type="color" data-a="bg" value="' + toHex(state.bg, "#0a0908") + '">' +
        '<span class="cms-lbl">txt</span><input type="color" data-a="color" value="' + toHex(state.color, "#e8e4de") + '">' +
        '<button data-a="layout" title="Layout &amp; spacing">⛶</button><button data-a="reset" title="Reset section">↺</button>';
      bar.addEventListener("click", function (e) { e.stopPropagation(); });
      sec.appendChild(bar);
      if (state.hidden) sec.classList.add("cms-hiddenmark");

      bar.querySelector('[data-a="hide"]').addEventListener("click", function () {
        state.hidden = !state.hidden; sec.classList.toggle("cms-hiddenmark", !!state.hidden);
        this.textContent = state.hidden ? "🚫" : "👁"; pushElement(key);
      });
      bar.querySelector('[data-a="up"]').addEventListener("click", function () { moveSection(sec, -1); });
      bar.querySelector('[data-a="down"]').addEventListener("click", function () { moveSection(sec, 1); });
      bar.querySelector('[data-a="bg"]').addEventListener("input", function () { state.bg = this.value; sec.style.backgroundColor = this.value; pushElement(key); });
      bar.querySelector('[data-a="color"]').addEventListener("input", function () { state.color = this.value; sec.style.color = this.value; pushElement(key); });
      bar.querySelector('[data-a="layout"]').addEventListener("click", function () { openLayout(key); });
      bar.querySelector('[data-a="reset"]').addEventListener("click", function () {
        SECTION_STATE[key] = {}; STYLE_STATE[key] = { d: {}, m: {}, base: {} };
        sec.style.backgroundColor = ""; sec.style.color = ""; sec.style.display = ""; sec.classList.remove("cms-hiddenmark");
        rebuildStyleSheet();
        post("cms-reset", { key: key, kind: "section", label: labelOf(sec, key) });
      });
    });

    document.addEventListener("scroll", function () { if (_lh && !_drag) _lh.style.display = "none"; }, true);
    post("cms-ready", { page: PAGE });
  }

  // ── Layout + style panel ──
  function openLayout(key) {
    var el = elFor(key); if (!el) return;
    var kind = kindOf(el), st = styleOf(key), vp = curVp(), css = st[vp], base = st.base;
    var old = document.getElementById("cms-lpanel"); if (old) old.remove();
    if (_lh) _lh.style.display = "none";

    var p = document.createElement("div"); p.className = "cms-lpanel"; p.id = "cms-lpanel";
    p.innerHTML =
      '<div class="lp-h"><span>Layout · ' + labelOf(el, key) + '</span><button data-a="close" style="padding:2px 7px">×</button></div>' +
      '<div class="lp-vp">Editing <b>' + (vp === "m" ? "Mobile" : "Desktop") + '</b> layout' + (vp === "m" ? " (≤" + MOBILE_BP + "px)" : "") + '</div>' +
      '<div class="pad">' +
        '<span class="sp"></span><button data-a="nudge" data-d="up" title="Up">↑</button><span class="sp"></span>' +
        '<button data-a="nudge" data-d="left" title="Left">←</button><button data-a="center" title="Center">◎</button><button data-a="nudge" data-d="right" title="Right">→</button>' +
        '<span class="sp"></span><button data-a="nudge" data-d="down" title="Down">↓</button><span class="sp"></span>' +
      '</div>' +
      '<div class="row"><label>Width</label><button data-a="w-">−</button><span class="val" id="lp-w">auto</span><button data-a="w+">+</button><button data-a="w0" title="Auto">auto</button></div>' +
      '<div class="row"><label>Height</label><button data-a="h-">−</button><span class="val" id="lp-h">auto</span><button data-a="h+">+</button></div>' +
      '<div class="row"><label>Padding</label><button data-a="p-">−</button><span class="val" id="lp-p">0</span><button data-a="p+">+</button></div>' +
      (kind === "text" ? '<div class="row"><label>Text</label><button data-a="t-">−</button><span class="val" id="lp-t">-</span><button data-a="t+">+</button></div>' : '') +
      '<div class="row al"><label>Align</label><button data-a="al" data-v="left">L</button><button data-a="al" data-v="center">C</button><button data-a="al" data-v="right">R</button></div>' +
      (kind === "text"
        ? '<div class="row"><label>Color</label><input type="color" data-a="color" value="' + toHex(base["color"], computedHex(el, "color", "#e8e4de")) + '"><button data-a="colorclear" title="Clear colour">-</button></div>' +
          '<div class="row st"><label>Style</label><button data-a="bold" class="' + (base["font-weight"] === "700" ? "on" : "") + '">B</button><button data-a="italic" class="' + (base["font-style"] === "italic" ? "on" : "") + '">I</button></div>'
        : '') +
      '<div class="lp-foot"><button data-a="reset" class="reset">Reset ' + (vp === "m" ? "mobile" : "desktop") + '</button><button data-a="close">Done</button></div>';
    document.body.appendChild(p);

    var r = el.getBoundingClientRect();
    p.style.left = Math.min(window.innerWidth - 226, Math.max(8, r.left)) + "px";
    p.style.top = Math.min(window.innerHeight - 330, Math.max(8, r.top)) + "px";

    function refresh() {
      var w = p.querySelector("#lp-w"); if (w) w.textContent = css["max-width"] ? pxOf(css, "max-width", 0) : "auto";
      var h = p.querySelector("#lp-h"); if (h) h.textContent = css["min-height"] ? pxOf(css, "min-height", 0) : "auto";
      var pd = p.querySelector("#lp-p"); if (pd) pd.textContent = ("padding" in css && css["padding"] !== "") ? pxOf(css, "padding", 0) : computedPx(el, "paddingTop", 0);
      var t = p.querySelector("#lp-t"); if (t) t.textContent = css["font-size"] ? pxOf(css, "font-size", 0) : computedPx(el, "fontSize", 16);
    }
    function commit() { rebuildStyleSheet(); pushElement(key); refresh(); }
    refresh();

    p.addEventListener("input", function (e) {
      if (e.target.getAttribute("data-a") === "color") { base["color"] = e.target.value; commit(); }
    });
    p.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; e.stopPropagation();
      var a = b.getAttribute("data-a");
      if (a === "close") { p.remove(); return; }
      if (a === "nudge") {
        var d = b.getAttribute("data-d"), s = 8;
        if (d === "up") css["margin-top"] = (pxOf(css, "margin-top", 0) - s) + "px";
        else if (d === "down") css["margin-top"] = (pxOf(css, "margin-top", 0) + s) + "px";
        else if (d === "left") css["margin-left"] = (pxOf(css, "margin-left", 0) - s) + "px";
        else if (d === "right") css["margin-left"] = (pxOf(css, "margin-left", 0) + s) + "px";
        commit(); return;
      }
      if (a === "center") { css["margin-left"] = "auto"; css["margin-right"] = "auto"; if (!css["max-width"]) css["max-width"] = Math.round(el.offsetWidth) + "px"; commit(); return; }
      if (a === "w-") { css["max-width"] = Math.max(80, pxOf(css, "max-width", Math.round(el.offsetWidth)) - 40) + "px"; commit(); return; }
      if (a === "w+") { css["max-width"] = (pxOf(css, "max-width", Math.round(el.offsetWidth)) + 40) + "px"; commit(); return; }
      if (a === "w0") { css["max-width"] = ""; commit(); return; }
      if (a === "h-") { css["min-height"] = Math.max(0, pxOf(css, "min-height", 0) - 8) + "px"; commit(); return; }
      if (a === "h+") { css["min-height"] = (pxOf(css, "min-height", 0) + 8) + "px"; commit(); return; }
      if (a === "p-") { css["padding"] = Math.max(0, pxOf(css, "padding", computedPx(el, "paddingTop", 0)) - 4) + "px"; commit(); return; }
      if (a === "p+") { css["padding"] = (pxOf(css, "padding", computedPx(el, "paddingTop", 0)) + 4) + "px"; commit(); return; }
      if (a === "t-") { css["font-size"] = Math.max(8, pxOf(css, "font-size", computedPx(el, "fontSize", 16)) - 1) + "px"; commit(); return; }
      if (a === "t+") { css["font-size"] = (pxOf(css, "font-size", computedPx(el, "fontSize", 16)) + 1) + "px"; commit(); return; }
      if (a === "al") { css["text-align"] = b.getAttribute("data-v"); commit(); return; }
      if (a === "colorclear") { base["color"] = ""; var ci = p.querySelector('[data-a="color"]'); if (ci) ci.value = computedHex(el, "color", "#e8e4de"); commit(); return; }
      if (a === "bold") { base["font-weight"] = (base["font-weight"] === "700") ? "" : "700"; b.classList.toggle("on", base["font-weight"] === "700"); commit(); return; }
      if (a === "italic") { base["font-style"] = (base["font-style"] === "italic") ? "" : "italic"; b.classList.toggle("on", base["font-style"] === "italic"); commit(); return; }
      if (a === "reset") { st[vp] = {}; css = st[vp]; rebuildStyleSheet(); pushElement(key); refresh(); return; }
    });

    setTimeout(function () {
      var onDoc = function (ev) {
        if (p.contains(ev.target) || (_lh && _lh.contains(ev.target))) return;
        p.remove(); document.removeEventListener("mousedown", onDoc, true);
      };
      document.addEventListener("mousedown", onDoc, true);
    }, 0);
  }

  function moveSection(sec, dir) {
    var par = sec.parentNode;
    var sibs = qa("[data-cms-section]", par).filter(function (s) { return s.parentNode === par; });
    var i = sibs.indexOf(sec), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    if (dir < 0) par.insertBefore(sec, sibs[j]); else par.insertBefore(sibs[j], sec);
    qa("[data-cms-section]", par).filter(function (s) { return s.parentNode === par; }).forEach(function (s, idx) {
      sectionOf(s.getAttribute("data-cms-section")).sort = idx;
      pushElement(s.getAttribute("data-cms-section"));
    });
  }

  function toHex(v, fallback) { if (!v) return fallback; if (/^#[0-9a-f]{6}$/i.test(v)) return v; return fallback; }
  function computedHex(el, prop, fb) {
    try {
      var c = getComputedStyle(el)[prop]; var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
      if (!m) return fb;
      return "#" + [1, 2, 3].map(function (i) { return ("0" + parseInt(m[i], 10).toString(16)).slice(-2); }).join("");
    } catch (e) { return fb; }
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data || {};
    if (d.type === "cms-set-image" && d.key) {
      var img = q('[data-cms-img="' + attrEsc(d.key) + '"]');
      if (img) {
        if (d.remove) { img.style.display = "none"; pushElement(d.key); }
        else { if (d.url) img.src = d.url; if (typeof d.alt === "string") img.alt = d.alt; img.style.display = ""; pushElement(d.key); }
      }
    } else if (d.type === "cms-viewport") {
      _editVp = (d.vp === "mobile") ? "m" : "d";
      var pv = document.getElementById("cms-lpanel"); if (pv) pv.remove();
      rebuildStyleSheet();
    } else if (d.type === "cms-reload") { location.reload(); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
