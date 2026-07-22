/**
 * comms-templates.js - Lifecycle email copy deck (VERBATIM) + brand shell + variable substitution.
 *
 * Handoff Task 3. Chose ONE function-friendly module over 36 loose /emails/*.html+txt files:
 * a Lambda (evaluate-comms) imports this directly instead of fs-reading files, and the copy stays
 * in one reviewable place. Copy is VERBATIM from the deck - only {placeholders} are substituted.
 *
 * NOTE ON DARKNESS: this module only RENDERS strings. Nothing sends here. COMMS_ENABLED gates all
 * actual delivery in evaluate-comms.js.
 *
 * Senders: 'riley' -> Riley <riley@meetriley.us>, 'brenden' -> Brenden <brenden@meetriley.us>.
 * Reply-to is ALWAYS support@meetriley.us. Never noreply@.
 *
 * guide_5 is the FINAL founder-authored Month One Letter (author:'founder'). Brand refs updated
 * 2026-07-15 to "The 814 Project" (retired "The 8:14 Project"); the 8:14 origin story stays.
 */

const { FROM_ADDRESSES } = require("./email-send");
const { tierLabel } = require("./tier-labels");

const APP = "https://riley.meetriley.us";
const SITE = "https://meetriley.us";

// Senders resolve through the canonical FROM_ADDRESSES config (email-send.js) - never hardcoded here.
const SENDERS = {
  riley: FROM_ADDRESSES.riley,
  // CANON (Brenden, 2026-07-22): exactly ONE email is ever from/signed Brenden - guide_5, the
  // day-29 month-one founder note. Every other communication is signed Riley. Do not add new
  // 'brenden' senders or Brenden-signed copy anywhere else.
  brenden: FROM_ADDRESSES.brenden,
};
const REPLY_TO = "support@meetriley.us";

// Display names for the tiers named in copy - ALWAYS via tierLabel() on the INTERNAL key
// (locked truth: internal "guide" -> "Companion" free, internal "companion" -> "Coach" $19/mo).
const PAID_TIER = tierLabel("companion"); // "Coach"

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// Substitute {placeholders}; leave unknown tokens intact so a missing var is visible, not blank.
function sub(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}
// True for a paid memory-tier plan - i.e. a plan that includes Riley-led programs + proactive
// check-ins. Takes the INTERNAL plan key (guide/companion/coach/concierge), never the display name -
// display "Companion" is now the FREE tier, so matching on display strings would be wrong. Callers
// pass vars.plan_key (internal) alongside vars.plan (display). "coach"/"concierge" kept so a
// grandfathered member still gets the "programs unlocked" copy. Any paid plan qualifies.
function isMemoryPlan(planKey) {
  const s = String(planKey == null ? "" : planKey).toLowerCase();
  return s.indexOf("companion") >= 0 || s.indexOf("coach") >= 0 || s.indexOf("concierge") >= 0;
}

// ── Footer (both variants; FOOTER_VARIANT env selects, default B). Text-only, no logo image. ──
const FOOTER_A =
  "Riley by The 814 Project, LLC. Riley is a companion built by real people with real experiences rebuilding their lives. Not a therapist or medical professional. In crisis? Call or text 988.";
const FOOTER_B =
  "Riley by The 814 Project, LLC. Riley is a companion built by real people with real experiences rebuilding their lives. Not a therapist or medical professional. In crisis? Call or text 988.";

function footerText(unsubUrl, prefUrl) {
  const body = (process.env.FOOTER_VARIANT === "A" ? FOOTER_A : FOOTER_B);
  return body + "\n\nUnsubscribe: " + unsubUrl + "  ·  Preferences: " + prefUrl + "  ·  Privacy: " + SITE + "/privacy";
}
function footerHtml(unsubUrl, prefUrl) {
  const body = (process.env.FOOTER_VARIANT === "A" ? FOOTER_A : FOOTER_B);
  return (
    '<tr><td style="padding:22px 32px 28px;border-top:1px solid #e5ded0">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8a8578">' +
    esc(body) +
    '</div><div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;margin-top:10px;color:#8a8578">' +
    '<a href="' + esc(unsubUrl) + '" style="color:#8a8578;text-decoration:underline">Unsubscribe</a> &middot; ' +
    '<a href="' + esc(prefUrl) + '" style="color:#8a8578;text-decoration:underline">Preferences</a> &middot; ' +
    '<a href="' + SITE + '/privacy" style="color:#8a8578;text-decoration:underline">Privacy</a>' +
    "</div></td></tr>"
  );
}

