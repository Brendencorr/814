# Calendar Integration - as built (2026-07-23)

Source handoff: founder's "RILEY - CALENDAR INTEGRATION HANDOFF" (July 23, 2026).
Phase 1 is LIVE-ready; Phase 2 is fully built BEHIND A FLAG awaiting Google verification;
Phase 3 is documented only (do not file the write scope yet).

## Phase 1 - the ICS feed (SHIPPED)

- **Table:** `calendar_feeds` (migration 104, applied live). One active row per member;
  regenerate = revoke old + insert new. NOTE: handoff SQL referenced `profiles(id)`;
  this repo's member table is `user_profiles(id)` - observed reality wins.
- **Endpoint:** `GET /.netlify/functions/calendar-ics?t={token}` (calendar-ics.js).
  - Unknown/revoked/short token → 404 EMPTY body (no enumeration, no detail).
  - `Content-Type: text/calendar; charset=utf-8` · `Cache-Control: private, max-age=900`.
  - Events: the daily **Your 8:14** (RRULE FREQ=DAILY at the member's first-login
    time-of-day in their timezone, `DURATION:PT8M14S` - the brand lives in the metadata),
    all-day **Session {n} is ready** rows for active enrollments, and opt-in
    **A milestone worth marking** days (30/90/annuals from the sobriety date).
  - **PRIVACY LAW:** discreet titles only. No program names, no recovery language,
    milestones opt-in and discreetly worded. Enforced by tests.
  - VTIMEZONE definitions bundled for US zones; unknown timezone → America/Denver.
- **UI:** `calendar-card.js` mounted on Account (settings.html) and the Calendar page
  (calendar.html - the dashboard Calendar quick-button routes there). Google / Apple /
  Copy link buttons, `Include milestone days` toggle (default off), regenerate line.
  Members manage their own `calendar_feeds` row directly under RLS.
- **Tests:** `npm run test:calendar` → tests/calendar/ics.test.js covers the §1.4 gates
  (recurrence + duration, discreet-title sweep, opt-in milestones, RFC 5545 escaping +
  75-octet folding, UID format, tz fallback).

## Phase 2 - read-only Google Calendar (BUILT, FLAG OFF)

Flag: **`CALENDAR_GOOGLE_ENABLED=true`** in Netlify env. Until then every Phase 2
endpoint 404s and the connect card renders NOTHING (members never see the
"unverified app" interstitial). Flip the flag only after Google verification clears.

Required env before flipping:
- `GOOGLE_CAL_CLIENT_ID` / `GOOGLE_CAL_CLIENT_SECRET` - OAuth client (project riley-app)
- `CAL_TOKEN_KEY` - 32-byte hex key for AES-256-GCM refresh-token encryption

- **Tables** (migration 105, applied live): `calendar_connections` (refresh_token_enc,
  service-role ONLY - RLS with no member policies + anon/authenticated revoked) and
  `calendar_digest_cache` (reduced digest, expires <= 15 min).
- **Functions:**
  - `calendar-connect` - GET ?token → 302 to consent; POST {token,action:'status'} →
    {enabled, connected} (drives the card).
  - `calendar-callback` - verifies the HMAC state (member-bound, 10-min expiry),
    exchanges the code, ENCRYPTS the refresh token, upserts, → /dashboard?calendar=connected.
  - `calendar-disconnect` - revokes at Google + deletes connection & cache. Works even
    with the flag off - a member can always sever access.
  - `calendar-digest` - QA endpoint; the real consumer is IN-PROCESS:
    `calendar-google.js getDigest(sb, userId)`.
- **Digest:** today only (member-local day bounds), reduced in-memory to
  `{count, first_start, last_end, blocks[{start,end,label<=40}]}`, cached <= 15 min,
  raw payloads never persisted, `invalid_grant` → connection deleted (reconnect state).
- **Product integration (both fail-open, flag-gated):**
  - Morning Brief (daily-brief.js): one woven time-aware line max via
    `digestContextLine()`; SUPPRESSED inside a 7-day L2/3 crisis window (fail-safe).
  - Chat (riley-chat.js getClientData → buildUserContext): digest rides alongside
    streak/habits context; the line itself instructs "at most one gentle sentence,
    never list events".
- **Connect card** (calendar-card.js `mountGoogle`): Morning Brief area on the
  dashboard + Account → Calendar. Final copy per handoff. `Not now` suppresses
  re-prompt for 30 days (localStorage). Connected state shows a Disconnect row;
  `?calendar=connected` shows the one-time "Connected. Riley can see your day now."
- **Privacy policy:** the verbatim Limited Use paragraph is live in privacy.html
  ("Google Calendar (optional)" under §5).
- **Tests:** tests/calendar/google.test.js - encryption round-trip + tamper-fail,
  state expiry, digest reduction/40-char cap, and the §2.4 source gates (no plaintext
  token writes, TTL=15 hard cap, no raw events persisted, invalid_grant cleanup).

### Verification packet (file NOW - the 2-6 week long pole; Brenden owns these)
- [ ] Search Console domain verification for meetriley.us
- [x] Privacy policy Limited Use paragraph at a stable URL (/privacy#google-calendar)
- [ ] OAuth consent screen: External · name "Riley" · white-card sun logo ·
      homepage meetriley.us · privacy/terms URLs · authorized domain meetriley.us
- [ ] Scope justification (submit text, from the handoff): "Riley reads the member's
      same-day calendar events to time supportive check-ins and compose a daily brief.
      Data is summarized in-memory, cached at most 15 minutes, never stored durably,
      never used for advertising or model training."
- [ ] Demo video (Brenden, ~90s, unlisted YouTube): consent → connect → brief
      references the day → disconnect in Account
- [ ] Redirect URI registered: https://riley.meetriley.us/.netlify/functions/calendar-callback
- [ ] Scope: https://www.googleapis.com/auth/calendar.readonly (sensitive class -
      verification required, NOT the paid restricted-scope assessment)

## Phase 3 - write access (DO NOT BUILD YET)
Incremental auth (`calendar.events`) requested only at the member's first "add" tap,
never bundled into Phase 2 consent. File the scope update only when Phase 2 connect
rates justify it. Created events follow the same discreet-naming law.

## Out of scope (all phases)
Microsoft/Outlook OAuth (ICS covers Outlook read) · two-way sync · editing member
events · non-primary calendars · family/shared calendars · any calendar-based
conversion or upsell triggers.

## Founder decisions still open (before the Phase 2 card ships)
1. Tier gating: connect + brief line for ALL tiers (recommended) or Coach-only depth.
2. Milestones on ICS: confirm default-off + the discreet wording.
3. Google Cloud owner account (recommend brenden@meetriley.us Workspace, not personal).
4. Consent-screen logo: confirm the white-card sun asset.
5. Record the verification demo video.
