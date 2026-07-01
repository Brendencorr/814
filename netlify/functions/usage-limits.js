/**
 * usage-limits.js — shared usage-cap helpers (Riley Guide's caps, v4 pricing)
 *
 * The one place `currentPeriodStart()` is defined. Any function that checks OR
 * increments a usage counter must use THIS implementation — if the check and
 * the increment ever disagreed on what "this week" means, a cap could leak or
 * a member could get locked out early. Used by entitlements.js (display) and
 * riley-chat.js (actual enforcement).
 */

function currentPeriodStart(period) {
  const now = new Date();
  if (period === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
    return d;
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(0); // lifetime
}

/**
 * Is this user currently capped on featureKey, and how much do they have left?
 * Returns null if the feature isn't capped for them at all (uncapped tier, or
 * feature has no cap row for any product they own).
 */
async function getRemaining(sb, userId, featureKey, ownedProductKeys) {
  const { data: caps } = await sb.from('usage_limits').select('product_key, limit_amount, limit_period').eq('feature_key', featureKey);
  if (!caps || !caps.length) return null;
  const cap = caps.find(c => ownedProductKeys.includes(c.product_key));
  if (!cap) return null; // they don't own a product this cap applies to

  const periodStart = currentPeriodStart(cap.limit_period);
  const { data: row } = await sb.from('usage_counters')
    .select('count_used')
    .eq('user_id', userId).eq('feature_key', featureKey).eq('period_start', periodStart.toISOString())
    .maybeSingle();
  const used = row ? row.count_used : 0;
  return { remaining: Math.max(cap.limit_amount - used, 0), limit: cap.limit_amount, period: cap.limit_period, periodStart };
}

/** Increment usage after a successful consume of a capped feature. Non-fatal. */
async function incrementUsage(sb, userId, featureKey, periodStart) {
  try {
    await sb.rpc('increment_usage_counter', { p_user_id: userId, p_feature_key: featureKey, p_period_start: periodStart.toISOString() });
  } catch (e) {
    // Fallback if the RPC isn't installed yet — read-then-write (rare race, acceptable for a soft cap).
    try {
      const { data: row } = await sb.from('usage_counters').select('id, count_used')
        .eq('user_id', userId).eq('feature_key', featureKey).eq('period_start', periodStart.toISOString()).maybeSingle();
      if (row) {
        await sb.from('usage_counters').update({ count_used: row.count_used + 1 }).eq('id', row.id);
      } else {
        await sb.from('usage_counters').insert({ user_id: userId, feature_key: featureKey, period_start: periodStart.toISOString(), count_used: 1 });
      }
    } catch (e2) { console.warn('incrementUsage fallback failed (non-fatal):', e2.message); }
  }
}

module.exports = { currentPeriodStart, getRemaining, incrementUsage };