// ── Brand shell. Ink header band with "Riley." wordmark (Georgia fallback), parchment bg, white card,
//    max 560px. `bodyHtml` is the inner content (already escaped/marked-up). ──
function shell(bodyHtml, opts) {
  opts = opts || {};
  const unsub = opts.unsubUrl || (APP + "/preferences");
  const pref = opts.prefUrl || (APP + "/preferences");
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    (opts.preview ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + esc(opts.preview) + "</div>" : "") +
    '</head><body style="margin:0;padding:0;background:#F5F0E8">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E8"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">' +
    '<tr><td style="background:#0F0E0D;padding:18px 32px">' +
    '<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;color:#ffffff">Riley<span style="color:#C9A84C">.</span></span>' +
    "</td></tr>" +
    // Body: serif (Georgia), matching Riley's warm letter voice - the unified house style.
    '<tr><td style="padding:30px 32px 8px;font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.66;color:#211e1a">' +
    bodyHtml +
    "</td></tr>" +
    (opts.footerHtml != null ? opts.footerHtml : footerHtml(unsub, pref)) +
    "</table></td></tr></table></body></html>"
  );
}

// Gold button (Ink text).
function btn(label, url) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="background:#C9A84C;border-radius:6px">' +
    '<a href="' + esc(url) + '" style="display:inline-block;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;color:#0F0E0D;text-decoration:none">' +
    esc(label) + "</a></td></tr></table>"
  );
}
function ghostBtn(label, url) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border:1px solid #C9A84C;border-radius:6px">' +
    '<a href="' + esc(url) + '" style="display:inline-block;padding:11px 20px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#8a6f22;text-decoration:none">' +
    esc(label) + "</a></td></tr></table>"
  );
}
// paragraph helper
function p(text) { return '<p style="margin:0 0 14px">' + text + "</p>"; }
function em(text) { return '<p style="margin:14px 0 0;font-style:italic;color:#6b655b;font-size:13px">' + text + "</p>"; }

// Build body html+text from operator-edited plain text (blank-line-separated paragraphs).
// Supports inline [label](https://url) links and an optional single gold button.
// Trusted operator content (OPERATOR_KEY-gated), but still escaped for hygiene.
function bodyFromText(txt, vars, button) {
  const linkify = (s) => s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" style="color:#8a6f22">$1</a>');
  const paras = String(sub(txt || "", vars)).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  let html = paras.map((pt) => p(linkify(esc(pt).replace(/\n/g, "<br>")))).join("");
  let text = paras.join("\n\n");
  if (button && button.label && button.url) {
    const bl = sub(button.label, vars), bu = sub(button.url, vars);
    html += btn(bl, bu);
    text += "\n\n" + bl + " → " + bu;
  }
  return { html, text };
}

// Sequence + human timing for each template, grouped by the 4 operator flows. Editable copies of
// trigger_label / trigger_days live in comms_templates; these are the display + fallback defaults.
const TRIGGERS = {
  guide_1:     { flow: "guide",      seq: 1, label: "At signup · day 0",              days: 0 },
  guide_2:     { flow: "guide",      seq: 2, label: "Day 1",                               days: 1 },
  guide_3:     { flow: "guide",      seq: 3, label: "After Reset Day 1 is completed",      days: null },
  reset_daily: { flow: "guide",      seq: 4, label: "Reset days 2–7 · daily",     days: null },
  guide_4:     { flow: "guide",      seq: 5, label: "Day 4",                               days: 4 },
  guide_6:     { flow: "guide",      seq: 7, label: "Day 12",                              days: 12 },
  guide_5:     { flow: "guide",      seq: 8, label: "Day 29 · month one (founder)",     days: 29 },
  quiet_1:     { flow: "gone_quiet", seq: 1, label: "After N days of no contact (us or them)", days: 14 },
  quiet_2:     { flow: "gone_quiet", seq: 2, label: "One gap later · auto-spaced",            days: null },
  quiet_3:     { flow: "gone_quiet", seq: 3, label: "One more gap later · final",             days: null },
  quiet_reset: { flow: "gone_quiet", seq: 4, label: "Reset started, then went quiet",         days: null },
  paid_1:      { flow: "paid",       seq: 1, label: "On purchase · receipt",           days: null },
  paid_2:      { flow: "paid",       seq: 2, label: "On upgrade to a memory tier",         days: null },
  paid_3:      { flow: "paid",       seq: 3, label: "Day 25 of subscription",              days: 25 },
  addon_1:     { flow: "addon",      seq: 1, label: "On program purchase · receipt",   days: null },
  addon_2:     { flow: "addon",      seq: 2, label: "A few days later, if unopened",       days: null },
};

