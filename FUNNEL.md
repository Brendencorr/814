# Riley — Launch Funnel Definition (for Echo)

Internal analytics reference. Event names are the canonical PostHog taxonomy for the acquisition →
activation → conversion funnel. **HARD RULE (track.js):** event properties are booleans / categories
/ counts only — **never** free-text or anything sensitive (no message content, no journal text, no PII
beyond email where a row already stores it).

## The funnel (in order)

| Stage | Event | Status | Where it fires |
|-------|-------|--------|----------------|
| Acquire | `page_view` | ✅ wired | posthog.js auto-capture (all marketing pages, operator excluded) |
| Acquire | `waitlist_joined` `{plan}` | ✅ wired | home.html waitlist modal + `waitlist-join.js` (also `events` row for Echo) |
| Acquire | `story_submitted` | ✅ wired | home.html story modal success |
| Activate | `signup_started` | ⚠️ TO WIRE | login.html — on Google click / magic-link submit |
| Activate | `signup_completed` | ⚠️ TO WIRE | auth success (onAuthStateChange SIGNED_IN) — new user |
| Activate | `first_riley_message` | ⚠️ TO WIRE | first user send in riley-auth.html/chat.html (per session) |
| Activate | `account_saved` | ⚠️ TO WIRE | anonymous → saved (auth after anon chat) |
| Engage | `reset_day1_complete` | ✅ likely | 8:14 Reset flow (verify emit name) |
| Engage | `reset_day7_complete` | ✅ likely | 8:14 Reset Day-7 handoff |
| Engage | `checkin_completed` | ✅ likely | chat.html daily check-in save (verify emit name) |
| Convert | `program_purchased` `{slug}` | ⛔ BLOCKED | needs checkout — payments not live (Rock Paper Coin) |
| Convert | `subscription_started` `{tier}` | ⛔ BLOCKED | needs checkout — payments not live |

## Notes
- **Emit helper:** client `window.RileyPH.track(event, props)` (posthog.js) → `posthog.capture`.
  Server-side events also land in the Supabase `events` table (name, props) which Echo reads.
- **Blocked-on-payments** events (`program_purchased`, `subscription_started`) should be wired into the
  Rock Paper Coin success webhook/handler when that ships — one line each at the confirmed-purchase step.
- **To-wire** activation events are small, additive `RileyPH.track(...)` calls at the noted points; do
  them in one focused pass so the funnel is complete before launch. Confirm the exact existing emit names
  for `reset_day*` / `checkin_completed` against the code before building Echo's funnel query.
