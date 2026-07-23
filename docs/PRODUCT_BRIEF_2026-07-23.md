# Meet Riley (the 8:14 Project) - Product Brief
**As of 2026-07-23.** This is the shared source of truth for anyone (human or AI assistant) working on
the product. If something here conflicts with an older doc, this brief wins; if it conflicts with the
live site or database, observed reality wins - flag the drift to Brenden.

House style note: member-facing copy uses plain hyphens only, never em-dashes. Canonical lines from
RILEY_MESSAGING_HOUSE.md v2.1 are used verbatim, never paraphrased. This brief follows the same rule.

---

## 1. What the product is

**Riley is a companion for life's hard chapters - grief, burnout, habits, sobriety, starting over -
built by someone who's been through them.** (That one-liner is canon; use it verbatim.) Riley is an AI
companion - openly disclosed as an AI ("Riley is an AI.") - who offers a steady, warm, judgment-free
presence at any hour.

**Riley is NOT a recovery tool.** The category is **REBUILDING** - not wellness, not recovery.
"Wellness" is a sea; "recovery" is a label. Rebuilding is ours: sobriety, grief, burnout, the body, the
whole restart - one companion for the whole person. Recovery is one chapter, never the whole story.
(Category language is internal and investor-facing; the porch speaks in change and chapters, not
category names.) The mission: help people build a life they don't want to escape from.

Audience: the lead ICP is **the Rebuilder** - recovery first, grief close second, 25-60, in or around a
hard chapter they can name. The adjacent ring (stressed, anxious, burnt-out adults) is welcomed by the
universal lines and never pitched with lane language.

The brand is positioned against forms, streaks, and guilt: showing up counts, gaps are never counted
out loud, and Riley remembers so members never have to explain themselves twice.

Surfaces:
- **meetriley.us** - marketing site (home, about, tiers, FAQ).
- **riley.meetriley.us** - the member app (sign-in via Google OAuth through Supabase).
- **admin.meetriley.us** - private operator dashboard (Brenden only, server-validated operator key).

Voice and canon:
- Everything member-facing is in Riley's voice and signed Riley. **Exactly one** communication is ever
  from Brenden: the day-29 founder note email (guide_5). Never add another Brenden-signed comm.
- A build-blocking script (`scripts/check-messaging.js`) enforces the canon on every deploy: retired
  strings, em-dashes, verbatim canonical lines, tier taglines, and client-visible naming in the DB.

## 2. Tiers and pricing (locked v2.3.1 - display rename only, internal keys never change)

The tiers answer "how close do you want Riley?", not "how much do you get?". One paid tier.

| Display name | Internal key(s) | Price | Tagline (verbatim, everywhere) |
|---|---|---|---|
| **Riley Companion** | `guide`, `reset_free` | Free | Riley shows you where you stand. |
| **Riley Coach** | `companion` | $19/mo or $175/yr | Riley walks with you. |
| **Riley Mentor** | `coach`, `mentor`, `concierge` | Coming soon (Community, Upload your history) | Riley moves you forward. |

- Coach is the whole of Riley: memory turns on ("never explain yourself twice"). The member-facing name
  for the memory pillar is **Life Map** - never "Knowledge Graph".
- Mentor is teased in-app only (dashboard), never on marketing surfaces. The retired $34 tier maps to
  the Mentor display name for grandfathered members only.
- Payments are LIVE (Stripe Checkout). The marketing waitlist is retired - paid CTAs route straight
  through sign-in to checkout.
- Display names render only through `tierLabel()` / `RILEY_TIER_LABELS` - never hardcoded.
- In-app upsell cards lead with value and carry no inline price.
- One-breath offering (canon): "Riley is free to start. $8.14 gets you a program. $19 a month gets you
  all of Riley." Programs are $8.14 - the :14 rhythm is a brand signature.

## 3. The member experience

