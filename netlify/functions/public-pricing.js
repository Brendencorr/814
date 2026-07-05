/**
 * public-pricing.js — Public pricing feed for the marketing site (Squarespace).
 *
 * No auth — this is meant to be fetched directly from meetriley.us. Returns only
 * `live` and `locked` products (never `draft`, so Riley Mentor stays invisible
 * everywhere but the operator Pricing tab until it's explicitly flipped live —
 * no manual exclusion logic needed on the Squarespace side).
 *
 * GET /.netlify/functions/public-pricing
 *   → [{ key, name, price_cents, recurring, status, blurb, tier_level, checkout_url }]
 *
 * See supabase/migrations/033_pricing_v4.sql + 03_squarespace_guide.md (v4)
 * for the embed snippet this feeds.
 */

const { getSupabaseClient } = require("./supabase-client");

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  try {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from("products")
      .select("product_key,display_name,price_cents,recurring,status,blurb,sort_order,tier_level")
      .in("status", ["live", "locked"])
      .eq("visible_on_menu", true)
      .order("sort_order");
    if (error) throw error;

    const out = (data || []).map(p => ({
      key: p.product_key,
      name: p.display_name,
      price_cents: p.price_cents,
      recurring: p.recurring,
      status: p.status,
      blurb: p.blurb,
      tier_level: p.tier_level,
      checkout_url: p.status !== "live" ? null
                  : p.product_key === "reset_free" ? "/signup"
                  : `/checkout/${p.product_key}`,
    }));

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(out),
    };
  } catch (err) {
    console.error("public-pricing error:", err.message);
    return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Failed to load pricing" }) };
  }
};
