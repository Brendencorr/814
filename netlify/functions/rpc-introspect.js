/**
 * rpc-introspect.js — TEMPORARY discovery tool. OPERATOR_KEY-gated.
 *
 * Reads RPC_API_KEY from env (never returns it) and runs a focused GraphQL introspection against
 * https://api.app.rockpapercoin.com/graphql to discover the available queries + mutations, so we can
 * build the real poller/checkout against RPC's actual schema. Tries the common API-key auth styles
 * and reports which one worked. Remove this function once the integration is built.
 */
const { requireOperator } = require("./supabase-client");

const ENDPOINT = process.env.RPC_ENDPOINT || "https://api.app.rockpapercoin.com/graphql";
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });

// Focused introspection: names/args/return types of every top-level query + mutation.
const Q = `{ __schema {
  queryType { fields { name args { name type { kind name ofType { kind name } } } type { kind name ofType { kind name ofType { kind name } } } } }
  mutationType { fields { name args { name type { kind name ofType { kind name } } } type { kind name ofType { kind name } } } }
} }`;

async function tryAuth(headers) {
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ query: Q }),
    });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch (_) { body = { raw: text.slice(0, 400) }; }
    const ok = r.ok && body && body.data && body.data.__schema;
    return { ok, status: r.status, body };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

exports.handler = async (event) => {
  const gate = requireOperator(event); if (gate) return gate;
  const key = process.env.RPC_API_KEY;
  if (!key) return json(503, { error: "RPC_API_KEY not set" });

  const styles = [
    { label: "Authorization: Bearer", headers: { Authorization: "Bearer " + key } },
    { label: "Authorization: raw", headers: { Authorization: key } },
    { label: "x-api-key", headers: { "x-api-key": key } },
    { label: "apikey", headers: { apikey: key } },
    { label: "X-API-KEY", headers: { "X-API-KEY": key } },
  ];

  const attempts = [];
  for (const s of styles) {
    const res = await tryAuth(s.headers);
    attempts.push({ auth: s.label, ok: res.ok, status: res.status, error: res.error, errors: res.body && res.body.errors });
    if (res.ok) {
      const sch = res.body.data.__schema;
      const simplify = (f) => ({ name: f.name, args: (f.args || []).map((a) => a.name), returns: JSON.stringify(f.type) });
      return json(200, {
        ok: true,
        working_auth: s.label,
        queries: (sch.queryType && sch.queryType.fields || []).map(simplify),
        mutations: (sch.mutationType && sch.mutationType.fields || []).map(simplify),
      });
    }
  }
  return json(200, { ok: false, note: "no auth style returned a schema", attempts });
};
