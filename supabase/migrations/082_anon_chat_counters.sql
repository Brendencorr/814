-- 082_anon_chat_counters.sql
-- Server-side daily cap for anonymous marketing chat (chat-anon.html → riley-chat.js).
-- Two counters per row:
--   anon_id  - UUID stored in the visitor's localStorage; product cap (20/day = Guide limit)
--   ip_hash  - SHA-256 of the client IP; abuse ceiling (100/day = 5× product cap)
--
-- The table is intentionally tiny: rows are soft-deleted after 48 h by a separate
-- scheduled sweep (or just left to grow slowly; the unique key + the 48h index keep
-- queries fast). No PII is stored: IP is hashed before INSERT from the function.

CREATE TABLE IF NOT EXISTS anon_chat_counters (
  id           bigserial PRIMARY KEY,
  key_type     text        NOT NULL CHECK (key_type IN ('anon_id', 'ip_hash')),
  key_value    text        NOT NULL,
  period_date  date        NOT NULL,  -- UTC calendar date (resets each day)
  count_used   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_type, key_value, period_date)
);

-- Fast lookup: type+value+date is always the access pattern
CREATE INDEX IF NOT EXISTS idx_anon_chat_counters_lookup
  ON anon_chat_counters (key_type, key_value, period_date);

-- Cleanup: anything older than 2 days is safe to prune (no cap state needed)
CREATE INDEX IF NOT EXISTS idx_anon_chat_counters_period
  ON anon_chat_counters (period_date);

-- RLS: anon key must NOT be able to read or write this table directly.
-- The function uses the SERVICE key, so no row-level policy is needed for
-- the server - we just block all direct client access.
ALTER TABLE anon_chat_counters ENABLE ROW LEVEL SECURITY;
-- No policies = no client access (service key bypasses RLS).

-- Increment-or-insert RPC so the Netlify function can do a single round-trip.
-- Returns the NEW count after increment. Used for both anon_id and ip_hash rows.
CREATE OR REPLACE FUNCTION increment_anon_counter(
  p_key_type   text,
  p_key_value  text,
  p_date       date
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO anon_chat_counters (key_type, key_value, period_date, count_used, updated_at)
  VALUES (p_key_type, p_key_value, p_date, 1, now())
  ON CONFLICT (key_type, key_value, period_date)
  DO UPDATE SET
    count_used = anon_chat_counters.count_used + 1,
    updated_at = now()
  RETURNING count_used INTO v_count;
  RETURN v_count;
END;
$$;

-- Read-only RPC (no increment) for the pre-check before the cap decision.
CREATE OR REPLACE FUNCTION get_anon_counter(
  p_key_type   text,
  p_key_value  text,
  p_date       date
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count_used INTO v_count
  FROM anon_chat_counters
  WHERE key_type = p_key_type
    AND key_value = p_key_value
    AND period_date = p_date;
  RETURN COALESCE(v_count, 0);
END;
$$;
