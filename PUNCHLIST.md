# Member-App UX Punch List - execution tracker (July 14 walkthrough)

Status legend: ✅ shipped+verified · 🟡 in progress · ⬜ not started · 🚩 flagged decision (review)

## P0 - TRUST-CRITICAL
- ✅ **P0.1 Sober-count single source of truth.** Audited: every LIVE surface already reads the ONE
  canonical fn (client `window.RileyDay.soberDays`, server `soberDaysForMember`) - dashboard, Life Map
  timeline, Clarity, milestones, emails, admin. The 2,430-vs-2,417 defect was **baked prose** in the
  stored User Manual (generated once when the count was 2,417). Fix: member-doc generation now emits the
  `{{sober_days}}` token (never a literal); `lifemap.html` fills the token live AND scrubs any legacy baked
  "N,NNN days sober" at render. Milestone "125 to 7 years" confirmed derived from canonical. Regression
  test `tests/sober/ssot-test.js` (client==server across the 4am boundary + a tz edge): 11/11 pass.
  Files: member-doc-background.js, lifemap.html, tests/sober/ssot-test.js.
  - 🚩 Existing stored docs still hold baked numbers in the DB; they're corrected at RENDER (display is
    right now). Full DB rewrite would need a per-member regeneration sweep - flagged, not done.
  - 🚩 daily-brief + plan-generate reference the count too but regenerate frequently (≤1-day self-healing
    drift) and use it as tone-context - left as-is this pass; flagged.
- ✅ **P0.2 User Manual content hygiene.** Generation prompt rewritten: OMIT empty sections (no "share
  more"/"add more"/"tell me more" invitations inside prose), Riley is "I"/"she" never "we", plain hyphens.
  Added a deterministic output lint (`lintDoc`) that scrubs em-dashes, first-person-plural, scaffolding
  items (and drops sections left empty), and tokenizes any baked count. Unit-verified on real defect samples.

## P1 - ARCHITECTURE & CANON
- ⬜ P1.1 Remove raw layer numbers (FOUNDATION/PRACTICE/DIRECTION) from dashboard
- ⬜ P1.2 Financial Goals -> Mentor (remove card/link/route, preserve data, park behind Mentor flag)
- ⬜ P1.3 Legacy Vault -> Mentor (remove from Life Map, preserve data)
- ⬜ P1.4 Life Balance wheel - delete entirely + data plumbing
- ⬜ P1.5 Track Your Day cards -> compact chip buttons
- ⬜ P1.6 Empty dims never render as dash rows
- ✅ P1.7 Default landing/nav - RESOLVED by P1.9/P1.10 (nav order Talk to Riley first, Clarity second)
- ⬜ P1.8 Morning Brief - two honest modes (email vs generate-on-login)
- ⬜ P1.9 Dashboard becomes a conversation (one voice + composer + one CTA)
- ⬜ P1.10 Chat becomes a conversation LAYER + retire in-app pill  [BIG; /talk groundwork exists]
- ⬜ P1.11 Life Map restructure - crown jewel first, collapse empties

## P2 - VOICE & POLISH
- ⬜ 1 "Day 0 of 7" -> "Ready to begin - Day 1 is waiting"
- ⬜ 2 Remove % progress from program cards
- ⬜ 3 Auto-title past conversations warmly
- ⬜ 4 Label/remove the unlabeled "6" on dashboard header
- ⬜ 5 Programs page: "Your Programs" + quiet "included with Coach"
- ⬜ 6 State-aware greeting quote pool
- ⬜ 7 Quiet hours mode (after ~10pm local)
- ⬜ 8 Mobile bottom bar with the sun at center
- ⬜ P2b-9 Hero eyebrow "REBUILD" not "WELLNESS"  [FOUNDER pick pending]
- ⬜ P2b-10 "Four Pillars" nav retire/fold  [FOUNDER confirm pending]

## FOUNDER EXCEPTIONS - do NOT touch
Recovery Journey name · Casey K. testimonial · "What We Believe" block.

## VERIFY
- ⬜ /chat routing smoke test (fresh session, member role, /chat direct + nav both land on chat)
- ⬜ Re-run v2.3 acceptance gate after P1
- ⬜ grep orphaned refs to Financial Goals / Legacy Vault / Life Balance after P1.2-1.4
