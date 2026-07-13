-- 087: store the Stripe coupon/promo-code a member redeemed at checkout onto their subscription row.
alter table public.subscriptions add column if not exists stripe_coupon_id text;
alter table public.subscriptions add column if not exists promo_code text;
