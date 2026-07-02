# THE 8:14 Hero Logo — LOCKED (approved by Brenden 2026-07-02)

`hero-logo.png` **is** the hero logo. Brenden approved this exact image and asked that it
never be redrawn or reinvented again. When "the hero logo" is needed, **use this file** (or
re-render it at a new size with `generate.py` — the proportions are fixed, only the pixel
size changes).

> "i want this to be the hero logo — lock this in… moving forward anytime i ask for it, use
> this one. You can just adjust the sizing appropriately, but all dimensions and scaling
> should remain the same."

## The design (a dark square with a glowing sunset + "8:14." at the bottom)
All positions/sizes are fractions of the square side `S`, so it scales cleanly.

- **Background** — radial gradient, center (0.50·S, 0.30·S), radius 0.98·S:
  `#17130d` @0 → `#0a0807` @0.55 → `#040302` @1
- **Warm glow (the "sunset")** — radial gradient, center (0.50·S, 0.36·S), radius 0.52·S:
  `rgba(201,168,76,0.20)` @0 → transparent @1
- **Sun** — circle, center (0.50·S, 0.365·S), radius 0.158·S.
  Fill = radial gradient from inner focal (cx−0.28r, cy−0.30r, r·0.08) to (cx, cy, r):
  `#f2e4bc` @0 → `#c9a84c` @0.55 → `#a8842f` @1.
  Soft glow around it: shadow color `rgba(201,168,76,0.55)`, blur 0.10·S.
- **"8:14."** — DM Serif Display, font-size 0.205·S, centered, baseline at 0.74·S.
  `8:14` in `#f5f0e8` (warm white), the `.` in `#c9a84c` (gold).

## Files
- `hero-logo.png` — the canonical master (512×512, the approved image).
- `generate.py` — re-render at any size. It's a tiny local server that draws the logo on a
  browser `<canvas>` (with DM Serif Display) and POSTs the PNG back to disk. Needed because
  this machine has **no SVG→PNG tool** (no rsvg-convert / ImageMagick / PIL / cairosvg).
  The live PWA icons (`/icon-512.png`, `/icon-192.png`, `/apple-touch-icon.png`) were made
  from this exact recipe.

## Do NOT
- redraw it "from scratch," swap the font, add a horizon line, move the sun, or change the
  palette. It is locked.
