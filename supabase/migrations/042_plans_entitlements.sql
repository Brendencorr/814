-- ============================================================
-- 042_plans_entitlements.sql — Doc 0 §7: ENTITLEMENTS AS DATA (v4 canonical)
--
-- The single source of truth for tiers, prices, and entitlements. All three
-- surfaces (website, client app, admin) read these rows — changing a price or
-- entitlement is ONE row update, reflected everywhere, no deploy.
--
-- Additive + backward-compatible: the app falls back to the legacy
-- products/feature_map/user_active_products system until these are seeded, so
-- deploying the code never breaks live gating. Run AFTER 041. Safe to re-run.
-- ============================================================

-- ── Catalog: plans + their entitlements (public-read, like other catalogs) ──
CREATE TABLE IF NOT EXISTS plans (
  id                  text PRIMARY KEY,          -- 'guide' | 'companion' | 'coach' | 'mentor'
  name                text NOT NULL,
  tagline             text,
  price_monthly_cents int,                        -- null = free / unpriced
  price_annual_cents  int,
  annual_savings_cents int,
  anchor_line         text,                        -- e.g. 'Less than one hour of therapy — per month.'
  badge               text,                        -- e.g. 'The primary membership'
  sort_order          int DEFAULT 0,
  status              text DEFAULT 'active',       -- active | future
  active              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
);
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans read" ON plans;
CREATE POLICY "plans read" ON plans FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  key     text NOT NULL,                           -- e.g. 'chat.daily_reply_limit'
  value   text NOT NULL,                           -- stored as text; parsed per-key
  PRIMARY KEY (plan_id, key)
);
ALTER TABLE plan_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_ent read" ON plan_entitlements;
CREATE POLICY "plan_ent read" ON plan_entitlements FOR SELECT USING (true);

-- ── Per-user commerce state (owner-scoped) ──
CREATE TABLE IF NOT EXISTS subscriptions (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL,
  plan_id    text NOT NULL,
  term       text,                                 -- monthly | annual | weekend | comped
  status     text DEFAULT 'active',                -- active | expired | canceled | comped
  comped     boolean DEFAULT false,
  source     text,                                 -- 'checkout' | 'comp' | 'companion_weekend' | ...
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz,                           -- weekend grants + comps with an expiry
  created_at timestamptz DEFAULT now()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own subs" ON subscriptions;
CREATE POLICY "own subs" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS purchases (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL,
  program_id   text NOT NULL,                       -- 'sobriety' | 'grief' | 'body_rebuild'
  amount_cents int NOT NULL DEFAULT 814,
  purchased_at timestamptz DEFAULT now()
);
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own purchases" ON purchases;
CREATE POLICY "own purchases" ON purchases FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS credits (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL,
  amount_cents       int NOT NULL DEFAULT 814,
  source_purchase_id bigint,
  expires_at         timestamptz,                   -- 90 days from purchase
  redeemed_at        timestamptz,
  created_at         timestamptz DEFAULT now()
);
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own credits" ON credits;
CREATE POLICY "own credits" ON credits FOR SELECT USING (auth.uid() = user_id);

-- ── Chat usage (Doc 0 §4): per user per user-local day ──
CREATE TABLE IF NOT EXISTS chat_usage (
  user_id             uuid NOT NULL,
  date                date NOT NULL,               -- user-local day; 5am reset handled in code
  reply_count         int DEFAULT 0,
  crisis_exempt_count int DEFAULT 0,
  updated_at          timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, date)
);
ALTER TABLE chat_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own chat usage" ON chat_usage;
CREATE POLICY "own chat usage" ON chat_usage FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Canonical events (Doc 0 §9) — the ONLY source for admin metrics ──
CREATE TABLE IF NOT EXISTS events (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  name       text NOT NULL,                         -- canonical event names only
  props      jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own events insert" ON events;
CREATE POLICY "own events insert" ON events FOR INSERT WITH CHECK (auth.uid() = user_id);
-- admin/metrics reads happen server-side via the service key (bypasses RLS).
CREATE INDEX IF NOT EXISTS events_name_created_idx ON events(name, created_at);
CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id);

-- ── payments_live flag (Doc 0 §7) — default false; gates all checkout ──
INSERT INTO app_settings (key, value) VALUES ('payments_live', 'false')
  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SEED — plans (Doc 0 §2, LOCKED)
-- ============================================================
INSERT INTO plans (id, name, tagline, price_monthly_cents, price_annual_cents, annual_savings_cents, anchor_line, badge, sort_order, status) VALUES
('guide',     'Riley Guide',     'For people who simply want to begin.',       0,    0,     0,    NULL,                                        NULL,                     1, 'active'),
('companion', 'Riley Companion', 'You''re not doing this alone.',              1900, 17500, 5300, 'Less than one hour of therapy — per month.', 'The primary membership', 2, 'active'),
('coach',     'Riley Coach',     'Personalized guidance that grows with you.', 3400, 35000, 5800, NULL,                                        NULL,                     3, 'active'),
('mentor',    'Riley Mentor',    NULL,                                         NULL, NULL,  NULL, NULL,                                        NULL,                     4, 'future')
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name, tagline=EXCLUDED.tagline, price_monthly_cents=EXCLUDED.price_monthly_cents,
  price_annual_cents=EXCLUDED.price_annual_cents, annual_savings_cents=EXCLUDED.annual_savings_cents,
  anchor_line=EXCLUDED.anchor_line, badge=EXCLUDED.badge, sort_order=EXCLUDED.sort_order, status=EXCLUDED.status;

-- ============================================================
-- SEED — plan_entitlements (Doc 0 §3 matrix, LOCKED)
-- ============================================================
INSERT INTO plan_entitlements (plan_id, key, value) VALUES
('guide','chat.daily_reply_limit','20'),   ('guide','memory.level','session'),        ('guide','programs.access','module_1_only'),
('guide','checkins','weekly'),             ('guide','habit_tracker','false'),         ('guide','resource_library','starter'),
('guide','workshops.monthly','false'),     ('guide','adaptive_plans','false'),        ('guide','dashboards','basic'),
('guide','personal_coaching','false'),     ('guide','community','false'),
('companion','chat.daily_reply_limit','unlimited'), ('companion','memory.level','longterm'),   ('companion','programs.access','full'),
('companion','checkins','daily'),          ('companion','habit_tracker','true'),      ('companion','resource_library','full'),
('companion','workshops.monthly','true'),  ('companion','adaptive_plans','false'),    ('companion','dashboards','light'),
('companion','personal_coaching','false'), ('companion','community','false'),
('coach','chat.daily_reply_limit','unlimited'),     ('coach','memory.level','knowledge_graph'), ('coach','programs.access','full'),
('coach','checkins','proactive'),          ('coach','habit_tracker','true'),          ('coach','resource_library','full'),
('coach','workshops.monthly','true'),      ('coach','adaptive_plans','true'),         ('coach','dashboards','full'),
('coach','personal_coaching','true'),      ('coach','community','false')
ON CONFLICT (plan_id, key) DO UPDATE SET value=EXCLUDED.value;
