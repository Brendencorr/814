# RILEY TEMPLATE SYSTEM - v1.0 (LOCKED)
### The contract for placing content on Riley's grounds · Brand Guidelines v2.1 · July 2026

This kit is the complete design system for Riley social content. **The designs are locked; only the content varies.** Any agent (human or automated) producing Riley content follows this spec exactly. If a treatment isn't in this document, it isn't allowed.

---

## 1 · THE LOCKED GROUNDS (six - nothing else ships)

| Ground | Mode | Use for |
|---|---|---|
| **Dawn** | Dark | Wins, milestones, beginnings, hope-forward posts |
| **First Light** | Dark | The dark workhorse - general posts, product, practices |
| **Veil** | Dark | Heavy subjects (grief, slips, 2am), stat cards, dense text - maximum quiet |
| **Parchment** | Light | The light workhorse - lists, practices, lexicon posts |
| **Framed** | Light | Statement posts, definitions, "collectible" content (the hairline = the brand's vessel) |
| **First Blush** | Light | Gentle light-mode wins, mornings, soft CTAs |

**Retired permanently (never use):** Beam, Ember, Horizon, Crest, Doorway, Window, Motes, Ridge, Threadlight, Morning Wall, Shadow Window, Linen Block.

**Files:** `/grounds/{ground}--{format}.png` - every ground in all three canvases. Never stretch a ground to a different ratio; use the correct file.

**Rhythm rule:** roughly 2 light posts per 10; never two identical grounds back-to-back in the feed; Veil for anything emotionally heavy.

## 2 · CANVASES

| Format | Size | File suffix |
|---|---|---|
| Carousel slide | 1080×1080 | `square-1080x1080` |
| Single feed post | 1080×1350 | `portrait-1080x1350` |
| Story / Reel | 1080×1920 | `story-1080x1920` |

## 3 · TYPE SYSTEM (never substitute)

- **Headlines:** DM Serif Display, regular. Parchment #F5F0E8 on dark · Ink #0A0908 on light. Sizes: start 88-100px, shrink-to-fit; never below 30px; line-height 1.16; centered.
- **THE GOLD PERIOD:** if a headline ends in a period, the period renders in Gold #C9A84C (dark) / Gold Deep #A8842F (light). One period, always.
- **Eyebrows:** DM Mono, UPPERCASE, 26px, letter-spacing ~0.34em, centered, y≈118 (square/portrait) / y≈300 (story). Gold on dark, Gold Deep on light. Eyebrows are CONTENT (e.g. "ON GRIEF"), never the template name.
- **Sub-lines:** DM Sans 34px (36 on story), line-height 1.5, centered. Smoke #8A8578 on dark · Umber #6B655B on light.
- **Body/list items:** DM Sans 37px, gold bullet dots (12px), left-aligned at x=188, shrink-to-fit to right margin.

## 4 · MARGINS & SAFE ZONES

- Side margins: **104px** minimum, all canvases. Nothing but grounds touches the edge.
- Square/portrait: content band y 118 → H−240 (signature zone below).
- **Story sticker zones:** link sticker sits over the gold MEETRILEY.US line at y≈1560; poll/question stickers in the outlined zone y 980-1230 (render the faint outline; the platform sticker covers it).
- Story top/bottom 250px: keep clear of critical text (platform UI overlaps).

## 5 · SIGNATURES (launch phase - Assets 1 & 2 ONLY, no maker's mark)

| Surface | Mark | File | Width / position |
|---|---|---|---|
| Dark content slide | Nav lockup (white word, boxless) | `riley-nav-logo.png` | 176-196px wide, bottom-center, 62-64px from bottom |
| Dark sign-off slide | Nav lockup, larger | same | 360px, mid-lower + gold `meetriley.us` mono line beneath |
| Light (any) | **Ink-text nav, boxless** | `riley-nav-ink.png` | same sizes/positions as dark |
| Story (either mode) | matching nav variant | - | 190px, 118px from bottom |

Never: the maker's mark ("by The 8:14 Project") anywhere; the white-word nav on light; chips/boxes around the mark on these templates; the Hero lockup as a footer (Hero is for avatars/moments only).

## 6 · LAYOUTS (the only seven)

1. **HOOK** - eyebrow + headline (+ optional sub). Carousel slide 1 / singles.
2. **BODY** - small gold sun-dot (9px radius, centered, y≈206) + headline + sub. NO eyebrow. Carousel interior slides.
3. **LIST** - eyebrow + headline + gold-bulleted items (max 5).
4. **STAT** - eyebrow + giant serif number (270px) + gold mono context line + sub.
5. **SIGN-OFF** - headline + optional tagline + large nav + gold `meetriley.us`. Always the final carousel slide.
6. **STORY-QUOTE / STORY-POLL / STORY-CTA** - per §4 sticker zones.
7. **REEL (motion)** - 1080×1920, 8s, 24fps, silent. Ground still · gold sun-dot breathing (5s ease-in-out, scale 1→1.06, opacity .80→1, y≈330) · headline fades in 0.4-1.9s · sub 3.0-4.5s · gold URL + nav 5.5-7.0s. No other motion, ever. No confetti, no slides, no bounces.

## 7 · THE ONE-GOLD-MOMENT RULE

Every piece carries exactly one deliberate gold accent beyond the logo: the eyebrow OR the headline period OR the sun-dot OR the stat context line. Never gold paragraphs, gold backgrounds, or gold-on-gold. Proportions: ~70% ground / 20% text / 8% gold / 2% semantic.

## 8 · CONTENT RULES (Sentinel - every word passes before publish)

- **Never use:** journey · addict · alcoholic · clean · relapse (say **slip**) · broken · failure · hustle · grind · crush it · users · patients · disorder · treatment · "you should" · any urgency ("last chance," countdowns).
- **Canonical lines are verbatim** - never paraphrased: "Rebuild your life. One day at a time." / "Start where you are. Riley will meet you there." / "You're not starting over. You're continuing - and you don't have to do it alone." / "Not sure if you have a problem? Good. That's exactly who this is for." / "I know. Me too." / "No appointments. No judgment." / "8:14 - the minute the light comes back."
- No shame, no judgment, no diagnosis, no medical claims. No faces, alcohol, scales, clinical or zen-cliché imagery. No literal suns in imagery - the orb is the logo only.
- Crisis-adjacent content (e.g. the 988 story frame) is NEVER paired with any promotion.

## 9 · AUTOMATED PATH (Atlas)

`carousel_engine.py` + `multiformat_engine.py` (included) implement this entire spec programmatically. The `ground()` calls are restricted to the six locked names in code - Beam/Ember/etc. raise. The engines LOAD the pre-baked grounds from `./grounds/{ground}--{format}.png` (never regenerate). `make_*.py` scripts show the content-definition format and render into `./library/` (regenerable, git-ignored). **Font note:** the production DM family (DM Serif Display / DM Sans / DM Mono) is bundled in `./fonts/` and picked up automatically; the engines only fall back to stand-ins if the bundle is missing. Never publish stand-in-font renders.

## 10 · EXPORT

PNG, sRGB, no compression artifacts (quality ≥ 90 if JPEG required by a platform). Reels: H.264 MP4, yuv420p, CRF ≤ 20. File naming: `{campaign}-{slug}-{format}.png`.

## 11 · ROTATION & CADENCE (templates are used RANDOMLY, within rules)

The designs are locked; which template lands where is randomized inside these hard rules. Enforced in code by `netlify/functions/template-rotation.js` (`planCampaign`, `nextPick`, `validateSequence`; run `node netlify/functions/template-rotation.js --selftest`).

- **A - No repeats:** never use the same template (a format+ground pairing) more than **2 times in a row**.
- **B - Light/dark rhythm:** never more than **3 dark or 3 light** grounds in a row before the opposite mode appears. (Plus the section 1 rhythm: ~2 light per 10; avoid the exact same ground back-to-back; Veil for anything heavy.)
- **C - Weekly mix:** every week includes a **post, a story, a reel, AND a carousel** (default cadence 2 carousels / 2 posts / 2 stories / 1 reel = 7 a week).
- **D - Launch phasing:**
  - **Week 1** - **every** post is about Riley and the launch.
  - **Weeks 2-4** - at least **4 posts per week** are about Riley and our program; all other weekly content may be sourced from the web.

The Operator generates a compliant plan, then a human approves/schedules each item in FeedHive (nothing publishes without a human click - Spec section 8 + the pipeline's Sentinel gate still apply to every word).
