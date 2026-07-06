-- 047_notification_prefs.sql — member notification preferences.
--
-- Two booleans on user_profiles, DEFAULT TRUE so new signups get notifications on and existing
-- members are unchanged. Editable in Settings. Honored by the crons:
--   email_notifications=false → brief-delivery-cron + reengagement-cron skip that member's EMAIL.
--   push_notifications=false  → reset-nudge-cron skips that member's PUSH.
-- SAFETY messages (crisis-followup) are intentionally NOT gated by these — they always send.
-- Idempotent — safe to re-run. Run AFTER 046.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS push_notifications  boolean NOT NULL DEFAULT true;