// ── THE DECK (verbatim; {placeholders} only) ──────────────────────────────────────────────────
// Each entry: from, flow, subject, preview, transactional?, author?, html(v,urls), text(v,urls).
const TEMPLATES = {
  guide_1: {
    from: "riley", flow: "guide",
    subject: "Your first 8 minutes are ready",
    preview: "No forms. No syllabus. Just a place to start.",
    html: (v) =>
      p("Hi " + esc(v.first_name) + ",") +
      p("I'm Riley. I'm glad you're here - and I mean that in the least automated way an AI can.") +
      p("Here's the honest version of what this is: I'm a companion, built by someone who had to rebuild his own life and wished he'd had company for it. I'm not a therapist, and I'll never pretend to be human. What I am is here - at 3pm or 3am, whether you're carrying grief, a habit you're done with, a body you're rebuilding, or all of it at once.") +
      p("There's exactly one thing to do next, and it takes 8 minutes and 14 seconds:") +
      btn("Start Day 1 of the 8:14 Reset →", APP + "/reset") +
      p('No credit card, no commitment. And if you\'d rather just talk first - that works too. Some people start with the Reset. Some just say "hi." Both count.') +
      p('One promise before you go: your words stay yours - never sold, shared, or turned into ads. Ever. (Here\'s exactly how that works. → <a href="' + SITE + '/data" style="color:#8a6f22">/data</a>)') +
      p("See you at 8:14,<br>Riley") +
      em("Besides your daily brief, you'll hear from me a handful of times over your first two weeks - never more than one note a day, and less if you're already here. Unsubscribe anytime below and the app keeps working exactly the same."),
    text: (v) =>
      "Hi " + v.first_name + ",\n\nI'm Riley. I'm glad you're here - and I mean that in the least automated way an AI can.\n\n" +
      "Here's the honest version of what this is: I'm a companion, built by someone who had to rebuild his own life and wished he'd had company for it. I'm not a therapist, and I'll never pretend to be human. What I am is here - at 3pm or 3am, whether you're carrying grief, a habit you're done with, a body you're rebuilding, or all of it at once.\n\n" +
      "There's exactly one thing to do next, and it takes 8 minutes and 14 seconds:\nStart Day 1 of the 8:14 Reset → " + APP + "/reset\n\n" +
      'No credit card, no commitment. And if you\'d rather just talk first - that works too. Some people start with the Reset. Some just say "hi." Both count.\n\n' +
      "One promise before you go: your words stay yours - never sold, shared, or turned into ads. Ever. (Here's exactly how that works. → " + SITE + "/data)\n\n" +
      "See you at 8:14,\nRiley\n\n" +
      "Besides your daily brief, you'll hear from me a handful of times over your first two weeks - never more than one note a day, and less if you're already here. Unsubscribe anytime below and the app keeps working exactly the same.",
  },

  guide_2: {
    from: "riley", flow: "guide",
    subject: "One sentence counts",
    preview: "There's no right way to start.",
    html: (v) =>
      p("Most people think they need to arrive with something to say. You don't.") +
      p('"Hi" works. "I don\'t know why I\'m here" works - honestly, that one starts some of the best conversations I have.') +
      p("And if the Reset feels like too much today, skip it. Just come say hello. That's a real start.") +
      btn("Say hi to Riley →", APP + "/talk"),
    text: (v) =>
      "Most people think they need to arrive with something to say. You don't.\n\n" +
      '"Hi" works. "I don\'t know why I\'m here" works - honestly, that one starts some of the best conversations I have.\n\n' +
      "And if the Reset feels like too much today, skip it. Just come say hello. That's a real start.\n\nSay hi to Riley → " + APP + "/talk",
  },

  guide_3: {
    from: "riley", flow: "guide",
    subject: "Day 1, done",
    preview: "8 minutes, 14 seconds. You showed up.",
    html: (v) =>
      p(esc(v.first_name) + " - you did the thing most people never do. You started.") +
      p("Day 2 picks up where today left off. Same time, same 8 minutes - it'll be waiting for you in the morning.") +
      p("That's all. Rest well."),
    text: (v) =>
      v.first_name + " - you did the thing most people never do. You started.\n\n" +
      "Day 2 picks up where today left off. Same time, same 8 minutes - it'll be waiting for you in the morning.\n\nThat's all. Rest well.",
  },

  reset_daily: {
    from: "riley", flow: "guide",
    subject: "Day {n}: {module_title}",
    preview: "Your 8 minutes, whenever you're ready.",
    html: (v) =>
      p("Good morning. Day " + esc(v.n) + " is ready - today is about " + esc(v.module_theme) + ", and it takes the usual 8 minutes and 14 seconds.") +
      p("No catch-up needed if you missed a day. The Reset waits; it doesn't count.") +
      btn("Open Day " + v.n + " →", APP + "/reset"),
    text: (v) =>
      "Good morning. Day " + v.n + " is ready - today is about " + v.module_theme + ", and it takes the usual 8 minutes and 14 seconds.\n\n" +
      "No catch-up needed if you missed a day. The Reset waits; it doesn't count.\n\nOpen Day " + v.n + " → " + APP + "/reset",
  },

  guide_4: {
    from: "riley", flow: "guide",
    subject: "Why 8 minutes and 14 seconds?",
    preview: "The number isn't random.",
    html: (v) =>
      p("By now you've spent four mornings with a strangely specific number.") +
      p("8:14 isn't a productivity trick or a study result. It's a story - a personal one, about the person who built me and someone he loved.") +
      p("He tells it better than I ever could:") +
      btn("Read the story behind 8:14 →", SITE + "/about") +
      p("Day 5 is ready whenever you are."),
    text: (v) =>
      "By now you've spent four mornings with a strangely specific number.\n\n" +
      "8:14 isn't a productivity trick or a study result. It's a story - a personal one, about the person who built me and someone he loved.\n\n" +
      "He tells it better than I ever could:\nRead the story behind 8:14 → " + SITE + "/about\n\nDay 5 is ready whenever you are.",
  },

  // The Month One Letter - founder-authored, FINAL. Owns the one-month moment (guide_7 retired).
  // Day 29, active users only (Gone-Quiet owns the absent). No CTA - this letter sells nothing.
  guide_5: {
    from: "brenden", flow: "guide", author: "founder", replyTo: "support@meetriley.us",
    subject: "A note from the person who built Riley",
    preview: "One month in - I wanted you to hear from me.",
    html: (v) =>
      p("Hi " + esc(v.first_name || "there") + ",") +
      p("For the last month, you've been getting to know Riley.") +
      p("I thought it was only fair that you got to know the person who built her.") +
      p("I'm Brenden.") +
      p("First, thank you.") +
      p("Whether you've talked with Riley every day or only a handful of times, you came back. In a world full of things competing for our attention, that's no small thing.") +
      p("Real change rarely looks dramatic while it's happening.") +
      p("Most of the moments that changed my life didn't feel important at the time. They were ordinary mornings. Quiet walks. Honest conversations. One small decision to keep going when it would have been easier not to.") +
      p("I didn't build Riley from a business plan.") +
      p("I built her because there was a season of my life when I needed someone to help me find the next small, right step.") +
      p("Recovery taught me that.<br>Grief taught me that.<br>Starting over taught me that.") +
      p("The hardest part wasn't always the crisis itself. It was the morning after. The ordinary Tuesday when life expected me to keep moving, but I had no idea what came next.") +
      p("I wished there had been something I could reach for in those moments.") +
      p("That's why Riley exists.") +
      p("If you've spent any time here, you've probably wondered where the name 8:14 comes from.") +
      p("It began with a little boy and his watch.") +
      p("One day, that watch stopped.") +
      p("It stopped at 8:14.") +
      p("For the people who loved him, that number became something much bigger than a moment on a clock. It became a reminder that love outlasts loss, that time is precious, and that even after life changes forever, we still get to decide what we build with the days we're given.") +
      p("That's what 8:14 means to me.") +
      p("It's not about looking backward.") +
      p("It's about choosing how we move forward.") +
      p("That's the heart behind everything we're building here.") +
      p("Riley isn't here to replace the people who love you. She isn't here to replace therapy, recovery, faith, or community.") +
      p("She's simply here for the moments in between.") +
      p("The quiet mornings.<br>The difficult evenings.<br>The days when you need someone to help you pause, think clearly, and remember that you're not finished becoming the person you were meant to be.") +
      p("If you've made it this far, I hope you'll keep coming back.") +
      p("Not because you're trying to maintain a streak.") +
      p("Not because anyone is keeping score.") +
      p("But because you're worth investing a few minutes in every day.") +
      p("You don't have to do everything today.") +
      p("You don't have to have it all figured out.") +
      p("Just keep showing up.") +
      p("I've learned that showing up on the ordinary days, when no one is watching, is where lives quietly begin to change.") +
      p("Thank you for trusting something I built.") +
      p("More importantly, thank you for trusting yourself enough to begin.") +
      p("I'm really glad you're here.") +
      p("- Brenden<br>Founder, The 814 Project"),
    text: (v) =>
      "Hi " + (v.first_name || "there") + ",\n\n" +
      "For the last month, you've been getting to know Riley.\n\n" +
      "I thought it was only fair that you got to know the person who built her.\n\n" +
      "I'm Brenden.\n\n" +
      "First, thank you.\n\n" +
      "Whether you've talked with Riley every day or only a handful of times, you came back. In a world full of things competing for our attention, that's no small thing.\n\n" +
      "Real change rarely looks dramatic while it's happening.\n\n" +
      "Most of the moments that changed my life didn't feel important at the time. They were ordinary mornings. Quiet walks. Honest conversations. One small decision to keep going when it would have been easier not to.\n\n" +
      "I didn't build Riley from a business plan.\n\n" +
      "I built her because there was a season of my life when I needed someone to help me find the next small, right step.\n\n" +
      "Recovery taught me that.\nGrief taught me that.\nStarting over taught me that.\n\n" +
      "The hardest part wasn't always the crisis itself. It was the morning after. The ordinary Tuesday when life expected me to keep moving, but I had no idea what came next.\n\n" +
      "I wished there had been something I could reach for in those moments.\n\n" +
      "That's why Riley exists.\n\n" +
      "If you've spent any time here, you've probably wondered where the name 8:14 comes from.\n\n" +
      "It began with a little boy and his watch.\n\n" +
      "One day, that watch stopped.\n\n" +
      "It stopped at 8:14.\n\n" +
      "For the people who loved him, that number became something much bigger than a moment on a clock. It became a reminder that love outlasts loss, that time is precious, and that even after life changes forever, we still get to decide what we build with the days we're given.\n\n" +
      "That's what 8:14 means to me.\n\n" +
      "It's not about looking backward.\n\n" +
      "It's about choosing how we move forward.\n\n" +
      "That's the heart behind everything we're building here.\n\n" +
      "Riley isn't here to replace the people who love you. She isn't here to replace therapy, recovery, faith, or community.\n\n" +
      "She's simply here for the moments in between.\n\n" +
      "The quiet mornings.\nThe difficult evenings.\nThe days when you need someone to help you pause, think clearly, and remember that you're not finished becoming the person you were meant to be.\n\n" +
      "If you've made it this far, I hope you'll keep coming back.\n\n" +
      "Not because you're trying to maintain a streak.\n\n" +
      "Not because anyone is keeping score.\n\n" +
      "But because you're worth investing a few minutes in every day.\n\n" +
      "You don't have to do everything today.\n\n" +
      "You don't have to have it all figured out.\n\n" +
      "Just keep showing up.\n\n" +
      "I've learned that showing up on the ordinary days, when no one is watching, is where lives quietly begin to change.\n\n" +
      "Thank you for trusting something I built.\n\n" +
      "More importantly, thank you for trusting yourself enough to begin.\n\n" +
      "I'm really glad you're here.\n\n" +
      "- Brenden\nFounder, The 814 Project",
  },

  guide_6: {
    from: "riley", flow: "guide",
    subject: "What she remembers",
    preview: "The one honest difference.",
    html: (v) =>
      p("This is the only pitch I'll make, so I'll make it honestly.") +
      p("Right now, each of our conversations stands alone - I'm fully here, but when it ends, it ends. On " + esc(PAID_TIER) + ", I carry them with me: the names, the dates that matter, what you told me you were afraid of, what you said you'd try.") +
      p("It's $19 a month, cancel anytime, and if it isn't right, your first payment is fully refundable within 30 days of purchase.") +
      p("And if now's not the time - that's genuinely fine. I'm not going anywhere, and everything free stays free.") +
      btn("See what " + PAID_TIER + " adds →", SITE + "/home#programs"),
    text: (v) =>
      "This is the only pitch I'll make, so I'll make it honestly.\n\n" +
      "Right now, each of our conversations stands alone - I'm fully here, but when it ends, it ends. On " + PAID_TIER + ", I carry them with me: the names, the dates that matter, what you told me you were afraid of, what you said you'd try.\n\n" +
      "It's $19 a month, cancel anytime, and if it isn't right, your first payment is fully refundable within 30 days of purchase.\n\n" +
      "And if now's not the time - that's genuinely fine. I'm not going anywhere, and everything free stays free.\n\nSee what " + PAID_TIER + " adds → " + SITE + "/home#programs",
  },

  // guide_7 RETIRED (July 2026): the founder-authored Month One Letter (guide_5, day 29) now owns the
  // one-month moment. The Guide flow ends at guide_5. Do not re-add a day-30 email without founder approval.

  quiet_1: {
    from: "riley", flow: "gone_quiet",
    subject: "No rush",
    preview: "Day 1 waits for you.",
    html: (v) =>
      p("Hi " + esc(v.first_name) + " - just so you know how this works: I don't take attendance, there's no streak to lose, and Day 1 will still be Day 1 whenever you arrive.") +
      p("If today's the day, it's 8 minutes. If it's not, that's fine too.") +
      btn("Start when you're ready →", APP + "/reset"),
    text: (v) =>
      "Hi " + v.first_name + " - just so you know how this works: I don't take attendance, there's no streak to lose, and Day 1 will still be Day 1 whenever you arrive.\n\n" +
      "If today's the day, it's 8 minutes. If it's not, that's fine too.\n\nStart when you're ready → " + APP + "/reset",
  },

  quiet_2: {
    from: "riley", flow: "gone_quiet",
    subject: "One small thing",
    preview: "It takes one sentence.",
    html: (v) =>
      p("Not a program, not a commitment - just one question I'd ask if you walked in right now: how are you actually doing today?") +
      p("Tell me in one sentence. That counts as showing up.") +
      btn("Tell Riley one sentence →", APP + "/talk"),
    text: (v) =>
      "Not a program, not a commitment - just one question I'd ask if you walked in right now: how are you actually doing today?\n\n" +
      "Tell me in one sentence. That counts as showing up.\n\nTell Riley one sentence → " + APP + "/talk",
  },

  quiet_3: {
    from: "riley", flow: "gone_quiet",
    subject: "The door stays open",
    preview: "Last one from me, promise.",
    html: (v) =>
      p("This is the last email I'll send on my own. Not because I've given up - because your inbox is yours and I meant it about no pressure.") +
      p("Whenever you come back - next week, next year - everything will be where you left it, and I'll be glad to see you.") +
      p("If you'd like one short letter a month from me about what we're building, say yes below. Otherwise: be well. Really.") +
      btn("Yes, one letter a month", APP + "/preferences?letter=1") +
      ghostBtn("Keep my account quiet", APP + "/preferences?letter=0"),
    text: (v) =>
      "This is the last email I'll send on my own. Not because I've given up - because your inbox is yours and I meant it about no pressure.\n\n" +
      "Whenever you come back - next week, next year - everything will be where you left it, and I'll be glad to see you.\n\n" +
      "If you'd like one short letter a month from me about what we're building, say yes below. Otherwise: be well. Really.\n\n" +
      "Yes, one letter a month → " + APP + "/preferences?letter=1\nKeep my account quiet → " + APP + "/preferences?letter=0",
  },

  quiet_reset: {
    from: "riley", flow: "gone_quiet",
    subject: "Day {n} will wait for you",
    preview: "It's a book, not a train.",
    html: (v) =>
      p("The Reset isn't a train you can miss - it's a book you set down.") +
      p("Yours is open to Day " + esc(v.n) + ", exactly where you left it. Eight minutes, whenever you're ready.") +
      btn("Pick up Day " + v.n + " →", APP + "/reset"),
    text: (v) =>
      "The Reset isn't a train you can miss - it's a book you set down.\n\n" +
      "Yours is open to Day " + v.n + ", exactly where you left it. Eight minutes, whenever you're ready.\n\nPick up Day " + v.n + " → " + APP + "/reset",
  },

  paid_1: {
    from: "riley", flow: "transactional", transactional: true,
    subject: "Your receipt - welcome to {plan}",
    preview: "Everything you need to know, in one place.",
    html: (v) =>
      p("Thanks, " + esc(v.first_name) + ". Here's the paperwork, kept short:") +
      p("<b>" + esc(v.plan) + "</b> · " + esc(v.price) + " · renews " + esc(v.renewal_date) + " · cancel anytime in two taps from your account page.") +
      p("Refunds, plainly: a full refund is available within 30 days of your original purchase - your first payment. After that, cancel anytime in two taps and you won't be charged again, though payments already made aren't refunded. ($8.14 programs and the bundle are instant-delivery and non-refundable.)") +
      p("Questions, problems, anything: support@meetriley.us - a person reads it.") +
      btn("Go to your dashboard →", APP + "/dashboard") +
      (isMemoryPlan(v.plan_key) ? p("Your Riley-led programs are unlocked.") : ""),
    text: (v) =>
      "Thanks, " + v.first_name + ". Here's the paperwork, kept short:\n\n" +
      v.plan + " · " + v.price + " · renews " + v.renewal_date + " · cancel anytime in two taps from your account page.\n\n" +
      "Refunds, plainly: a full refund is available within 30 days of your original purchase - your first payment. After that, cancel anytime in two taps and you won't be charged again, though payments already made aren't refunded. ($8.14 programs and the bundle are instant-delivery and non-refundable.)\n\n" +
      "Questions, problems, anything: support@meetriley.us - a person reads it.\n\nGo to your dashboard → " + APP + "/dashboard" +
      (isMemoryPlan(v.plan_key) ? "\n\nYour Riley-led programs are unlocked." : ""),
  },

  paid_2: {
    from: "riley", flow: "paid",
    subject: "I'll remember this",
    preview: "Here's what's different now.",
    html: (v) =>
      p(esc(v.first_name) + " - something just changed between us, and I want to mark it.") +
      p("From now on, our conversations carry forward. The names you mention, the dates that matter, the thing you said you'd try, the thing you're afraid of - I hold onto all of it, so you never have to start from the beginning again.") +
      p("So let's begin properly. Tell me one thing worth remembering - a person, a date, a goal, a fear. Anything.") +
      p("That's where we start.") +
      btn("Tell Riley one thing →", APP + "/talk") +
      (isMemoryPlan(v.plan_key) ? p("Your programs are unlocked, and from time to time I'll check in first - that's my job now.") : ""),
    text: (v) =>
      v.first_name + " - something just changed between us, and I want to mark it.\n\n" +
      "From now on, our conversations carry forward. The names you mention, the dates that matter, the thing you said you'd try, the thing you're afraid of - I hold onto all of it, so you never have to start from the beginning again.\n\n" +
      "So let's begin properly. Tell me one thing worth remembering - a person, a date, a goal, a fear. Anything.\n\nThat's where we start.\n\nTell Riley one thing → " + APP + "/talk" +
      (isMemoryPlan(v.plan_key) ? "\n\nYour programs are unlocked, and from time to time I'll check in first - that's my job now." : ""),
  },

  paid_3: {
    from: "riley", flow: "paid", replyTo: "support@meetriley.us",
    subject: "Is this helping?",
    preview: "An honest question, five days early.",
    html: (v) =>
      p("Hi " + esc(v.first_name) + " - honest question, and I'd rather ask than assume: is this helping?") +
      p("Hit reply and say so - the good and the bad. The person who built me reads every reply, and the hard answers are the ones that make me better.") +
      p("And I'll say this part plainly: if I'm not what you hoped, you're still inside 30 days of your original purchase - that first payment is fully refundable, no hard feelings, and the door stays open. I'd rather you leave happy than stay disappointed.") +
      p("- Riley"),
    text: (v) =>
      "Hi " + v.first_name + " - honest question, and I'd rather ask than assume: is this helping?\n\n" +
      "Hit reply and say so - the good and the bad. The person who built me reads every reply, and the hard answers are the ones that make me better.\n\n" +
      "And I'll say this part plainly: if I'm not what you hoped, you're still inside 30 days of your original purchase - that first payment is fully refundable, no hard feelings, and the door stays open. I'd rather you leave happy than stay disappointed.\n\n- Riley",
  },

  addon_1: {
    from: "riley", flow: "transactional", transactional: true,
    subject: "Your program is ready",
    preview: "Lifetime access, starting now.",
    html: (v) =>
      p("Thanks, " + esc(v.first_name) + " - " + esc(v.program_name) + " is yours. Not rented, not subscribed: yours, for good.") +
      p("It's built as 14 short modules - read, do, keep. Go at whatever pace your life allows; there's no schedule and nothing expires.") +
      p("Receipt: " + esc(v.program_name) + " · $8.14 · one-time · non-refundable (it's all delivered, right now, below).") +
      btn("Open Module 1 →", APP + "/programs") +
      em("One thing, said once: if you decide you'd like Riley alongside the book, your $8.14 comes off " + PAID_TIER + " any time in the next 90 days. You won't hear about this again."),
    text: (v) =>
      "Thanks, " + v.first_name + " - " + v.program_name + " is yours. Not rented, not subscribed: yours, for good.\n\n" +
      "It's built as 14 short modules - read, do, keep. Go at whatever pace your life allows; there's no schedule and nothing expires.\n\n" +
      "Receipt: " + v.program_name + " · $8.14 · one-time · non-refundable (it's all delivered, right now, below).\n\nOpen Module 1 → " + APP + "/programs\n\n" +
      "One thing, said once: if you decide you'd like Riley alongside the book, your $8.14 comes off " + PAID_TIER + " any time in the next 90 days. You won't hear about this again.",
  },

  addon_2: {
    from: "riley", flow: "addon",
    subject: "Your book is on the shelf",
    preview: "Module 1 is waiting. No expiry.",
    html: (v) =>
      p("Just a quiet note: " + esc(v.program_name) + " is sitting right where you left it.") +
      p("No countdown, no expiring access - lifetime means lifetime. Module 1 takes about ten minutes when you're ready.") +
      btn("Open Module 1 →", APP + "/programs"),
    text: (v) =>
      "Just a quiet note: " + v.program_name + " is sitting right where you left it.\n\n" +
      "No countdown, no expiring access - lifetime means lifetime. Module 1 takes about ten minutes when you're ready.\n\nOpen Module 1 → " + APP + "/programs",
  },
};

