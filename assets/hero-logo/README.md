# THE 8:14 Hero Logo — LOCKED (approved by Brenden 2026-07-02)

**The hero logo is the "Meet Riley" card from the marketing site**: a **centered** glowing
gold orb in a dark square box, with **"8:14." at the bottom**. Brenden approved this exact
design and asked, emphatically, that it never be redrawn or reinvented again.

> "go to the website, scroll down and you will see the hero logo… the one you originally
> created with 8:14 at the bottom… lock this in… anytime i ask for it, use this one. You can
> just adjust the sizing appropriately, but all dimensions and scaling should remain the same."

## Source of truth
- **`hero-logo.html`** — the canonical, scalable component (this IS the logo). Change `--size`
  ONLY to resize; every proportion is pinned to the box via container-query units, so it never
  needs redrawing. It is byte-for-byte the same design as `home.html`'s `.riley-visual` /
  `.riley-orb` / `.rtag` (the live Meet Riley card).
- **`hero-logo.png`** — a 512px raster master of the same design.
- **`generate.py`** — re-render the PNG at any size (browser-canvas → tiny POST-writer server;
  this box has no SVG→PNG tool). Also writes the live PWA icons (`/icon-512.png`, `/icon-192.png`,
  `/apple-touch-icon.png`) from this exact recipe, so the app icon == the hero logo.

## The design (all sizes are fractions of the box side `S`)
- **Box** — square, border-radius 0.0435·S, `overflow:hidden`;
  background `radial-gradient(circle at 38% 32%, rgba(201,168,76,0.22), #141210 62%)`,
  1px border `rgba(201,168,76,0.16)`.
- **Orb** — a circle, **centered**, diameter 0.326·S; fill
  `radial-gradient(circle at 40% 35%, #e8d5a3, #c9a84c 55%, #a8842f)`;
  glow `box-shadow: 0 0 0.174·S rgba(201,168,76,0.40)`; breathe 5s.
- **"8:14."** — DM Serif Display, font-size 0.074·S, centered, 0.052·S up from the bottom;
  `8:14` in `#fff`, the `.` in `#c9a84c`.

## Do NOT
- put the sun up high, move "8:14." to the middle, change the font, swap the palette, add a
  horizon line, or make a fresh variation. **It is locked. Use this file.**
