-- Every payment event received from the Stripe/RockPaperCoin → Zapier webhook is logged here.
-- external_id (the Stripe/RPC invoice or charge id) is UNIQUE = idempotency: a replayed event
-- can't double-grant. status records the outcome so unmatched/ambiguous payments surface for the
-- operator instead of silently granting the wrong thing.
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  external_id  text unique,                 -- Stripe/RPC charge or invoice id (idempotency key)
  email        text,
  user_id      uuid,
  amount_cents integer,
  currency     text default 'usd',
  product      text,                          -- freetext invoice/product title (for audit)
  plan_id      text,                          -- resolved tier (companion|coach) if a subscription
  program_id   text,                          -- resolved program key if a one-time program
  term         text,                          -- monthly|annual|one_time
  status       text,                          -- granted|duplicate|unmatched|needs_review|ignored|error
  detail       text,
  raw          jsonb,
  created_at   timestamptz default now()
);

alter table public.payments enable row level security;
-- Service-role only (webhook writes, operator reads via a gated function). No anon/authenticated policies.
grant all privileges on table public.payments to service_role, postgres;
create index if not exists payments_email_idx on public.payments(email);
create index if not exists payments_created_idx on public.payments(created_at desc);

notify pgrst, 'reload schema';
