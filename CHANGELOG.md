# Riley — Deploy & Change Log

**Shared coordination log for parallel Claude Code sessions.** Multiple sessions deploy to
`main` at any given time. Before you start: `git fetch && git log --oneline -5` + read the top of
this file. After you ship to production: **append an entry here (newest first) in the same commit
or the next one, then push.** This is how each session knows what the others already changed.

Format per entry: `date` · `commit` — one-line summary · then bullets of what/why + files touched.
Keep it benign — this file is committed to a public-served repo, so **never put secrets here**.

---

## 2026-07-07

### Daily check-in merged INTO Riley chat — dark, mandatory, time-aware
- **Why:** the dashboard auto-fired its **own** rich modal check-in AND the chat popup ran a
  **separate** lighter check-in — members saw two at once. The chat was also light/cream (off-brand)
  and the morning goal question asked about "today" at 6am (nonsensical). Also fixed a pre-existing
  bug: `chat.html` bootstrap threw on missing `#user-avatar`/`#user-name`, so the chat's own
  check-in + resume never actually ran.
- **What:** `chat.html` is now the **single** owner of the daily check-in — Riley-led chips, the full
  rich flow (mood → sleep/heaviness → lane-keyed goal → what shaped it → optional note), crisis scan +
  Watch/Concern escalation + "give one thing back" card, saving the same `daily_checkins` row. In the
  **morning** the reflective questions look back at **yesterday**. Chat restyled **dark** (ink/gold/
  parchment). After the check-in, a warm mood-aware line + resume-or-new. Check-in is **mandatory**:
  while it's in progress the popup can't be minimized/closed — `chat.html` posts `pending/done/exempt`
  to `pwa.js` which locks the −/×/ESC/overlay. **Crisis + any error always unlock** (fail-open, never
  trap). Retired the dashboard modal (`loadDailyCheckin` trigger + the whole engine removed) and
  neutralized the `saveMood` quick-tap so it logs mood only (no `checkin_completed` bypass).
- **Files:** `chat.html` (check-in flow, dark theme, contextual greeting, lock signals, bootstrap fix,
  `newConversation` fix), `pwa.js` (mandatory lock: postMessage listener + guarded close/ESC/overlay),
  `dashboard.html` (retired modal trigger + dead engine, `saveMood` logs mood only). No migration.

### Security — internal `*.md` docs no longer publicly served + operator-key note
- **Why:** `meetriley.us/CLAUDE.md` (and other root docs) returned HTTP 200 — internal dev notes
  were publicly readable, including the documented `Riley814` operator password.
- **What:** `netlify.toml` now force-404s the internal docs on every host (`/CLAUDE.md`,
  `/CHANGELOG.md`, `/DATA_CONTRACT.md`, `/ENTITLEMENTS_ADMIN.md`, `/INTERACTIVE_PROGRAMS_QA.md`,
  `/README.md`) via a new `/404.html`. Scrubbed the literal `Riley814` from `CLAUDE.md` — the operator
  key is validated SERVER-SIDE by `requireOperator()` (supabase-client.js); value lives only in the
  Netlify `OPERATOR_KEY` env var + a password manager. Verified NO secret values (service key, etc.)
  are committed; the Supabase anon key is public-by-design (RLS-protected) — no action there.
- 🔴 **OPERATOR TODO (Brenden, in Netlify → Environment variables):** **rotate `OPERATOR_KEY`** to a
  strong random value. The old value was documented in a publicly-served file, so treat it as
  compromised. After rotating, operators sign in with the new key (prompted once).
- **Files:** `netlify.toml`, `404.html` (new), `CLAUDE.md`.

### `7e132fa` — Programs page: split add-ons into Self-Guided vs Riley-Led
- **Why:** the client `/programs` "Program Add-ons" grid mixed self-guided content programs
  ($8.14, no Riley) with Riley-led coaching programs ($18.14, Session Zero + 14 sessions) in one
  undifferentiated list — members found it confusing.
- **What:** `programs.html` now renders two labeled sections, each with a serif header, a one-line
  descriptor, and a price pill: **Self-Guided Programs** (from $8.14) and **Riley-Led Programs**
  ($18.14). Split is driven by program `kind`: `self_guided`+`bundle` → self-guided; `interactive`+
  `guided` → Riley-led (`pgFamily()`/`pgSection()`). New programs slot in automatically.
- **Files:** `programs.html` only (CSS `.pg-fam*`, `#pg-avail`→`#pg-addons`, `loadPrograms()`).

### `7b6348c` — Client portal: remove redundant topbar ← Home / Ask Riley buttons
- **Why:** every client page has the left sidebar (Today = home) + the global floating Riley pill,
  so the top-right `← Home`/`← Tracker` + `Ask Riley` button pair was pure duplication.
- **What:** removed that button pair from **12 pages** (brief, calendar, conversations, finance,
  library, nutrition, programs, progress, sleep, tracker, workouts, chat).
- **Kept (do NOT remove):** the `+ New Chat` / `New Conversation` buttons (functional), the
  dashboard notification bell, the `← Back to dashboard` link on the **sidebar-less** pages
  (`program.html`/`profile.html`/`settings.html` — their only nav), and the `← Back to Home` links
  that live **inside the full-screen `🔒 feature-locked` overlays** (they're the escape hatch, not
  footer clutter — removing them traps users).

---

## 2026-07-06

### `f6dbc6a` — Operator dashboard rework + Finance system
- Operator `operator.html`: top nav → **left sidebar** + Riley logo; tabs reorganized (PostHog
  Analytics nested under Social; Engagement→**Client Overview** w/ Safety merged; Metrics→**Riley
  Overview**; Add User → modal). New finance: **Revenue** (MRR from `subscriptions`) + editable
  **`operating_expenses`** table + Net, via `admin-finance.js` + migration `066`. Home shows an
  MRR·Expenses·Net snapshot. (Full detail in Claude memory: `operator-finance-rework-2026-07`.)
