-- Operator-editable overrides for lifecycle email templates. Rows are created only when the
-- operator edits a template; comms-templates.js remains the verbatim fallback for any null field
-- or missing row. Service-role only (writes go through the OPERATOR_KEY-gated admin-comms fn).
create table if not exists public.comms_templates (
  template_key  text primary key,
  subject       text,
  preview       text,
  from_sender   text,        -- 'riley' | 'brenden'  (null = code default)
  trigger_label text,        -- human-readable timing note (editable, display)
  trigger_days  integer,     -- guide-flow day threshold override (null = code default)
  body_text     text,        -- edited body, plain text, blank-line-separated paragraphs (null = code default)
  button_label  text,
  button_url    text,
  enabled       boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

alter table public.comms_templates enable row level security;
-- No anon/authenticated policies: reads + writes are server-side (service role) only.
grant all privileges on table public.comms_templates to service_role, postgres;

notify pgrst, 'reload schema';
