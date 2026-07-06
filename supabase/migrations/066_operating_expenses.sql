-- 066_operating_expenses.sql (renumbered — 061-065 taken by the INT branch; table already applied live)
-- Operator finance: editable operating-cost line items for the Riley Overview tab.
-- Revenue is computed live from `subscriptions` (no table needed); this is the expense side.
-- Deny-all RLS (operator/service-key only, like admin tables). Seed = the cost tracker spreadsheet.
-- NOTE (037 lesson): new tables need explicit grants to service_role or the key hits 42501.

create table if not exists public.operating_expenses (
  id             uuid primary key default gen_random_uuid(),
  service        text not null,
  category       text,
  amount_monthly numeric(10,2) not null default 0,   -- normalized to $/month (annual ÷ 12)
  billing        text default 'monthly',             -- monthly | annual | usage | per-transaction
  status         text not null default 'active'
                   check (status in ('active','upcoming','optional','retired')),
  notes          text,
  sort_order     int not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.operating_expenses enable row level security;  -- service-key only
grant all privileges on public.operating_expenses to service_role, postgres;

-- Seed once (only if the table is empty) from the cost tracker. amount_monthly = current burn.
insert into public.operating_expenses (service, category, amount_monthly, billing, status, notes, sort_order)
select * from (values
  ('Anthropic (Claude)','AI / LLM',            100.00,'monthly',        'active',  '$100 plan + API usage on api.anthropic.com', 10),
  ('ChatGPT',           'AI / tooling',          20.00,'monthly',        'active',  'Your dev/content assistant (not in runtime)', 20),
  ('Netlify',           'Hosting / serverless',  19.00,'monthly',        'active',  'Pro removes fn timeout; +usage over limits', 30),
  ('Supabase',          'Database / Auth',       25.00,'monthly',        'active',  'Pro recommended for prod', 40),
  ('GitHub',            'Version control',        0.00,'monthly',        'active',  'Free for this repo; ~$4/mo if Pro', 50),
  ('GoDaddy',           'Domain',                 2.00,'annual',         'active',  'meetriley.us ~$20-25/yr (normalized to /mo)', 60),
  ('FeedHive',          'Social publishing',     19.00,'monthly',        'active',  'Replaced Buffer; 2 accounts connected', 70),
  ('PostHog',           'Product analytics',      0.00,'monthly',        'active',  'Free tier; usage-based above ~1M events/mo', 80),
  ('Canva',             'Design',                15.00,'monthly',        'active',  'Pro ~$15/mo; Connect API (Phase 2)', 90),
  ('Resend',            'Email (transactional)',  0.00,'monthly',        'upcoming','In code, dormant until RESEND_API_KEY set; free 3k/mo', 100),
  ('Stripe',            'Payments',               0.00,'per-transaction','upcoming','2.9% + $0.30 per charge; not connected yet', 110),
  ('Metricool',         'Social analytics',       0.00,'monthly',        'optional','~$18/mo if used', 120),
  ('Creatomate',        'Video / design gen',     0.00,'usage',          'upcoming','Phase 2; usage-based', 130),
  ('Cloudflare',        'Security / CDN',         0.00,'monthly',        'optional','Likely free tier; ~$20/mo Pro if needed', 140),
  ('Google Workspace',  'Email (domain)',         0.00,'monthly',        'optional','Only if support@ runs on Workspace', 150),
  ('Buffer',            'Social publishing',      0.00,'monthly',        'retired', 'Replaced by FeedHive — cancel if still billing', 160)
) as v(service,category,amount_monthly,billing,status,notes,sort_order)
where not exists (select 1 from public.operating_expenses);

notify pgrst, 'reload schema';
