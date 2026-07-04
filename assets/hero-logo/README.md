# The Riley logo suite — current (approved 2026-07-04)

The mark is a **glowing gold sun** on dark — full-bleed (no box, no border), and it
gently **breathes**. It appears as the **hero** ("I'm Riley.") and the **nav** lockup
("Riley."). This replaced the retired "8:14." hero (rebrand → meetriley.us).

Full brand guide: **[`../brand/brand-guide.html`](../brand/brand-guide.html)** — logo
usage, clear space, misuse, color, type, motion, voice.

## The 4 logos
| File | Use |
|------|-----|
| `meet-riley.png` | Hero — orb + "I'm Riley." (512×512, full-bleed). Marketing / splash. |
| `meet-riley-animated.html` | Hero, breathing (live CSS). |
| `riley-nav-logo.png` | Nav lockup — sun + "Riley." (transparent, 568×258 @4×). |
| `riley-nav-logo.html` | Nav lockup, breathing (live CSS). |

App icons (`/icon-512.png`, `/icon-192.png`, `/apple-touch-icon.png`) are the orb mark
and stay in use (referenced by the PWA manifest + every page).

## Design tokens
- **Sun:** `radial-gradient(circle at 40% 35%, #e8d5a3, #c9a84c 55%, #a8842f)`, glow `rgba(201,168,76,0.4)`.
- **Hero wash:** `radial-gradient(circle at 38% 32%, rgba(201,168,76,0.22), #141210 62%)` on `#0a0908`.
- **Wordmark:** DM Serif Display, white `#fff`; the **period is gold `#c9a84c`**.
- **Breathe:** `@keyframes breathe {0%,100%{scale(1);opacity:.92} 50%{scale(1.06);opacity:1}}` — 5s ease-in-out infinite.

## Notes
- The live pages render the logo via CSS (`home.html` `.herologo`/`.orb`/`.tag` and
  `.logo`/`.logo-sun`) — these PNGs/HTML are the standalone brand assets / kit.
- `generate.py` is the legacy browser-canvas renderer that also writes the PWA icons.
  It still draws "8:14." text — update the wordmark before reusing it to regenerate.
- Retired 2026-07-04: `hero-logo.png` / `hero-logo.html` (the "8:14." hero). Superseded
  by "I'm Riley."; see memory `logo-assets-current-2026-07` + `rebrand-meetriley-2026-07`.
