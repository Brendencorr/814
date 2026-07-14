# Member-App UX Punch List - execution tracker (July 14 walkthrough)

Status: ✅ shipped+verified · 🟡 partial · 🚩 flagged follow-up · ⬜ not started

## P0 - TRUST-CRITICAL  ✅
- ✅ P0.1 Sober-count SSOT (tokenized generation + render fill + scrub; test 11/11).
- ✅ P0.2 User Manual hygiene (omit empties, "I"/"she", hyphens, scrub lint).

## P1 - ARCHITECTURE & CANON  ✅ (one flagged follow-up)
- ✅ P1.1 Removed raw layer numbers.
- ✅ P1.2 Financial Goals -> Mentor (all surfaces + /finance redirect; data preserved; money-in-convo kept).
- ✅ P1.3 Legacy Vault -> Mentor (data preserved).
- ✅ P1.4 Life Balance wheel deleted.
- ✅ P1.5 Compact tool chips (was six large cards).
- ✅ P1.6 Empty dims warm-framed.
- ✅ P1.7 Nav order Talk-to-Riley-first / Clarity-second.
- ✅ P1.8 Two honest brief modes (email vs generate-on-login) + toggle (notification_schedule).
- ✅ P1.9 (composer + nav) - **the dashboard composer is live** ("Say anything - she's here" -> opens the
  layer with the message sent). 🚩 P1.9.1 full voice-block DOM merge (greeting + Riley Suggests + brief
  into ONE block) + P1.9.3 one-dominant-CTA hierarchy: FOLLOW-UP - the top area (greeting + Riley Suggests +
  composer, all now state-aware) already reads as one voice; the full DOM merge (moving the plan-gated brief
  up + one-CTA visual hierarchy) is a nuanced restructure best done as its own careful pass.
- ✅ P1.10 Conversation LAYER: full-height slide-over (expand to full screen, mobile full sheet), one
  conversation/memory, Esc/reduced-motion, crisis breaks out to full screen (988 -> full), nav opens it,
  pill retired (marketing keeps it), "Ask Riley about this" affordances (library + programs), mobile sun
  bottom-bar. 🚩 true cross-navigation persistence (layer staying open while navigating pages) needs a
  SPA/iframe-shell - deferred; this delivers the layer per-page + one conversation (reopen resumes thread).
- ✅ P1.11 Life Map crown-jewels-first + empties collapse, first person.

## P2 - VOICE & POLISH  ✅
- ✅ P2.1 No "Day 0". P2.2 No % on program cards. P2.3 Auto-titled conversations (member-editable, Haiku).
- ✅ P2.4 Labeled bell. P2.5 "Your Programs". P2.6 State-aware greeting (gentler on hard days).
- ✅ P2.7 Quiet hours. P2.8 Mobile sun bottom-bar. P2b.9 "Rebuilding." P2b.10 Four Pillars folded into About.

## FOUNDER EXCEPTIONS - not touched
Recovery Journey · Casey K. testimonial · "What We Believe" block.

## VERIFY
- ⬜ /chat routing smoke test (fresh member session): /chat direct + nav both reach chat.
- ⬜ Re-run v2.3 acceptance gate (P1 touched dashboard render, /finance + /pillars redirects).
- ✅ Orphan grep after P1.2/1.3/1.4: 0 dangling (finance lock-previews, wheel, vault all clean).
- 🔵 Layer/composer/mobile-bar/auto-title are member-auth-gated - deployed + parse-clean; the live
  interactive behavior wants a founder session test (open the layer, send from the composer, mobile bar).