### Homepage (the Clarity home, /dashboard)
Top to bottom: warm time-aware greeting (gentler on hard days, quiet-hours mode 10pm-5am) → Clarity
score ring → "Say anything - she's here" composer (opens the conversation with the message sent) →
**Life Map spotlight card** (new 2026-07-23: What Riley's Noticing + the facets she's holding as chips
+ a still-learning line + link to the full Life Map; member can DISMISS it) → trend cards → compact
tool chips (Check-In, Movement, Nourishment, Rest, Life Map, Calendar) → **Daily Brief** (one card;
either generated on login or delivered by morning email, member's choice via a checkbox) → Active
Programs → Recent Conversations.

### Talking to Riley
- Real-time chat, full conversation memory, personalized from the member's profile and Life Map.
- Crisis protocol: leveled detection (L1 concern / L2 acute / L3 emergency) with a full-screen
  break-out to human resources (988) at the top level; a post-hoc crisis scan runs in the background.
- Riley extracts memory as you talk: Life Map facets, open threads (commitments, worries, events,
  joys, goals) that she follows up on later.

### Clarity Score (v2.3 - the score of the product)
- One daily score with bands and lanes, built from check-ins, sleep, movement, nourishment, and
  reflection. New members get **First Light** (a gentle provisional period), and scores are
  provisional when coverage is thin.
- **Grief is never graded - and Presence is scored (v2.4).** The founder-approved Presence lane
  (docs/07A, 2026-07-23) scores SHOWING UP as occurrence density over 14 days: check-ins on hard
  days, hard-date engagement, "kept the ritual," grief-program steps, connection on heavy days,
  and a conversation with Riley on a hard date (occurrence only - the door counts, the words
  never do). Hard days and hard-date windows are protected: the lane can rise or hold, never
  fall. Opt-in; auto-offered to grief-program members with opt-out. Multi-lane rule: one lane
  takes 12 of Practice's 40; two lanes take 10 each; max two.
- **Re-Light:** when a member returns after 7+ days away, the displayed score is rise-only for a
  7-day window (it can climb, never drop) so the first week back never punishes the return.

### Rhythm & Return (v1.1 - ON by default)
How Riley adapts to a member's real login rhythm:
- **Return tiers** by gap: R0 same day, R1 1-2 days, R2 3-6, R3 7-29, R4 30+.
- **The Never-Say law:** Riley never counts the gap out loud - no "it's been 9 days", no streaks, no
  "we missed you", no guilt. Enforced by pattern gate at generation time plus a runtime tripwire.
- **Welcome-back flow** (R2+): "Good to see you" register, how have you been, anything I should know,
  and a keep / adjust / fresh-start fork on goals. What the member shares updates their history and
  context but is never scored.
- **Dynamic daily check-in:** the scored spine (mood, energy, etc.) is invariant, but the framing and
  follow-up questions are live-generated per member from their threads, hard dates, and recent
  conversations (Haiku, Never-Say gated, static bank fallback). Returning members get shortened
  check-ins (condensed at R2, micro at R4).
- **Notifications back off** when unanswered (doubling to a cap, then weekly, then a monthly floor -
  the light stays on but never spams) and re-tighten when the member re-engages. Cadence is learned
  per member (median of their own gaps).

### Life Map (Coach - the memory pillar)
Page order (founder, 2026-07-23): **Life Balance wheel at the top** (nine-spoke mirror: Recovery,
Sleep, Move, Food, Purpose, People, Joy, Calm, Reflect - "not a grade, a mirror") → **My User Manual**
(Riley writes the manual to you: how you work, what overwhelms you, how to be there for you) → **Your
Story** ("this is who you became", regenerated on demand) → What Riley's Noticing (patterns from the
member's own data) → the facets (Your Why, Who You're Becoming, What Keeps You Steady / Recovery DNA,
Wins, Joy, People Who Matter, Fears, Values, Strengths, Energy Rhythms) as chips Riley fills from
conversation and members can add to → Your Timeline. Empty facets collapse into one quiet
"Riley's still learning these" line - never a wall of empty boxes.

### Programs
- **The 8:14 Reset** - the free 7-day starting program (daily emails + in-app days).
- Paid programs are $8.14 a la carte ("The book, not the coach."); progress is tracked per member.

## 4. Member communications (email)

First-14-days flow (all signed Riley, from riley@meetriley.us; one lifecycle email per member-day max):
- **guide_1** welcome (day 0) - promises "besides your daily brief, a handful of notes over the first
  two weeks, never more than one a day".
- **guide_2** orientation (days 1-3), **guide_3** Reset day-1 kickoff, **reset_daily** for Reset days
  2-7 (calendar-aligned even for late starters; a skipped number is never sent late), **guide_4**
  mid-point nudge (~day 4+).
- **guide_6** upgrade note (free members, days 12-29) - Coach at $19.
- **guide_5** day-29 founder note - the one Brenden-signed email.
- **Purchase (transactional, bypass the caps):** paid_1 receipt/welcome + paid_2 getting-started on
  subscription; addon_1 on a program purchase, addon_2 follow-up ~3 days later if the program is
  unopened. paid_3 ("Is she helping?", ~day 25 of a subscription) exists but its Brenden signature
  conflicts with the one-Brenden-email canon - open founder decision.
- **Governance (email-send.js, the single choke point):** every send carries a category
  (transactional / crisis / brief / lifecycle / reengagement / program_nudge / operator). Capped
  categories share one global member-local daily cap. Any member with an L2/L3 crisis event in the
  last 7 days is suppressed from capped sends (fail-safe: if the check errors, suppress). Everything
  is logged to a unified ledger (email_events).

## 5. Tech snapshot

Netlify serverless functions (member app + operator + crons) · Supabase (auth, Postgres with RLS,
storage) · Stripe (payments) · FeedHive (social scheduling for the marketing content engine) ·
transactional email through the email-send choke point. AI: conversation on Claude Sonnet 4.6;
utility/background jobs (memory extraction, personalization, summaries, crisis scan) on Claude Haiku
4.5, all routed through one model router, all utility calls fail-open so they can never break a
member's reply.

## 6. Recent decisions log

**2026-07-22**
- Payments live; waitlist retired.
- Tier display rename synced everywhere (Companion / Coach / Mentor as above).
- Rhythm & Return turned ON by default; check-in personalization is live-generated, not canned.
- No "Clarity got smarter" crossover message - members just experience the new score.
- One-Brenden-email canon (guide_5 only).

**2026-07-23**
- Life Balance wheel restored and moved to the top of the Life Map page (reverses the July-14
  punch-list deletion).
- Life Map spotlight card added to the member homepage, dismissible per member.
- Daily Brief consolidated to one card (no separate header band, no duplicated copy).
- Returning-member welcome-back flow fixed (a timestamp race made 5-day returners see the static
  check-in; return tier is now passed end to end).

**Open questions / launch blockers**
- paid_3 signature (Brenden vs Riley) - founder decision pending.
- Crisis test corpus: 14 human-authored phrases (Brenden + clinician) must replace placeholders
  before launch; the test suite deliberately fails until they do.
- Supabase leaked-password protection: deferred until the plan upgrade.
