# Riley - Positioning & Tiers (CANONICAL COPY DECK)

**Single source of truth for tier messaging. If copy about the tiers appears anywhere, it must match
this file exactly.** Internal doc - force-404'd publicly via netlify.toml. Plain hyphens only (no em-dashes).

Set 2026-07-13. The tiers answer one question: **"how close do you want Riley?"** - not "how much do you get?"
Money is secondary; members decide on what they get *from Riley*. Prices are unchanged ($19/$34); this is a
messaging change only. Every plan already includes every topic - the only thing that changes is how much of
Riley is beside you.

---

## Product differentiator (lead line, used near the top of the funnel)
> **Never explain yourself twice.**
One Riley for all of you - your sobriety, your grief, your body, your days - and Riley remembers everything.

## The thesis line (already live on home.html:270 - keep verbatim)
> Every plan includes every topic - sobriety, movement, food, grief, all of it. The only thing that changes
> is how much of Riley you want beside you.

---

## The three tiers = three depths of relationship

### Guide - Free, forever
- **Tagline (verbatim, everywhere):** `Riley shows you where you stand.`
- **Card / blurb (verbatim):**
  `Riley shows you where you stand. In your corner from the very first message - not a trial, not a timer. Every topic open, real support the moment you need it, and The 8:14 Reset to begin.`

### Companion - $19/mo ($175/yr)
- **Tagline (verbatim, everywhere):** `Riley walks with you.`
- **Card / blurb (verbatim):**
  `Riley walks with you. Now Riley remembers everything and carries it forward, so you never explain yourself twice - unlimited conversation any hour, daily check-ins and your habit tracker, and every self-guided program included.`

### Coach - $34/mo ($350/yr)
- **Tagline (verbatim, everywhere):** `Riley moves you forward.`
- **Card / blurb (verbatim):**
  `Riley moves you forward. Everything in Companion, plus every Riley-led program, adaptive movement and nourishment, and proactive check-ins Riley starts - guidance that adapts to you and grows over time.`

### Mentor - future (draft, invisible until flipped live)
- Keep existing teaser: `And later, Riley Mentor - a deeper tier with a human in the loop, for when you're ready to go further. Not yet. But coming.`

---

## À la carte (unchanged - the taste, not the relationship)
- Self-guided program $8.14 · Self-Guided Bundle / Riley-led program $18.14.
- Framing: the book, not the coach. The subscription adds the thing a one-time buy can't - Riley remembering
  all of it and keeping going. Keep `$8.14 off Companion if you upgrade within 90 days`.

## In-app upsell / lock cards (money secondary)
Lead with what Riley *does* with you; **drop inline prices** from in-app lock cards (price lives on the
pricing page + checkout). Companion = memory + daily presence. Coach = adaptive plans + proactive + Life Map.
Never meter the relationship in copy the member can feel.

## Comparison-table wording
Rename the memory row `Long-term memory` -> `Riley remembers you`.

---

## Surfaces this must land on (checklist)
- [ ] home.html - tier cards (guide/companion/coach desc), compare-table memory row
- [ ] products.blurb (DB) - reset_free / companion / coach (match card blurbs)
- [ ] riley-chat.js - system-prompt tier block (Riley's own words) + member-facing tier explanations
- [ ] comms-templates.js - Companion pitch email + any tier lines
- [ ] stripe-catalog.js - Companion + Coach product descriptions
- [ ] help.html - tier/billing explanation lines
- [ ] dashboard.html - Morning Brief lock + feature-lock cards + weekend reengagement line
- [ ] chat.html - chat-cap upsell line
- [ ] lifemap.html / workouts.html / nutrition.html - Coach lock cards (drop inline price)
- [ ] library.html - "what Companion unlocks" CTA
- [ ] programs.html - upgrade modal copy
- [ ] Stripe live catalog - Brenden re-runs stripe-setup (operator) after deploy
