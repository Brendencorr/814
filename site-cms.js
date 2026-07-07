/* site-cms.js — runtime overrides for the marketing site + the in-page live editor.
 *
 * TWO MODES:
 *  1) Apply (always): fetch /.netlify/functions/site-content?page=<page> and apply
 *     any overrides on top of the page's hardcoded defaults — text, images, and
 *     section state (hidden / order / colors).
 *  2) Edit (?cms=edit, only meaningful inside the operator "Customize Website" iframe):
 *     click text to edit it, click a logo to swap it, and use each section's toolbar
 *     (hide · move up/down · colors). The editor NEVER writes to Supabase — it posts
 *     each change to window.parent (the operator, which holds the OPERATOR_KEY and saves).
 *
 * Instrument a page with:
 *   <body data-cms-page="home">
 *   <h1 data-cms-text="hero_title">…</h1>
 *   <img data-cms-img="hero_logo" …>
 *   <section data-cms-section="hero" data-cms-label="Hero">…</section>
 */
(function () {
  "use strict";

  var PAGE =
    (document.body && document.body.getAttribute("data-cms-page")) ||
    (location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "home").replace(/\.html?$/, "") ||
    "home";
  var EDIT = /[?&]cms=edit\b/.test(location.search);
  var OVERRIDES = {};
  var SECTION_STATE = {}; // key -> {hidden, sort, bg, color, accent}

  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function attrEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  // ─────────────────────────────── APPLY ───────────────────────────────
  function applyText(key, props) {
    var el = q('[data-cms-text="' + attrEsc(key) + '"]');
    if (el && props && typeof props.text === "string") el.textContent = props.text;
  }
  function applyImage(key, props) {
    var el = q('[data-cms-img="' + attrEsc(key) + '"]');
    if (!el || !props) return;
    if (props.src) el.src = props.src;
    if (typeof props.alt === "string") el.alt = props.alt;
    el.style.display = props.hidden ? "none" : "";
  }
  function applySectionStyle(key, props) {
    var el = q('[data-cms-section="' + attrEsc(key) + '"]');
    if (!el) return;
    el.style.display = props.hidden ? "none" : "";
    el.style.backgroundColor = props.bg || "";
    if (props.color) el.style.color = props.color; else el.style.color = "";
    if (props.accent) el.style.setProperty("--cms-accent", props.accent);
  }
  function applyOrder() {
    // Reorder sections within each shared parent by their `sort`, but only where at
    // least one sibling has an explicit sort override (otherwise leave the DOM as-is).
    var groups = new Map();
    qa("[data-cms-section]").forEach(function (s) {
      var k = s.getAttribute("data-cms-section");
      var st = SECTION_STATE[k] || {};
      s.__sort = (typeof st.sort === "number") ? st.sort : null;
      var par = s.parentNode;
      if (!groups.has(par)) groups.set(par, []);
      groups.get(par).push(s);
    });
    groups.forEach(function (list, par) {
      if (!list.some(function (s) { return s.__sort != null; })) return;
      list.forEach(function (s, i) { if (s.__sort == null) s.__sort = i; });
      list.slice().sort(function (a, b) { return a.__sort - b.__sort; })
        .forEach(function (s) { par.appendChild(s); });
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

  function injectEditorStyles() {
    var css = [
      '[data-cms-text],[data-cms-img]{transition:outline .1s}',
      '.cmsEdit [data-cms-text]:hover,.cmsEdit [data-cms-img]:hover{outline:1px dashed #c9a84c;outline-offset:3px;cursor:pointer}',
      '.cmsEdit [data-cms-text][contenteditable="true"]{outline:2px solid #c9a84c;background:rgba(201,168,76,.10);cursor:text}',
      '.cmsEdit [data-cms-section]{position:relative}',
      '.cmsEdit [data-cms-section]:hover{outline:1px dashed rgba(201,168,76,.5);outline-offset:-1px}',
      '.cms-tools{position:absolute;top:6px;right:6px;z-index:2147483000;display:flex;gap:4px;align-items:center;background:rgba(10,9,8,.92);border:1px solid rgba(201,168,76,.4);border-radius:8px;padding:4px 6px;opacity:0;pointer-events:none;transition:opacity .12s;font-family:system-ui,sans-serif}',
      '.cmsEdit [data-cms-section]:hover > .cms-tools,.cms-tools:hover{opacity:1;pointer-events:auto}',
      '.cms-tools button{background:rgba(255,255,255,.08);border:none;color:#f5f0e8;font-size:12px;line-height:1;padding:5px 7px;border-radius:5px;cursor:pointer}',
      '.cms-tools button:hover{background:rgba(201,168,76,.35)}',
      '.cms-tools input[type=color]{width:22px;height:22px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:4px;background:none;cursor:pointer}',
      '.cms-tools .cms-lbl{color:#c9a84c;font-size:9px;letter-spacing:.08em;text-transform:uppercase;margin-right:2px}',
      '.cms-hiddenmark{outline:2px dashed rgba(201,168,76,.6) !important;opacity:.45}'
    ].join("");
    var st = document.createElement("style"); st.id = "cms-editor-css"; st.textContent = css;
    document.head.appendChild(st);
  }

  function initEditor() {
    if (document.documentElement.classList.contains("cmsEdit")) return;
    document.documentElement.classList.add("cmsEdit");
    injectEditorStyles();

    // Block navigation while editing so CTAs/links don't take the operator away.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (a) { e.preventDefault(); }
    }, true);

    // TEXT slots → click to edit inline.
    qa("[data-cms-text]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (el.getAttribute("contenteditable") === "true") return;
        var before = el.textContent;
        el.setAttribute("contenteditable", "true");
        el.focus();
        // place caret at click
        var onBlur = function () {
          el.removeAttribute("contenteditable");
          el.removeEventListener("blur", onBlur);
          var now = el.textContent;
          if (now !== before) postChange(el.getAttribute("data-cms-text"), "text", { text: now }, labelOf(el, el.getAttribute("data-cms-text")));
        };
        el.addEventListener("blur", onBlur);
        el.addEventListener("keydown", function (k) {
          if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); el.blur(); }
          if (k.key === "Escape") { el.textContent = before; el.blur(); }
        });
      });
    });

    // IMAGE slots → ask the operator for a new image.
    qa("[data-cms-img]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        post("cms-pick-image", { key: el.getAttribute("data-cms-img"), label: labelOf(el, el.getAttribute("data-cms-img")) });
      });
    });

    // SECTION toolbars.
    qa("[data-cms-section]").forEach(function (sec) {
      var key = sec.getAttribute("data-cms-section");
      var state = sectionOf(key);
      var bar = document.createElement("div");
      bar.className = "cms-tools";
      bar.innerHTML =
        '<span class="cms-lbl">' + (labelOf(sec, key)) + '</span>' +
        '<button data-a="hide" title="Show / hide">' + (state.hidden ? "🚫" : "👁") + '</button>' +
        '<button data-a="up" title="Move up">↑</button>' +
        '<button data-a="down" title="Move down">↓</button>' +
        '<span class="cms-lbl">bg</span><input type="color" data-a="bg" value="' + toHex(state.bg, "#0a0908") + '">' +
        '<span class="cms-lbl">txt</span><input type="color" data-a="color" value="' + toHex(state.color, "#e8e4de") + '">' +
        '<button data-a="reset" title="Reset section">↺</button>';
      // keep toolbar out of contenteditable / navigation
      bar.addEventListener("click", function (e) { e.stopPropagation(); });
      sec.appendChild(bar);
      if (state.hidden) sec.classList.add("cms-hiddenmark");

      bar.querySelector('[data-a="hide"]').addEventListener("click", function () {
        state.hidden = !state.hidden;
        sec.classList.toggle("cms-hiddenmark", !!state.hidden);
        this.textContent = state.hidden ? "🚫" : "👁";
        pushSection(key, sec);
      });
      bar.querySelector('[data-a="up"]').addEventListener("click", function () { moveSection(sec, -1); });
      bar.querySelector('[data-a="down"]').addEventListener("click", function () { moveSection(sec, 1); });
      bar.querySelector('[data-a="bg"]').addEventListener("input", function () { state.bg = this.value; sec.style.backgroundColor = this.value; pushSection(key, sec); });
      bar.querySelector('[data-a="color"]').addEventListener("input", function () { state.color = this.value; sec.style.color = this.value; pushSection(key, sec); });
      bar.querySelector('[data-a="reset"]').addEventListener("click", function () {
        SECTION_STATE[key] = {};
        sec.style.backgroundColor = ""; sec.style.color = ""; sec.style.display = ""; sec.classList.remove("cms-hiddenmark");
        post("cms-reset", { key: key, kind: "section", label: labelOf(sec, key) });
      });
    });

    post("cms-ready", { page: PAGE });
  }

  function pushSection(key, sec) {
    var st = sectionOf(key);
    postChange(key, "section", { hidden: !!st.hidden, sort: st.sort, bg: st.bg || "", color: st.color || "", accent: st.accent || "" }, labelOf(sec, key));
  }

  // Move a section among its data-cms-section siblings and renumber all of them.
  function moveSection(sec, dir) {
    var par = sec.parentNode;
    var sibs = qa("[data-cms-section]", par).filter(function (s) { return s.parentNode === par; });
    var i = sibs.indexOf(sec), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    if (dir < 0) par.insertBefore(sec, sibs[j]);
    else par.insertBefore(sibs[j], sec);
    // renumber every section in this parent and push each
    qa("[data-cms-section]", par).filter(function (s) { return s.parentNode === par; }).forEach(function (s, idx) {
      var k = s.getAttribute("data-cms-section");
      sectionOf(k).sort = idx;
      pushSection(k, s);
    });
  }

  function toHex(v, fallback) {
    if (!v) return fallback;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    return fallback;
  }

  // Messages from the operator (image chosen, force reload).
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data || {};
    if (d.type === "cms-set-image" && d.key) {
      var img = q('[data-cms-img="' + attrEsc(d.key) + '"]');
      if (img) {
        if (d.remove) {
          img.style.display = "none";
          postChange(d.key, "image", { src: img.getAttribute("src") || "", alt: img.alt, hidden: true }, d.label || d.key);
        } else {
          if (d.url) img.src = d.url;
          if (typeof d.alt === "string") img.alt = d.alt;
          img.style.display = "";
          postChange(d.key, "image", { src: d.url || img.src, alt: (typeof d.alt === "string" ? d.alt : img.alt), hidden: false }, d.label || d.key);
        }
      }
    } else if (d.type === "cms-reload") {
      location.reload();
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
