-- ============================================================
-- 068_int_metrics_fn.sql — server-side aggregation for the operator interactive-program metrics.
--
-- Replaces the old admin-int-metrics.js pattern (fetch ALL int_* rows into the Lambda, aggregate in JS)
-- with one indexed GROUP BY in Postgres — so the operator metrics screen stays instant at thousands of
-- enrollments instead of transferring + aggregating 75k+ rows per open. CTEs pre-aggregate each child
-- table once (no cartesian fan-out), then join 1:1 to enrollments. Locked to the service role.
-- Safe to re-run. Requires 060.
-- ============================================================

CREATE OR REPLACE FUNCTION int_program_metrics()
RETURNS TABLE (
  program_key   text,
  enrolled      bigint,
  session_zero  bigint,
  session_four  bigint,
  graduated     bigint,
  commitments   bigint,
  confirmed     bigint,
  artifacts     bigint,
  lapse_active  bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  s0 AS (SELECT DISTINCT enrollment_id FROM int_session_progress WHERE session_number = 0),
  s4 AS (SELECT DISTINCT enrollment_id FROM int_session_progress WHERE session_number = 4),
  cm AS (SELECT enrollment_id, count(*) AS n, count(*) FILTER (WHERE confirmed_state IS NOT NULL) AS c
           FROM int_commitments GROUP BY enrollment_id),
  ar AS (SELECT enrollment_id, count(*) AS n FROM int_artifacts GROUP BY enrollment_id)
  SELECT
    e.program_key,
    count(*)                                                                              AS enrolled,
    count(*) FILTER (WHERE s0.enrollment_id IS NOT NULL)                                  AS session_zero,
    count(*) FILTER (WHERE e.current_session >= 4 OR s4.enrollment_id IS NOT NULL)         AS session_four,
    count(*) FILTER (WHERE e.graduated_at IS NOT NULL)                                    AS graduated,
    COALESCE(sum(cm.n), 0)                                                                AS commitments,
    COALESCE(sum(cm.c), 0)                                                                AS confirmed,
    COALESCE(sum(ar.n), 0)                                                                AS artifacts,
    count(*) FILTER (WHERE e.lapse_state = 'lapse_active')                                AS lapse_active
  FROM int_enrollments e
  LEFT JOIN s0 ON s0.enrollment_id = e.id
  LEFT JOIN s4 ON s4.enrollment_id = e.id
  LEFT JOIN cm ON cm.enrollment_id = e.id
  LEFT JOIN ar ON ar.enrollment_id = e.id
  GROUP BY e.program_key;
$$;

-- Server-only: the operator function calls this with the service key. Block client keys.
REVOKE ALL ON FUNCTION int_program_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION int_program_metrics() FROM anon, authenticated;
