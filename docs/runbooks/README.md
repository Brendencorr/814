# Incident Runbooks (Master Build Spec §10)

Each runbook: **detection → immediate action → member communication → postmortem.** When you're
someone's 2 AM support line, every minute of ambiguity is a cost.

---

## 1. Claude / model API outage
- **Detection:** spike in `system_incidents` kind=`model_fallback`/`api_failure`; uptime monitor on `/api/health-chat`; members report Riley "having trouble thinking clearly."
- **Immediate:** `anthropic-client.js` already auto-retries → Haiku fallback → graceful line, so chat degrades softly (crisis L3 is deterministic and unaffected). Check the [Anthropic status page]; nothing to restart.
- **Member comms:** if >15 min, post to status page: "Riley is briefly slower than usual — your history is safe." Do NOT email (avoid alarm).
- **Postmortem:** review fallback counts; confirm no crisis turn was affected (L3 never calls the model).

## 2. Supabase outage
- **Detection:** uptime monitor on Supabase reachability; `getClientData`/persist warnings in logs.
- **Immediate:** every DB write is non-blocking/non-fatal — Riley still replies (without personalization); check Supabase status; do NOT fail the chat path. If auth is down, sign-in breaks — post to status page.
- **Member comms:** status page only unless data-affecting.
- **Postmortem:** verify no writes were lost that matter (memory extraction is best-effort by design).

## 3. Missed-crisis report
- **Detection:** post-hoc scan queues `system_incidents` kind=`possible_missed_crisis`; or a human report.
- **Immediate:** review the excerpt. If it IS crisis language the detector missed → (a) reach the member per the crisis SLA, (b) add the phrasing to `tests/crisis/fixtures.json` (human-authored) and to `crisis-detection.js` **only with the crisis suite green + clinician sign-off**.
- **Member comms:** per crisis-response protocol (not a template — human + clinician).
- **Postmortem:** new rule + new test case; note in CHANGELOG.

## 4. Member data-deletion request
- **Detection:** member self-serve deletion, or written request.
- **Immediate:** confirm identity; start the 7-day grace (email confirm); after grace, hard-delete member rows across ALL tables + redact conversation content. Retain only: anonymized aggregates, legally-required financial rows, de-identified `crisis_log` per retention policy.
- **Member comms:** confirmation email on request + on completion.
- **Postmortem:** verify the v2 tables were covered (`riley_memory`, `life_map`, `session_summaries`, `chat_turn_signals`).

## 5. Key rotation (OPERATOR_KEY / VAPID / service / API)
- **Cadence:** quarterly, calendar-driven. OPERATOR_KEY precedent 2026-07-07.
- **Immediate:** rotate in Netlify env (+ `push_config` for VAPID via DB, never revert to env-only); verify old key 401s; for VAPID, keep the keypair STABLE or existing push subscriptions break.
- **Member comms:** none (silent).
- **Postmortem:** confirm no functions hardcode the old value; update the password manager.
