# Riley - Positioning & Tiers (CANONICAL COPY DECK)

**Single source of truth for tier messaging. If copy about the tiers appears anywhere, it must match
this file exactly.** Internal doc - force-404'd publicly via netlify.toml. Plain hyphens only (no em-dashes).

Set 2026-07-13; tier fold updated 2026-07-22 to the locked v2.3.1 truth (display rename only - internal
keys, entitlements, Stripe lookups and DB values unchanged). The tiers answer one question: **"how close do
you want Riley?"** - not "how much do you get?" Money is secondary; members decide on what they get *from
Riley*. One paid tier at $19/mo. Every plan already includes every topic - the only thing that changes is
how much of Riley is beside you.

**Locked tier truth (render display names ONLY through `tierLabel()` / `RILEY_TIER_LABELS` - never
hardcode a display name in code or copy surfaces):**
- **Companion** = free (internal key `guide`)
- **Coach** = $19/mo · $175/yr (internal key `companion`)
- **Mentor** = teased, not purchasable (internal keys `coach` / `mentor` / `concierge`)

---

## Product differentiator (lead line, used near the top of the funnel)
> **Never explain yourself twice.**
One Riley for all of you - your sobriety, your grief, your body, your days - and Riley remembers everything.

## The thesis line (already live on home.html:270 - keep verbatim)
> Every plan includes every topic - sobriety, movement, food, grief, all of it. The only thing that changes
> is how much of Riley you want beside you.

---

## The three tiers = three depths of relationship

### Companion - Free, forever (internal key `guide`)
- **Tagline (verbatim, everywhere):** `Riley shows you where you stand.`
- **Card / blurb (verbatim):**
  `Riley shows you where you stand. In your corner from the very first message - not a trial, not a timer. Every topic open, real support the moment you need it, and The 8:14 Reset to begin.`

### Coach - $19/mo ($175/yr) (internal key `companion`)
- **Tagline (verbatim, everywhere):** `Riley walks with you.`
- **Card / blurb (verbatim):**
  `Riley walks with you. Now Riley remembers everything and carries it forward, so you never explain yourself twice - unlimited conversation any hour, daily check-ins and your habit tracker, and every program included.`
- Coach is the whole of Riley - memory, every program (self-guided and Riley-led), adaptive movement and
  nourishment, proactive check-ins Riley starts, and the Life Map. Nothing held back.

### Mentor - teased, not purchasable (internal keys `coach` / `mentor` / `concierge`)
- **Tagline (verbatim, everywhere):** `Riley moves you forward.`
- Keep existing teaser: `And later, Riley Mentor - a deeper tier with a human in the loop, for when you're ready to go further. Not yet. But coming.`
- Never sold, never priced. If someone asks what's next, mention it warmly.

---

## À la carte (unchanged - the taste, not the relationship)
- Self-guided program $8.14 · Self-Guided Bundle $18.14 (Riley-led programs are included in Coach, not sold separately).
- Framing: the book, not the coach. The subscription adds the thing a one-time buy can't - Riley remembering
  all of it and keeping going. Keep `$8.14 off Coach if you upgrade within 90 days`.

## In-app upsell / lock cards (money secondary)
Lead with what Riley *does* with you; **drop inline prices** from in-app lock cards (price lives on the
pricing page + checkout). Coach = memory + daily presence + adaptive plans + proactive + Life Map - the
whole of Riley. Mentor is teased only, never sold. Never meter the relationship in copy the member can feel.

## Comparison-table wording
Rename the memory row `Long-term memory` -> `Riley remembers you`.

---

## Surfaces this must land on (checklist)
- [ ] home.html - tier cards (internal guide/companion desc), compare-table memory row
- [ ] products.blurb (DB) - reset_free / companion / coach (match card blurbs)
- [ ] riley-chat.js - system-prompt tier block (Riley's own words) + member-facing tier explanations
- [ ] comms-templates.js - Coach pitch email (guide_6) + any tier lines (via tierLabel())
- [ ] stripe-catalog.js - Coach product description (paid tier; internal key companion)
- [ ] help.html - tier/billing explanation lines
- [ ] dashboard.html - Morning Brief lock + feature-lock cards + weekend reengagement line
- [ ] chat.html - chat-cap upsell line
- [ ] lifemap.html / workouts.html / nutrition.html - Coach lock cards (drop inline price)
- [ ] library.html - "what Coach unlocks" CTA
- [ ] programs.html - upgrade modal copy
- [ ] Stripe live catalog - Brenden re-runs stripe-setup (operator) after deploy
