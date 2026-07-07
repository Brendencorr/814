/**
 * admin-comms.js — operator CRUD for the lifecycle email templates ("Client Onboarding
 * Communication" tab). OPERATOR_KEY-gated.
 *
 * GET  → all 17 templates grouped into the 4 flows (guide, gone_quiet, paid, addon), each with the
 *        EFFECTIVE content (code default merged with any comms_templates override), a rendered HTML
 *        preview (sample vars), and whether it's been edited.
 * PUT  → upsert one override { template_key, subject?, preview?, from_sender?, trigger_label?,
 *        trigger_days?, body_text?, button_label?, button_url?, enabled? }.
 * POST { action:"reset", template_key } → delete the override (revert to the verbatim code copy).
 *
 * comms-templates.js stays the verbatim fallback — a row only overrides the fields the operator
 * changed. Edits here change what evaluate-comms sends (it reads these overrides), but NOTHING
 * sends while COMMS_ENABLED is unset (dark). Model: n/a.
 */
const { getSupabaseClient, requireOperator } = require("./supabase-client");
const { TEMPLATES, TRIGGERS, render, SENDERS } = require("./comms-templates");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-operator-key",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(o) });

const FLOWS = [
  { key: "guide",      title: "Guide Flow",       blurb: "Free onboarding — the first two weeks after signup." },
  { key: "gone_quiet", title: "Gone Quiet Flow",  blurb: "Gentle win-back for members who drift, in escalating steps." },
  { key: "paid",       title: "Paid Member Flow", blurb: "Receipt, memory welcome, and a founder check-in for subscribers." },
  { key: "addon",      title: "Add-on Flow",      blurb: "One-time $8.14 program purchases — receipt + a nudge to open." },
];

// Realistic sample vars so {placeholders} render in the preview.
const SAMPLE = { first_name: "Alex", n: 3, module_title: "Grounding", module_theme: "grounding", session_count: 12, plan: "Companion", price: "$19/mo", renewal_date: "August 5", program_name: "Living Forward" };
const SAMPLE_URLS = { unsub: "https://riley.meetriley.us/.netlify/functions/comms-unsubscribe?u=preview", pref: "https://riley.meetriley.us/preferences?u=preview" };

const EDITABLE = ["subject", "preview", "from_sender", "trigger_label", "trigger_days", "body_text", "button_label", "button_url", "enabled"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const gate = requireOperator(event); if (gate) return gate;
  const sb = getSupabaseClient();

  try {
    if (event.httpMethod === "GET") {
      const { data: rows } = await sb.from("comms_templates").select("*");
      const byKey = {}; (rows || []).forEach((r) => (byKey[r.template_key] = r));
      const flows = FLOWS.map((f) => ({ ...f, templates: [] }));
      const flowIndex = {}; flows.forEach((f, i) => (flowIndex[f.key] = i));
      Object.keys(TRIGGERS).forEach((key) => {
        const t = TEMPLATES[key], tr = TRIGGERS[key], o = byKey[key] || {};
        const eff = render(key, SAMPLE, SAMPLE_URLS, o);
        flows[flowIndex[tr.flow]].templates.push({
          template_key: key, flow: tr.flow, seq: tr.seq,
          transactional: !!t.transactional, author: eff.author,
          subject: o.subject != null ? o.subject : t.subject,
          preview: o.preview != null ? o.preview : t.preview,
          from_sender: o.from_sender || t.from,
          trigger_label: o.trigger_label != null ? o.trigger_label : tr.label,
          trigger_days: o.trigger_days != null ? o.trigger_days : tr.days,
          body_text: (o.body_text != null && o.body_text !== "") ? o.body_text : t.text(SAMPLE),
          button_label: o.button_label || "",
          button_url: o.button_url || "",
          enabled: o.enabled != null ? o.enabled : true,
          edited: !!byKey[key],
          updated_at: o.updated_at || null,
          preview_html: eff.html,
          preview_subject: eff.subject,
          from_email: eff.from,
          reply_to: eff.replyTo,
        });
      });
      flows.forEach((f) => f.templates.sort((a, b) => a.seq - b.seq));
      return json(200, { flows, comms_enabled: String(process.env.COMMS_ENABLED || "").toLowerCase() === "true" });
    }

    const body = JSON.parse(event.body || "{}");
    const key = (body.template_key || "").toString();
    if (!TRIGGERS[key]) return json(400, { error: "unknown template_key" });

    // Non-persisting render of unsaved edits (the "Update preview" button).
    if (event.httpMethod === "POST" && body.action === "preview") {
      const eff = render(key, SAMPLE, SAMPLE_URLS, body);
      return json(200, { ok: true, preview_html: eff.html, preview_subject: eff.subject });
    }

    if (event.httpMethod === "POST" && body.action === "reset") {
      await sb.from("comms_templates").delete().eq("template_key", key);
      const eff = render(key, SAMPLE, SAMPLE_URLS, {});
      return json(200, { ok: true, reset: key, preview_html: eff.html, preview_subject: eff.subject });
    }

    if (event.httpMethod === "PUT" || event.httpMethod === "POST") {
      const patch = { template_key: key, updated_at: new Date().toISOString(), updated_by: "operator" };
      EDITABLE.forEach((f) => { if (f in body) patch[f] = body[f]; });
      if ("trigger_days" in patch) patch.trigger_days = (patch.trigger_days === "" || patch.trigger_days == null) ? null : parseInt(patch.trigger_days, 10);
      if ("enabled" in patch) patch.enabled = !!patch.enabled;
      if ("from_sender" in patch && patch.from_sender !== "riley" && patch.from_sender !== "brenden") delete patch.from_sender;
      await sb.from("comms_templates").upsert(patch, { onConflict: "template_key" });
      const { data: rows } = await sb.from("comms_templates").select("*").eq("template_key", key);
      const o = (rows && rows[0]) || {};
      const eff = render(key, SAMPLE, SAMPLE_URLS, o);
      return json(200, { ok: true, template_key: key, edited: true, preview_html: eff.html, preview_subject: eff.subject });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
