-- ============================================================
-- 044_admin_audit.sql — Doc 3 Phase 2: append-only operator audit log.
-- Every admin override (comp, weekend, à la carte grant, credit, reset-reset) writes a row here
-- via admin-comp.js. Service-role only (no anon policy) — operator functions read/write with the
-- service key. Run AFTER 043. Safe to re-run.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_audit (
  id          bigserial PRIMARY KEY,
  action      text NOT NULL,
  target_user uuid,
  detail      jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE admin_audit ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policy: only the service key (operator functions) can touch it.
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit(created_at DESC);
