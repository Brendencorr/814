-- 074_push_config.sql — server-side home for the web-push VAPID keypair.
--
-- WHY: the VAPID keypair (public + private) was previously two Netlify env vars that had
-- to be hand-entered as a matched pair. That was error-prone (a blank/mismatched private
-- key silently disables all web push). Moving the keypair into a locked-down singleton
-- table makes it set-once, server-side, and stable — so browser push subscriptions (which
-- are bound to the public key at subscribe time) stay valid forever.
--
-- SECURITY: single row (id = 1). RLS enabled with NO policies → anon/authenticated are
-- fully denied. Only the service role (server functions using SUPABASE_SERVICE_KEY) can
-- read it, and the private key is NEVER returned to any client — the "key" endpoints
-- return only public_key. The keypair itself is seeded out-of-band (not in this file) so
-- no secret is ever committed to the repo.
--
-- READ PATH: supabase-client.getVapidConfig() — DB-first, falls back to the old env vars
-- if the row is somehow absent, so this is a safe, non-breaking migration.

create table if not exists public.push_config (
  id          smallint primary key default 1,
  public_key  text not null,
  private_key text not null,
  subject     text not null default 'mailto:hello@meetriley.us',
  updated_at  timestamptz not null default now(),
  constraint push_config_singleton check (id = 1)
);

comment on table public.push_config is
  'Singleton (id=1) web-push VAPID keypair. Service-role only; private_key never leaves the server. Keep stable so existing browser push subscriptions remain valid.';

alter table public.push_config enable row level security;

-- No policies are created on purpose: with RLS on and zero policies, anon + authenticated
-- get nothing. The service role bypasses RLS. Revoke table grants too, for defense in depth.
revoke all on public.push_config from anon, authenticated;
