# Data Sensitivity Map (Master Build Spec §11)

Every table classified by sensitivity. **Tier 1** data never leaves Supabase except to the
model call — never to analytics, exports, or third parties.

## Tier 1 — most sensitive (mood / sobriety / crisis / clinical / memory)
Never sent to analytics. Crisis-derived rows are additionally walled off from personalization
and member-visible surfaces.

| Table | Why Tier 1 |
|---|---|
| `crisis_log` | Safety records. Service-role only; RLS blocks client reads; excluded from analytics + member views + exports. |
| `riley_memory`, `life_map` | Riley's model of the person, incl. `sensitive` memory_type (grief/trauma). Member-visible + correctable (Phase 6); crisis-derived pattern memories inherit the crisis wall. |
| `daily_checkins`, `user_daily_state` | Mood, sleep, clarity. |
| `sobriety_tracker`, `reset_*` | Sobriety status. |
| `who5_scores`, `phq_gad_scores` | Clinical screeners. |
| `session_summaries` | Episodic conversation memory (may contain sensitive threads). |
| `riley_conversations` | Full chat transcripts. |
| `life_events`, `important_dates` | Losses, anniversaries. |

## Tier 2 — personal, not clinical
`user_profiles`, `profile_details`, `wellness_profile`, `wellness_plans`, `user_goals`,
`habits`, `fitness_logs`, `nutrition_logs`, `sleep_logs`, `member_docs`, `legacy_vault`,
`notification_consents`, `user_comms_state`, `email_log`, `email_sends`.

## Tier 3 — operational / behavioral (de-identified where analyzed)
`engagement_events`, `client_events`, `chat_turn_signals`, `recommendation_history`,
`content_interactions`, `api_cost_log` (hashed user ids only), `system_incidents`
(hashed ids only), `posthog_daily_conversions`.

## Tier 4 — non-personal content / config
`content_library`, `content_*` pipeline tables, `module_registry`, `tag_registry`,
`programs`, `products`, `plans`, `plan_entitlements`, `program_modules`, `int_sessions`,
`reset_days`, `canon_copy`, `app_settings`, `site_content`, `operating_expenses`.

## Hard rules
- Analytics (`track.js` / PostHog) carry **booleans/categories only** — never free text, never Tier-1 values.
- `api_cost_log` / `system_incidents` store a **SHA-256 hash prefix** of the user id, never the raw id, never message content (excerpts only where safety requires, e.g. post-hoc crisis review).
- All 110 tables have RLS enabled. Member reads are `auth.uid() = user_id`; service-role writes are server-side only.
