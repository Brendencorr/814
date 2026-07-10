-- 085: record the recipient's tier on every lifecycle send/decision, so the operator can see
-- at a glance which tier each email went to (Guide / Companion / Coach). Written by evaluate-comms decide().
alter table public.email_sends add column if not exists plan text;
