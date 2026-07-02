# Cardinal art — drop files here

Drop the cardinal illustration files into this folder using the exact filenames below,
then tell Claude "the cardinal files are in." Claude will wire up the ambient fly-in/out,
loading states, chatbot greeting, feather drops, and feather collection from these.

## Format
- **PNG with a transparent background** (preferred), or **SVG**.
- Each pose = its own file. No text labels, no drop shadow baked in if avoidable.
- Long side ≥ 512px (bigger is fine). Cardinal facing left is what the mockup shows.

## Minimum set (enough to build the whole system)
- `cardinal-perched.png` — the main "Meet the Cardinal" pose (hero, About, "stays to help")
- `cardinal-flying.png` — wings out, for "flies in" + the ambient fly-across
- `feather.png` — a single feather (used for the drop animation + the collected-feather trophies)

## Full set (matches every state in the mockup — nice to have)
- `cardinal-walking.png`      — loading: "walking…"
- `cardinal-looking.png`      — loading: "looking for something…" (head down)
- `cardinal-almost.png`       — loading: "almost there…"
- `cardinal-welcome.png`      — loading: "welcome."
- `cardinal-flying-small.png` — small flying pose for chat "flies in" trail
- micro-interaction poses (thank-you, success, notification, gentle-reminder, keep-going) — optional

## Notes
- If all you have is the single mockup board image, save it here as `mockup-board.png` and
  tell Claude — he can crop the main cardinal from it as a fallback (lower quality; clean
  individual exports are much better).
