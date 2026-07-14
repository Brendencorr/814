-- 091_v23_two_tier_founding.sql
-- Riley v2.3 two-tier restructure: founding-cohort migration + Companion entitlement fold-up.
-- Safe + reversible. Does NOT touch real paying Coach subscriptions (those keep full access via the
-- v2.3 entitlement collapse; the Stripe billing downgrade to $19 is a founder action - see BUILD_LOG).

-- 1. founding_member flag (permanent recognition/offers for the early cohort)
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS founding_member boolean NOT NULL DEFAULT false;

-- 2. Every EXISTING member is a founding member. (New signups after this migration default false.)
UPDATE public.user_profiles SET founding_member = true WHERE founding_member = false;

-- 3. Companion now includes everything Coach had - upgrade Companion's plan_entitlements to Coach's
--    stronger values. (community stays false - it is the future "Coach - coming soon" teaser.)
UPDATE public.plan_entitlements SET value = 'true'            WHERE plan_id = 'companion' AND key = 'adaptive_plans';
UPDATE public.plan_entitlements SET value = 'proactive'       WHERE plan_id = 'companion' AND key = 'checkins';
UPDATE public.plan_entitlements SET value = 'full'            WHERE plan_id = 'companion' AND key = 'dashboards';
UPDATE public.plan_entitlements SET value = 'knowledge_graph' WHERE plan_id = 'companion' AND key = 'memory.level';
UPDATE public.plan_entitlements SET value = 'true'            WHERE plan_id = 'companion' AND key = 'personal_coaching';

-- 4. Fold COMPED coach/mentor/concierge subscriptions -> companion (safe: no Stripe billing attached).
--    Real (comped=false) Coach checkout subs are intentionally left grandfathered (full access already),
--    to avoid a DB/Stripe mismatch; the founder does the Stripe proration downgrade.
UPDATE public.subscriptions SET plan_id = 'companion'
 WHERE status = 'active' AND comped = true AND plan_id IN ('coach', 'mentor', 'concierge');

-- 5. Grant a founding-member Companion comp to every existing member with no active paid membership.
--    expires_at = NULL (indefinite) until the founder sets a founding-comp end date (D.2 open item;
--    configurable via app_settings 'founding_comp_until' + a future enforcement cron if desired).
INSERT INTO public.subscriptions (user_id, plan_id, term, status, comped, source, started_at, expires_at)
SELECT up.id, 'companion', 'comped', 'active', true, 'founding', now(), NULL
FROM public.user_profiles up
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE s.user_id = up.id AND s.status = 'active'
    AND s.plan_id IN ('companion', 'coach', 'mentor', 'concierge')
    AND (s.expires_at IS NULL OR s.expires_at > now())
);