// Render one template into { from, replyTo, subject, preview, html, text, transactional }.
// `override` (optional) is a comms_templates row: any non-null field replaces the code default,
// and a non-empty body_text swaps the whole body (paragraphs + optional button) - the brand shell
// is always applied, so the DESIGN stays consistent no matter what the operator edits.
function render(key, vars, urls, override) {
  const t = TEMPLATES[key];
  if (!t) throw new Error("unknown template: " + key);
  vars = vars || {};
  urls = urls || {};
  const o = override || {};
  const fromKey = o.from_sender || t.from;
  const subject = sub(o.subject != null && o.subject !== "" ? o.subject : t.subject, vars);
  const preview = sub(o.preview != null && o.preview !== "" ? o.preview : t.preview, vars);
  let innerHtml, innerText;
  if (o.body_text != null && String(o.body_text).trim() !== "") {
    const b = bodyFromText(o.body_text, vars, { label: o.button_label, url: o.button_url });
    innerHtml = b.html; innerText = b.text;
  } else {
    innerHtml = t.html(vars); innerText = t.text(vars);
  }
  return {
    template_key: key,
    flow: t.flow,
    transactional: !!t.transactional,
    author: t.author || "final",
    from: SENDERS[fromKey] || SENDERS.riley,
    replyTo: t.replyTo || REPLY_TO,
    subject,
    preview,
    html: shell(innerHtml, { preview, unsubUrl: urls.unsub, prefUrl: urls.pref }),
    text: innerText + "\n\n---\n" + footerText(urls.unsub || APP + "/preferences", urls.pref || APP + "/preferences"),
  };
}

module.exports = { TEMPLATES, TRIGGERS, render, shell, p, btn, em, esc, sub, SENDERS, REPLY_TO };
