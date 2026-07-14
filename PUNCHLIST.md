# Member-App UX Punch List - execution tracker (July 14 walkthrough)

Status: ✅ shipped+verified · 🟡 partial · 🚩 flagged for founder / dedicated build · ⬜ not started

## P0 - TRUST-CRITICAL  ✅ ALL SHIPPED
- ✅ **P0.1 Sober-count SSOT.** Live surfaces already read the ONE canonical fn; fixed the baked-prose
  drift (member-doc tokenizes `{{sober_days}}`; lifemap fills live + scrubs legacy). Test 11/11.
- ✅ **P0.2 User Manual hygiene.** Prompt rewrite (omit empties, Riley "I"/"she", hyphens) + scrub lint.

## P1 - ARCHITECTURE & CANON
- ✅ **P1.1** Removed FOUNDATION/PRACTICE/DIRECTION numeric row (dashboard).
- ✅ **P1.2** Financial Goals -> Mentor: removed card/chip/quick-link/lock-preview across all pages;
  /finance route redirected to /dashboard; data preserved; Riley keeps money-in-conversation.
- ✅ **P1.3** Legacy Vault removed from Life Map (data preserved; returns with Mentor).
- ✅ **P1.4** Life Balance wheel deleted entirely (+ data plumbing).
- ✅ **P1.5** Six large tool cards -> one compact chip row (Check-In/Movement/Nourishment/Rest/Life Map/Calendar).
- ✅ **P1.6** Empty dims show warm "nothing logged yet / Log it ->" instead of a bare dash.
- ✅ **P1.7** Resolved: nav order Talk to Riley first, Clarity second (done).
- 🟡 **P1.8** Brief modes - fixed the "inbox + Generate button together" contradiction (default generate-on-login).
  🚩 Full email-mode toggle (setting + email path) flagged - needs a member setting + the email send wiring.
- 🚩 **P1.9** Dashboard-as-conversation - DID: nav order (Talk to Riley first). FLAGGED: merge greeting +
  Riley Suggests + brief into one "from Riley" voice block + embedded composer + one state-aware CTA.
  Coupled to the P1.10 layer (the composer opens it); best built together as a dedicated pass.
- 🟡 **P1.10** Chat-as-layer - DID: P1.10.7 retired the in-app floating pill (kept on marketing).
  🚩 CORE FLAGGED: the persistent overlay conversation-layer mounted at app root that persists across
  navigation is a large architectural change to a multi-page app (crisis-path exemption is non-negotiable),
  and there's parallel `/talk` groundwork in flight from another session. Needs a dedicated build +
  coordination, not a hasty single pass. Nav "Talk to Riley" -> /chat for now (works).
- ✅ **P1.11** Life Map restructure - crown jewels (User Manual + Story) lead; empties collapse into one
  expandable line; empty states in Riley's first person.

## P2 - VOICE & POLISH
- ✅ **P2.1** No "Day 0 of N" -> "Ready to begin - Day 1 is waiting" (programs + dashboard).
- ✅ **P2.2** Removed % progress from program cards (days only).
- 🚩 **P2.3** Auto-title past conversations warmly - flagged (needs a utility-model titling fn + member-edit UI).
- ✅ **P2.4** Notification bell badge labeled (dynamic "N unread notifications" hover).
- ✅ **P2.5** Programs page "Your Programs" + quiet "included with Coach".
- 🟡 **P2.6** State-aware greeting - quiet-hours night voice done (P2.7). 🚩 Full gentler-pool-on-hard-days
  needs the state (sleep/mood) at greeting time; folds into the P1.9 voice block.
- ✅ **P2.7** Quiet hours mode (after ~10pm local: night voice + day-work recedes).
- 🚩 **P2.8** Mobile bottom bar with the sun at center - flagged (new PWA nav component).
- ✅ **P2b.9** Hero eyebrow -> "Rebuild. One day at a time." 🚩 founder pick vs "Rebuilding." (+ possible CMS override).
- ✅ **P2b.10** Retired "Four Pillars" from primary nav (kept footer). 🚩 founder: retire vs fold-into-About.

## FOUNDER EXCEPTIONS - not touched (correct)
Recovery Journey name · Casey K. testimonial · "What We Believe" block.

## VERIFY (open)
- ⬜ /chat routing smoke test (fresh session, member, /chat direct + nav both land on chat).
- ⬜ Re-run v2.3 acceptance gate (P1 touched dashboard render + the /finance redirect).
- ✅ grep orphaned refs after P1.2/1.3/1.4: finance lock-previews all removed; wheel/vault fns all removed (0 dangling).
