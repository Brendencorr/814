# Entitlements — Admin Guide (Phase 1: Manual Grant)

How to grant/revoke access for any user **without a code deploy**.
Until Rock Paper Coin is wired, you grant entitlements by hand.

---

## The model in one paragraph

A user sees a dashboard feature only if they hold a **product** that unlocks it.
Products → `products` table. Who-owns-what → `entitlements` table. Which product
unlocks which feature → `feature_map` table. Concierge automatically includes all
programs (resolved live by the `user_active_products` view). Everyone with any
entitlement also gets the free 7-Day Reset.

---

## How to grant access (Supabase → SQL Editor)

### Find a user's ID by email
```sql
select id, email from auth.users where email = 'someone@example.com';
```

### Grant Riley Concierge (all-access subscription)
```sql
insert into entitlements (user_id, product_key, status, source, expires_at)
values ('<user-uuid>', 'concierge', 'active', 'manual_grant', null)
on conflict (user_id, product_key) do update set status = 'active';
```

### Grant Riley Companion
```sql
insert into entitlements (user_id, product_key, status, source, expires_at)
values ('<user-uuid>', 'companion', 'active', 'manual_grant', null)
on conflict (user_id, product_key) do update set status = 'active';
```

### Grant a single à la carte program (lifetime — never expires)
```sql
-- product_key options: prog_sobriety_90, prog_grief, prog_body_90,
--                       prog_first30, prog_eat, prog_move
insert into entitlements (user_id, product_key, status, source, expires_at)
values ('<user-uuid>', 'prog_sobriety_90', 'active', 'manual_grant', null)
on conflict (user_id, product_key) do update set status = 'active';
```

---

## How to revoke access

### Cancel a subscription (Companion/Concierge)
```sql
update entitlements set status = 'canceled'
where user_id = '<user-uuid>' and product_key = 'concierge';
```
> À la carte programs are lifetime — don't revoke them unless refunding.

### Fully remove an entitlement row
```sql
delete from entitlements
where user_id = '<user-uuid>' and product_key = 'companion';
```

---

## Check what a user can access right now
```sql
-- Resolved products (concierge already expanded to all programs)
select product_key from user_active_products where user_id = '<user-uuid>';
```

---

## Using the Supabase Table Editor (no SQL)

The `entitlements` table has RLS, but the **Table Editor uses the service role**,
so you can insert/edit rows there directly:

1. Supabase → Table Editor → `entitlements`
2. **Insert row**: set `user_id` (copy from `auth.users`), `product_key`
   (e.g. `concierge`), leave `status=active`, `source=manual_grant`,
   `expires_at` empty (= lifetime).
3. To revoke: edit the row, set `status` to `canceled`.

Changes take effect on the user's **next dashboard load** (entitlements are
cached per browser session — they may need to sign out/in or wait for the
session cache to clear).

---

## Editing what unlocks what (no deploy)

To change which products unlock a feature, edit the `feature_map` table:
```sql
-- e.g. make Sleep tracking available to à la carte body buyers too
update feature_map
set required_any = array['companion','concierge','prog_body_90']
where feature_key = 'tracker_sleep';
```

Set a feature to disappear entirely vs. show a locked upsell:
```sql
update feature_map set gate_mode = 'hidden'        where feature_key = 'roadmap';
update feature_map set gate_mode = 'locked_upsell' where feature_key = 'roadmap';
```

---

## Product reference

| product_key | what it is | price |
|---|---|---|
| `reset_free` | 7-Day Rebuild Reset | Free |
| `companion` | Riley Companion (subscription) | $19/mo |
| `concierge` | Riley Concierge (subscription, all programs) | $39/mo |
| `prog_sobriety_90` | 90-Day Sobriety Challenge | $97 lifetime |
| `prog_grief` | Carry Both (grief) | $37 lifetime |
| `prog_body_90` | Move & Nourish (body) | $97 lifetime |
| `prog_first30` | First 30 Days (hidden) | $37 lifetime |
| `prog_eat` | Eat to Rebuild (hidden) | $37 lifetime |
| `prog_move` | Move to Rebuild (hidden) | $37 lifetime |

---

## Phase 2 (later): Rock Paper Coin webhook

When RPC is ready, a webhook endpoint will insert/update the same
`entitlements` rows automatically (`source='purchase'` or `'subscription'`,
`external_ref` = RPC transaction id). On cancel/lapse it sets
`status='canceled'`. The dashboard and Riley read entitlements identically —
no other changes needed. The manual-grant path above stays as the admin
override.
