-- 083_social_design_review.sql
-- Adds the design-review gate to the Content Engine v3 lifecycle.
--
-- New flow: pending -> (approve copy: auto-assign + render a design via the Riley
-- grounds engine) -> 'designed' (Review) -> (publish: final approval) -> approved -> scheduled.
--
-- The design step fills content_creative_assets (was always empty) using
-- render_engine = 'riley-grounds' (netlify/functions/content-design.js), rendered
-- onto the six locked grounds and stored in the existing public 'content-assets'
-- Storage bucket (already present; no bucket/RLS change needed).

-- One additive enum value for content_approval_queue.status (review_status).
ALTER TYPE review_status ADD VALUE IF NOT EXISTS 'designed';
