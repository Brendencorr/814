-- Map a Stripe Customer back to a Riley member. Set on checkout.session.completed; used by later
-- subscription/invoice/refund events (which arrive keyed by customer, not user) to find the member.
alter table public.user_profiles add column if not exists stripe_customer_id text;
create index if not exists user_profiles_stripe_customer_idx on public.user_profiles(stripe_customer_id);
notify pgrst, 'reload schema';
