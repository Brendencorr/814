-- ============================================================
-- 048_operator_push.sql — Operator/admin DEVICE push for new-member alerts
--
-- Registers admin *devices* (not member subscriptions) that receive a web-push
-- whenever a new member signs up. Written/read ONLY by service-key server functions
-- (operator-push.js + operator-notify.js), which are OPERATOR_KEY-gated. Holds NO
-- member data — only the operator's own push endpoint + an optional device label.
-- Run AFTER 047. Safe to re-run.
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint      text NOT NULL UNIQUE,           -- the push endpoint = the device identity
  subscription  jsonb NOT NULL,                 -- full PushSubscription (endpoint + keys)
  label         text,                           -- friendly name the operator types ("Brenden — iPhone")
  tz            text DEFAULT 'America/Denver',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz
);

-- Fast lookup of the devices the signup hook fans out to.
CREATE INDEX IF NOT EXISTS idx_operator_push_active ON operator_push_subscriptions (active) WHERE active;

-- Operator-only table: lock it to server (service-key) access. RLS ON with NO policies
-- means anon/authenticated clients get zero rows; the service key bypasses RLS as usual.
ALTER TABLE operator_push_subscriptions ENABLE ROW LEVEL SECURITY;
